/**
 * EmailVerificationManager - Handles email verification form interactions and loading states
 *
 * Features:
 * - Loading states for both resend and request forms
 * - Form submission with visual feedback
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The EmailVerificationManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.resendVerificationEmail: Button text for resending verification email
 * - auth.sendVerificationLink: Button text for sending verification link
 * - auth.sending: Loading text during form submission
 *
 * Usage in templates:
 * {{ t('auth.sending', 'Sending...') | tojson }}
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
  interface EmailVerificationConfig {
    enableLoadingStates: boolean;
    errorRecoveryTimeout: number;
  }

  interface TranslationStrings {
    resendVerificationEmail: string;
    sendVerificationLink: string;
    sending: string;
  }

  interface EmailVerificationManagerOptions {
    config: EmailVerificationConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class EmailVerificationManager {
    private config: EmailVerificationConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private forms: NodeListOf<HTMLFormElement> | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      resendVerificationEmail: 'Resend Verification Email',
      sendVerificationLink: 'Send Verification Link',
      sending: 'Sending...',
    };

    constructor(options: EmailVerificationManagerOptions) {
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
      this.errorRecoveryTimeout = options.errorRecoveryTimeout ?? 120000; // 2 minutes default

      this.initializeElements();

      this.log('EmailVerificationManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: EmailVerificationConfig
    ): EmailVerificationConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          enableLoadingStates: true,
          errorRecoveryTimeout: 120000,
        };
      }

      return {
        enableLoadingStates: Boolean(config.enableLoadingStates),
        errorRecoveryTimeout: Math.max(
          10000,
          Math.min(300000, Number(config.errorRecoveryTimeout) || 120000)
        ),
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

      const prefix = '[EmailVerificationManager]';
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
      if (!this.forms || this.forms.length === 0) {
        this.log('No forms found', null, 'error');
        return;
      }

      this.setupForms();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.forms = document.querySelectorAll('form');
    }

    /**
     * Setup form handling
     */
    private setupForms(): void {
      if (!this.forms) return;

      this.forms.forEach((form, index) => {
        const submitButton = form.querySelector(
          'button[type="submit"]'
        ) as HTMLButtonElement;

        if (submitButton) {
          this.setupFormSubmission(form, submitButton, index);
        }
      });
    }

    /**
     * Setup form submission handling
     */
    private setupFormSubmission(
      form: HTMLFormElement,
      submitButton: HTMLButtonElement,
      index: number
    ): void {
      form.addEventListener('submit', (e: Event) => {
        if (this.isSubmitting) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        this.log('Form submission detected', {
          formAction: form.action,
          index,
        });

        e.preventDefault();

        this.disableAllButtons();

        if (form.action.includes('/resend')) {
          submitButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-700 dark:text-gray-200 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            ${this.getTranslation('sending')}
          `;
        } else {
          // Request form - use white spinner
          submitButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            ${this.getTranslation('sending')}
          `;
        }

        setTimeout(() => {
          if (form) {
            form.submit();
          }
        }, 100);
      });
    }

    /**
     * Disable all interactive elements during submission
     */
    private disableAllButtons(): void {
      this.isSubmitting = true;

      // Clear any existing timeout
      if (this.submissionTimeout) {
        clearTimeout(this.submissionTimeout);
      }

      if (this.forms) {
        this.forms.forEach(form => {
          const submitButton = form.querySelector(
            'button[type="submit"]'
          ) as HTMLButtonElement;
          if (submitButton) {
            submitButton.disabled = true;
            submitButton.classList.add('disabled-button');
          }
        });
      }

      // Disable all forms to prevent any submission
      if (this.forms) {
        this.forms.forEach(form => {
          form.style.pointerEvents = 'none';
          form.classList.add('form-disabled');
        });
      }

      // Set a timeout to re-enable buttons after configured time (error recovery)
      this.submissionTimeout = window.setTimeout(() => {
        this.log('Error recovery timeout triggered', null, 'warn');
        this.enableAllButtons();
      }, this.errorRecoveryTimeout);
    }

    /**
     * Enable all interactive elements (for error recovery)
     */
    private enableAllButtons(): void {
      this.isSubmitting = false;

      // Clear timeout
      if (this.submissionTimeout) {
        clearTimeout(this.submissionTimeout);
        this.submissionTimeout = null;
      }

      // Re-enable all form submit buttons and restore visual state
      if (this.forms) {
        this.forms.forEach(form => {
          const submitButton = form.querySelector(
            'button[type="submit"]'
          ) as HTMLButtonElement;
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.classList.remove('disabled-button');

            if (form.action.includes('/resend')) {
              submitButton.innerHTML = this.getTranslation(
                'resendVerificationEmail'
              );
            } else {
              submitButton.innerHTML = this.getTranslation(
                'sendVerificationLink'
              );
            }
          }
        });
      }

      // Re-enable all forms
      if (this.forms) {
        this.forms.forEach(form => {
          form.style.pointerEvents = 'auto';
          form.classList.remove('form-disabled');
        });
      }
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById(
      '___EMAIL_VERIFICATION_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const emailVerificationManager = new EmailVerificationManager({
          config: data.config || {
            enableLoadingStates: true,
            errorRecoveryTimeout: 120000,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
        });

        emailVerificationManager.run();
      } catch (error) {
        console.error(
          '[EmailVerificationManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const emailVerificationManager = new EmailVerificationManager({
            config: {
              enableLoadingStates: true,
              errorRecoveryTimeout: 120000,
            },
            debug: true,
          });
          emailVerificationManager.run();
        } catch (fallbackError) {
          console.error(
            '[EmailVerificationManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[EmailVerificationManager] No configuration data found in DOM'
      );

      try {
        const emailVerificationManager = new EmailVerificationManager({
          config: {
            enableLoadingStates: true,
            errorRecoveryTimeout: 120000,
          },
          debug: true,
        });
        emailVerificationManager.run();
      } catch (fallbackError) {
        console.error(
          '[EmailVerificationManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
