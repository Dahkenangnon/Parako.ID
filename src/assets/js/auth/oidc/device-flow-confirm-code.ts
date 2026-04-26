/**
 * DeviceFlowConfirmCodeManager - Handles device flow confirmation page interactions and form submission
 *
 * Features:
 * - Form validation and loading states for both continue and abort actions
 * - Double submission prevention with configurable timeout
 * - Back button prevention and form resubmission prevention
 * - Enhanced button disabling with visual feedback
 * - Error recovery mechanisms with configurable timeout
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 * - CSS class-based visual feedback for disabled states
 *
 * Translation Support:
 * The DeviceFlowConfirmCodeManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.continue: Continue button text
 * - auth.processing: Processing loading text
 * - auth.abort: Abort button text
 * - auth.aborting: Aborting loading text
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.continue', 'Continue') | tojson }}
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
  interface DeviceFlowConfirmCodeConfig {
    enableLoadingStates: boolean;
    enableErrorRecovery: boolean;
    errorRecoveryTimeout: number;
    enableBackButtonPrevention: boolean;
    enableFormResubmissionPrevention: boolean;
    enableDoubleSubmissionPrevention: boolean;
    submissionTimeout: number;
  }

  interface TranslationStrings {
    continue: string;
    processing: string;
    abort: string;
    aborting: string;
    errorRecovery: string;
  }

  interface DeviceFlowConfirmCodeManagerOptions {
    config: DeviceFlowConfirmCodeConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class DeviceFlowConfirmCodeManager {
    private config: DeviceFlowConfirmCodeConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private continueButton: HTMLButtonElement | null = null;
    private abortButton: HTMLButtonElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      continue: 'Continue',
      processing: 'Processing...',
      abort: 'Abort',
      aborting: 'Aborting...',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: DeviceFlowConfirmCodeManagerOptions) {
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
      this.errorRecoveryTimeout = options.errorRecoveryTimeout ?? 10000; // 10 seconds default

      this.initializeElements();

      this.log('DeviceFlowConfirmCodeManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: DeviceFlowConfirmCodeConfig
    ): DeviceFlowConfirmCodeConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          enableLoadingStates: true,
          enableErrorRecovery: true,
          errorRecoveryTimeout: 10000,
          enableBackButtonPrevention: true,
          enableFormResubmissionPrevention: true,
          enableDoubleSubmissionPrevention: true,
          submissionTimeout: 10000,
        };
      }

      return {
        enableLoadingStates: Boolean(config.enableLoadingStates),
        enableErrorRecovery: Boolean(config.enableErrorRecovery),
        errorRecoveryTimeout: Math.max(
          5000,
          Number(config.errorRecoveryTimeout) || 10000
        ),
        enableBackButtonPrevention: Boolean(config.enableBackButtonPrevention),
        enableFormResubmissionPrevention: Boolean(
          config.enableFormResubmissionPrevention
        ),
        enableDoubleSubmissionPrevention: Boolean(
          config.enableDoubleSubmissionPrevention
        ),
        submissionTimeout: Math.max(
          5000,
          Number(config.submissionTimeout) || 10000
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

      const prefix = '[DeviceFlowConfirmCodeManager]';
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
      if (!this.form) {
        this.log('Required form element not found', null, 'error');
        return;
      }

      this.setupFormSubmission();
      this.setupButtonHandlers();
      this.setupBackButtonPrevention();
      this.setupFormResubmissionPrevention();
      this.setupErrorRecovery();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.form = document.querySelector(
        'form[id="op.deviceConfirmForm"]'
      ) as HTMLFormElement;
      this.continueButton = this.form?.querySelector(
        'button[type="submit"]:not([name="abort"])'
      ) as HTMLButtonElement;
      this.abortButton = this.form?.querySelector(
        'button[name="abort"]'
      ) as HTMLButtonElement;
    }

    /**
     * Setup form submission handling with double submission prevention
     */
    private setupFormSubmission(): void {
      if (!this.form || !this.config.enableDoubleSubmissionPrevention) {
        this.log(
          'Form submission prevention disabled by configuration',
          null,
          'log'
        );
        return;
      }

      this.form.addEventListener('submit', (e: Event) => {
        if (this.isSubmitting) {
          this.log('Double submission prevented', null, 'warn');
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        this.isSubmitting = true;
        this.log('Form submission started');

        // Set a timeout to re-enable the form if something goes wrong
        this.submissionTimeout = window.setTimeout(() => {
          if (this.isSubmitting) {
            this.log(
              'Submission timeout reached, re-enabling form',
              null,
              'warn'
            );
            this.isSubmitting = false;
            this.enableAllButtons();
          }
        }, this.config.submissionTimeout);
      });

      this.log('Form submission prevention enabled', {
        timeout: this.config.submissionTimeout,
      });
    }

    /**
     * Setup button click handlers with loading states
     */
    private setupButtonHandlers(): void {
      if (!this.config.enableLoadingStates) {
        this.log('Loading states disabled by configuration', null, 'log');
        return;
      }

      if (this.continueButton) {
        this.continueButton.addEventListener('click', (e: Event) => {
          if (this.isSubmitting) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          this.log('Continue button clicked');
          this.disableAllButtons();
          this.updateContinueButtonLoading();
        });
        this.log('Continue button handler added');
      } else {
        this.log('Continue button not found', null, 'warn');
      }

      if (this.abortButton) {
        this.abortButton.addEventListener('click', (e: Event) => {
          if (this.isSubmitting) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          this.log('Abort button clicked');
          this.disableAllButtons();
          this.updateAbortButtonLoading();
        });
        this.log('Abort button handler added');
      } else {
        this.log('Abort button not found', null, 'warn');
      }
    }

    /**
     * Update continue button with loading state
     */
    private updateContinueButtonLoading(): void {
      if (!this.continueButton) return;

      this.continueButton.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${this.getTranslation('processing')}
      `;
    }

    /**
     * Update abort button with loading state
     */
    private updateAbortButtonLoading(): void {
      if (!this.abortButton) return;

      this.abortButton.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${this.getTranslation('aborting')}
      `;
    }

    /**
     * Setup back button prevention
     */
    private setupBackButtonPrevention(): void {
      if (!this.config.enableBackButtonPrevention) {
        this.log(
          'Back button prevention disabled by configuration',
          null,
          'log'
        );
        return;
      }

      window.addEventListener('pageshow', (event: PageTransitionEvent) => {
        if (event.persisted) {
          this.log(
            'Back button navigation detected, reloading page',
            null,
            'warn'
          );
          window.location.reload();
        }
      });

      this.log('Back button prevention enabled');
    }

    /**
     * Setup form resubmission prevention
     */
    private setupFormResubmissionPrevention(): void {
      if (!this.config.enableFormResubmissionPrevention) {
        this.log(
          'Form resubmission prevention disabled by configuration',
          null,
          'log'
        );
        return;
      }

      if (window.history.replaceState) {
        window.history.replaceState(null, '', window.location.href);
        this.log('Form resubmission prevention enabled');
      } else {
        this.log(
          'History API not supported, form resubmission prevention disabled',
          null,
          'warn'
        );
      }
    }

    /**
     * Setup error recovery
     */
    private setupErrorRecovery(): void {
      if (!this.config.enableErrorRecovery) {
        this.log('Error recovery disabled by configuration', null, 'log');
        return;
      }

      // Set up error recovery timeout
      setTimeout(() => {
        if (this.isSubmitting) {
          this.log('Error recovery timeout triggered', null, 'warn');
          this.isSubmitting = false;
          this.enableAllButtons();
          this.showErrorRecoveryMessage();
        }
      }, this.errorRecoveryTimeout);

      this.log('Error recovery enabled', {
        timeout: this.errorRecoveryTimeout,
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

      if (this.continueButton) {
        this.continueButton.disabled = true;
        this.continueButton.classList.add('disabled-button');
      }

      if (this.abortButton) {
        this.abortButton.disabled = true;
        this.abortButton.classList.add('disabled-button');
      }

      // Disable the entire form to prevent any submission
      if (this.form) {
        this.form.style.pointerEvents = 'none';
        this.form.classList.add('form-disabled');
      }

      this.log('All buttons disabled');
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

      // Re-enable continue button and restore visual state
      if (this.continueButton) {
        this.continueButton.disabled = false;
        this.continueButton.innerHTML = `
          <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          ${this.getTranslation('continue')}
        `;
        this.continueButton.classList.remove('disabled-button');
      }

      // Re-enable abort button and restore visual state
      if (this.abortButton) {
        this.abortButton.disabled = false;
        this.abortButton.innerHTML = `
          <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
          ${this.getTranslation('abort')}
        `;
        this.abortButton.classList.remove('disabled-button');
      }

      // Re-enable the entire form
      if (this.form) {
        this.form.style.pointerEvents = 'auto';
        this.form.classList.remove('form-disabled');
      }

      this.log('All buttons enabled');
    }

    /**
     * Show error recovery message to user
     */
    private showErrorRecoveryMessage(): void {
      this.log('Showing error recovery message', null, 'warn');

      // For now, use alert - in production, you might want to use a toast or inline error display
      alert(this.getTranslation('errorRecovery'));
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById(
      '___OIDC_DEVICE_FLOW_CONFIRM_CODE_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const deviceFlowConfirmCodeManager = new DeviceFlowConfirmCodeManager({
          config: data.config || {
            enableLoadingStates: true,
            enableErrorRecovery: true,
            errorRecoveryTimeout: 10000,
            enableBackButtonPrevention: true,
            enableFormResubmissionPrevention: true,
            enableDoubleSubmissionPrevention: true,
            submissionTimeout: 10000,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 10000,
        });

        deviceFlowConfirmCodeManager.run();
      } catch (error) {
        console.error(
          '[DeviceFlowConfirmCodeManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const deviceFlowConfirmCodeManager = new DeviceFlowConfirmCodeManager(
            {
              config: {
                enableLoadingStates: true,
                enableErrorRecovery: true,
                errorRecoveryTimeout: 10000,
                enableBackButtonPrevention: true,
                enableFormResubmissionPrevention: true,
                enableDoubleSubmissionPrevention: true,
                submissionTimeout: 10000,
              },
              debug: true,
            }
          );
          deviceFlowConfirmCodeManager.run();
        } catch (fallbackError) {
          console.error(
            '[DeviceFlowConfirmCodeManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[DeviceFlowConfirmCodeManager] No configuration data found in DOM'
      );

      try {
        const deviceFlowConfirmCodeManager = new DeviceFlowConfirmCodeManager({
          config: {
            enableLoadingStates: true,
            enableErrorRecovery: true,
            errorRecoveryTimeout: 10000,
            enableBackButtonPrevention: true,
            enableFormResubmissionPrevention: true,
            enableDoubleSubmissionPrevention: true,
            submissionTimeout: 10000,
          },
          debug: true,
        });
        deviceFlowConfirmCodeManager.run();
      } catch (fallbackError) {
        console.error(
          '[DeviceFlowConfirmCodeManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
