/**
 * DeviceFlowCodeInputManager - Handles device flow code input page interactions and form submission
 *
 * Features:
 * - Dynamic device code input with configurable mask and charset
 * - Auto-focus and navigation between input fields
 * - Paste functionality with separator handling
 * - Input filtering based on charset (digits, base-20)
 * - Form validation and loading states
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
 * The DeviceFlowCodeInputManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.deviceVerification: Device verification heading
 * - auth.enterDeviceCode: Enter device code instruction
 * - auth.deviceCode: Device code label
 * - auth.verifyCode: Verify code button text
 * - auth.verifying: Verifying loading text
 * - auth.enterCompleteCode: Complete code validation message
 * - auth.needHelp: Need help text
 * - auth.helpText: Help text content
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.deviceVerification', 'Device Verification') | tojson }}
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
  interface DeviceFlowCodeInputConfig {
    deviceCodeMask: string;
    deviceCodeCharset: 'digits' | 'base-20';
    initialUserCode: string;
    formId: string;
    enableLoadingStates: boolean;
    enableErrorRecovery: boolean;
    errorRecoveryTimeout: number;
    enableBackButtonPrevention: boolean;
    enableFormResubmissionPrevention: boolean;
    enableDoubleSubmissionPrevention: boolean;
    submissionTimeout: number;
  }

  interface TranslationStrings {
    deviceVerification: string;
    enterDeviceCode: string;
    deviceCode: string;
    verifyCode: string;
    verifying: string;
    enterCompleteCode: string;
    needHelp: string;
    helpText: string;
    errorRecovery: string;
  }

  interface DeviceFlowCodeInputManagerOptions {
    config: DeviceFlowCodeInputConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class DeviceCodeInput {
    private container: HTMLElement | null;
    private hiddenInput: HTMLInputElement | null;
    private mask: string;
    private charset: 'digits' | 'base-20';
    private inputs: HTMLInputElement[] = [];
    private separators: HTMLElement[] = [];

    constructor(
      containerId: string,
      hiddenInputId: string,
      mask: string,
      charset: 'digits' | 'base-20'
    ) {
      this.container = document.getElementById(containerId);
      this.hiddenInput = document.getElementById(
        hiddenInputId
      ) as HTMLInputElement;
      this.mask = mask;
      this.charset = charset;

      this.init();
    }

    init(): void {
      this.createInputFields();
      this.setupEventListeners();
      this.updateHintText();

      setTimeout(() => {
        if (this.inputs[0]) {
          this.inputs[0].focus();
        }
      }, 100);
    }

    createInputFields(): void {
      if (!this.container) return;

      this.container.innerHTML = '';
      this.inputs = [];
      this.separators = [];

      for (let i = 0; i < this.mask.length; i++) {
        const char = this.mask[i];

        if (char === '*') {
          const input = document.createElement('input');
          input.type = 'text';
          input.className =
            'w-9 h-9 text-center text-sm font-mono bg-gray-50/50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 focus:bg-white dark:focus:bg-gray-800';
          input.maxLength = 1;
          input.autocomplete = 'off';
          input.inputMode = this.charset === 'digits' ? 'numeric' : 'text';
          input.dataset.index = this.inputs.length.toString();

          this.inputs.push(input);
          this.container.appendChild(input);
        } else {
          const separator = document.createElement('span');
          separator.textContent = char;
          separator.className =
            'text-lg font-mono text-gray-400 dark:text-gray-500 flex items-center';

          this.separators.push(separator);
          this.container.appendChild(separator);
        }
      }
    }

    setupEventListeners(): void {
      this.inputs.forEach((input, index) => {
        input.addEventListener('input', (e: Event) => {
          const target = e.target as HTMLInputElement;
          const value = target.value;
          const filteredValue = this.filterInput(value);

          if (filteredValue !== value) {
            target.value = filteredValue;
          }

          if (filteredValue && index < this.inputs.length - 1) {
            this.inputs[index + 1].focus();
          }

          this.updateHiddenInput();
        });

        // Keydown event for backspace and navigation
        input.addEventListener('keydown', (e: KeyboardEvent) => {
          const target = e.target as HTMLInputElement;
          if (e.key === 'Backspace' && !target.value && index > 0) {
            this.inputs[index - 1].focus();
            this.inputs[index - 1].value = '';
            this.updateHiddenInput();
          } else if (e.key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            this.inputs[index - 1].focus();
          } else if (e.key === 'ArrowRight' && index < this.inputs.length - 1) {
            e.preventDefault();
            this.inputs[index + 1].focus();
          }
        });

        input.addEventListener('paste', (e: ClipboardEvent) => {
          e.preventDefault();
          const pastedText = e.clipboardData?.getData('text') || '';
          this.handlePaste(pastedText, index);
        });

        input.addEventListener('focus', () => {
          input.classList.add('ring-2', 'ring-primary/20');
        });

        input.addEventListener('blur', () => {
          input.classList.remove('ring-2', 'ring-primary/20');
        });
      });
    }

    filterInput(value: string): string {
      if (this.charset === 'digits') {
        return value.replace(/[^0-9]/g, '');
      } else if (this.charset === 'base-20') {
        return value.replace(/[^0-9A-J]/gi, '').toUpperCase();
      }
      return value;
    }

    handlePaste(text: string, startIndex: number): void {
      let cleanText = text;
      const maskSeparators = this.mask
        .replace(/\*/g, '')
        .split('')
        .filter(c => c);
      maskSeparators.forEach(sep => {
        cleanText = cleanText.replace(new RegExp(`\\${sep}`, 'g'), '');
      });

      const filteredText = this.filterInput(cleanText);

      for (
        let i = 0;
        i < filteredText.length && startIndex + i < this.inputs.length;
        i++
      ) {
        this.inputs[startIndex + i].value = filteredText[i];
      }

      const nextEmptyIndex = this.inputs.findIndex(
        (input, idx) => idx > startIndex && !input.value
      );
      const focusIndex =
        nextEmptyIndex !== -1
          ? nextEmptyIndex
          : Math.min(startIndex + filteredText.length, this.inputs.length - 1);
      this.inputs[focusIndex].focus();

      this.updateHiddenInput();
    }

    updateHiddenInput(): void {
      if (!this.hiddenInput) return;

      const values = this.inputs.map(input => input.value);
      let result = '';
      let valueIndex = 0;

      for (let i = 0; i < this.mask.length; i++) {
        if (this.mask[i] === '*') {
          result += values[valueIndex] || '';
          valueIndex++;
        } else {
          result += values[valueIndex - 1] ? this.mask[i] : '';
        }
      }

      this.hiddenInput.value = result;
    }

    updateHintText(): void {
      const hintElement = document.getElementById('code-format-hint');
      if (hintElement) {
        const exampleCode = this.mask.replace(
          /\*/g,
          this.charset === 'digits' ? '0' : 'A'
        );
        hintElement.textContent = `Enter your device code in format: ${exampleCode}`;
      }
    }

    setValue(value: string): void {
      this.inputs.forEach(input => (input.value = ''));

      const chars = value.replace(/[^0-9A-J]/gi, '');
      const filteredChars = this.filterInput(chars);

      for (let i = 0; i < filteredChars.length && i < this.inputs.length; i++) {
        this.inputs[i].value = filteredChars[i];
      }

      this.updateHiddenInput();
    }

    getValue(): string {
      return this.hiddenInput?.value || '';
    }

    isComplete(): boolean {
      return this.inputs.every(input => input.value.length > 0);
    }

    clear(): void {
      this.inputs.forEach(input => (input.value = ''));
      this.updateHiddenInput();
      if (this.inputs[0]) {
        this.inputs[0].focus();
      }
    }

    disable(): void {
      this.inputs.forEach(input => {
        input.disabled = true;
        input.classList.add('disabled-button');
      });
    }

    enable(): void {
      this.inputs.forEach(input => {
        input.disabled = false;
        input.classList.remove('disabled-button');
      });
    }
  }

  class DeviceFlowCodeInputManager {
    private config: DeviceFlowCodeInputConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private isSubmitting: boolean = false;
    private submissionTimeout: number | null = null;
    private deviceCodeInput: DeviceCodeInput | null = null;

    // DOM elements
    private form: HTMLFormElement | null = null;
    private submitButton: HTMLButtonElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      deviceVerification: 'Device Verification',
      enterDeviceCode: 'Enter the code from your device',
      deviceCode: 'Device Code',
      verifyCode: 'Verify Code',
      verifying: 'Verifying...',
      enterCompleteCode: 'Please enter a complete device code in the format:',
      needHelp: 'Need help?',
      helpText:
        "The code should be displayed on your device's screen. If you don't see a code, check your device's display or try refreshing the device's login page.",
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: DeviceFlowCodeInputManagerOptions) {
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

      this.log('DeviceFlowCodeInputManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: DeviceFlowCodeInputConfig
    ): DeviceFlowCodeInputConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          deviceCodeMask: '***-*-***',
          deviceCodeCharset: 'digits',
          initialUserCode: '',
          formId: 'device-code-form',
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
        deviceCodeMask: String(config.deviceCodeMask || '***-*-***'),
        deviceCodeCharset:
          config.deviceCodeCharset === 'base-20' ? 'base-20' : 'digits',
        initialUserCode: String(config.initialUserCode || ''),
        formId: String(config.formId || 'device-code-form'),
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

      const prefix = '[DeviceFlowCodeInputManager]';
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

      this.initializeDeviceCodeInput();
      this.setupFormSubmission();
      this.setupBackButtonPrevention();
      this.setupFormResubmissionPrevention();
      this.setupErrorRecovery();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.form = document.getElementById(
        this.config.formId
      ) as HTMLFormElement;
      this.submitButton = this.form?.querySelector(
        'button[type="submit"]'
      ) as HTMLButtonElement;
    }

    /**
     * Initialize device code input component
     */
    private initializeDeviceCodeInput(): void {
      this.deviceCodeInput = new DeviceCodeInput(
        'device-code-container',
        'user_code',
        this.config.deviceCodeMask,
        this.config.deviceCodeCharset
      );

      if (this.config.initialUserCode) {
        this.deviceCodeInput.setValue(this.config.initialUserCode);
      }

      this.log('Device code input initialized', {
        mask: this.config.deviceCodeMask,
        charset: this.config.deviceCodeCharset,
        initialValue: this.config.initialUserCode,
      });
    }

    /**
     * Setup form submission handling with validation and loading states
     */
    private setupFormSubmission(): void {
      if (!this.form || !this.submitButton || !this.deviceCodeInput) {
        this.log(
          'Required elements not found for form submission',
          null,
          'error'
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

        const code = this.deviceCodeInput!.getValue();

        if (!code || !this.deviceCodeInput!.isComplete()) {
          e.preventDefault();
          const message = `${this.getTranslation('enterCompleteCode')} ${this.config.deviceCodeMask}`;
          this.log(
            'Form validation failed',
            { code, isComplete: this.deviceCodeInput!.isComplete() },
            'warn'
          );
          alert(message);
          return;
        }

        this.isSubmitting = true;
        this.log('Form submission started', { code });

        this.disableAllButtons();

        if (this.config.enableLoadingStates) {
          this.updateSubmitButtonLoading();
        }

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

      this.log('Form submission handling enabled', {
        enableLoadingStates: this.config.enableLoadingStates,
        submissionTimeout: this.config.submissionTimeout,
      });
    }

    /**
     * Update submit button with loading state
     */
    private updateSubmitButtonLoading(): void {
      if (!this.submitButton) return;

      this.submitButton.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${this.getTranslation('verifying')}
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

      if (this.submitButton) {
        this.submitButton.disabled = true;
        this.submitButton.classList.add('disabled-button');
      }

      if (this.deviceCodeInput) {
        this.deviceCodeInput.disable();
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

      // Re-enable submit button and restore visual state
      if (this.submitButton) {
        this.submitButton.disabled = false;
        this.submitButton.innerHTML = `
          <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          ${this.getTranslation('verifyCode')}
        `;
        this.submitButton.classList.remove('disabled-button');
      }

      // Re-enable device code input
      if (this.deviceCodeInput) {
        this.deviceCodeInput.enable();
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
      '___OIDC_DEVICE_FLOW_CODE_INPUT_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const deviceFlowCodeInputManager = new DeviceFlowCodeInputManager({
          config: data.config || {
            deviceCodeMask: '***-*-***',
            deviceCodeCharset: 'digits',
            initialUserCode: '',
            formId: 'device-code-form',
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

        deviceFlowCodeInputManager.run();
      } catch (error) {
        console.error(
          '[DeviceFlowCodeInputManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const deviceFlowCodeInputManager = new DeviceFlowCodeInputManager({
            config: {
              deviceCodeMask: '***-*-***',
              deviceCodeCharset: 'digits',
              initialUserCode: '',
              formId: 'device-code-form',
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
          deviceFlowCodeInputManager.run();
        } catch (fallbackError) {
          console.error(
            '[DeviceFlowCodeInputManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[DeviceFlowCodeInputManager] No configuration data found in DOM'
      );

      try {
        const deviceFlowCodeInputManager = new DeviceFlowCodeInputManager({
          config: {
            deviceCodeMask: '***-*-***',
            deviceCodeCharset: 'digits',
            initialUserCode: '',
            formId: 'device-code-form',
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
        deviceFlowCodeInputManager.run();
      } catch (fallbackError) {
        console.error(
          '[DeviceFlowCodeInputManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
