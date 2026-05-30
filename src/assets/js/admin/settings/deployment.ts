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
      const devOriginsInput = document.getElementById(
        'server.dev_allowed_origins'
      ) as HTMLInputElement | null;
      const trustHopsInput = document.getElementById(
        'server.trust_proxy_hops'
      ) as HTMLInputElement | null;

      const url = urlInput?.value || '';
      const allowedOrigins = originsInput?.value || '';
      const devAllowedOrigins = devOriginsInput?.value || '';

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

      const invalidOrigin = this.findFirstInvalidOrigin(allowedOrigins);
      if (invalidOrigin) {
        await this.showError(
          'Invalid Allowed Origin',
          `"${invalidOrigin}" is not a valid origin URL.`
        );
        return false;
      }

      if (devAllowedOrigins) {
        const invalidDev = this.findFirstInvalidOrigin(devAllowedOrigins);
        if (invalidDev) {
          await this.showError(
            'Invalid Dev Allowed Origin',
            `"${invalidDev}" is not a valid origin URL.`
          );
          return false;
        }
      }

      const hops = Number.parseInt(trustHopsInput?.value || '', 10);
      if (
        !Number.isFinite(hops) ||
        Number.isNaN(hops) ||
        hops < 0 ||
        hops > 10
      ) {
        await this.showError(
          'Invalid Trust Proxy Hops',
          'Trust proxy hops must be an integer between 0 and 10.'
        );
        return false;
      }

      return true;
    }

    private findFirstInvalidOrigin(commaSeparated: string): string | null {
      const candidates = commaSeparated
        .split(',')
        .map(value => value.trim())
        .filter(value => value.length > 0);
      for (const candidate of candidates) {
        try {
          new URL(candidate);
        } catch {
          return candidate;
        }
      }
      return null;
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
