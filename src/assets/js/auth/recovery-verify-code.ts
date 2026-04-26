/**
 * RecoveryVerifyCodeManager - Handles recovery verification code form interactions and OTP input management
 *
 * Features:
 * - 6-digit OTP input with automatic navigation between fields
 * - Real-time validation and visual feedback
 * - Paste support for complete OTP codes
 * - Form submission with loading states and error recovery
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The RecoveryVerifyCodeManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.verifyCode: Button text for verifying code
 * - auth.verifyingCode: Loading text during code verification
 * - auth.codeRequired: Validation message for empty verification code
 * - auth.codeInvalid: Validation message for invalid verification code length
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.verifyCode', 'Verify Code') | tojson }}
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
  interface RecoveryVerifyCodeConfig {
    codeLength: number;
    autoFocus: boolean;
    enablePaste: boolean;
    enableBackspace: boolean;
    shakeAnimationDuration: number;
  }

  interface TranslationStrings {
    verifyCode: string;
    verifyingCode: string;
    codeRequired: string;
    codeInvalid: string;
    errorRecovery: string;
  }

  interface RecoveryVerifyCodeManagerOptions {
    config: RecoveryVerifyCodeConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class RecoveryVerifyCodeManager {
    private config: RecoveryVerifyCodeConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private hiddenInput: HTMLInputElement | null = null;
    private otpContainer: HTMLElement | null = null;
    private otpInputs: NodeListOf<HTMLInputElement> | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      verifyCode: 'Verify Code',
      verifyingCode: 'Verifying...',
      codeRequired: 'Please enter the verification code',
      codeInvalid: 'Please enter a valid 6-digit verification code',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: RecoveryVerifyCodeManagerOptions) {
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

      this.log('RecoveryVerifyCodeManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: RecoveryVerifyCodeConfig
    ): RecoveryVerifyCodeConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          codeLength: 6,
          autoFocus: true,
          enablePaste: true,
          enableBackspace: true,
          shakeAnimationDuration: 500,
        };
      }

      return {
        codeLength: Math.max(4, Math.min(10, Number(config.codeLength) || 6)),
        autoFocus: Boolean(config.autoFocus),
        enablePaste: Boolean(config.enablePaste),
        enableBackspace: Boolean(config.enableBackspace),
        shakeAnimationDuration: Math.max(
          200,
          Math.min(2000, Number(config.shakeAnimationDuration) || 500)
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

      const prefix = '[RecoveryVerifyCodeManager]';
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
      if (!this.otpInputs || this.otpInputs.length === 0) {
        this.log('No OTP inputs found', null, 'error');
        return;
      }

      this.setupOTPInputs();
      this.setupFormSubmission();

      // Auto-focus first input if enabled
      if (this.config.autoFocus && this.otpInputs[0]) {
        this.otpInputs[0].focus();
      }
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.form = document.querySelector('form');
      this.submitButton =
        this.form?.querySelector('button[type="submit"]') || null;
      this.hiddenInput = document.getElementById('code') as HTMLInputElement;
      this.otpContainer = document.getElementById('otp-container');
      this.otpInputs = document.querySelectorAll(
        '.otp-input'
      ) as NodeListOf<HTMLInputElement>;
    }

    /**
     * Setup OTP input handling
     */
    private setupOTPInputs(): void {
      if (!this.otpInputs) return;

      this.otpInputs.forEach((input, index) => {
        input.addEventListener('input', e => {
          this.handleInput(e, index);
        });

        // Keydown handling (backspace navigation)
        if (this.config.enableBackspace) {
          input.addEventListener('keydown', e => {
            this.handleKeydown(e, index);
          });
        }

        if (this.config.enablePaste) {
          input.addEventListener('paste', e => {
            this.handlePaste(e);
          });
        }

        input.addEventListener('focus', () => {
          this.handleFocus(input);
        });

        input.addEventListener('blur', () => {
          this.handleBlur(input);
        });
      });
    }

    /**
     * Handle input events
     */
    private handleInput(e: Event, index: number): void {
      const input = e.target as HTMLInputElement;

      input.value = input.value.replace(/[^0-9]/g, '');

      if (input.value.length === 1 && index < this.otpInputs!.length - 1) {
        this.otpInputs![index + 1].focus();
      }

      this.updateHiddenInput();
    }

    /**
     * Handle keydown events (backspace navigation)
     */
    private handleKeydown(e: KeyboardEvent, index: number): void {
      if (
        e.key === 'Backspace' &&
        (e.target as HTMLInputElement).value === '' &&
        index > 0
      ) {
        this.otpInputs![index - 1].focus();
      }
    }

    /**
     * Handle paste events
     */
    private handlePaste(e: ClipboardEvent): void {
      e.preventDefault();

      if (!this.otpInputs) return;

      const pastedData =
        e.clipboardData?.getData('text').replace(/[^0-9]/g, '') || '';

      for (
        let i = 0;
        i < Math.min(pastedData.length, this.otpInputs.length);
        i++
      ) {
        this.otpInputs[i].value = pastedData[i];
      }

      const nextEmptyIndex = Math.min(
        pastedData.length,
        this.otpInputs.length - 1
      );
      this.otpInputs[nextEmptyIndex].focus();

      this.updateHiddenInput();
    }

    /**
     * Handle focus events
     */
    private handleFocus(input: HTMLInputElement): void {
      input.classList.add('ring-2', 'ring-primary/20');
    }

    /**
     * Handle blur events
     */
    private handleBlur(input: HTMLInputElement): void {
      input.classList.remove('ring-2', 'ring-primary/20');
    }

    /**
     * Update hidden input with complete code
     */
    private updateHiddenInput(): void {
      if (!this.hiddenInput || !this.otpInputs) return;

      const code = Array.from(this.otpInputs)
        .map(input => input.value)
        .join('');
      this.hiddenInput.value = code;
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

        const code = this.hiddenInput?.value || '';

        if (!code || code.length !== this.config.codeLength) {
          e.preventDefault();
          this.showValidationError();
          return;
        }

        e.preventDefault();

        this.disableAllButtons();

        this.submitButton!.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('verifyingCode')}
        `;

        setTimeout(() => {
          if (this.form) {
            this.form.submit();
          }
        }, 100);
      });
    }

    /**
     * Show validation error with visual feedback
     */
    private showValidationError(): void {
      this.log(
        'Validation error',
        { codeLength: this.config.codeLength },
        'warn'
      );

      if (this.otpContainer) {
        this.otpContainer.classList.add('animate-pulse');
        setTimeout(() => {
          this.otpContainer?.classList.remove('animate-pulse');
        }, this.config.shakeAnimationDuration);
      }

      if (this.otpInputs) {
        const firstEmpty = Array.from(this.otpInputs).find(
          input => !input.value
        );
        if (firstEmpty) {
          firstEmpty.focus();
        } else {
          this.otpInputs[0].focus();
        }
      }

      alert(this.getTranslation('codeInvalid'));
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

      if (this.otpInputs) {
        this.otpInputs.forEach(input => {
          input.disabled = true;
          input.style.opacity = '0.6';
          input.style.cursor = 'not-allowed';
          input.style.pointerEvents = 'none';
        });
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
        alert(this.getTranslation('errorRecovery'));
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
        this.submitButton.innerHTML = this.getTranslation('verifyCode');
        this.submitButton.style.opacity = '1';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.pointerEvents = 'auto';
      }

      // Re-enable all OTP inputs
      if (this.otpInputs) {
        this.otpInputs.forEach(input => {
          input.disabled = false;
          input.style.opacity = '1';
          input.style.cursor = 'text';
          input.style.pointerEvents = 'auto';
        });
      }

      // Re-enable the entire form
      if (this.form) {
        this.form.style.pointerEvents = 'auto';
        this.form.classList.remove('form-disabled');
      }
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById(
      '___RECOVERY_VERIFY_CODE_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const recoveryVerifyCodeManager = new RecoveryVerifyCodeManager({
          config: data.config || {
            codeLength: 6,
            autoFocus: true,
            enablePaste: true,
            enableBackspace: true,
            shakeAnimationDuration: 500,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 120000,
        });

        recoveryVerifyCodeManager.run();
      } catch (error) {
        console.error(
          '[RecoveryVerifyCodeManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const recoveryVerifyCodeManager = new RecoveryVerifyCodeManager({
            config: {
              codeLength: 6,
              autoFocus: true,
              enablePaste: true,
              enableBackspace: true,
              shakeAnimationDuration: 500,
            },
            debug: true,
          });
          recoveryVerifyCodeManager.run();
        } catch (fallbackError) {
          console.error(
            '[RecoveryVerifyCodeManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[RecoveryVerifyCodeManager] No configuration data found in DOM'
      );

      try {
        const recoveryVerifyCodeManager = new RecoveryVerifyCodeManager({
          config: {
            codeLength: 6,
            autoFocus: true,
            enablePaste: true,
            enableBackspace: true,
            shakeAnimationDuration: 500,
          },
          debug: true,
        });
        recoveryVerifyCodeManager.run();
      } catch (fallbackError) {
        console.error(
          '[RecoveryVerifyCodeManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
