/**
 * RecoveryBackupCodesManager - Handles recovery backup codes form interactions and alphanumeric input management
 *
 * Features:
 * - 8-character backup code input with automatic navigation between fields (XXXX-XXXX format)
 * - Real-time validation and visual feedback for alphanumeric input (A-F, 0-9)
 * - Paste support for complete backup codes
 * - Form submission with loading states and error recovery
 * - Comprehensive button disabling during submission
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The RecoveryBackupCodesManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.recoverAccount: Button text for recovering account
 * - auth.recoveringAccount: Loading text during account recovery
 * - auth.codeRequired: Validation message for empty backup code
 * - auth.codeInvalid: Validation message for invalid backup code format
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.recoverAccount', 'Recover Account') | tojson }}
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
  interface RecoveryBackupCodesConfig {
    codeLength: number;
    codeFormat: 'XXXX-XXXX' | 'XXXXXXXX';
    autoFocus: boolean;
    enablePaste: boolean;
    enableBackspace: boolean;
    shakeAnimationDuration: number;
    allowUppercase: boolean;
  }

  interface TranslationStrings {
    recoverAccount: string;
    recoveringAccount: string;
    codeRequired: string;
    codeInvalid: string;
    errorRecovery: string;
  }

  interface RecoveryBackupCodesManagerOptions {
    config: RecoveryBackupCodesConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class RecoveryBackupCodesManager {
    private config: RecoveryBackupCodesConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private hiddenInput: HTMLInputElement | null = null;
    private backupCodeContainer: HTMLElement | null = null;
    private backupInputs: NodeListOf<HTMLInputElement> | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      recoverAccount: 'Recover Account',
      recoveringAccount: 'Recovering...',
      codeRequired: 'Please enter your backup code',
      codeInvalid: 'Please enter a valid 8-character backup code',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: RecoveryBackupCodesManagerOptions) {
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

      this.log('RecoveryBackupCodesManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: RecoveryBackupCodesConfig
    ): RecoveryBackupCodesConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          codeLength: 8,
          codeFormat: 'XXXX-XXXX',
          autoFocus: true,
          enablePaste: true,
          enableBackspace: true,
          shakeAnimationDuration: 500,
          allowUppercase: true,
        };
      }

      return {
        codeLength: Math.max(6, Math.min(12, Number(config.codeLength) || 8)),
        codeFormat: config.codeFormat === 'XXXXXXXX' ? 'XXXXXXXX' : 'XXXX-XXXX',
        autoFocus: Boolean(config.autoFocus),
        enablePaste: Boolean(config.enablePaste),
        enableBackspace: Boolean(config.enableBackspace),
        shakeAnimationDuration: Math.max(
          200,
          Math.min(2000, Number(config.shakeAnimationDuration) || 500)
        ),
        allowUppercase: Boolean(config.allowUppercase),
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

      const prefix = '[RecoveryBackupCodesManager]';
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
      if (!this.backupInputs || this.backupInputs.length === 0) {
        this.log('No backup code inputs found', null, 'error');
        return;
      }

      this.setupBackupCodeInputs();
      this.setupFormSubmission();

      // Auto-focus first input if enabled
      if (this.config.autoFocus && this.backupInputs[0]) {
        this.backupInputs[0].focus();
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
      this.backupCodeContainer = document.getElementById(
        'backup-code-container'
      );
      this.backupInputs = document.querySelectorAll(
        '.backup-input'
      ) as NodeListOf<HTMLInputElement>;
    }

    /**
     * Setup backup code input handling
     */
    private setupBackupCodeInputs(): void {
      if (!this.backupInputs) return;

      this.backupInputs.forEach((input, index) => {
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
            this.handlePaste(e, index);
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

      let value = input.value.replace(/[^A-F0-9]/gi, '');
      if (this.config.allowUppercase) {
        value = value.toUpperCase();
      }
      input.value = value;

      if (input.value.length === 1 && index < this.backupInputs!.length - 1) {
        this.backupInputs![index + 1].focus();
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
        this.backupInputs![index - 1].focus();
      }
    }

    /**
     * Handle paste events
     */
    private handlePaste(e: ClipboardEvent, index: number): void {
      e.preventDefault();

      if (!this.backupInputs) return;

      let pastedData =
        e.clipboardData?.getData('text').replace(/[^A-F0-9]/gi, '') || '';
      if (this.config.allowUppercase) {
        pastedData = pastedData.toUpperCase();
      }

      for (
        let i = 0;
        i < Math.min(pastedData.length, this.backupInputs.length - index);
        i++
      ) {
        if (index + i < this.backupInputs.length) {
          this.backupInputs[index + i].value = pastedData[i];
        }
      }

      const nextEmptyIndex = Math.min(
        index + pastedData.length,
        this.backupInputs.length - 1
      );
      this.backupInputs[nextEmptyIndex].focus();

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
     * Update hidden input with complete code in XXXX-XXXX format
     */
    private updateHiddenInput(): void {
      if (!this.hiddenInput || !this.backupInputs) return;

      const values = Array.from(this.backupInputs).map(input => input.value);

      if (this.config.codeFormat === 'XXXX-XXXX') {
        const firstPart = values.slice(0, 4).join('');
        const secondPart = values.slice(4, 8).join('');

        if (firstPart.length === 4 && secondPart.length === 4) {
          this.hiddenInput.value = `${firstPart}-${secondPart}`;
        } else if (firstPart.length > 0 || secondPart.length > 0) {
          this.hiddenInput.value = values.join('');
        } else {
          this.hiddenInput.value = '';
        }
      } else {
        // XXXX-XXXX format
        this.hiddenInput.value = values.join('');
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

        const code = this.hiddenInput?.value || '';
        const codeWithoutDash = code.replace('-', '');

        if (!code || codeWithoutDash.length !== this.config.codeLength) {
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
          ${this.getTranslation('recoveringAccount')}
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

      if (this.backupCodeContainer) {
        this.backupCodeContainer.classList.add('animate-pulse');
        setTimeout(() => {
          this.backupCodeContainer?.classList.remove('animate-pulse');
        }, this.config.shakeAnimationDuration);
      }

      if (this.backupInputs) {
        const firstEmpty = Array.from(this.backupInputs).find(
          input => !input.value
        );
        if (firstEmpty) {
          firstEmpty.focus();
        } else {
          this.backupInputs[0].focus();
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

      if (this.backupInputs) {
        this.backupInputs.forEach(input => {
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
        this.submitButton.innerHTML = this.getTranslation('recoverAccount');
        this.submitButton.style.opacity = '1';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.pointerEvents = 'auto';
      }

      // Re-enable all backup code inputs
      if (this.backupInputs) {
        this.backupInputs.forEach(input => {
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
      '___RECOVERY_BACKUP_CODES_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const recoveryBackupCodesManager = new RecoveryBackupCodesManager({
          config: data.config || {
            codeLength: 8,
            codeFormat: 'XXXX-XXXX',
            autoFocus: true,
            enablePaste: true,
            enableBackspace: true,
            shakeAnimationDuration: 500,
            allowUppercase: true,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 120000,
        });

        recoveryBackupCodesManager.run();
      } catch (error) {
        console.error(
          '[RecoveryBackupCodesManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const recoveryBackupCodesManager = new RecoveryBackupCodesManager({
            config: {
              codeLength: 8,
              codeFormat: 'XXXX-XXXX',
              autoFocus: true,
              enablePaste: true,
              enableBackspace: true,
              shakeAnimationDuration: 500,
              allowUppercase: true,
            },
            debug: true,
          });
          recoveryBackupCodesManager.run();
        } catch (fallbackError) {
          console.error(
            '[RecoveryBackupCodesManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[RecoveryBackupCodesManager] No configuration data found in DOM'
      );

      try {
        const recoveryBackupCodesManager = new RecoveryBackupCodesManager({
          config: {
            codeLength: 8,
            codeFormat: 'XXXX-XXXX',
            autoFocus: true,
            enablePaste: true,
            enableBackspace: true,
            shakeAnimationDuration: 500,
            allowUppercase: true,
          },
          debug: true,
        });
        recoveryBackupCodesManager.run();
      } catch (fallbackError) {
        console.error(
          '[RecoveryBackupCodesManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
