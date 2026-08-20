import dialogService, { type DialogService } from '../../utils/dialog.js';

type UserDataManagementDialog = Pick<
  DialogService,
  'showAlert' | 'showConfirm'
>;

const MAX_CSV_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export class UserDataManagementManager {
  private importForm: HTMLFormElement | null = null;
  private exportForm: HTMLFormElement | null = null;
  private importButton: HTMLButtonElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private csvFileInput: HTMLInputElement | null = null;
  private clearLogForm: HTMLFormElement | null = null;
  private includePasswordsCheckbox: HTMLInputElement | null = null;
  private includeSensitiveDataCheckbox: HTMLInputElement | null = null;
  private tabs: NodeListOf<HTMLButtonElement> | null = null;
  private panels: NodeListOf<HTMLElement> | null = null;

  public constructor(
    private readonly dialog: UserDataManagementDialog = dialogService
  ) {}

  public initialize(): void {
    this.cacheElements();
    this.setupEventListeners();
    this.setupTabs();
  }

  private cacheElements(): void {
    this.importForm = document.getElementById(
      'importForm'
    ) as HTMLFormElement | null;
    this.exportForm = document.getElementById(
      'exportForm'
    ) as HTMLFormElement | null;
    this.importButton = document.getElementById(
      'importBtn'
    ) as HTMLButtonElement | null;
    this.exportButton = document.getElementById(
      'exportBtn'
    ) as HTMLButtonElement | null;
    this.csvFileInput = document.getElementById(
      'csvFile'
    ) as HTMLInputElement | null;
    this.clearLogForm = document.getElementById(
      'clear-log-form'
    ) as HTMLFormElement | null;
    this.includePasswordsCheckbox = document.getElementById(
      'includePasswords'
    ) as HTMLInputElement | null;
    this.includeSensitiveDataCheckbox = document.getElementById(
      'includeSensitiveData'
    ) as HTMLInputElement | null;
    this.tabs = document.querySelectorAll('.data-tab-btn');
    this.panels = document.querySelectorAll('.data-tab-panel');
  }

  private setupTabs(): void {
    this.tabs?.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        if (!targetTab) return;

        this.tabs?.forEach(candidate => {
          const isActive = candidate.dataset.tab === targetTab;
          candidate.setAttribute('aria-selected', String(isActive));
          candidate.classList.toggle('border-primary', isActive);
          candidate.classList.toggle('text-primary', isActive);
          candidate.classList.toggle('border-transparent', !isActive);
          candidate.classList.toggle('text-muted-foreground', !isActive);
        });

        this.panels?.forEach(panel => {
          panel.classList.toggle('hidden', panel.id !== `${targetTab}-panel`);
        });
      });
    });
  }

  private setupEventListeners(): void {
    this.csvFileInput?.addEventListener('change', event =>
      this.handleFileChange(event)
    );
    this.importForm?.addEventListener('submit', event =>
      this.handleImportSubmit(event)
    );
    this.exportForm?.addEventListener('submit', event =>
      this.handleExportSubmit(event)
    );
    this.clearLogForm?.addEventListener('submit', event =>
      this.handleClearLogSubmit(event)
    );
  }

  private async handleFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
      await this.dialog.showAlert(
        'File Too Large',
        `Maximum file size is 10MB.\nYour file: ${(
          file.size /
          1024 /
          1024
        ).toFixed(2)}MB`,
        { variant: 'error' }
      );
      input.value = '';
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      await this.dialog.showAlert(
        'Invalid File Type',
        'Please select a CSV file.\nAccepted: .csv files only',
        { variant: 'error' }
      );
      input.value = '';
    }
  }

  private async handleImportSubmit(event: Event): Promise<void> {
    if (!this.csvFileInput?.files?.length) {
      event.preventDefault();
      await this.dialog.showAlert(
        'No File Selected',
        'Please select a CSV file to import.',
        { variant: 'warning' }
      );
      return;
    }

    if (this.csvFileInput.files[0]!.size > MAX_CSV_FILE_SIZE_BYTES) {
      event.preventDefault();
      await this.dialog.showAlert(
        'File Too Large',
        'Maximum file size is 10MB.',
        { variant: 'error' }
      );
      return;
    }

    if (this.importButton) {
      this.importButton.disabled = true;
      this.importButton.innerHTML = `${this.getLoadingSpinner()}Importing...`;
    }
  }

  private async handleExportSubmit(event: Event): Promise<void> {
    const includePasswords = this.includePasswordsCheckbox?.checked ?? false;
    const includeSensitive =
      this.includeSensitiveDataCheckbox?.checked ?? false;

    if (!includePasswords && !includeSensitive) {
      this.showExportLoadingState();
      return;
    }

    const warnings: string[] = [];
    if (includePasswords) warnings.push('- Password hashes (encrypted)');
    if (includeSensitive) {
      warnings.push('- Personal information (phone, address, etc.)');
    }

    event.preventDefault();
    const confirmed = await this.dialog.showConfirm(
      'Sensitive Data Export',
      `You are about to export:\n${warnings.join(
        '\n'
      )}\n\nThis file will contain sensitive user data.\nPlease handle it securely and comply with data protection regulations.\n\nContinue with export?`,
      {
        variant: 'warning',
        confirmText: 'Export',
        cancelText: 'Cancel',
      }
    );

    if (confirmed) {
      this.exportForm?.submit();
    }
  }

  private showExportLoadingState(): void {
    if (!this.exportButton) return;

    this.exportButton.disabled = true;
    this.exportButton.innerHTML = `${this.getLoadingSpinner()}Exporting...`;

    setTimeout(() => {
      if (!this.exportButton) return;

      this.exportButton.disabled = false;
      this.exportButton.innerHTML =
        '<i data-lucide="download" class="h-4 w-4 mr-2"></i>Export to CSV';
      window.lucide?.createIcons();
    }, 2000);
  }

  private async handleClearLogSubmit(event: Event): Promise<void> {
    event.preventDefault();

    const errorCount =
      this.clearLogForm
        ?.closest('.bg-card')
        ?.querySelector('.text-xs.text-muted-foreground')?.textContent || 'all';
    const confirmed = await this.dialog.showConfirm(
      'Clear All Import Errors',
      `This will permanently remove ${errorCount} error logs. This action cannot be undone.\n\nContinue?`,
      {
        variant: 'danger',
        confirmText: 'Clear All',
        cancelText: 'Cancel',
      }
    );

    if (confirmed) {
      this.clearLogForm?.submit();
    }
  }

  private getLoadingSpinner(): string {
    return `<svg class="animate-spin h-4 w-4 mr-2 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>`;
  }
}

export function initializeUserDataManagementPage(
  dialog: UserDataManagementDialog = dialogService
): void {
  new UserDataManagementManager(dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeUserDataManagementPage(),
      { once: true }
    );
  } else {
    initializeUserDataManagementPage();
  }
}
