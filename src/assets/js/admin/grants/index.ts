/**
 * Admin Grants Manager
 *
 * Handles admin grant management functionality:
 * - Grant revocation with confirmation dialog
 * - AJAX-based grant revocation
 */
(function () {
  'use strict';

  // Type Definitions

  interface GrantsConfig {
    csrfToken: string;
    routes: {
      revokeGrant: string;
    };
    translations: TranslationStrings;
  }

  interface TranslationStrings {
    revokeTitle: string;
    revokeMessage: string;
    revokeConfirm: string;
    revokeCancel: string;
    successTitle: string;
    successMessage: string;
    errorTitle: string;
    errorMessage: string;
    unknownError: string;
  }

  // Grants Manager Class

  class AdminGrantsManager {
    private config: GrantsConfig;
    private translations: TranslationStrings;

    private readonly defaultTranslations: TranslationStrings = {
      revokeTitle: 'Revoke Authorization',
      revokeMessage:
        'Are you sure you want to revoke this authorization? This action cannot be undone.',
      revokeConfirm: 'Revoke',
      revokeCancel: 'Cancel',
      successTitle: 'Success',
      successMessage: 'Authorization revoked successfully',
      errorTitle: 'Error',
      errorMessage: 'Failed to revoke authorization',
      unknownError: 'Unknown error',
    };

    constructor(config: GrantsConfig) {
      this.config = config;
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    public initialize(): void {
      this.exposeGlobalMethods();
      this.setupFormConfirmation();
    }

    /**
     * Expose global methods for inline onclick handlers
     */
    private exposeGlobalMethods(): void {
      (window as any).revokeGrant = this.revokeGrant.bind(this);
    }

    /**
     * Setup form confirmation for revoke forms (show.njk pattern)
     */
    private setupFormConfirmation(): void {
      const revokeForm = document.getElementById(
        'revoke-grant-form'
      ) as HTMLFormElement | null;

      if (revokeForm) {
        revokeForm.addEventListener('submit', async e => {
          e.preventDefault();

          const confirmed = await (window as any).dialog.showConfirm(
            this.translations.revokeTitle,
            this.translations.revokeMessage,
            {
              variant: 'danger',
              confirmText: this.translations.revokeConfirm,
              cancelText: this.translations.revokeCancel,
            }
          );

          if (confirmed) {
            revokeForm.submit();
          }
        });
      }
    }

    /**
     * Revoke a grant via AJAX (index.njk pattern)
     */
    public async revokeGrant(grantId: string): Promise<void> {
      const confirmed = await (window as any).dialog.showConfirm(
        this.translations.revokeTitle,
        this.translations.revokeMessage,
        {
          variant: 'danger',
          confirmText: this.translations.revokeConfirm,
          cancelText: this.translations.revokeCancel,
        }
      );

      if (!confirmed) {
        return;
      }

      try {
        const csrfToken = this.getCsrfToken();
        const response = await fetch(`/admin/user-grants/${grantId}/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': csrfToken,
          },
        });

        const result = await response.json();

        if (result.success) {
          await (window as any).dialog.showAlert(
            this.translations.successTitle,
            this.translations.successMessage,
            {
              variant: 'success',
            }
          );
          window.location.reload();
        } else {
          await (window as any).dialog.showAlert(
            this.translations.errorTitle,
            `${this.translations.errorMessage}: ${result.error || this.translations.unknownError}`,
            { variant: 'error' }
          );
        }
      } catch (error) {
        console.error('Error revoking authorization:', error);
        await (window as any).dialog.showAlert(
          this.translations.errorTitle,
          `${this.translations.errorMessage}. Please try again.`,
          { variant: 'error' }
        );
      }
    }

    /**
     * Get CSRF token from hidden input or meta tag
     */
    private getCsrfToken(): string {
      const csrfInput = document.querySelector<HTMLInputElement>(
        'input[name="_csrf"]'
      );
      if (csrfInput) {
        return csrfInput.value;
      }

      const csrfMeta = document.querySelector(
        'meta[name="csrf-token"]'
      ) as HTMLElement | null;
      if (csrfMeta) {
        return csrfMeta.getAttribute('content') || '';
      }

      return this.config.csrfToken || '';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById('___ADMIN_GRANTS_STATE___');

    // Default config if state element not found
    const defaultConfig: GrantsConfig = {
      csrfToken: '',
      routes: {
        revokeGrant: '/admin/user-grants/{id}/revoke',
      },
      translations: {
        revokeTitle: 'Revoke Authorization',
        revokeMessage:
          'Are you sure you want to revoke this authorization? This action cannot be undone.',
        revokeConfirm: 'Revoke',
        revokeCancel: 'Cancel',
        successTitle: 'Success',
        successMessage: 'Authorization revoked successfully',
        errorTitle: 'Error',
        errorMessage: 'Failed to revoke authorization',
        unknownError: 'Unknown error',
      },
    };

    try {
      const config = stateElement
        ? JSON.parse(stateElement.textContent || '{}')
        : defaultConfig;
      const manager = new AdminGrantsManager({ ...defaultConfig, ...config });
      manager.initialize();
    } catch (error) {
      console.error('[AdminGrantsManager] Initialization failed:', error);
      const manager = new AdminGrantsManager(defaultConfig);
      manager.initialize();
    }
  });

  if (typeof window !== 'undefined') {
    (window as any).AdminGrantsManager = AdminGrantsManager;
  }
})();
