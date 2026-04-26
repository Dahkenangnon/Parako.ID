/**
 * OIDCLogoutManager - Handles OIDC logout form interactions and state management
 *
 * Features:
 * - Double submission prevention for logout form
 * - Loading states with visual feedback
 * - Error recovery mechanisms with configurable timeout
 * - Back button resubmission prevention
 * - Form resubmission prevention on page refresh
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The OIDCLogoutManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.yesSignOut: Button text for confirming sign out
 * - auth.noStaySignedIn: Button text for staying signed in
 * - auth.signingOut: Loading text during sign out
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.yesSignOut', 'Yes, Sign Out') | tojson }}
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
  interface OIDCLogoutConfig {
    enableLoadingStates: boolean;
    enableErrorRecovery: boolean;
    errorRecoveryTimeout: number;
    enableBackButtonPrevention: boolean;
    enableFormResubmissionPrevention: boolean;
  }

  interface TranslationStrings {
    yesSignOut: string;
    noStaySignedIn: string;
    signingOut: string;
    errorRecovery: string;
  }

  interface OIDCLogoutManagerOptions {
    config: OIDCLogoutConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
  }

  class OIDCLogoutManager {
    private config: OIDCLogoutConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private logoutForm: HTMLFormElement | null = null;
    private submitButtons: NodeListOf<HTMLButtonElement> | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      yesSignOut: 'Yes, Sign Out',
      noStaySignedIn: 'No, Stay Signed In',
      signingOut: 'Signing Out...',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: OIDCLogoutManagerOptions) {
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

      this.log('OIDCLogoutManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: OIDCLogoutConfig): OIDCLogoutConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          enableLoadingStates: true,
          enableErrorRecovery: true,
          errorRecoveryTimeout: 10000,
          enableBackButtonPrevention: true,
          enableFormResubmissionPrevention: true,
        };
      }

      return {
        enableLoadingStates: Boolean(config.enableLoadingStates),
        enableErrorRecovery: Boolean(config.enableErrorRecovery),
        errorRecoveryTimeout: Math.max(
          5000,
          Math.min(60000, Number(config.errorRecoveryTimeout) || 10000)
        ),
        enableBackButtonPrevention: Boolean(config.enableBackButtonPrevention),
        enableFormResubmissionPrevention: Boolean(
          config.enableFormResubmissionPrevention
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

      const prefix = '[OIDCLogoutManager]';
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
      if (
        !this.logoutForm ||
        !this.submitButtons ||
        this.submitButtons.length === 0
      ) {
        this.log('Required form elements not found', null, 'error');
        return;
      }

      this.setupFormSubmission();
      this.setupBackButtonPrevention();
      this.setupFormResubmissionPrevention();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.logoutForm = document.querySelector(
        'form[id="op.logoutForm"]'
      ) as HTMLFormElement;
      this.submitButtons = this.logoutForm?.querySelectorAll(
        'button[type="submit"]'
      ) as NodeListOf<HTMLButtonElement>;
    }

    /**
     * Setup form submission handling
     */
    private setupFormSubmission(): void {
      if (!this.logoutForm || !this.submitButtons) return;

      this.logoutForm.addEventListener('submit', (e: Event) => {
        if (this.isSubmitting) {
          e.preventDefault();
          e.stopPropagation();
          this.log('Double submission prevented', null, 'warn');
          return;
        }

        this.log('Form submission detected');
        this.isSubmitting = true;

        this.disableAllButtons();

        if (this.submitButtons) {
          this.submitButtons.forEach(button => {
            if (button.textContent?.includes('Yes') || button.value === 'yes') {
              button.innerHTML = `
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                ${this.getTranslation('signingOut')}
              `;
            }
          });
        }

        // Set a timeout to re-enable the form if something goes wrong
        if (this.config.enableErrorRecovery) {
          this.submissionTimeout = window.setTimeout(() => {
            if (this.isSubmitting) {
              this.log('Error recovery timeout triggered', null, 'warn');
              this.enableAllButtons();
              this.showValidationError(this.getTranslation('errorRecovery'));
            }
          }, this.config.errorRecoveryTimeout);
        }
      });
    }

    /**
     * Setup back button resubmission prevention
     */
    private setupBackButtonPrevention(): void {
      if (!this.config.enableBackButtonPrevention) return;

      window.addEventListener('pageshow', (event: PageTransitionEvent) => {
        if (event.persisted) {
          // Page was loaded from cache (user pressed back button)
          this.log('Back button detected, reloading page');
          window.location.reload();
        }
      });
    }

    /**
     * Setup form resubmission prevention on page refresh
     */
    private setupFormResubmissionPrevention(): void {
      if (!this.config.enableFormResubmissionPrevention) return;

      if (window.history.replaceState) {
        this.log('Preventing form resubmission on page refresh');
        window.history.replaceState(null, '', window.location.href);
      }
    }

    /**
     * Disable all interactive elements during submission
     */
    private disableAllButtons(): void {
      if (!this.submitButtons) return;

      // Clear any existing timeout
      if (this.submissionTimeout) {
        clearTimeout(this.submissionTimeout);
      }

      this.submitButtons.forEach(button => {
        button.disabled = true;
        button.classList.add('disabled-button');
      });

      // Disable the entire form to prevent any submission
      if (this.logoutForm) {
        this.logoutForm.style.pointerEvents = 'none';
        this.logoutForm.classList.add('form-disabled');
      }
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

      // Re-enable all submit buttons and restore visual state
      if (this.submitButtons) {
        this.submitButtons.forEach(button => {
          button.disabled = false;
          button.classList.remove('disabled-button');

          if (
            button.textContent?.includes('Signing Out') ||
            button.innerHTML.includes('Signing Out')
          ) {
            button.innerHTML = this.getTranslation('yesSignOut');
          }
        });
      }

      // Re-enable the entire form
      if (this.logoutForm) {
        this.logoutForm.style.pointerEvents = 'auto';
        this.logoutForm.classList.remove('form-disabled');
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
    const dataElement = document.getElementById('___OIDC_LOGOUT_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const oidcLogoutManager = new OIDCLogoutManager({
          config: data.config || {
            enableLoadingStates: true,
            enableErrorRecovery: true,
            errorRecoveryTimeout: 10000,
            enableBackButtonPrevention: true,
            enableFormResubmissionPrevention: true,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
        });

        oidcLogoutManager.run();
      } catch (error) {
        console.error('[OIDCLogoutManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const oidcLogoutManager = new OIDCLogoutManager({
            config: {
              enableLoadingStates: true,
              enableErrorRecovery: true,
              errorRecoveryTimeout: 10000,
              enableBackButtonPrevention: true,
              enableFormResubmissionPrevention: true,
            },
            debug: true,
          });
          oidcLogoutManager.run();
        } catch (fallbackError) {
          console.error(
            '[OIDCLogoutManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error('[OIDCLogoutManager] No configuration data found in DOM');

      try {
        const oidcLogoutManager = new OIDCLogoutManager({
          config: {
            enableLoadingStates: true,
            enableErrorRecovery: true,
            errorRecoveryTimeout: 10000,
            enableBackButtonPrevention: true,
            enableFormResubmissionPrevention: true,
          },
          debug: true,
        });
        oidcLogoutManager.run();
      } catch (fallbackError) {
        console.error(
          '[OIDCLogoutManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
