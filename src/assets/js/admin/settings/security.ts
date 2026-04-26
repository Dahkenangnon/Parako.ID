/**
 * Admin Security Settings Module
 *
 * Handles security settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - JWT expiration validation (secrets sub-page only)
 * - Cookie secrets validation (secrets sub-page only)
 * - Backup codes count validation (authentication sub-page only)
 *
 * Validates only fields present on the current sub-page.
 */
(function () {
  'use strict';

  interface DialogApi {
    showAlert: (
      title: string,
      message: string,
      options?: { variant?: string }
    ) => Promise<void>;
  }

  class SecuritySettingsManager {
    private form: HTMLFormElement | null = null;

    public initialize(): void {
      this.form = document.querySelector('form');
      this.setupFormValidation();
    }

    private setupFormValidation(): void {
      if (!this.form) return;

      this.form.addEventListener('submit', async e => {
        const isValid = await this.validateForm();
        if (!isValid) {
          e.preventDefault();
        }
      });
    }

    private async validateForm(): Promise<boolean> {
      // JWT expiration — only on secrets sub-page
      const jwtExpiresInElement = document.getElementById(
        'secrets.jwt_expires_in'
      ) as HTMLInputElement | null;
      if (jwtExpiresInElement) {
        const jwtExpiresIn = jwtExpiresInElement.value || '';
        if (jwtExpiresIn && !/^\d+[smhd]$/.test(jwtExpiresIn)) {
          await this.showError(
            'Invalid JWT Expiration',
            'JWT expiration must be in format like 1h, 30m, 7d'
          );
          return false;
        }
      }

      // Cookie secrets — only on secrets sub-page
      const cookieSecretsElement = document.getElementById(
        'secrets.cookie_secrets'
      ) as HTMLTextAreaElement | null;
      if (cookieSecretsElement) {
        const cookieSecrets = cookieSecretsElement.value || '';
        const secrets = cookieSecrets.split('\n').filter(s => s.trim());
        if (secrets.length < 2) {
          await this.showError(
            'Invalid Cookie Secrets',
            'At least 2 cookie secrets are required'
          );
          return false;
        }
      }

      // Backup codes count — only on authentication sub-page
      const backupCodesElement = document.getElementById(
        'authentication.recovery.backup_codes.count'
      ) as HTMLInputElement | null;
      if (backupCodesElement) {
        const backupCodesCount = parseInt(backupCodesElement.value || '0', 10);
        if (
          backupCodesCount &&
          (backupCodesCount < 1 || backupCodesCount > 50)
        ) {
          await this.showError(
            'Invalid Backup Codes Count',
            'Backup codes count must be between 1 and 50'
          );
          return false;
        }
      }

      return true;
    }

    private async showError(title: string, message: string): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;
      if (dialogApi?.showAlert) {
        await dialogApi.showAlert(title, message, { variant: 'error' });
      } else {
        alert(message);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new SecuritySettingsManager().initialize();
  });
})();
