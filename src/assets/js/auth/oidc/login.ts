/**
 * OIDCLoginManager - Handles OIDC login form interactions and state management
 *
 * Features:
 * - Email/Phone tab switching with smooth transitions
 * - Form validation and submission with loading states
 * - Social provider login with OIDC flow integration
 * - Comprehensive button disabling during authentication
 * - Error recovery mechanisms with configurable timeout
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 * - OIDC-specific URL building and parameter handling
 *
 * Translation Support:
 * The OIDCLoginManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.signIn: Button text for sign in
 * - auth.signingIn: Loading text during sign in
 * - auth.connecting: Loading text for social login
 * - auth.emailRequired: Validation message for empty email
 * - auth.phoneRequired: Validation message for empty phone
 * - auth.passwordRequired: Validation message for empty password
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.signIn', 'Sign in') | tojson }}
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
  interface OIDCLoginConfig {
    bothMethodsEnabled: boolean;
    emailEnabled: boolean;
    phoneEnabled: boolean;
    oidcPath: string;
    uid: string;
    clientId: string;
    prompt?: string;
    acrValues?: string;
    allowedRedirectHosts?: string[];
  }

  interface TranslationStrings {
    signIn: string;
    signingIn: string;
    connecting: string;
    emailRequired: string;
    phoneRequired: string;
    identifierRequired: string;
    passwordRequired: string;
    errorRecovery: string;
  }

  interface OIDCLoginManagerOptions {
    config: OIDCLoginConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class OIDCLoginManager {
    private config: OIDCLoginConfig;
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
    private emailInput: HTMLInputElement | null = null;
    private phoneInput: HTMLInputElement | null = null;
    private loginMethodInput: HTMLInputElement | null = null;
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private togglePassword: HTMLElement | null = null;
    private passwordInput: HTMLInputElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      signIn: 'Sign in',
      signingIn: 'Signing in...',
      connecting: 'Connecting...',
      emailRequired: 'Please enter your email address',
      phoneRequired: 'Please enter your phone number',
      identifierRequired: 'Please enter your identifier',
      passwordRequired: 'Please enter your password',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: OIDCLoginManagerOptions) {
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

      this.log('OIDCLoginManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: OIDCLoginConfig): OIDCLoginConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          bothMethodsEnabled: false,
          emailEnabled: true,
          phoneEnabled: false,
          oidcPath: 'oidc/v1',
          uid: '',
          clientId: '',
        };
      }

      return {
        bothMethodsEnabled: Boolean(config.bothMethodsEnabled),
        emailEnabled: Boolean(config.emailEnabled),
        phoneEnabled: Boolean(config.phoneEnabled),
        oidcPath: String(config.oidcPath || 'oidc/v1'),
        uid: String(config.uid || ''),
        clientId: String(config.clientId || ''),
        prompt: config.prompt ? String(config.prompt) : undefined,
        acrValues: config.acrValues ? String(config.acrValues) : undefined,
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

      const prefix = '[OIDCLoginManager]';
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
      if (!this.form || !this.submitButton) {
        this.log('Required form elements not found', null, 'error');
        return;
      }

      this.setupTabSwitching();
      this.setupPasswordToggle();
      this.setupFormSubmission();
      this.setupInputFocusAnimations();
      this.setupSocialLogin();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.emailTab = document.getElementById('email-tab');
      this.phoneTab = document.getElementById('phone-tab');
      this.emailField = document.getElementById('email-field');
      this.phoneField = document.getElementById('phone-field');
      this.emailInput = document.getElementById('email') as HTMLInputElement;
      this.phoneInput = document.getElementById('phone') as HTMLInputElement;
      this.loginMethodInput = document.getElementById(
        'login_method'
      ) as HTMLInputElement;
      this.form = document.getElementById('login-form') as HTMLFormElement;
      this.submitButton =
        this.form?.querySelector('button[type="submit"]') || null;
      this.togglePassword = document.getElementById('toggle-password');
      this.passwordInput = document.getElementById(
        'password'
      ) as HTMLInputElement;
    }

    /**
     * Setup email/phone tab switching functionality
     */
    private setupTabSwitching(): void {
      const hasMultipleMethods = this.config.bothMethodsEnabled;

      if (hasMultipleMethods) {
        if (this.emailTab) {
          this.emailTab.addEventListener('click', e => {
            if (this.isSubmitting) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            this.switchToEmail();
          });
        }

        if (this.phoneTab) {
          this.phoneTab.addEventListener('click', e => {
            if (this.isSubmitting) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            this.switchToPhone();
          });
        }

        if (this.phoneInput) this.phoneInput.disabled = true;
      } else {
        // If only one method is enabled, make sure the correct field is enabled
        if (this.config.emailEnabled && this.emailInput) {
          this.emailInput.disabled = false;
        }
        if (this.config.phoneEnabled && this.phoneInput) {
          this.phoneInput.disabled = false;
        }
      }
    }

    /**
     * Helper to set tab as active
     */
    private setTabActive(tab: HTMLElement | null): void {
      if (!tab) return;
      tab.classList.add(
        'bg-white',
        'dark:bg-card',
        'text-primary',
        'border-2',
        'border-primary',
        'font-semibold'
      );
      tab.classList.remove(
        'text-gray-600',
        'dark:text-gray-300',
        'hover:text-gray-900',
        'dark:hover:text-gray-100',
        'bg-transparent',
        'border-transparent',
        'font-medium'
      );
    }

    /**
     * Helper to set tab as inactive
     */
    private setTabInactive(tab: HTMLElement | null): void {
      if (!tab) return;
      tab.classList.remove(
        'bg-white',
        'dark:bg-card',
        'text-primary',
        'border-primary',
        'font-semibold'
      );
      tab.classList.add(
        'text-gray-600',
        'dark:text-gray-300',
        'hover:text-gray-900',
        'dark:hover:text-gray-100',
        'bg-transparent',
        'border-2',
        'border-transparent',
        'font-medium'
      );
    }

    /**
     * Switch to email input mode
     */
    private switchToEmail(): void {
      if (this.isSubmitting) return;

      this.setTabActive(this.emailTab);
      this.setTabInactive(this.phoneTab);

      // Show/hide fields
      if (this.emailField) this.emailField.classList.remove('hidden');
      if (this.phoneField) this.phoneField.classList.add('hidden');

      // Enable/disable inputs
      if (this.emailInput) this.emailInput.disabled = false;
      if (this.phoneInput) {
        this.phoneInput.disabled = true;
        this.phoneInput.value = '';
      }

      if (this.loginMethodInput) this.loginMethodInput.value = 'email';
    }

    /**
     * Switch to phone input mode
     */
    private switchToPhone(): void {
      if (this.isSubmitting) return;

      this.setTabActive(this.phoneTab);
      this.setTabInactive(this.emailTab);

      // Show/hide fields
      if (this.phoneField) this.phoneField.classList.remove('hidden');
      if (this.emailField) this.emailField.classList.add('hidden');

      // Enable/disable inputs
      if (this.phoneInput) this.phoneInput.disabled = false;
      if (this.emailInput) {
        this.emailInput.disabled = true;
        this.emailInput.value = '';
      }

      if (this.loginMethodInput) this.loginMethodInput.value = 'phone';
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

        if (this.emailField?.classList.contains('hidden')) {
          if (this.emailInput) this.emailInput.disabled = true;
          if (this.phoneInput) this.phoneInput.disabled = false;
        } else {
          if (this.phoneInput) this.phoneInput.disabled = true;
          if (this.emailInput) this.emailInput.disabled = false;
        }

        e.preventDefault();

        this.disableAllButtons();

        this.submitButton!.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('signingIn')}
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
        'input[type="email"], input[type="tel"], input[type="password"]'
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
     * Setup social login functionality with OIDC flow
     */
    private setupSocialLogin(): void {
      const socialButtons = document.querySelectorAll('[data-provider]');
      socialButtons.forEach(button => {
        button.addEventListener('click', (e: Event) => {
          e.preventDefault();
          e.stopPropagation();

          if (this.isSubmitting) {
            return;
          }

          const provider = button.getAttribute('data-provider');
          if (!provider) return;

          this.disableAllButtons();

          const buttonElement = button as HTMLButtonElement;
          buttonElement.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-5 w-5 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            ${this.getTranslation('connecting')}
          `;

          let socialLoginUrl: string;
          try {
            socialLoginUrl = this.buildSocialLoginUrl(provider);
          } catch (error) {
            this.log('Failed to build social login URL', {
              provider,
              error: error instanceof Error ? error.message : String(error),
            });
            this.enableAllButtons();
            this.showValidationError(
              'Failed to build login URL. Please try again.'
            );
            return;
          }

          this.log('Redirecting to OIDC social login', {
            provider,
            url: socialLoginUrl,
          });

          setTimeout(() => {
            if (this.isValidRedirectUrl(socialLoginUrl)) {
              window.location.href = socialLoginUrl;
            } else {
              this.log('Invalid redirect URL detected, preventing redirect', {
                url: socialLoginUrl,
                provider,
              });
              this.enableAllButtons();
              this.showValidationError(
                'Invalid redirect URL detected. Please try again.'
              );
            }
          }, 100);
        });
      });
    }

    /**
     * Validate redirect URL to prevent XSS and malicious redirects
     */
    private isValidRedirectUrl(url: string): boolean {
      if (!url || typeof url !== 'string') {
        return false;
      }

      try {
        const parsedUrl = new URL(url);

        // Only allow http and https protocols
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return false;
        }

        // Check for dangerous protocols in the URL
        const dangerousProtocols = [
          'javascript:',
          'data:',
          'vbscript:',
          'file:',
          'ftp:',
        ];
        if (
          dangerousProtocols.some(protocol =>
            url.toLowerCase().includes(protocol)
          )
        ) {
          return false;
        }

        // Check for suspicious characters that could indicate XSS
        const suspiciousChars = /[<>"'`]/;
        if (suspiciousChars.test(url)) {
          return false;
        }

        // Ensure the URL is not too long (prevent DoS)
        if (url.length > 2048) {
          return false;
        }

        // For OIDC URLs, ensure they point to expected domains
        // This should match your OIDC server configuration
        const allowedHosts = this.config.allowedRedirectHosts || [];
        if (
          allowedHosts.length > 0 &&
          !allowedHosts.includes(parsedUrl.hostname)
        ) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    }

    /**
     * Build OIDC social login URL with all required parameters
     */
    private buildSocialLoginUrl(provider: string): string {
      if (!provider || typeof provider !== 'string') {
        throw new Error('Invalid provider parameter');
      }

      const sanitizedProvider = provider.replace(/[^a-zA-Z0-9-]/g, '');
      if (sanitizedProvider !== provider) {
        this.log('Provider parameter sanitized', {
          original: provider,
          sanitized: sanitizedProvider,
        });
      }

      if (!this.config.oidcPath || typeof this.config.oidcPath !== 'string') {
        throw new Error('Invalid OIDC path configuration');
      }

      let socialLoginUrl = `${this.config.oidcPath}/social/${sanitizedProvider}?uid=${encodeURIComponent(this.config.uid)}&client_id=${encodeURIComponent(this.config.clientId)}`;

      if (this.config.prompt && typeof this.config.prompt === 'string') {
        socialLoginUrl += `&prompt=${encodeURIComponent(this.config.prompt)}`;
      }
      if (this.config.acrValues && typeof this.config.acrValues === 'string') {
        socialLoginUrl += `&acr_values=${encodeURIComponent(this.config.acrValues)}`;
      }

      const currentParams = new URLSearchParams(window.location.search);
      const allowedParams = [
        'state',
        'nonce',
        'response_type',
        'scope',
        'redirect_uri',
      ];

      currentParams.forEach((value, key) => {
        if (allowedParams.includes(key) && value && typeof value === 'string') {
          // Additional validation for each parameter
          if (this.isValidQueryParameter(key, value)) {
            socialLoginUrl += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
          }
        }
      });

      return socialLoginUrl;
    }

    /**
     * Validate query parameter values to prevent injection
     */
    private isValidQueryParameter(key: string, value: string): boolean {
      const suspiciousChars = /[<>"'`]/;
      if (suspiciousChars.test(value)) {
        return false;
      }

      const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
      if (
        dangerousProtocols.some(protocol =>
          value.toLowerCase().includes(protocol)
        )
      ) {
        return false;
      }

      if (value.length > 1000) {
        return false;
      }

      return true;
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
        this.submitButton.classList.add('disabled-button');
      }

      const socialButtons = document.querySelectorAll('[data-provider]');
      socialButtons.forEach(button => {
        const btn = button as HTMLButtonElement;
        btn.disabled = true;
        btn.classList.add('disabled-button');
      });

      if (this.emailTab) {
        const emailBtn = this.emailTab as HTMLButtonElement;
        emailBtn.disabled = true;
        emailBtn.classList.add('disabled-button');
      }
      if (this.phoneTab) {
        const phoneBtn = this.phoneTab as HTMLButtonElement;
        phoneBtn.disabled = true;
        phoneBtn.classList.add('disabled-button');
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
        this.submitButton.innerHTML = this.getTranslation('signIn');
        this.submitButton.classList.remove('disabled-button');
      }

      // Re-enable all social provider buttons and restore visual state
      const socialButtons = document.querySelectorAll('[data-provider]');
      socialButtons.forEach(button => {
        const btn = button as HTMLButtonElement;
        btn.disabled = false;
        btn.classList.remove('disabled-button');

        const provider = btn.getAttribute('data-provider');
        if (provider) {
          const iconSpan = btn.querySelector('span');
          if (iconSpan) {
            btn.innerHTML = iconSpan.outerHTML;
          }
        }
      });

      // Re-enable tab switching buttons and restore visual state
      if (this.emailTab) {
        const emailBtn = this.emailTab as HTMLButtonElement;
        emailBtn.disabled = false;
        emailBtn.classList.remove('disabled-button');
      }
      if (this.phoneTab) {
        const phoneBtn = this.phoneTab as HTMLButtonElement;
        phoneBtn.disabled = false;
        phoneBtn.classList.remove('disabled-button');
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
    const dataElement = document.getElementById('___OIDC_LOGIN_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const oidcLoginManager = new OIDCLoginManager({
          config: data.config || {
            bothMethodsEnabled: false,
            emailEnabled: true,
            phoneEnabled: false,
            oidcPath: 'oidc/v1',
            uid: '',
            clientId: '',
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 120000,
        });

        oidcLoginManager.run();
      } catch (error) {
        console.error('[OIDCLoginManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const oidcLoginManager = new OIDCLoginManager({
            config: {
              bothMethodsEnabled: false,
              emailEnabled: true,
              phoneEnabled: false,
              oidcPath: 'oidc/v1',
              uid: '',
              clientId: '',
            },
            debug: true,
          });
          oidcLoginManager.run();
        } catch (fallbackError) {
          console.error(
            '[OIDCLoginManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error('[OIDCLoginManager] No configuration data found in DOM');

      try {
        const oidcLoginManager = new OIDCLoginManager({
          config: {
            bothMethodsEnabled: false,
            emailEnabled: true,
            phoneEnabled: false,
            oidcPath: 'oidc/v1',
            uid: '',
            clientId: '',
          },
          debug: true,
        });
        oidcLoginManager.run();
      } catch (fallbackError) {
        console.error(
          '[OIDCLoginManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
