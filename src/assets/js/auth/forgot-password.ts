/**
 * ForgotPasswordManager - Handles forgot password form interactions and email validation
 *
 * Features:
 * - Email validation with real-time feedback
 * - Form submission with loading states and error recovery
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 * - Enhanced user experience with visual feedback
 *
 * Translation Support:
 * The ForgotPasswordManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.sendResetLink: Button text for sending reset link
 * - auth.sendingResetLink: Loading text during reset link sending
 * - auth.emailRequired: Validation message for empty email
 * - auth.emailInvalid: Validation message for invalid email format
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.sendResetLink', 'Send reset link') | tojson }}
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
  interface ForgotPasswordConfig {
    enableEmailValidation: boolean;
    emailValidationTimeout: number;
  }

  interface TranslationStrings {
    sendResetLink: string;
    sendingResetLink: string;
    emailRequired: string;
    emailInvalid: string;
    errorRecovery: string;
  }

  interface ForgotPasswordManagerOptions {
    config: ForgotPasswordConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class ForgotPasswordManager {
    private config: ForgotPasswordConfig;
    private translations: TranslationStrings;
    private debug: boolean;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private emailInput: HTMLInputElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      sendResetLink: 'Send reset link',
      sendingResetLink: 'Sending...',
      emailRequired: 'Please enter your email address',
      emailInvalid: 'Please enter a valid email address',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: ForgotPasswordManagerOptions) {
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

      this.log('ForgotPasswordManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: ForgotPasswordConfig): ForgotPasswordConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          enableEmailValidation: true,
          emailValidationTimeout: 300,
        };
      }

      return {
        enableEmailValidation: Boolean(config.enableEmailValidation),
        emailValidationTimeout: Math.max(
          100,
          Math.min(2000, Number(config.emailValidationTimeout) || 300)
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

      const prefix = '[ForgotPasswordManager]';
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
      if (!this.form || !this.submitButton || !this.emailInput) {
        this.log('Required form elements not found', null, 'error');
        return;
      }

      this.setupFormSubmission();
      this.setupEmailValidation();
      this.setupInputFocusAnimations();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.form = document.querySelector('form');
      this.submitButton =
        this.form?.querySelector('button[type="submit"]') || null;
      this.emailInput = document.getElementById('email') as HTMLInputElement;
    }

    /**
     * Setup email validation
     */
    private setupEmailValidation(): void {
      if (!this.emailInput || !this.config.enableEmailValidation) return;

      let validationTimeout: number | null = null;

      this.emailInput.addEventListener('input', () => {
        // Clear existing timeout
        if (validationTimeout) {
          clearTimeout(validationTimeout);
        }

        // Set new timeout for validation
        validationTimeout = window.setTimeout(() => {
          this.validateEmail();
        }, this.config.emailValidationTimeout);
      });

      this.emailInput.addEventListener('blur', () => {
        this.validateEmail();
      });
    }

    /**
     * Validate email input
     */
    private validateEmail(): void {
      if (!this.emailInput) return;

      const email = this.emailInput.value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (email && !emailRegex.test(email)) {
        this.showValidationError(this.getTranslation('emailInvalid'));
        this.emailInput.classList.add(
          'border-red-500',
          'focus:border-red-500',
          'focus:ring-red-500'
        );
        this.emailInput.classList.remove(
          'border-gray-200',
          'dark:border-gray-600',
          'focus:border-primary/30',
          'focus:ring-primary/20'
        );
      } else {
        this.clearValidationError();
        this.emailInput.classList.remove(
          'border-red-500',
          'focus:border-red-500',
          'focus:ring-red-500'
        );
        this.emailInput.classList.add(
          'border-gray-200',
          'dark:border-gray-600',
          'focus:border-primary/30',
          'focus:ring-primary/20'
        );
      }
    }

    /**
     * Setup form submission handling
     */
    private setupFormSubmission(): void {
      if (!this.form || !this.submitButton) {
        return;
      }

      this.form.addEventListener('submit', (e: Event) => {
        const emailInput = this.emailInput;
        if (!emailInput || !emailInput.value) {
          e.preventDefault();
          alert(this.getTranslation('emailRequired'));
          return;
        }

        this.submitButton!.disabled = true;
        this.submitButton!.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('sendingResetLink')}
        `;
      });
    }

    /**
     * Setup input focus animations
     */
    private setupInputFocusAnimations(): void {
      if (!this.emailInput) return;

      this.emailInput.addEventListener('focus', () => {
        this.emailInput?.classList.add('ring-2', 'ring-primary/20');
      });

      this.emailInput.addEventListener('blur', () => {
        this.emailInput?.classList.remove('ring-2', 'ring-primary/20');
      });
    }

    /**
     * Show validation error
     */
    private showValidationError(message: string): void {
      this.log('Validation error', { message }, 'warn');

      this.clearValidationError();

      const errorElement = document.createElement('p');
      errorElement.className = 'text-red-500 text-xs mt-1';
      errorElement.textContent = message;
      errorElement.id = 'email-error-message';

      if (this.emailInput) {
        this.emailInput.parentNode?.insertBefore(
          errorElement,
          this.emailInput.parentNode.lastElementChild
        );
      }
    }

    /**
     * Clear validation error
     */
    private clearValidationError(): void {
      const existingError = document.getElementById('email-error-message');
      if (existingError) {
        existingError.remove();
      }
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('___FORGOT_PASSWORD_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const forgotPasswordManager = new ForgotPasswordManager({
          config: data.config || {
            enableEmailValidation: true,
            emailValidationTimeout: 300,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
        });

        forgotPasswordManager.run();
      } catch (error) {
        console.error('[ForgotPasswordManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const forgotPasswordManager = new ForgotPasswordManager({
            config: {
              enableEmailValidation: true,
              emailValidationTimeout: 300,
            },
            debug: true,
          });
          forgotPasswordManager.run();
        } catch (fallbackError) {
          console.error(
            '[ForgotPasswordManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[ForgotPasswordManager] No configuration data found in DOM'
      );

      try {
        const forgotPasswordManager = new ForgotPasswordManager({
          config: {
            enableEmailValidation: true,
            emailValidationTimeout: 300,
          },
          debug: true,
        });
        forgotPasswordManager.run();
      } catch (fallbackError) {
        console.error(
          '[ForgotPasswordManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
