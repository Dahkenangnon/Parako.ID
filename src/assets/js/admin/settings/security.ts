import dialogService from '../../utils/dialog.js';
import {
  bindSynchronousFormValidation,
  type ValidationDialog,
  type ValidationError,
} from './validation.js';

export class SecuritySettingsManager {
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
    const jwtExpiresInElement = document.getElementById(
      'secrets.jwt_expires_in'
    ) as HTMLInputElement | null;
    if (
      jwtExpiresInElement?.value &&
      !/^\d+[smhd]$/.test(jwtExpiresInElement.value)
    ) {
      return {
        title: 'Invalid JWT Expiration',
        message: 'JWT expiration must be in format like 1h, 30m, 7d',
      };
    }

    const cookieSecretsElement = document.getElementById(
      'secrets.cookie_secrets'
    ) as HTMLTextAreaElement | null;
    if (cookieSecretsElement) {
      const secrets = cookieSecretsElement.value
        .split('\n')
        .filter(secret => secret.trim());
      if (secrets.length < 2) {
        return {
          title: 'Invalid Cookie Secrets',
          message: 'At least 2 cookie secrets are required',
        };
      }
    }

    const backupCodesElement = document.getElementById(
      'authentication.recovery.backup_codes.count'
    ) as HTMLInputElement | null;
    if (backupCodesElement) {
      const backupCodesValue = backupCodesElement.value.trim();
      const backupCodesCount = Number(backupCodesValue);
      if (
        backupCodesValue &&
        (!Number.isInteger(backupCodesCount) ||
          backupCodesCount < 1 ||
          backupCodesCount > 50)
      ) {
        return {
          title: 'Invalid Backup Codes Count',
          message: 'Backup codes count must be between 1 and 50',
        };
      }
    }

    return null;
  }
}

export function initializeSecuritySettingsPage(
  dialog: ValidationDialog | null = dialogService
): void {
  new SecuritySettingsManager(dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeSecuritySettingsPage(),
      { once: true }
    );
  } else {
    initializeSecuritySettingsPage();
  }
}
