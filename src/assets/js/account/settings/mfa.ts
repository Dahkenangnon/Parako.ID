/**
 * MfaManager - Manages Multi-Factor Authentication settings
 *
 * Features:
 * - Supports multiple MFA methods (TOTP, Email, WebAuthn)
 * - Prevents enabling a method that's already enabled
 * - Prevents disabling a method that's not enabled
 * - Confirmation dialog for MFA disable action
 * - Integration with dialog utility for consistent UX
 * - State-based form submission control
 *
 * @version 2.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for MfaManager
   */
  interface MfaMethodsEnabled {
    totp: boolean;
    email: boolean;
    webauthn: boolean;
  }

  interface MfaConfig {
    isMfaEnabled: boolean;
    mfaMethodsEnabled?: MfaMethodsEnabled;
    translations: {
      mfaAlreadyEnabled: string;
      mfaMethodAlreadyEnabled?: string;
      mfaNotEnabled: string;
      mfaDisableConfirm: string;
    };
    debug?: boolean;
  }

  /**
   * MfaManager class - Handles MFA toggle logic with multi-method support
   */
  class MfaManager {
    private config: MfaConfig;
    private debug: boolean;
    private enableMfaAppForm: HTMLFormElement | null;
    private enableMfaEmailForm: HTMLFormElement | null;
    private disableMfaForms: NodeListOf<HTMLFormElement> | null;

    constructor(config: MfaConfig) {
      this.config = config;
      this.debug = config.debug || false;
      this.enableMfaAppForm = null;
      this.enableMfaEmailForm = null;
      this.disableMfaForms = null;
    }

    /**
     * Initialize the MFA manager
     */
    public initialize(): void {
      this.log('Initializing MfaManager with config:', {
        isMfaEnabled: this.config.isMfaEnabled,
        mfaMethodsEnabled: this.config.mfaMethodsEnabled,
      });

      this.enableMfaAppForm = document.getElementById(
        'enable-mfa-app-form'
      ) as HTMLFormElement;
      this.enableMfaEmailForm = document.getElementById(
        'enable-mfa-email-form'
      ) as HTMLFormElement;
      this.disableMfaForms = document.querySelectorAll(
        'form[action*="disable_mfa"]'
      ) as NodeListOf<HTMLFormElement>;

      this.setupMethodHandlers();
    }

    /**
     * Setup handlers for each MFA method based on its enabled state
     */
    private setupMethodHandlers(): void {
      const methodsEnabled = this.config.mfaMethodsEnabled || {
        totp: false,
        email: false,
        webauthn: false,
      };

      if (this.enableMfaAppForm) {
        if (methodsEnabled.totp) {
          // TOTP is already enabled - prevent enabling again
          this.enableMfaAppForm.addEventListener('submit', async e => {
            e.preventDefault();
            await (window as any).dialog.showAlert(
              'TOTP Already Enabled',
              this.config.translations.mfaMethodAlreadyEnabled ||
                this.config.translations.mfaAlreadyEnabled,
              { variant: 'info' }
            );
          });
          this.log('TOTP enable form blocked (already enabled)');
        } else {
          // TOTP not enabled - allow form submission
          this.log('TOTP enable form allowed (not enabled yet)');
        }
      }

      if (this.enableMfaEmailForm) {
        if (methodsEnabled.email) {
          // Email MFA is already enabled - prevent enabling again
          this.enableMfaEmailForm.addEventListener('submit', async e => {
            e.preventDefault();
            await (window as any).dialog.showAlert(
              'Email MFA Already Enabled',
              this.config.translations.mfaMethodAlreadyEnabled ||
                this.config.translations.mfaAlreadyEnabled,
              { variant: 'info' }
            );
          });
          this.log('Email MFA enable form blocked (already enabled)');
        } else {
          // Email MFA not enabled - allow form submission
          this.log('Email MFA enable form allowed (not enabled yet)');
        }
      }

      if (this.disableMfaForms && this.disableMfaForms.length > 0) {
        this.disableMfaForms.forEach(form => {
          form.addEventListener('submit', async e => {
            const action = form.getAttribute('action') || '';
            const urlParams = new URLSearchParams(action.split('?')[1] || '');
            const method = urlParams.get('method') || 'unknown';

            const methodEnabled = this.isMethodEnabled(method);
            if (!methodEnabled) {
              e.preventDefault();
              await (window as any).dialog.showAlert(
                'MFA Not Enabled',
                this.config.translations.mfaNotEnabled,
                { variant: 'info' }
              );
              return;
            }

            const confirmed = await (window as any).dialog.showConfirm(
              'Disable MFA',
              this.config.translations.mfaDisableConfirm,
              {
                variant: 'warning',
                confirmText: 'Disable',
                cancelText: 'Cancel',
              }
            );

            if (!confirmed) {
              e.preventDefault();
              this.log(`User cancelled disabling ${method} MFA`);
            } else {
              this.log(`User confirmed disabling ${method} MFA`);
            }
          });
        });
        this.log('Disable MFA form handlers setup with confirmation');
      }
    }

    /**
     * Check if a specific MFA method is enabled
     */
    private isMethodEnabled(method: string): boolean {
      const methodsEnabled = this.config.mfaMethodsEnabled;
      if (!methodsEnabled) {
        // Fallback to global isMfaEnabled if per-method not available
        return this.config.isMfaEnabled;
      }

      switch (method) {
        case 'totp':
          return methodsEnabled.totp;
        case 'email':
          return methodsEnabled.email;
        case 'webauthn':
          return methodsEnabled.webauthn;
        default:
          return false;
      }
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[MfaManager]', ...args);
      }
    }
  }

  if (typeof window !== 'undefined') {
    (window as any).MfaManager = MfaManager;
  }

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MfaManager;
  }
})();
