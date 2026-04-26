/**
 * Admin User Data Management Module
 *
 * Handles user data import/export page functionality:
 * - Tab navigation between import/export panels
 * - CSV file validation (size, type)
 * - Import form submission with loading state
 * - Export form submission with confirmation for sensitive data
 * - Clear import log confirmation
 */
(function () {
  'use strict';

  interface DialogApi {
    showAlert: (
      title: string,
      message: string,
      options?: { variant?: string }
    ) => Promise<void>;
    showConfirm: (
      title: string,
      message: string,
      options?: { variant?: string; confirmText?: string; cancelText?: string }
    ) => Promise<boolean>;
  }

  interface LucideApi {
    createIcons: () => void;
  }

  interface WindowWithApis {
    dialog: DialogApi;
    lucide?: LucideApi;
  }

  class UserDataManagementManager {
    private importForm: HTMLFormElement | null = null;
    private exportForm: HTMLFormElement | null = null;
    private importBtn: HTMLButtonElement | null = null;
    private exportBtn: HTMLButtonElement | null = null;
    private csvFileInput: HTMLInputElement | null = null;
    private clearLogForm: HTMLFormElement | null = null;
    private includePasswordsCheckbox: HTMLInputElement | null = null;
    private includeSensitiveDataCheckbox: HTMLInputElement | null = null;
    private tabs: NodeListOf<HTMLButtonElement> | null = null;
    private panels: NodeListOf<HTMLElement> | null = null;

    private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
      this.importBtn = document.getElementById(
        'importBtn'
      ) as HTMLButtonElement | null;
      this.exportBtn = document.getElementById(
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
      if (!this.tabs || !this.panels) return;

      this.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const targetTab = tab.dataset.tab;
          if (!targetTab) return;

          this.tabs?.forEach(t => {
            const isActive = t.dataset.tab === targetTab;
            t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            t.classList.toggle('border-primary', isActive);
            t.classList.toggle('text-primary', isActive);
            t.classList.toggle('border-transparent', !isActive);
            t.classList.toggle('text-muted-foreground', !isActive);
          });

          this.panels?.forEach(panel => {
            const isActive = panel.id === targetTab + '-panel';
            panel.classList.toggle('hidden', !isActive);
          });
        });
      });
    }

    private setupEventListeners(): void {
      // File validation on change
      this.csvFileInput?.addEventListener('change', e =>
        this.handleFileChange(e)
      );

      this.importForm?.addEventListener('submit', e =>
        this.handleImportSubmit(e)
      );

      this.exportForm?.addEventListener('submit', e =>
        this.handleExportSubmit(e)
      );

      this.clearLogForm?.addEventListener('submit', e =>
        this.handleClearLogSubmit(e)
      );
    }

    private async handleFileChange(e: Event): Promise<void> {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      const dialog = (window as unknown as WindowWithApis).dialog;

      if (file.size > this.MAX_FILE_SIZE) {
        await dialog.showAlert(
          'File Too Large',
          `Maximum file size is 10MB.\nYour file: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
          { variant: 'error' }
        );
        input.value = '';
        return;
      }

      if (
        !file.name.toLowerCase().endsWith('.csv') &&
        file.type !== 'text/csv'
      ) {
        await dialog.showAlert(
          'Invalid File Type',
          'Please select a CSV file.\nAccepted: .csv files only',
          {
            variant: 'error',
          }
        );
        input.value = '';
        return;
      }
    }

    private async handleImportSubmit(e: Event): Promise<void> {
      const dialog = (window as unknown as WindowWithApis).dialog;

      if (!this.csvFileInput?.files || this.csvFileInput.files.length === 0) {
        e.preventDefault();
        await dialog.showAlert(
          'No File Selected',
          'Please select a CSV file to import.',
          { variant: 'warning' }
        );
        return;
      }

      const file = this.csvFileInput.files[0];
      if (file.size > this.MAX_FILE_SIZE) {
        e.preventDefault();
        await dialog.showAlert('File Too Large', 'Maximum file size is 10MB.', {
          variant: 'error',
        });
        return;
      }

      if (this.importBtn) {
        this.importBtn.disabled = true;
        this.importBtn.innerHTML = this.getLoadingSpinner() + 'Importing...';
      }
    }

    private async handleExportSubmit(e: Event): Promise<void> {
      const dialog = (window as unknown as WindowWithApis).dialog;
      const includePasswords = this.includePasswordsCheckbox?.checked || false;
      const includeSensitive =
        this.includeSensitiveDataCheckbox?.checked || false;

      if (includePasswords || includeSensitive) {
        const warnings: string[] = [];
        if (includePasswords) warnings.push('- Password hashes (encrypted)');
        if (includeSensitive)
          warnings.push('- Personal information (phone, address, etc.)');

        e.preventDefault();

        const confirmed = await dialog.showConfirm(
          'Sensitive Data Export',
          `You are about to export:\n${warnings.join('\n')}\n\nThis file will contain sensitive user data.\nPlease handle it securely and comply with data protection regulations.\n\nContinue with export?`,
          {
            variant: 'warning',
            confirmText: 'Export',
            cancelText: 'Cancel',
          }
        );

        if (!confirmed) {
          return;
        }

        // If confirmed, submit the form
        this.exportForm?.submit();
        return;
      }

      this.showExportLoadingState();
    }

    private showExportLoadingState(): void {
      if (this.exportBtn) {
        this.exportBtn.disabled = true;
        this.exportBtn.innerHTML = this.getLoadingSpinner() + 'Exporting...';

        // Re-enable button after download starts (file downloads don't reload page)
        setTimeout(() => {
          if (this.exportBtn) {
            this.exportBtn.disabled = false;
            this.exportBtn.innerHTML =
              '<i data-lucide="download" class="h-4 w-4 mr-2"></i>Export to CSV';
            this.refreshIcons();
          }
        }, 2000);
      }
    }

    private async handleClearLogSubmit(e: Event): Promise<void> {
      e.preventDefault();

      const dialog = (window as unknown as WindowWithApis).dialog;
      const errorCount =
        this.clearLogForm
          ?.closest('.bg-card')
          ?.querySelector('.text-xs.text-muted-foreground')?.textContent ||
        'all';

      const confirmed = await dialog.showConfirm(
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
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>`;
    }

    private refreshIcons(): void {
      const lucideWindow = window as unknown as WindowWithApis;
      if (
        lucideWindow.lucide &&
        typeof lucideWindow.lucide.createIcons === 'function'
      ) {
        lucideWindow.lucide.createIcons();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new UserDataManagementManager().initialize();
  });
})();
