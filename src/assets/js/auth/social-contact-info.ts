/**
 * SocialContactInfoManager - Handles social contact information completion form interactions and state management
 *
 * Features:
 * - Real-time email and phone validation with visual feedback
 * - Form submission with loading states and error recovery
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The SocialContactInfoManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.completeRegistration: Button text for completing registration
 * - auth.completingRegistration: Loading text during registration completion
 * - auth.emailRequired: Validation message for empty email
 * - auth.phoneRequired: Validation message for empty phone
 * - auth.emailInvalid: Validation message for invalid email format
 * - auth.phoneInvalid: Validation message for invalid phone format
 * - auth.contactInfoRequired: Validation message when neither email nor phone provided
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.completeRegistration', 'Complete Registration') | tojson }}
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
  interface SocialContactInfoConfig {
    requireEmail: boolean;
    requirePhone: boolean;
    allowBoth: boolean;
    emailPlaceholder: string;
    phonePlaceholder: string;
  }

  interface TranslationStrings {
    completeRegistration: string;
    completingRegistration: string;
    emailRequired: string;
    phoneRequired: string;
    emailInvalid: string;
    phoneInvalid: string;
    contactInfoRequired: string;
    errorRecovery: string;
  }

  interface SocialContactInfoManagerOptions {
    config: SocialContactInfoConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class SocialContactInfoManager {
    private config: SocialContactInfoConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private emailInput: HTMLInputElement | null = null;
    private phoneInput: HTMLInputElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      completeRegistration: 'Complete Registration',
      completingRegistration: 'Completing registration...',
      emailRequired: 'Please enter your email address',
      phoneRequired: 'Please enter your phone number',
      emailInvalid: 'Please enter a valid email address',
      phoneInvalid: 'Please enter a valid phone number',
      contactInfoRequired:
        'Please provide either an email address or phone number',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: SocialContactInfoManagerOptions) {
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

      this.log('SocialContactInfoManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: SocialContactInfoConfig
    ): SocialContactInfoConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          requireEmail: true,
          requirePhone: false,
          allowBoth: true,
          emailPlaceholder: 'Enter your email address',
          phonePlaceholder: 'Enter your phone number',
        };
      }

      return {
        requireEmail: Boolean(config.requireEmail),
        requirePhone: Boolean(config.requirePhone),
        allowBoth: Boolean(config.allowBoth),
        emailPlaceholder: String(
          config.emailPlaceholder || 'Enter your email address'
        ),
        phonePlaceholder: String(
          config.phonePlaceholder || 'Enter your phone number'
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

      const prefix = '[SocialContactInfoManager]';
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
      this.setupInputValidation();
      this.setupFormSubmission();
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
      this.phoneInput = document.getElementById(
        'phone_number'
      ) as HTMLInputElement;
    }

    /**
     * Setup real-time input validation
     */
    private setupInputValidation(): void {
      if (this.emailInput) {
        this.emailInput.addEventListener('input', () => {
          this.validateEmail();
        });
      }

      if (this.phoneInput) {
        this.phoneInput.addEventListener('input', () => {
          this.validatePhone();
        });
      }
    }

    /**
     * Validate email input
     */
    private validateEmail(): void {
      if (!this.emailInput) return;

      const email = this.emailInput.value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (email && !emailRegex.test(email)) {
        this.emailInput.setCustomValidity(this.getTranslation('emailInvalid'));
        this.emailInput.classList.add(
          'border-red-500',
          'focus:border-red-500',
          'focus:ring-red-500'
        );
        this.emailInput.classList.remove(
          'border-gray-300',
          'dark:border-gray-600',
          'focus:border-primary/30',
          'focus:ring-primary/20'
        );
      } else {
        this.emailInput.setCustomValidity('');
        this.emailInput.classList.remove(
          'border-red-500',
          'focus:border-red-500',
          'focus:ring-red-500'
        );
        this.emailInput.classList.add(
          'border-gray-300',
          'dark:border-gray-600',
          'focus:border-primary/30',
          'focus:ring-primary/20'
        );
      }
    }

    /**
     * Validate phone input
     */
    private validatePhone(): void {
      if (!this.phoneInput) return;

      const phone = this.phoneInput.value.replace(/[\s\-\(\)]/g, '');
      const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;

      if (phone && !phoneRegex.test(phone)) {
        this.phoneInput.setCustomValidity(this.getTranslation('phoneInvalid'));
        this.phoneInput.classList.add(
          'border-red-500',
          'focus:border-red-500',
          'focus:ring-red-500'
        );
        this.phoneInput.classList.remove(
          'border-gray-300',
          'dark:border-gray-600',
          'focus:border-primary/30',
          'focus:ring-primary/20'
        );
      } else {
        this.phoneInput.setCustomValidity('');
        this.phoneInput.classList.remove(
          'border-red-500',
          'focus:border-red-500',
          'focus:ring-red-500'
        );
        this.phoneInput.classList.add(
          'border-gray-300',
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
        if (this.isSubmitting) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const email = this.emailInput?.value.trim() || '';
        const phone = this.phoneInput?.value.trim() || '';

        if (!email && !phone) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('contactInfoRequired'));
          return;
        }

        if (this.config.requireEmail && !email) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('emailRequired'));
          if (this.emailInput) this.emailInput.focus();
          return;
        }

        if (this.config.requirePhone && !phone) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('phoneRequired'));
          if (this.phoneInput) this.phoneInput.focus();
          return;
        }

        if (email) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            e.preventDefault();
            this.showValidationError(this.getTranslation('emailInvalid'));
            if (this.emailInput) this.emailInput.focus();
            return;
          }
        }

        if (phone) {
          const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
          const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
          if (!phoneRegex.test(cleanPhone)) {
            e.preventDefault();
            this.showValidationError(this.getTranslation('phoneInvalid'));
            if (this.phoneInput) this.phoneInput.focus();
            return;
          }
        }

        e.preventDefault();

        this.disableAllButtons();

        this.submitButton!.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('completingRegistration')}
        `;

        setTimeout(() => {
          if (this.form) {
            this.form.submit();
          }
        }, 100);
      });
    }

    /**
     * Setup input focus animations
     */
    private setupInputFocusAnimations(): void {
      const inputs = document.querySelectorAll(
        'input[type="email"], input[type="tel"]'
      );
      inputs.forEach(input => {
        input.addEventListener('focus', function (this: HTMLElement) {
          this.parentElement?.classList.add('ring-2', 'ring-primary/20');
        });

        input.addEventListener('blur', function (this: HTMLElement) {
          this.parentElement?.classList.remove('ring-2', 'ring-primary/20');
        });
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

      if (this.submitButton) {
        this.submitButton.disabled = true;
        this.submitButton.style.opacity = '0.6';
        this.submitButton.style.cursor = 'not-allowed';
        this.submitButton.style.pointerEvents = 'none';
      }

      // Disable the entire form to prevent any submission
      if (this.form) {
        this.form.style.pointerEvents = 'none';
        this.form.classList.add('form-disabled');
      }

      // Set a timeout to re-enable buttons after configured time (error recovery)
      this.submissionTimeout = window.setTimeout(() => {
        this.log('Error recovery timeout triggered', null, 'warn');
        this.enableAllButtons();
        this.showValidationError(this.getTranslation('errorRecovery'));
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

      // Re-enable form submit button and restore visual state
      if (this.submitButton) {
        this.submitButton.disabled = false;
        this.submitButton.innerHTML = this.getTranslation(
          'completeRegistration'
        );
        this.submitButton.style.opacity = '1';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.pointerEvents = 'auto';
      }

      // Re-enable the entire form
      if (this.form) {
        this.form.style.pointerEvents = 'auto';
        this.form.classList.remove('form-disabled');
      }
    }

    /**
     * Show validation error to user
     */
    private showValidationError(message: string): void {
      this.log('Validation error', { message }, 'warn');

      // For now, use alert - in production, you might want to use a toast or inline error display
      alert(message);
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById(
      '___SOCIAL_CONTACT_INFO_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const socialContactInfoManager = new SocialContactInfoManager({
          config: data.config || {
            requireEmail: true,
            requirePhone: false,
            allowBoth: true,
            emailPlaceholder: 'Enter your email address',
            phonePlaceholder: 'Enter your phone number',
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 120000,
        });

        socialContactInfoManager.run();
      } catch (error) {
        console.error(
          '[SocialContactInfoManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const socialContactInfoManager = new SocialContactInfoManager({
            config: {
              requireEmail: true,
              requirePhone: false,
              allowBoth: true,
              emailPlaceholder: 'Enter your email address',
              phonePlaceholder: 'Enter your phone number',
            },
            debug: true,
          });
          socialContactInfoManager.run();
        } catch (fallbackError) {
          console.error(
            '[SocialContactInfoManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[SocialContactInfoManager] No configuration data found in DOM'
      );

      try {
        const socialContactInfoManager = new SocialContactInfoManager({
          config: {
            requireEmail: true,
            requirePhone: false,
            allowBoth: true,
            emailPlaceholder: 'Enter your email address',
            phonePlaceholder: 'Enter your phone number',
          },
          debug: true,
        });
        socialContactInfoManager.run();
      } catch (fallbackError) {
        console.error(
          '[SocialContactInfoManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
