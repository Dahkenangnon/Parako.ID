/**
 * ResetPasswordManager - Handles password reset form interactions and state management
 *
 * Features:
 * - Password visibility toggle with visual feedback
 * - Real-time password strength validation with visual indicators
 * - Password confirmation matching validation
 * - Form submission with loading states and error recovery
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The ResetPasswordManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.resetPassword: Button text for resetting password
 * - auth.resettingPassword: Loading text during password reset
 * - auth.passwordRequired: Validation message for empty password
 * - auth.confirmPasswordRequired: Validation message for empty confirm password
 * - auth.passwordsDoNotMatch: Validation message for password mismatch
 * - auth.passwordTooShort: Validation message for password too short
 * - auth.passwordRequiresUppercase: Validation message for missing uppercase
 * - auth.passwordRequiresLowercase: Validation message for missing lowercase
 * - auth.passwordRequiresNumbers: Validation message for missing numbers
 * - auth.passwordRequiresSymbols: Validation message for missing symbols
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.resetPassword', 'Reset password') | tojson }}
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
  interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
  }

  interface ResetPasswordConfig {
    enableLanguageSelector: boolean;
    enablePasswordToggle: boolean;
    enableStrengthMeter: boolean;
    enablePasswordConfirmation: boolean;
  }

  interface TranslationStrings {
    resetPassword: string;
    resettingPassword: string;
    passwordRequired: string;
    confirmPasswordRequired: string;
    passwordsDoNotMatch: string;
    passwordTooShort: string;
    passwordRequiresUppercase: string;
    passwordRequiresLowercase: string;
    passwordRequiresNumbers: string;
    passwordRequiresSymbols: string;
    errorRecovery: string;
  }

  interface ResetPasswordManagerOptions {
    config: ResetPasswordConfig;
    passwordPolicy: PasswordPolicy;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class ResetPasswordManager {
    private config: ResetPasswordConfig;
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
    private togglePassword: HTMLElement | null = null;
    private passwordStrength: HTMLElement | null = null;
    private passwordFeedback: HTMLElement | null = null;
    private languageSelector: HTMLSelectElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      resetPassword: 'Reset password',
      resettingPassword: 'Resetting password...',
      passwordRequired: 'Please enter your new password',
      confirmPasswordRequired: 'Please confirm your new password',
      passwordsDoNotMatch: 'Passwords do not match. Please try again.',
      passwordTooShort: 'Password must be at least {minLength} characters long',
      passwordRequiresUppercase:
        'Password must contain at least one uppercase letter',
      passwordRequiresLowercase:
        'Password must contain at least one lowercase letter',
      passwordRequiresNumbers: 'Password must contain at least one number',
      passwordRequiresSymbols:
        'Password must contain at least one special character',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: ResetPasswordManagerOptions) {
      this.config = this.validateConfig(options.config);
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

      this.log('ResetPasswordManager initialized', {
        config: this.config,
        passwordPolicy: this.passwordPolicy,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: ResetPasswordConfig): ResetPasswordConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          enableLanguageSelector: false,
          enablePasswordToggle: true,
          enableStrengthMeter: true,
          enablePasswordConfirmation: true,
        };
      }

      return {
        enableLanguageSelector: Boolean(config.enableLanguageSelector),
        enablePasswordToggle: Boolean(config.enablePasswordToggle),
        enableStrengthMeter: Boolean(config.enableStrengthMeter),
        enablePasswordConfirmation: Boolean(config.enablePasswordConfirmation),
      };
    }

    /**
     * Validate password policy object
     */
    private validatePasswordPolicy(policy: PasswordPolicy): PasswordPolicy {
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
        };
      }

      return {
        minLength: Math.max(1, Number(policy.minLength) || 8),
        requireUppercase: Boolean(policy.requireUppercase),
        requireLowercase: Boolean(policy.requireLowercase),
        requireNumbers: Boolean(policy.requireNumbers),
        requireSymbols: Boolean(policy.requireSymbols),
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

      const prefix = '[ResetPasswordManager]';
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
      this.setupLanguageSelector();
      this.setupPasswordToggle();
      this.setupPasswordStrengthValidation();
      this.setupFormSubmission();
      this.setupInputFocusAnimations();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.form = document.getElementById(
        'reset-password-form'
      ) as HTMLFormElement;
      this.submitButton =
        this.form?.querySelector('button[type="submit"]') || null;
      this.passwordInput = document.getElementById(
        'password'
      ) as HTMLInputElement;
      this.confirmPasswordInput = document.getElementById(
        'confirm-password'
      ) as HTMLInputElement;
      this.togglePassword = document.getElementById('toggle-password');
      this.passwordStrength = document.getElementById('password-strength');
      this.passwordFeedback = document.getElementById('password-feedback');
      this.languageSelector = document.getElementById(
        'language-selector'
      ) as HTMLSelectElement;
    }

    /**
     * Setup language selector functionality
     */
    private setupLanguageSelector(): void {
      if (!this.config.enableLanguageSelector || !this.languageSelector) {
        return;
      }

      this.languageSelector.addEventListener('change', e => {
        const lang = (e.target as HTMLSelectElement).value;
        this.log('Language changed to:', lang);
        // Implementation for language switching
        // This would typically trigger a page reload or AJAX call to change language
      });
    }

    /**
     * Setup password visibility toggle functionality
     */
    private setupPasswordToggle(): void {
      if (
        !this.config.enablePasswordToggle ||
        !this.togglePassword ||
        !this.passwordInput
      ) {
        return;
      }

      this.togglePassword.addEventListener('click', () => {
        const type =
          this.passwordInput!.getAttribute('type') === 'password'
            ? 'text'
            : 'password';
        this.passwordInput!.setAttribute('type', type);

        const eyeIcon = this.togglePassword!.querySelector('svg');
        if (eyeIcon) {
          if (type === 'password') {
            eyeIcon.innerHTML = `
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
            `;
          } else {
            eyeIcon.innerHTML = `
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L12 12m-3.122-3.122L12 12m-3.122-3.122l-4.242-4.242M12 12l4.242 4.242M12 12l6.878 6.878"></path>
            `;
          }
        }
      });
    }

    /**
     * Setup password strength validation
     */
    private setupPasswordStrengthValidation(): void {
      if (
        !this.config.enableStrengthMeter ||
        !this.passwordInput ||
        !this.passwordStrength ||
        !this.passwordFeedback
      ) {
        return;
      }

      this.passwordInput.addEventListener('input', () => {
        const value = this.passwordInput!.value;
        const strength = this.calculatePasswordStrength(value);

        this.passwordStrength!.style.width = `${strength.percentage}%`;

        if (strength.percentage <= 25) {
          this.passwordStrength!.className =
            'h-full bg-red-500 dark:bg-red-600 transition-all duration-300';
          this.passwordFeedback!.textContent = 'Weak password';
        } else if (strength.percentage <= 50) {
          this.passwordStrength!.className =
            'h-full bg-orange-500 dark:bg-orange-600 transition-all duration-300';
          this.passwordFeedback!.textContent = 'Fair password';
        } else if (strength.percentage <= 75) {
          this.passwordStrength!.className =
            'h-full bg-yellow-500 dark:bg-yellow-600 transition-all duration-300';
          this.passwordFeedback!.textContent = 'Good password';
        } else {
          this.passwordStrength!.className =
            'h-full bg-green-500 dark:bg-green-600 transition-all duration-300';
          this.passwordFeedback!.textContent = 'Strong password';
        }
      });
    }

    /**
     * Calculate password strength based on policy
     */
    private calculatePasswordStrength(password: string): {
      percentage: number;
      requirements: string[];
    } {
      const requirements: string[] = [];
      let strength = 0;
      //   1 +
      //   (this.passwordPolicy.requireUppercase ? 1 : 0) +
      //   (this.passwordPolicy.requireLowercase ? 1 : 0) +
      //   (this.passwordPolicy.requireNumbers ? 1 : 0) +
      //   (this.passwordPolicy.requireSymbols ? 1 : 0);

      if (password.length >= this.passwordPolicy.minLength) {
        strength += 25;
      } else {
        requirements.push(
          `At least ${this.passwordPolicy.minLength} characters`
        );
      }

      if (this.passwordPolicy.requireUppercase) {
        if (password.match(/[A-Z]/)) {
          strength += 25;
        } else {
          requirements.push('Uppercase letter');
        }
      } else if (password.match(/[A-Z]/)) {
        strength += 25;
      }

      if (this.passwordPolicy.requireLowercase) {
        if (password.match(/[a-z]/)) {
          strength += 25;
        } else {
          requirements.push('Lowercase letter');
        }
      } else if (password.match(/[a-z]/)) {
        strength += 25;
      }

      if (this.passwordPolicy.requireNumbers) {
        if (password.match(/[0-9]/)) {
          strength += 25;
        } else {
          requirements.push('Number');
        }
      } else if (password.match(/[0-9]/)) {
        strength += 25;
      }

      if (this.passwordPolicy.requireSymbols) {
        if (password.match(/[^A-Za-z0-9]/)) {
          strength += 25;
        } else {
          requirements.push('Special character');
        }
      } else if (password.match(/[^A-Za-z0-9]/)) {
        strength += 25;
      }

      return {
        percentage: strength,
        requirements,
      };
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

        const password = this.passwordInput?.value || '';
        const confirmPassword = this.confirmPasswordInput?.value || '';

        if (!password) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('passwordRequired'));
          if (this.passwordInput) this.passwordInput.focus();
          return;
        }

        if (this.config.enablePasswordConfirmation && !confirmPassword) {
          e.preventDefault();
          this.showValidationError(
            this.getTranslation('confirmPasswordRequired')
          );
          if (this.confirmPasswordInput) this.confirmPasswordInput.focus();
          return;
        }

        if (
          this.config.enablePasswordConfirmation &&
          password !== confirmPassword
        ) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('passwordsDoNotMatch'));
          if (this.confirmPasswordInput) this.confirmPasswordInput.focus();
          return;
        }

        const errors = this.validatePasswordRequirements(password);
        if (errors.length > 0) {
          e.preventDefault();
          this.showValidationError(
            `Password requirements not met:\n${errors.join('\n')}`
          );
          if (this.passwordInput) this.passwordInput.focus();
          return;
        }

        e.preventDefault();

        this.disableAllButtons();

        this.submitButton!.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('resettingPassword')}
        `;

        setTimeout(() => {
          if (this.form) {
            this.form.submit();
          }
        }, 100);
      });
    }

    /**
     * Validate password requirements
     */
    private validatePasswordRequirements(password: string): string[] {
      const errors: string[] = [];

      if (password.length < this.passwordPolicy.minLength) {
        errors.push(
          this.getTranslation('passwordTooShort').replace(
            '{minLength}',
            this.passwordPolicy.minLength.toString()
          )
        );
      }

      if (this.passwordPolicy.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push(this.getTranslation('passwordRequiresUppercase'));
      }

      if (this.passwordPolicy.requireLowercase && !/[a-z]/.test(password)) {
        errors.push(this.getTranslation('passwordRequiresLowercase'));
      }

      if (this.passwordPolicy.requireNumbers && !/\d/.test(password)) {
        errors.push(this.getTranslation('passwordRequiresNumbers'));
      }

      if (
        this.passwordPolicy.requireSymbols &&
        !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
      ) {
        errors.push(this.getTranslation('passwordRequiresSymbols'));
      }

      return errors;
    }

    /**
     * Setup input focus animations
     */
    private setupInputFocusAnimations(): void {
      const inputs = document.querySelectorAll(
        'input[type="password"], input[type="text"]'
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

      const inputs = this.form?.querySelectorAll('input, select, textarea');
      inputs?.forEach(input => {
        const element = input as HTMLInputElement;
        element.disabled = true;
        element.style.opacity = '0.6';
        element.style.cursor = 'not-allowed';
        element.style.pointerEvents = 'none';
      });

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
        this.submitButton.innerHTML = this.getTranslation('resetPassword');
        this.submitButton.style.opacity = '1';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.pointerEvents = 'auto';
      }

      // Re-enable all form inputs
      const inputs = this.form?.querySelectorAll('input, select, textarea');
      inputs?.forEach(input => {
        const element = input as HTMLInputElement;
        element.disabled = false;
        element.style.opacity = '1';
        element.style.cursor = 'text';
        element.style.pointerEvents = 'auto';
      });

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
    const dataElement = document.getElementById('___RESET_PASSWORD_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const resetPasswordManager = new ResetPasswordManager({
          config: data.config || {
            enableLanguageSelector: false,
            enablePasswordToggle: true,
            enableStrengthMeter: true,
            enablePasswordConfirmation: true,
          },
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
        });

        resetPasswordManager.run();
      } catch (error) {
        console.error('[ResetPasswordManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const resetPasswordManager = new ResetPasswordManager({
            config: {
              enableLanguageSelector: false,
              enablePasswordToggle: true,
              enableStrengthMeter: true,
              enablePasswordConfirmation: true,
            },
            passwordPolicy: {
              minLength: 8,
              requireUppercase: false,
              requireLowercase: false,
              requireNumbers: false,
              requireSymbols: false,
            },
            debug: true,
          });
          resetPasswordManager.run();
        } catch (fallbackError) {
          console.error(
            '[ResetPasswordManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[ResetPasswordManager] No configuration data found in DOM'
      );

      try {
        const resetPasswordManager = new ResetPasswordManager({
          config: {
            enableLanguageSelector: false,
            enablePasswordToggle: true,
            enableStrengthMeter: true,
            enablePasswordConfirmation: true,
          },
          passwordPolicy: {
            minLength: 8,
            requireUppercase: false,
            requireLowercase: false,
            requireNumbers: false,
            requireSymbols: false,
          },
          debug: true,
        });
        resetPasswordManager.run();
      } catch (fallbackError) {
        console.error(
          '[ResetPasswordManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
