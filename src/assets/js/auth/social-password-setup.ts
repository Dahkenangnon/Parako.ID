/**
 * SocialPasswordSetupManager - Handles social password setup form interactions and validation
 *
 * Features:
 * - Password visibility toggle for both password fields
 * - Real-time password strength validation with visual feedback
 * - Password confirmation matching validation
 * - Form submission with loading states
 * - Comprehensive button disabling during submission
 * - Error recovery mechanisms with configurable timeout
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The SocialPasswordSetupManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.completeRegistration: Button text for completing registration
 * - auth.completingRegistration: Loading text during registration completion
 * - auth.passwordRequired: Validation message for empty password
 * - auth.confirmPasswordRequired: Validation message for empty confirm password
 * - auth.passwordsDoNotMatch: Validation message for password mismatch
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

(function () {
  'use strict';
  interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
  }

  interface TranslationStrings {
    completeRegistration: string;
    completingRegistration: string;
    passwordRequired: string;
    confirmPasswordRequired: string;
    passwordsDoNotMatch: string;
    errorRecovery: string;
  }

  interface SocialPasswordSetupManagerOptions {
    passwordPolicy: any;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
    csrfToken?: string;
  }

  class SocialPasswordSetupManager {
    private passwordPolicy: PasswordPolicy;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private passwordInput: HTMLInputElement | null = null;
    private confirmPasswordInput: HTMLInputElement | null = null;
    private passwordToggle: HTMLElement | null = null;
    private confirmPasswordToggle: HTMLElement | null = null;

    // Password requirement check elements
    private lengthCheck: HTMLElement | null = null;
    private uppercaseCheck: HTMLElement | null = null;
    private lowercaseCheck: HTMLElement | null = null;
    private numberCheck: HTMLElement | null = null;
    private symbolCheck: HTMLElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      completeRegistration: 'Complete Registration',
      completingRegistration: 'Completing Registration...',
      passwordRequired: 'Please enter your password',
      confirmPasswordRequired: 'Please confirm your password',
      passwordsDoNotMatch: 'Passwords do not match',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: SocialPasswordSetupManagerOptions) {
      this.passwordPolicy = this.validatePasswordPolicy(options.passwordPolicy);

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

      this.log('SocialPasswordSetupManager initialized', {
        passwordPolicy: this.passwordPolicy,
        translations: this.translations,
      });
    }

    /**
     * Validate password policy object
     */
    private validatePasswordPolicy(policy: any): PasswordPolicy {
      if (!policy || typeof policy !== 'object') {
        this.log(
          'Invalid password policy provided, using defaults',
          { policy },
          'warn'
        );
        return {
          minLength: 8,
          requireUppercase: false,
          requireLowercase: false,
          requireNumbers: false,
          requireSymbols: false,
        } as PasswordPolicy;
      }

      return {
        minLength: Math.max(1, Number(policy.minLength) || 8),
        requireUppercase: Boolean(policy.requireUppercase),
        requireLowercase: Boolean(policy.requireLowercase),
        requireNumbers: Boolean(policy.requireNumbers),
        requireSymbols: Boolean(policy.requireSymbols),
      } as PasswordPolicy;
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

      const prefix = '[SocialPasswordSetupManager]';
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
      this.setupPasswordToggles();
      this.setupPasswordValidation();
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
      this.passwordInput = document.getElementById(
        'password'
      ) as HTMLInputElement;
      this.confirmPasswordInput = document.getElementById(
        'confirmPassword'
      ) as HTMLInputElement;
      this.passwordToggle = document.querySelector(
        'button[onclick*="togglePassword(\'password\')"]'
      );
      this.confirmPasswordToggle = document.querySelector(
        'button[onclick*="togglePassword(\'confirmPassword\')"]'
      );

      // Password requirement check elements
      this.lengthCheck = document.getElementById('length-check');
      this.uppercaseCheck = document.getElementById('uppercase-check');
      this.lowercaseCheck = document.getElementById('lowercase-check');
      this.numberCheck = document.getElementById('number-check');
      this.symbolCheck = document.getElementById('symbol-check');
    }

    /**
     * Setup password visibility toggle functionality
     */
    private setupPasswordToggles(): void {
      if (this.passwordToggle && this.passwordInput) {
        this.passwordToggle.addEventListener('click', () => {
          this.togglePasswordVisibility('password');
        });
      }

      if (this.confirmPasswordToggle && this.confirmPasswordInput) {
        this.confirmPasswordToggle.addEventListener('click', () => {
          this.togglePasswordVisibility('confirmPassword');
        });
      }
    }

    /**
     * Toggle password visibility for a specific field
     */
    private togglePasswordVisibility(fieldId: string): void {
      const field = document.getElementById(fieldId) as HTMLInputElement;
      const eye = document.getElementById(`${fieldId}-eye`);

      if (!field || !eye) return;

      if (field.type === 'password') {
        field.type = 'text';
        eye.innerHTML =
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />';
      } else {
        field.type = 'password';
        eye.innerHTML =
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />';
      }
    }

    /**
     * Setup password validation
     */
    private setupPasswordValidation(): void {
      if (!this.passwordInput) return;

      this.passwordInput.addEventListener('input', () => {
        this.validatePasswordStrength();
      });

      if (this.confirmPasswordInput) {
        this.confirmPasswordInput.addEventListener('input', () => {
          this.validatePasswordConfirmation();
        });
      }
    }

    /**
     * Validate password strength and update visual indicators
     */
    private validatePasswordStrength(): void {
      if (!this.passwordInput) return;

      const password = this.passwordInput.value;

      if (this.lengthCheck) {
        this.lengthCheck.textContent =
          password.length >= this.passwordPolicy.minLength ? '✅' : '❌';
      }

      if (this.uppercaseCheck) {
        this.uppercaseCheck.textContent = /[A-Z]/.test(password) ? '✅' : '❌';
      }

      if (this.lowercaseCheck) {
        this.lowercaseCheck.textContent = /[a-z]/.test(password) ? '✅' : '❌';
      }

      if (this.numberCheck) {
        this.numberCheck.textContent = /\d/.test(password) ? '✅' : '❌';
      }

      if (this.symbolCheck) {
        this.symbolCheck.textContent = /[!@#$%^&*(),.?":{}|<>]/.test(password)
          ? '✅'
          : '❌';
      }
    }

    /**
     * Validate password confirmation
     */
    private validatePasswordConfirmation(): void {
      if (!this.passwordInput || !this.confirmPasswordInput) return;

      const password = this.passwordInput.value;
      const confirmPassword = this.confirmPasswordInput.value;

      if (confirmPassword && password !== confirmPassword) {
        this.confirmPasswordInput.setCustomValidity(
          this.getTranslation('passwordsDoNotMatch')
        );
      } else {
        this.confirmPasswordInput.setCustomValidity('');
      }
    }

    /**
     * Setup form submission handling
     */
    private setupFormSubmission(): void {
      if (!this.form || !this.submitButton) return;

      this.form.addEventListener('submit', (e: Event) => {
        if (this.isSubmitting) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (this.passwordInput && !this.passwordInput.value.trim()) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('passwordRequired'));
          this.passwordInput.focus();
          return;
        }

        if (
          this.confirmPasswordInput &&
          !this.confirmPasswordInput.value.trim()
        ) {
          e.preventDefault();
          this.showValidationError(
            this.getTranslation('confirmPasswordRequired')
          );
          this.confirmPasswordInput.focus();
          return;
        }

        if (
          this.passwordInput &&
          this.confirmPasswordInput &&
          this.passwordInput.value !== this.confirmPasswordInput.value
        ) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('passwordsDoNotMatch'));
          this.confirmPasswordInput.focus();
          return;
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
      const inputs = document.querySelectorAll('input[type="password"]');
      inputs.forEach(input => {
        input.addEventListener('focus', function (this: HTMLElement) {
          this.parentElement?.classList.add('ring-2', 'ring-blue-500/20');
        });

        input.addEventListener('blur', function (this: HTMLElement) {
          this.parentElement?.classList.remove('ring-2', 'ring-blue-500/20');
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

      if (this.passwordToggle) {
        const passwordBtn = this.passwordToggle as HTMLButtonElement;
        passwordBtn.disabled = true;
        passwordBtn.style.opacity = '0.6';
        passwordBtn.style.cursor = 'not-allowed';
        passwordBtn.style.pointerEvents = 'none';
      }

      if (this.confirmPasswordToggle) {
        const confirmBtn = this.confirmPasswordToggle as HTMLButtonElement;
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.6';
        confirmBtn.style.cursor = 'not-allowed';
        confirmBtn.style.pointerEvents = 'none';
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

      // Re-enable password toggle buttons
      if (this.passwordToggle) {
        const passwordBtn = this.passwordToggle as HTMLButtonElement;
        passwordBtn.disabled = false;
        passwordBtn.style.opacity = '1';
        passwordBtn.style.cursor = 'pointer';
        passwordBtn.style.pointerEvents = 'auto';
      }

      if (this.confirmPasswordToggle) {
        const confirmBtn = this.confirmPasswordToggle as HTMLButtonElement;
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.style.pointerEvents = 'auto';
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
      '___SOCIAL_PASSWORD_SETUP_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const socialPasswordSetupManager = new SocialPasswordSetupManager({
          passwordPolicy: data.passwordPolicy || {
            minLength: 8,
            requireUppercase: false,
            requireLowercase: false,
            requireNumbers: false,
            requireSymbols: false,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 120000,
          csrfToken: data.config?.csrfToken,
        });

        socialPasswordSetupManager.run();
      } catch (error) {
        console.error(
          '[SocialPasswordSetupManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const socialPasswordSetupManager = new SocialPasswordSetupManager({
            passwordPolicy: {
              minLength: 8,
              requireUppercase: false,
              requireLowercase: false,
              requireNumbers: false,
              requireSymbols: false,
            },
            debug: true,
          });
          socialPasswordSetupManager.run();
        } catch (fallbackError) {
          console.error(
            '[SocialPasswordSetupManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[SocialPasswordSetupManager] No configuration data found in DOM'
      );

      try {
        const socialPasswordSetupManager = new SocialPasswordSetupManager({
          passwordPolicy: {
            minLength: 8,
            requireUppercase: false,
            requireLowercase: false,
            requireNumbers: false,
            requireSymbols: false,
          },
          debug: true,
        });
        socialPasswordSetupManager.run();
      } catch (fallbackError) {
        console.error(
          '[SocialPasswordSetupManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
