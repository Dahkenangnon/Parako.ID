import dialogService from '../../utils/dialog.js';
import { showValidationError, type ValidationDialog } from './validation.js';

export class ApplicationSettingsManager {
  private form: HTMLFormElement | null = null;
  private availableLocales: NodeListOf<HTMLInputElement> | null = null;
  private defaultLocaleSelect: HTMLSelectElement | null = null;

  public constructor(
    private readonly dialog: ValidationDialog | null = dialogService
  ) {}

  public initialize(): void {
    this.form = document.querySelector('form');
    this.availableLocales = document.querySelectorAll(
      'input[name="locales[available][]"]'
    );
    this.defaultLocaleSelect = document.getElementById(
      'locales.default'
    ) as HTMLSelectElement | null;

    if (!this.form) return;

    this.form.addEventListener('submit', event => {
      event.preventDefault();

      this.validateForm().then(isValid => {
        if (!isValid || !this.form) return;

        this.form.submit();
      });
    });
  }

  private async validateForm(): Promise<boolean> {
    if (!this.availableLocales || !this.defaultLocaleSelect) return true;

    const checkedLocales = Array.from(this.availableLocales).filter(
      locale => locale.checked
    );

    if (checkedLocales.length === 0) {
      await showValidationError(
        {
          title: 'Validation Error',
          message: 'Please select at least one available locale.',
        },
        this.dialog
      );
      return false;
    }

    const defaultLocale = this.defaultLocaleSelect.value;
    const isDefaultAvailable = checkedLocales.some(
      locale => locale.value === defaultLocale
    );

    if (!isDefaultAvailable) {
      await showValidationError(
        {
          title: 'Validation Error',
          message: 'Default locale must be included in available locales.',
        },
        this.dialog
      );
      return false;
    }

    return true;
  }
}

export function initializeApplicationSettingsPage(
  dialog: ValidationDialog | null = dialogService
): void {
  new ApplicationSettingsManager(dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeApplicationSettingsPage(),
      { once: true }
    );
  } else {
    initializeApplicationSettingsPage();
  }
}
