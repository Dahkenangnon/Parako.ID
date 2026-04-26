/**
 * Admin Deployment Settings Module
 *
 * Handles deployment settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - URL and allowed origins validation
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

  class DeploymentSettingsManager {
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
      const urlInput = document.getElementById(
        'url'
      ) as HTMLInputElement | null;
      const originsInput = document.getElementById(
        'server.allowed_origins'
      ) as HTMLInputElement | null;

      const url = urlInput?.value || '';
      const allowedOrigins = originsInput?.value || '';

      if (!url || !allowedOrigins) {
        await this.showError(
          'Validation Error',
          'URL and Allowed Origins are required fields.'
        );
        return false;
      }

      try {
        new URL(url);
      } catch {
        await this.showError('Invalid URL', 'Please enter a valid URL.');
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
    new DeploymentSettingsManager().initialize();
  });
})();
