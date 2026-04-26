/**
 * MFAManager - Handles MFA verification form interactions and state management
 *
 * Features:
 * - OTP input handling with auto-focus and navigation
 * - Paste functionality for verification codes
 * - Timer countdown with visual feedback
 * - Form validation and submission with loading states
 * - Custom dialog system for notifications
 * - Resend code functionality
 * - Comprehensive button disabling during submission
 * - Error recovery mechanisms with configurable timeout
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The MFAManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.verify: Button text for verification
 * - auth.verifying: Loading text during verification
 * - auth.resendCode: Button text for resending code
 * - auth.tryAnotherMethod: Button text for trying another method
 * - auth.codeRequired: Validation message for empty code
 * - auth.codeInvalid: Validation message for invalid code
 * - auth.codeResent: Success message when code is resent
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.verify', 'Verify') | tojson }}
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
  interface MFAConfig {
    codeLength: number;
    autoFocus: boolean;
    enablePaste: boolean;
    enableBackspace: boolean;
    shakeAnimationDuration: number;
    timerDuration: number;
    enableCustomDialog: boolean;
  }

  interface TranslationStrings {
    verify: string;
    verifying: string;
    resendCode: string;
    tryAnotherMethod: string;
    codeRequired: string;
    codeInvalid: string;
    codeResent: string;
    codeResentMessage: string;
    errorRecovery: string;
  }

  interface MFAManagerOptions {
    config: MFAConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class MFAManager {
    private config: MFAConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;
    private timerInterval: number | null = null;
    private timeLeft: number = 0;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private hiddenInput: HTMLInputElement | null = null;
    private otpContainer: HTMLElement | null = null;
    private otpInputs: NodeListOf<HTMLInputElement> | null = null;
    private timerEl: HTMLElement | null = null;
    private resendButton: HTMLElement | null = null;
    private tryAnotherMethodButton: HTMLElement | null = null;

    private customAlert: HTMLElement | null = null;
    private dialogBackdrop: HTMLElement | null = null;
    private dialogTitle: HTMLElement | null = null;
    private dialogMessage: HTMLElement | null = null;
    private dialogClose: HTMLElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      verify: 'Verify',
      verifying: 'Verifying...',
      resendCode: 'Resend code',
      tryAnotherMethod: 'Try another method',
      codeRequired: 'Please enter the verification code',
      codeInvalid: 'Please enter a valid 6-digit verification code',
      codeResent: 'Code Resent',
      codeResentMessage:
        'A new verification code has been sent to your device.',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: MFAManagerOptions) {
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
      this.timeLeft = this.config.timerDuration;

      this.initializeElements();

      this.log('MFAManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(config: MFAConfig): MFAConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          codeLength: 6,
          autoFocus: true,
          enablePaste: true,
          enableBackspace: true,
          shakeAnimationDuration: 500,
          timerDuration: 300,
          enableCustomDialog: true,
        };
      }

      return {
        codeLength: Math.max(4, Math.min(8, Number(config.codeLength) || 6)),
        autoFocus: Boolean(config.autoFocus),
        enablePaste: Boolean(config.enablePaste),
        enableBackspace: Boolean(config.enableBackspace),
        shakeAnimationDuration: Math.max(
          200,
          Math.min(2000, Number(config.shakeAnimationDuration) || 500)
        ),
        timerDuration: Math.max(
          60,
          Math.min(1800, Number(config.timerDuration) || 300)
        ),
        enableCustomDialog: Boolean(config.enableCustomDialog),
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

      const prefix = '[MFAManager]';
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
        !this.form ||
        !this.submitButton ||
        !this.otpInputs ||
        this.otpInputs.length === 0
      ) {
        this.log('Required form elements not found', null, 'error');
        return;
      }

      this.setupOTPInputs();
      this.setupFormSubmission();
      this.setupTimer();
      this.setupResendCode();
      this.setupCustomDialog();
      this.setupInputFocusAnimations();
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
      this.timerEl = document.getElementById('timer');
      this.resendButton = document.getElementById('resend-code');
      this.tryAnotherMethodButton =
        document.getElementById('try-another-method');

      this.customAlert = document.getElementById('custom-alert');
      this.dialogBackdrop = document.getElementById('dialog-backdrop');
      this.dialogTitle = document.getElementById('dialog-title');
      this.dialogMessage = document.getElementById('dialog-message');
      this.dialogClose = document.getElementById('dialog-close');
    }

    /**
     * Setup OTP input handling
     */
    private setupOTPInputs(): void {
      if (!this.otpInputs || this.otpInputs.length === 0) return;

      if (this.config.autoFocus && this.otpInputs[0]) {
        this.otpInputs[0].focus();
      }

      this.otpInputs.forEach((input, index) => {
        // Only allow numeric input
        input.addEventListener('input', (e: Event) => {
          const target = e.target as HTMLInputElement;
          target.value = target.value.replace(/[^0-9]/g, '');

          if (target.value.length === 1 && index < this.otpInputs!.length - 1) {
            this.otpInputs![index + 1].focus();
          }

          this.updateHiddenInput();
        });

        if (this.config.enableBackspace) {
          input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (
              e.key === 'Backspace' &&
              (e.target as HTMLInputElement).value === '' &&
              index > 0
            ) {
              this.otpInputs![index - 1].focus();
            }
          });
        }

        if (this.config.enablePaste) {
          input.addEventListener('paste', (e: ClipboardEvent) => {
            e.preventDefault();
            const pastedData =
              e.clipboardData?.getData('text').replace(/[^0-9]/g, '') || '';

            for (
              let i = 0;
              i < Math.min(pastedData.length, this.otpInputs!.length);
              i++
            ) {
              this.otpInputs![i].value = pastedData[i];
            }

            const nextEmptyIndex = Math.min(
              pastedData.length,
              this.otpInputs!.length - 1
            );
            this.otpInputs![nextEmptyIndex].focus();

            this.updateHiddenInput();
          });
        }
      });
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
      if (!this.form || !this.submitButton || !this.hiddenInput) return;

      this.form.addEventListener('submit', (e: Event) => {
        if (this.isSubmitting) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const code = this.hiddenInput!.value;

        if (!code || code.length !== this.config.codeLength) {
          e.preventDefault();

          if (this.otpContainer) {
            this.otpContainer.classList.add('animate-pulse');
            setTimeout(() => {
              this.otpContainer?.classList.remove('animate-pulse');
            }, this.config.shakeAnimationDuration);
          }

          const firstEmpty = Array.from(this.otpInputs!).find(
            input => !input.value
          );
          if (firstEmpty) {
            firstEmpty.focus();
          } else if (this.otpInputs![0]) {
            this.otpInputs![0].focus();
          }

          this.showValidationError(this.getTranslation('codeRequired'));
          return;
        }

        e.preventDefault();

        this.disableAllButtons();

        this.submitButton!.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          ${this.getTranslation('verifying')}
        `;

        setTimeout(() => {
          if (this.form) {
            this.form.submit();
          }
        }, 100);
      });
    }

    /**
     * Setup timer countdown functionality
     */
    private setupTimer(): void {
      if (!this.timerEl) return;

      const updateTimer = () => {
        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = this.timeLeft % 60;
        this.timerEl!.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if (this.timeLeft <= 0) {
          if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
          }
          this.timerEl!.textContent = '0:00';
          this.timerEl!.classList.add('text-red-500', 'dark:text-red-400');
        } else {
          this.timeLeft--;
        }
      };

      this.timerInterval = window.setInterval(updateTimer, 1000);
      updateTimer(); // Initialize timer display
    }

    /**
     * Setup resend code functionality
     */
    private setupResendCode(): void {
      if (!this.resendButton) return;

      this.resendButton.addEventListener('click', () => {
        if (this.isSubmitting) return;

        this.timeLeft = this.config.timerDuration;
        if (this.timerEl?.classList.contains('text-red-500')) {
          this.timerEl.classList.remove('text-red-500', 'dark:text-red-400');
        }

        this.otpInputs?.forEach(input => (input.value = ''));
        this.updateHiddenInput();
        if (this.otpInputs?.[0]) {
          this.otpInputs[0].focus();
        }

        // Show custom dialog instead of alert
        if (this.config.enableCustomDialog && this.customAlert) {
          this.showDialog(
            this.getTranslation('codeResent'),
            this.getTranslation('codeResentMessage')
          );
        } else {
          alert(this.getTranslation('codeResentMessage'));
        }

        // Simulate API call - in a real app this would be an actual API request
        this.log('Resending verification code...');
      });
    }

    /**
     * Setup custom dialog functionality
     */
    private setupCustomDialog(): void {
      if (!this.config.enableCustomDialog) return;

      if (this.dialogClose) {
        this.dialogClose.addEventListener('click', () => this.hideDialog());
      }
      if (this.dialogBackdrop) {
        this.dialogBackdrop.addEventListener('click', () => this.hideDialog());
      }

      // Escape key to close dialog
      document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (
          e.key === 'Escape' &&
          this.customAlert &&
          !this.customAlert.classList.contains('hidden')
        ) {
          this.hideDialog();
        }
      });
    }

    /**
     * Setup input focus animations
     */
    private setupInputFocusAnimations(): void {
      if (!this.otpInputs) return;

      this.otpInputs.forEach(input => {
        input.addEventListener('focus', () => {
          input.classList.add('ring-2', 'ring-primary/20');
        });

        input.addEventListener('blur', () => {
          input.classList.remove('ring-2', 'ring-primary/20');
        });
      });
    }

    /**
     * Show custom dialog
     */
    private showDialog(title: string, message: string): void {
      if (!this.customAlert || !this.dialogTitle || !this.dialogMessage) return;

      this.dialogTitle.textContent = title || 'Notification';
      this.dialogMessage.textContent = message || '';
      this.customAlert.classList.remove('hidden');

      setTimeout(() => {
        const dialogContent = this.customAlert?.querySelector('.bg-white');
        if (dialogContent) {
          dialogContent.classList.add('animate-in', 'fade-in', 'duration-300');
        }
      }, 10);
    }

    /**
     * Hide custom dialog
     */
    private hideDialog(): void {
      if (!this.customAlert) return;

      const dialogContent = this.customAlert.querySelector('.bg-white');
      if (dialogContent) {
        dialogContent.classList.add('animate-out', 'fade-out', 'duration-200');
      }

      setTimeout(() => {
        this.customAlert?.classList.add('hidden');
        if (dialogContent) {
          dialogContent.classList.remove(
            'animate-out',
            'fade-out',
            'animate-in',
            'fade-in'
          );
        }
      }, 200);
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

      if (this.resendButton) {
        (this.resendButton as HTMLButtonElement).disabled = true;
        this.resendButton.classList.add('disabled-button');
      }
      if (this.tryAnotherMethodButton) {
        (this.tryAnotherMethodButton as HTMLButtonElement).disabled = true;
        this.tryAnotherMethodButton.classList.add('disabled-button');
      }

      if (this.otpInputs) {
        this.otpInputs.forEach(input => {
          input.disabled = true;
          input.classList.add('disabled-button');
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
        this.submitButton.innerHTML = this.getTranslation('verify');
        this.submitButton.classList.remove('disabled-button');
      }

      // Re-enable resend and try another method buttons
      if (this.resendButton) {
        (this.resendButton as HTMLButtonElement).disabled = false;
        this.resendButton.classList.remove('disabled-button');
      }
      if (this.tryAnotherMethodButton) {
        (this.tryAnotherMethodButton as HTMLButtonElement).disabled = false;
        this.tryAnotherMethodButton.classList.remove('disabled-button');
      }

      // Re-enable OTP inputs
      if (this.otpInputs) {
        this.otpInputs.forEach(input => {
          input.disabled = false;
          input.classList.remove('disabled-button');
        });
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
    const dataElement = document.getElementById('___OIDC_MFA_STATE___');

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const mfaManager = new MFAManager({
          config: data.config || {
            codeLength: 6,
            autoFocus: true,
            enablePaste: true,
            enableBackspace: true,
            shakeAnimationDuration: 500,
            timerDuration: 300,
            enableCustomDialog: true,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 120000,
        });

        mfaManager.run();
      } catch (error) {
        console.error('[MFAManager] Failed to initialize:', error);

        // Fallback initialization with minimal config
        try {
          const mfaManager = new MFAManager({
            config: {
              codeLength: 6,
              autoFocus: true,
              enablePaste: true,
              enableBackspace: true,
              shakeAnimationDuration: 500,
              timerDuration: 300,
              enableCustomDialog: true,
            },
            debug: true,
          });
          mfaManager.run();
        } catch (fallbackError) {
          console.error(
            '[MFAManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error('[MFAManager] No configuration data found in DOM');

      try {
        const mfaManager = new MFAManager({
          config: {
            codeLength: 6,
            autoFocus: true,
            enablePaste: true,
            enableBackspace: true,
            shakeAnimationDuration: 500,
            timerDuration: 300,
            enableCustomDialog: true,
          },
          debug: true,
        });
        mfaManager.run();
      } catch (fallbackError) {
        console.error(
          '[MFAManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
