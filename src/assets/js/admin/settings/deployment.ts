/**
 * Admin Deployment Settings Module
 *
 * Handles deployment settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - Allowed origins and trust-proxy validation
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  interface DialogApi {
    showAlert: (
      title: string,
      message: string,
      options?: { variant?: string }
    ) => Promise<void>;
  }

  interface ValidationError {
    message: string;
    title: string;
  }

  class DeploymentSettingsManager {
    private form: HTMLFormElement | null = null;

    public initialize(): void {
      this.form = document.querySelector('#deployment-form');
      this.setupFormValidation();
    }

    private setupFormValidation(): void {
      if (!this.form) return;

      this.form.addEventListener('submit', e => {
        const validationError = this.validateForm();
        if (!validationError) return;

        // Native form submission does not wait for an async event handler.
        // Cancel synchronously, then let the dialog resolve independently.
        e.preventDefault();
        void this.showError(validationError.title, validationError.message);
      });
    }

    private validateForm(): ValidationError | null {
      const originsInput = document.getElementById(
        'server.allowed_origins'
      ) as HTMLInputElement | null;
      const devOriginsInput = document.getElementById(
        'server.dev_allowed_origins'
      ) as HTMLInputElement | null;
      const trustHopsInput = document.getElementById(
        'server.trust_proxy_hops'
      ) as HTMLInputElement | null;

      const allowedOrigins = originsInput?.value || '';
      const devAllowedOrigins = devOriginsInput?.value || '';

      if (!allowedOrigins) {
        return {
          title: 'Validation Error',
          message: 'Allowed Origins are required.',
        };
      }

      const invalidOrigin = this.findFirstInvalidOrigin(allowedOrigins);
      if (invalidOrigin) {
        return {
          title: 'Invalid Allowed Origin',
          message: `"${invalidOrigin}" is not a valid origin URL.`,
        };
      }

      if (devAllowedOrigins) {
        const invalidDev = this.findFirstInvalidOrigin(devAllowedOrigins);
        if (invalidDev) {
          return {
            title: 'Invalid Dev Allowed Origin',
            message: `"${invalidDev}" is not a valid origin URL.`,
          };
        }
      }

      const hopsValue = trustHopsInput?.value.trim() || '';
      const hops = Number(hopsValue);
      if (!hopsValue || !Number.isInteger(hops) || hops < 0 || hops > 10) {
        return {
          title: 'Invalid Trust Proxy Hops',
          message: 'Trust proxy hops must be an integer between 0 and 10.',
        };
      }

      return null;
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
