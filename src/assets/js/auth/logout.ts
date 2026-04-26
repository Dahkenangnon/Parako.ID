/**
 * LogoutManager - Handles logout form interactions and confirmation dialogs
 *
 * Features:
 * - Confirmation dialogs for logout actions
 * - Support for single account and multiple account logout scenarios
 * - Dynamic confirmation messages based on account count
 * - Form submission with loading states and error recovery
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The LogoutManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.confirmSignOut: Button text for confirming sign out
 * - auth.signingOut: Loading text during sign out process
 * - auth.confirmSignOutAll: Confirmation message for signing out from all accounts
 * - auth.confirmSignOutSingle: Confirmation message for signing out from single account
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.confirmSignOut', 'Confirm Sign Out') | tojson }}
 *
 * The second parameter is the fallback text used when translation is not available.
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */
// Self-contained module to prevent type collisions
(function () {
  'use strict';

  // Local type definitions to prevent global pollution
  interface LogoutConfig {
    enableConfirmation: boolean;
  }

  interface TranslationStrings {
    confirmSignOut: string;
    signingOut: string;
    confirmSignOutAll: string;
    confirmSignOutSingle: string;
    errorRecovery: string;
  }

  interface LogoutManagerOptions {
    config: LogoutConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class LogoutManager {
    private config: LogoutConfig;
    private translations: TranslationStrings;
    private debug: boolean;

    // DOM elements
    private logoutForms: NodeListOf<HTMLFormElement> | null = null;
    private submitButtons: NodeListOf<HTMLButtonElement> | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      confirmSignOut: 'Confirm Sign Out',
      signingOut: 'Signing Out...',
      confirmSignOutAll:
        'Are you sure you want to sign out from all {count} accounts? This will remove all signed-in accounts from this device.',
      confirmSignOutSingle:
        'Are you sure you want to sign out from your account?',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: LogoutManagerOptions) {
      this.config = this.validateConfig(options.config);

      this.translations = Object.assign(
        {},
        this.defaultTranslations,
        Object.fromEntries(
          Object.entries(options.translations ?? {}).filter(
            ([_, v]) => v !== undefined
          )
        )
      ) as TranslationStrings;

      this.debug = options.debug ?? false;

      this.initializeElements();

      this.log('LogoutManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: LogoutConfig): LogoutConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          enableConfirmation: true,
        };
      }

      return {
        enableConfirmation: Boolean(config.enableConfirmation),
      };
    }

    /**
     * Logging utility with debug support
     */
    private log(
      message: string,
      data?: any,
      level: 'log' | 'warn' | 'error' = 'log'
    ): void {
      if (!this.debug && level === 'log') return;

      const prefix = '[LogoutManager]';
      if (data) {
        console[level](prefix, message, data);
      } else {
        console[level](prefix, message);
      }
    }

    /**
     * Get translation with fallback to English if translation key is returned
     */
    private getTranslation(key: keyof TranslationStrings): string {
      const translation = this.translations[key];
      const fallback = this.defaultTranslations[key];

      // If translation looks like a key (contains dots and starts with letters), use fallback
      if (this.isTranslationKey(translation)) {
        this.log(
          `Translation key detected for '${key}': '${translation}', using fallback: '${fallback}'`,
          null,
          'warn'
        );
        return fallback as string;
      }

      return translation;
    }

    /**
     * Check if a string looks like a translation key
     */
    private isTranslationKey(text: string): boolean {
      if (!text || typeof text !== 'string') return false;

      // Translation keys typically:
      // - Start with letters
      // - Contain dots
      // - Are relatively short
      // - Don't contain spaces at the beginning/end
      const keyPattern = /^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/;
      return keyPattern.test(text.trim()) && text.length < 50;
    }

    /**
     * Initialize DOM elements and event listeners
     */
    public run(): void {
      if (!this.logoutForms || this.logoutForms.length === 0) {
        this.log('No logout forms found', null, 'error');
        return;
      }

      this.setupLogoutForms();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.logoutForms = document.querySelectorAll(
        'form[action*="logout"]'
      ) as NodeListOf<HTMLFormElement>;
      this.submitButtons = document.querySelectorAll(
        'form[action*="logout"] button[type="submit"]'
      ) as NodeListOf<HTMLButtonElement>;
    }

    /**
     * Setup logout form handling
     */
    private setupLogoutForms(): void {
      if (!this.logoutForms) return;

      this.logoutForms.forEach((form, index) => {
        const submitButton = form.querySelector(
          'button[type="submit"]'
        ) as HTMLButtonElement;
        const typeInput = form.querySelector(
          'input[name="type"]'
        ) as HTMLInputElement;

        if (submitButton && typeInput) {
          this.setupFormSubmission(form, submitButton, typeInput, index);
        }
      });
    }

    /**
     * Setup form submission handling
     */
    private setupFormSubmission(
      form: HTMLFormElement,
      submitButton: HTMLButtonElement,
      typeInput: HTMLInputElement,
      _index: number
    ): void {
      if (typeInput.value === 'all' && this.config.enableConfirmation) {
        submitButton.addEventListener('click', (e: Event) => {
          const accountCount = this.getAccountCount();
          const message =
            accountCount > 1
              ? this.getTranslation('confirmSignOutAll').replace(
                  '{count}',
                  accountCount.toString()
                )
              : this.getTranslation('confirmSignOutSingle');

          this.log('Showing all accounts logout confirmation', {
            accountCount,
            message,
          });

          if (!confirm(message)) {
            e.preventDefault();
          }
        });
      }
    }

    /**
     * Get account count from the page
     */
    private getAccountCount(): number {
      const accountCountElement = document.querySelector(
        '[data-account-count]'
      );
      if (accountCountElement) {
        const count = parseInt(
          accountCountElement.getAttribute('data-account-count') || '1'
        );
        if (!isNaN(count)) return count;
      }

      const accountElements = document.querySelectorAll('[data-account-id]');
      if (accountElements.length > 0) return accountElements.length;

      // Default to 1 if no accounts found
      return 1;
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('___LOGOUT_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const logoutManager = new LogoutManager({
          config: data.config || {
            enableConfirmation: true,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
        });

        logoutManager.run();
      } catch (error) {
        console.error('[LogoutManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const logoutManager = new LogoutManager({
            config: {
              enableConfirmation: true,
            },
            debug: true,
          });
          logoutManager.run();
        } catch (fallbackError) {
          console.error(
            '[LogoutManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error('[LogoutManager] No configuration data found in DOM');

      try {
        const logoutManager = new LogoutManager({
          config: {
            enableConfirmation: true,
          },
          debug: true,
        });
        logoutManager.run();
      } catch (fallbackError) {
        console.error(
          '[LogoutManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
