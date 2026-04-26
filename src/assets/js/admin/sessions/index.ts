/**
 * Admin Sessions Manager
 *
 * Handles admin session management functionality:
 * - Session revocation with confirmation dialog
 */
(function () {
  'use strict';

  // Type Definitions

  interface SessionsConfig {
    csrfToken: string;
    translations: TranslationStrings;
  }

  interface TranslationStrings {
    revokeTitle: string;
    revokeMessage: string;
    revokeConfirm: string;
    revokeCancel: string;
  }

  // Sessions Manager Class

  class AdminSessionsManager {
    private config: SessionsConfig;
    private translations: TranslationStrings;

    private readonly defaultTranslations: TranslationStrings = {
      revokeTitle: 'Revoke Session',
      revokeMessage:
        'Are you sure you want to revoke this session? This will immediately log out the user from this device.',
      revokeConfirm: 'Revoke',
      revokeCancel: 'Cancel',
    };

    constructor(config: SessionsConfig) {
      this.config = config;
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    public initialize(): void {
      this.setupRevokeConfirmation();
    }

    /**
     * Setup revoke confirmation dialogs for all revoke forms
     */
    private setupRevokeConfirmation(): void {
      const revokeForms = document.querySelectorAll<HTMLFormElement>(
        'form[action*="/revoke"]'
      );

      revokeForms.forEach(form => {
        form.addEventListener('submit', async e => {
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
            form.submit();
          }
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById('___ADMIN_SESSIONS_STATE___');

    // Default config if state element not found
    const defaultConfig: SessionsConfig = {
      csrfToken: '',
      translations: {
        revokeTitle: 'Revoke Session',
        revokeMessage:
          'Are you sure you want to revoke this session? This will immediately log out the user from this device.',
        revokeConfirm: 'Revoke',
        revokeCancel: 'Cancel',
      },
    };

    try {
      const config = stateElement
        ? JSON.parse(stateElement.textContent || '{}')
        : defaultConfig;
      const manager = new AdminSessionsManager({ ...defaultConfig, ...config });
      manager.initialize();
    } catch (error) {
      console.error('[AdminSessionsManager] Initialization failed:', error);
      const manager = new AdminSessionsManager(defaultConfig);
      manager.initialize();
    }
  });

  if (typeof window !== 'undefined') {
    (window as any).AdminSessionsManager = AdminSessionsManager;
  }
})();
