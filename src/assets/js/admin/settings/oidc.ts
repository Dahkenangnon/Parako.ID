/**
 * Admin OIDC Settings Module
 *
 * Handles OIDC settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - Issuer URL and path validation
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

  class OidcSettingsManager {
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
      const issuerInput = document.getElementById(
        'oidc.issuer'
      ) as HTMLInputElement | null;
      const pathInput = document.getElementById(
        'oidc.path'
      ) as HTMLInputElement | null;

      const issuer = issuerInput?.value || '';
      const path = pathInput?.value || '';

      if (!issuer || !path) {
        await this.showError(
          'Validation Error',
          'Issuer URL and OIDC path are required fields.'
        );
        return false;
      }

      try {
        new URL(issuer);
      } catch {
        await this.showError('Invalid URL', 'Please enter a valid issuer URL.');
        return false;
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
    new OidcSettingsManager().initialize();
  });
})();
