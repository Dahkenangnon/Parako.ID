/**
 * RegisterManager - Handles all registration form interactions and state management
 *
 * Features:
 * - Email/Phone tab switching with smooth animations
 * - Form validation and submission with loading states
 * - Social provider registration with visual feedback
 * - Password strength validation with real-time feedback
 * - Comprehensive button disabling during registration
 * - Error recovery mechanisms with configurable timeout
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The RegisterManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.createAccount: Button text for create account
 * - auth.creatingAccount: Loading text during account creation
 * - auth.connecting: Loading text for social registration
 * - auth.emailRequired: Validation message for empty email
 * - auth.phoneRequired: Validation message for empty phone
 * - auth.passwordRequired: Validation message for empty password
 * - auth.fullNameRequired: Validation message for empty full name
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.createAccount', 'Create account') | tojson }}
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
  interface CustomIdentifierFieldInfo {
    slot: number;
    key: string;
    name: string;
    hint_for_user: string;
    validation_type: string;
    pattern?: string;
    required_for_registration: boolean;
    edit_policy: string;
  }

  interface RegisterConfig {
    bothMethodsEnabled: boolean;
    emailEnabled: boolean;
    phoneEnabled: boolean;
    requireFullName: boolean;
    customIdentifierFields: CustomIdentifierFieldInfo[];
  }

  interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
  }

  interface TranslationStrings {
    createAccount: string;
    creatingAccount: string;
    connecting: string;
    emailPlaceholder: string;
    phonePlaceholder: string;
    passwordPlaceholder: string;
    fullNamePlaceholder: string;
    emailRequired: string;
    phoneRequired: string;
    passwordRequired: string;
    fullNameRequired: string;
    customIdentifierRequired: string;
    customIdentifierInvalid: string;
    errorRecovery: string;
  }

  interface ProviderIcons {
    [key: string]: string;
  }

  interface RegisterManagerOptions {
    config: RegisterConfig;
    passwordPolicy: PasswordPolicy;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class RegisterManager {
    private config: RegisterConfig;
    private passwordPolicy: PasswordPolicy;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private emailTab: HTMLElement | null = null;
    private phoneTab: HTMLElement | null = null;
    private emailField: HTMLElement | null = null;
    private phoneField: HTMLElement | null = null;
    private customIdentifierInputs: HTMLInputElement[] = [];
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private togglePassword: HTMLElement | null = null;
    private passwordInput: HTMLInputElement | null = null;
    private passwordStrength: HTMLElement | null = null;
    private passwordFeedback: HTMLElement | null = null;
    private passwordRequirements: HTMLElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      createAccount: 'Create account',
      creatingAccount: 'Creating account...',
      connecting: 'Connecting...',
      emailPlaceholder: 'you@example.com',
      phonePlaceholder: '+1 (123) 456-7890',
      passwordPlaceholder: 'Create a password',
      fullNamePlaceholder: 'John Doe',
      emailRequired: 'Please enter your email address',
      phoneRequired: 'Please enter your phone number',
      passwordRequired: 'Please enter your password',
      fullNameRequired: 'Please enter your full name',
      customIdentifierRequired: 'Please enter your identifier',
      customIdentifierInvalid: 'Invalid identifier format',
      errorRecovery: 'Session timed out. Please try again.',
    };

    // Provider icons for social registration buttons
    private readonly providerIcons: ProviderIcons = {
      google:
        '<svg class="w-6 h-6 md:w-7 md:h-7" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>',
      github:
        '<svg class="w-6 h-6 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 0C4.477 0 0 4.477 0 10c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V19c0 .27.16.59.67.5C17.14 18.16 20 14.42 20 10A10 10 0 0010 0z" clip-rule="evenodd"/></svg>',
      facebook:
        '<svg class="w-6 h-6 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
      linkedin:
        '<svg class="w-6 h-6 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>',
    };

    constructor(options: RegisterManagerOptions) {
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

      this.log('RegisterManager initialized', {
        config: this.config,
        passwordPolicy: this.passwordPolicy,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: RegisterConfig): RegisterConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          bothMethodsEnabled: false,
          emailEnabled: true,
          phoneEnabled: false,
          requireFullName: false,
          customIdentifierFields: [],
        };
      }

      return {
        bothMethodsEnabled: Boolean(config.bothMethodsEnabled),
        emailEnabled: Boolean(config.emailEnabled),
        phoneEnabled: Boolean(config.phoneEnabled),
        requireFullName: Boolean(config.requireFullName),
        customIdentifierFields: Array.isArray(config.customIdentifierFields)
          ? config.customIdentifierFields
          : [],
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

      const prefix = '[RegisterManager]';
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
      this.setupTabSwitching();
      this.setupPasswordToggle();
      this.setupPasswordStrengthValidation();
      this.setupFormSubmission();
      this.setupInputFocusAnimations();
      this.setupSocialRegistration();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.emailTab = document.getElementById('email-tab');
      this.phoneTab = document.getElementById('phone-tab');
      this.emailField = document.getElementById('email-field');
      this.phoneField = document.getElementById('phone-field');
      this.customIdentifierInputs = this.config.customIdentifierFields
        .map(
          f =>
            document.getElementById(
              `custom_identifier_${f.slot}`
            ) as HTMLInputElement
        )
        .filter(Boolean);
      this.form = document.querySelector('form');
      this.submitButton =
        this.form?.querySelector('button[type="submit"]') || null;
      this.togglePassword = document.getElementById('toggle-password');
      this.passwordInput = document.getElementById(
        'password'
      ) as HTMLInputElement;
      this.passwordStrength = document.getElementById('password-strength');
      this.passwordFeedback = document.getElementById('password-feedback');
      this.passwordRequirements = document.getElementById(
        'password-requirements'
      );
    }

    /**
     * Setup email/phone tab switching functionality
     */
    private setupTabSwitching(): void {
      if (
        !this.emailTab ||
        !this.phoneTab ||
        !this.emailField ||
        !this.phoneField
      ) {
        return;
      }

      // Only set up tab switching if both methods are enabled
      if (this.config.bothMethodsEnabled) {
        this.emailTab.addEventListener('click', e => {
          if (this.isSubmitting) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          this.switchToEmail();
        });
        this.phoneTab.addEventListener('click', e => {
          if (this.isSubmitting) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          this.switchToPhone();
        });

        const phoneInput = document.getElementById('phone') as HTMLInputElement;
        if (phoneInput) phoneInput.disabled = true;
      } else {
        // If only one method is enabled, make sure the correct field is enabled
        if (this.config.emailEnabled) {
          const emailInput = document.getElementById(
            'email'
          ) as HTMLInputElement;
          if (emailInput) emailInput.disabled = false;
        }
        if (this.config.phoneEnabled) {
          const phoneInput = document.getElementById(
            'phone'
          ) as HTMLInputElement;
          if (phoneInput) phoneInput.disabled = false;
        }
      }
    }

    /**
     * Switch to email input mode
     */
    private switchToEmail(): void {
      if (this.isSubmitting) {
        return;
      }

      if (
        !this.emailTab ||
        !this.phoneTab ||
        !this.emailField ||
        !this.phoneField
      ) {
        return;
      }

      // Style email tab as active
      this.emailTab.classList.add(
        'bg-white',
        'dark:bg-card',
        'text-primary',
        'border-2',
        'border-primary',
        'font-semibold'
      );
      this.emailTab.classList.remove(
        'text-gray-600',
        'dark:text-gray-300',
        'hover:text-gray-900',
        'dark:hover:text-gray-100',
        'bg-transparent',
        'border-transparent',
        'font-medium'
      );

      // Style phone tab as inactive
      this.phoneTab.classList.remove(
        'bg-white',
        'dark:bg-card',
        'text-primary',
        'border-primary',
        'font-semibold'
      );
      this.phoneTab.classList.add(
        'text-gray-600',
        'dark:text-gray-300',
        'hover:text-gray-900',
        'dark:hover:text-gray-100',
        'bg-transparent',
        'border-2',
        'border-transparent',
        'font-medium'
      );

      // Show/hide fields with animation
      this.emailField.classList.remove('hidden');
      this.phoneField.classList.add('hidden');

      const emailInput = document.getElementById('email') as HTMLInputElement;
      const phoneInput = document.getElementById('phone') as HTMLInputElement;
      if (emailInput) emailInput.disabled = false;
      if (phoneInput) {
        phoneInput.disabled = true;
        phoneInput.value = ''; // Clear phone input
      }
    }

    /**
     * Switch to phone input mode
     */
    private switchToPhone(): void {
      if (this.isSubmitting) {
        return;
      }

      if (
        !this.emailTab ||
        !this.phoneTab ||
        !this.emailField ||
        !this.phoneField
      ) {
        return;
      }

      // Style phone tab as active
      this.phoneTab.classList.add(
        'bg-white',
        'dark:bg-card',
        'text-primary',
        'border-2',
        'border-primary',
        'font-semibold'
      );
      this.phoneTab.classList.remove(
        'text-gray-600',
        'dark:text-gray-300',
        'hover:text-gray-900',
        'dark:hover:text-gray-100',
        'bg-transparent',
        'border-transparent',
        'font-medium'
      );

      // Style email tab as inactive
      this.emailTab.classList.remove(
        'bg-white',
        'dark:bg-card',
        'text-primary',
        'border-primary',
        'font-semibold'
      );
      this.emailTab.classList.add(
        'text-gray-600',
        'dark:text-gray-300',
        'hover:text-gray-900',
        'dark:hover:text-gray-100',
        'bg-transparent',
        'border-2',
        'border-transparent',
        'font-medium'
      );

      // Show/hide fields with animation
      this.phoneField.classList.remove('hidden');
      this.emailField.classList.add('hidden');

      const emailInput = document.getElementById('email') as HTMLInputElement;
      const phoneInput = document.getElementById('phone') as HTMLInputElement;
      if (phoneInput) phoneInput.disabled = false;
      if (emailInput) {
        emailInput.disabled = true;
        emailInput.value = ''; // Clear email input
      }
    }

    /**
     * Setup password visibility toggle functionality
     */
    private setupPasswordToggle(): void {
      if (!this.togglePassword || !this.passwordInput) {
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
        !this.passwordInput ||
        !this.passwordStrength ||
        !this.passwordFeedback ||
        !this.passwordRequirements
      ) {
        return;
      }

      this.passwordInput.addEventListener('input', () => {
        const value = this.passwordInput!.value;
        const unmetRequirements: string[] = [];

        if (value.length < this.passwordPolicy.minLength) {
          unmetRequirements.push(
            `At least ${this.passwordPolicy.minLength} characters`
          );
        }
        if (this.passwordPolicy.requireUppercase && !value.match(/[A-Z]/)) {
          unmetRequirements.push('Uppercase letter');
        }
        if (this.passwordPolicy.requireLowercase && !value.match(/[a-z]/)) {
          unmetRequirements.push('Lowercase letter');
        }
        if (this.passwordPolicy.requireNumbers && !value.match(/[0-9]/)) {
          unmetRequirements.push('Number');
        }
        if (
          this.passwordPolicy.requireSymbols &&
          !value.match(/[^A-Za-z0-9]/)
        ) {
          unmetRequirements.push('Special character');
        }

        const totalRequirements =
          1 +
          (this.passwordPolicy.requireUppercase ? 1 : 0) +
          (this.passwordPolicy.requireLowercase ? 1 : 0) +
          (this.passwordPolicy.requireNumbers ? 1 : 0) +
          (this.passwordPolicy.requireSymbols ? 1 : 0);
        const metRequirements = totalRequirements - unmetRequirements.length;
        const strengthPercentage = (metRequirements / totalRequirements) * 100;

        this.passwordStrength!.style.width = `${strengthPercentage}%`;

        if (strengthPercentage < 25) {
          this.passwordStrength!.className =
            'h-full bg-red-500 dark:bg-red-600';
        } else if (strengthPercentage < 50) {
          this.passwordStrength!.className =
            'h-full bg-orange-500 dark:bg-orange-600';
        } else if (strengthPercentage < 75) {
          this.passwordStrength!.className =
            'h-full bg-yellow-500 dark:bg-yellow-600';
        } else {
          this.passwordStrength!.className =
            'h-full bg-green-500 dark:bg-green-600';
        }

        // Show/hide feedback and update requirements
        if (unmetRequirements.length > 0) {
          this.passwordFeedback!.classList.remove('hidden');
          this.passwordRequirements!.textContent = '';
          unmetRequirements.forEach(req => {
            const li = document.createElement('li');
            li.textContent = req;
            this.passwordRequirements!.appendChild(li);
          });
        } else {
          this.passwordFeedback!.classList.add('hidden');
        }
      });
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

        const emailField = document.getElementById('email-field');
        const phoneField = document.getElementById('phone-field');
        const emailInput = document.getElementById('email') as HTMLInputElement;
        const phoneInput = document.getElementById('phone') as HTMLInputElement;
        const passwordInput = document.getElementById(
          'password'
        ) as HTMLInputElement;
        const fullnameInput = document.getElementById(
          'fullname'
        ) as HTMLInputElement;

        // Only validate fields that exist and are visible
        if (this.config.bothMethodsEnabled) {
          const isEmailActive =
            emailField && !emailField.classList.contains('hidden');
          const isPhoneActive =
            phoneField && !phoneField.classList.contains('hidden');

          if (isEmailActive && emailInput && !emailInput.value) {
            e.preventDefault();
            this.showValidationError(this.getTranslation('emailRequired'));
            return;
          }

          if (isPhoneActive && phoneInput && !phoneInput.value) {
            e.preventDefault();
            this.showValidationError(this.getTranslation('phoneRequired'));
            return;
          }
        } else {
          if (this.config.emailEnabled && emailInput && !emailInput.value) {
            e.preventDefault();
            this.showValidationError(this.getTranslation('emailRequired'));
            return;
          }

          if (this.config.phoneEnabled && phoneInput && !phoneInput.value) {
            e.preventDefault();
            this.showValidationError(this.getTranslation('phoneRequired'));
            return;
          }
        }

        if (passwordInput && !passwordInput.value) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('passwordRequired'));
          return;
        }

        if (
          this.config.requireFullName &&
          fullnameInput &&
          !fullnameInput.value.trim()
        ) {
          e.preventDefault();
          this.showValidationError(this.getTranslation('fullNameRequired'));
          return;
        }

        // Custom identifier validation
        for (const ciField of this.config.customIdentifierFields) {
          if (ciField.edit_policy === 'admin_only') continue;
          const input = document.getElementById(
            `custom_identifier_${ciField.slot}`
          ) as HTMLInputElement;
          if (!input) continue;
          const value = input.value.trim();

          if (ciField.required_for_registration && !value) {
            e.preventDefault();
            this.showValidationError(`${ciField.name} is required`);
            return;
          }

          if (value && ciField.validation_type === 'regex' && ciField.pattern) {
            try {
              const pattern = new RegExp(ciField.pattern);
              if (!pattern.test(value)) {
                e.preventDefault();
                this.showValidationError(`Invalid ${ciField.name} format`);
                return;
              }
            } catch (patternError) {
              this.log('Invalid pattern regex', { patternError }, 'error');
            }
          }
        }

        e.preventDefault();

        this.disableAllButtons();

        this.submitButton!.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${this.getTranslation('creatingAccount')}
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
        'input[type="email"], input[type="tel"], input[type="password"], input[type="text"]'
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
     * Setup social registration functionality
     */
    private setupSocialRegistration(): void {
      const socialButtons = document.querySelectorAll('button[data-provider]');
      socialButtons.forEach(button => {
        button.addEventListener('click', (e: Event) => {
          e.preventDefault();
          e.stopPropagation();

          if (this.isSubmitting) {
            return;
          }

          const buttonElement = (e.target as HTMLElement).closest(
            'button[data-provider]'
          ) as HTMLButtonElement;
          const provider = buttonElement?.getAttribute('data-provider');

          if (!provider || !buttonElement) return;

          this.disableAllButtons();

          buttonElement.innerHTML = `
          <svg class="animate-spin -ml-1 mr-2 h-5 w-5 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('connecting')}
        `;

          setTimeout(() => {
            const continueUrl =
              new URLSearchParams(window.location.search).get('continue') ||
              new URLSearchParams(window.location.search).get('redirectTo') ||
              '';
            const url = new URL(
              `/auth/social/${provider}/register`,
              window.location.origin
            );
            // Validate continueUrl to prevent open redirect (same-origin only)
            if (continueUrl && this.isValidContinueUrl(continueUrl)) {
              url.searchParams.set('continue', continueUrl);
            }

            window.location.href = url.toString();
          }, 100);
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

      const socialButtons = document.querySelectorAll('button[data-provider]');
      socialButtons.forEach(button => {
        const btn = button as HTMLButtonElement;
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
        btn.style.pointerEvents = 'none';
        btn.classList.add('disabled-button');
      });

      if (this.emailTab) {
        const emailBtn = this.emailTab as HTMLButtonElement;
        emailBtn.disabled = true;
        emailBtn.style.opacity = '0.6';
        emailBtn.style.cursor = 'not-allowed';
        emailBtn.style.pointerEvents = 'none';
      }
      if (this.phoneTab) {
        const phoneBtn = this.phoneTab as HTMLButtonElement;
        phoneBtn.disabled = true;
        phoneBtn.style.opacity = '0.6';
        phoneBtn.style.cursor = 'not-allowed';
        phoneBtn.style.pointerEvents = 'none';
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
        this.submitButton.innerHTML = this.getTranslation('createAccount');
        this.submitButton.style.opacity = '1';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.pointerEvents = 'auto';
      }

      // Re-enable all social provider buttons and restore visual state
      const socialButtons = document.querySelectorAll('button[data-provider]');
      socialButtons.forEach(button => {
        const btn = button as HTMLButtonElement;
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.pointerEvents = 'auto';
        btn.classList.remove('disabled-button');

        const provider = btn.getAttribute('data-provider');
        if (provider && this.providerIcons[provider]) {
          btn.innerHTML = `<span class="flex items-center justify-center w-6 h-6 md:w-7 md:h-7">${this.providerIcons[provider]}</span>`;
        }
      });

      // Re-enable tab switching buttons and restore visual state
      if (this.emailTab) {
        const emailBtn = this.emailTab as HTMLButtonElement;
        emailBtn.disabled = false;
        emailBtn.style.opacity = '1';
        emailBtn.style.cursor = 'pointer';
        emailBtn.style.pointerEvents = 'auto';
      }
      if (this.phoneTab) {
        const phoneBtn = this.phoneTab as HTMLButtonElement;
        phoneBtn.disabled = false;
        phoneBtn.style.opacity = '1';
        phoneBtn.style.cursor = 'pointer';
        phoneBtn.style.pointerEvents = 'auto';
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

      if (this.config.bothMethodsEnabled) {
        const emailField = document.getElementById('email-field');
        const isEmailActive =
          emailField && !emailField.classList.contains('hidden');

        if (isEmailActive) {
          const emailInput = document.getElementById(
            'email'
          ) as HTMLInputElement;
          emailInput?.focus();
        } else {
          const phoneInput = document.getElementById(
            'phone'
          ) as HTMLInputElement;
          phoneInput?.focus();
        }
      } else {
        if (this.config.emailEnabled) {
          const emailInput = document.getElementById(
            'email'
          ) as HTMLInputElement;
          emailInput?.focus();
        } else if (this.config.phoneEnabled) {
          const phoneInput = document.getElementById(
            'phone'
          ) as HTMLInputElement;
          phoneInput?.focus();
        }
      }
    }

    /**
     * Validate continue URL to prevent open redirect — same-origin only.
     */
    private isValidContinueUrl(url: string): boolean {
      if (!url || typeof url !== 'string') return false;
      try {
        const parsed = new URL(url, window.location.origin);
        return parsed.origin === window.location.origin || url.startsWith('/');
      } catch {
        return false;
      }
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('___REGISTER_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const registerManager = new RegisterManager({
          config: data.config || {
            bothMethodsEnabled: false,
            emailEnabled: true,
            phoneEnabled: false,
            requireFullName: false,
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

        registerManager.run();
      } catch (error) {
        console.error('[RegisterManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const registerManager = new RegisterManager({
            config: {
              bothMethodsEnabled: false,
              emailEnabled: true,
              phoneEnabled: false,
              requireFullName: false,
              customIdentifierFields: [],
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
          registerManager.run();
        } catch (fallbackError) {
          console.error(
            '[RegisterManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error('[RegisterManager] No configuration data found in DOM');

      try {
        const registerManager = new RegisterManager({
          config: {
            bothMethodsEnabled: false,
            emailEnabled: true,
            phoneEnabled: false,
            requireFullName: false,
            customIdentifierFields: [],
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
        registerManager.run();
      } catch (fallbackError) {
        console.error(
          '[RegisterManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
