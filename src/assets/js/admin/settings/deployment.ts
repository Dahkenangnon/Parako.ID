import dialogService from '../../utils/dialog.js';
import {
  bindSynchronousFormValidation,
  type ValidationDialog,
  type ValidationError,
} from './validation.js';

export class DeploymentSettingsManager {
  private form: HTMLFormElement | null = null;

  public constructor(
    private readonly dialog: ValidationDialog | null = dialogService
  ) {}

  public initialize(): void {
    this.form = document.querySelector('#deployment-form');
    if (!this.form) return;

    bindSynchronousFormValidation(
      this.form,
      () => this.validateForm(),
      this.dialog
    );
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
      const invalidDevOrigin = this.findFirstInvalidOrigin(devAllowedOrigins);
      if (invalidDevOrigin) {
        return {
          title: 'Invalid Dev Allowed Origin',
          message: `"${invalidDevOrigin}" is not a valid origin URL.`,
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
      .filter(Boolean);

    for (const candidate of candidates) {
      try {
        new URL(candidate);
      } catch {
        return candidate;
      }
    }

    return null;
  }
}

export function initializeDeploymentSettingsPage(
  dialog: ValidationDialog | null = dialogService
): void {
  new DeploymentSettingsManager(dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeDeploymentSettingsPage(),
      { once: true }
    );
  } else {
    initializeDeploymentSettingsPage();
  }
}
