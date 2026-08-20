import dialogService from '../../utils/dialog.js';
import {
  bindSynchronousFormValidation,
  type ValidationDialog,
  type ValidationError,
} from './validation.js';

export class OidcSettingsManager {
  private form: HTMLFormElement | null = null;

  public constructor(
    private readonly dialog: ValidationDialog | null = dialogService
  ) {}

  public initialize(): void {
    this.form = document.querySelector('form');
    if (!this.form) return;

    bindSynchronousFormValidation(
      this.form,
      () => this.validateForm(),
      this.dialog
    );
  }

  private validateForm(): ValidationError | null {
    const issuerInput = document.getElementById(
      'oidc.issuer'
    ) as HTMLInputElement | null;
    const pathInput = document.getElementById(
      'oidc.path'
    ) as HTMLInputElement | null;

    const issuer = issuerInput?.value || '';
    const path = pathInput?.value || '';

    if (!path || (issuerInput && !issuer)) {
      return {
        title: 'Validation Error',
        message: 'Issuer URL and OIDC path are required fields.',
      };
    }

    if (issuerInput) {
      try {
        new URL(issuer);
      } catch {
        return {
          title: 'Invalid URL',
          message: 'Please enter a valid issuer URL.',
        };
      }
    }

    return null;
  }
}

export function initializeOidcSettingsPage(
  dialog: ValidationDialog | null = dialogService
): void {
  new OidcSettingsManager(dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeOidcSettingsPage(),
      { once: true }
    );
  } else {
    initializeOidcSettingsPage();
  }
}
