/**
 * DeviceFlowSuccessManager - Handles device flow success page interactions and auto-close functionality
 *
 * Features:
 * - Auto-close functionality with enhanced browser compatibility
 * - Countdown timer with visual feedback
 * - Multiple close methods with fallback options
 * - Browser compatibility detection
 * - Enhanced close button functionality
 * - Back button prevention
 * - Form resubmission prevention
 * - Visibility change handling (pause when tab is hidden)
 * - Error recovery mechanisms with configurable timeout
 * - Full internationalization support
 * - Production-ready error handling and logging
 * - Configurable debug mode
 * - Fallback initialization for robustness
 *
 * Translation Support:
 * The DeviceFlowSuccessManager supports full internationalization through the `t()` function in Nunjucks templates.
 * Translation keys used:
 * - auth.authorizationSuccessful: Main success message
 * - auth.deviceAuthorized: Device authorization message
 * - auth.deviceReady: Device ready message
 * - auth.whatHappensNext: Next steps heading
 * - auth.deviceRefresh: Device refresh message
 * - auth.sessionSecure: Session security message
 * - auth.windowCloses: Window close countdown message
 * - auth.closeWindow: Close window button text
 * - auth.readyToClose: Ready to close message
 * - auth.youCanClose: Manual close message
 * - auth.errorRecovery: Message shown when session times out
 *
 * Usage in templates:
 * {{ t('auth.authorizationSuccessful', 'Authorization Successful!') | tojson }}
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
  interface DeviceFlowSuccessConfig {
    autoCloseDelay: number;
    enableAutoClose: boolean;
    enableCountdown: boolean;
    enableBackButtonPrevention: boolean;
    enableFormResubmissionPrevention: boolean;
    enableVisibilityHandling: boolean;
    errorRecoveryTimeout: number;
  }

  interface TranslationStrings {
    authorizationSuccessful: string;
    deviceAuthorized: string;
    deviceReady: string;
    whatHappensNext: string;
    deviceRefresh: string;
    sessionSecure: string;
    windowCloses: string;
    closeWindow: string;
    readyToClose: string;
    youCanClose: string;
    errorRecovery: string;
  }

  interface DeviceFlowSuccessManagerOptions {
    config: DeviceFlowSuccessConfig;
    translations?: Partial<TranslationStrings>;
    debug?: boolean;
    errorRecoveryTimeout?: number;
  }

  class DeviceFlowSuccessManager {
    private config: DeviceFlowSuccessConfig;
    private translations: TranslationStrings;
    private debug: boolean;
    private errorRecoveryTimeout: number;
    private timeLeft: number;
    private hasAttemptedClose: boolean = false;
    private timer: number | null = null;
    private backupTimer: number | null = null;
    private errorRecoveryTimer: number | null = null;

    // DOM elements
    private countdownElement: HTMLElement | null = null;
    private countdownTextElement: HTMLElement | null = null;
    private closeButton: HTMLButtonElement | null = null;

    // Default translations (fallback)
    private readonly defaultTranslations: Partial<TranslationStrings> = {
      authorizationSuccessful: 'Authorization Successful!',
      deviceAuthorized: 'Your device has been successfully authorized',
      deviceReady: 'Your device is now signed in and ready to use!',
      whatHappensNext: 'What happens next:',
      deviceRefresh: 'Device will refresh automatically',
      sessionSecure: 'Session is secure and encrypted',
      windowCloses: 'Window closes in',
      closeWindow: 'Close Window',
      readyToClose: 'Ready to close',
      youCanClose: 'You can now close this window',
      errorRecovery: 'Session timed out. Please try again.',
    };

    constructor(options: DeviceFlowSuccessManagerOptions) {
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
      this.errorRecoveryTimeout = options.errorRecoveryTimeout ?? 30000; // 30 seconds default
      this.timeLeft = this.config.autoCloseDelay;
      this.hasAttemptedClose = false;

      this.initializeElements();

      this.log('DeviceFlowSuccessManager initialized', {
        config: this.config,
        translations: this.translations,
      });
    }

    /**
     * Validate configuration object
     */
    private validateConfig(
      config: DeviceFlowSuccessConfig
    ): DeviceFlowSuccessConfig {
      if (!config || typeof config !== 'object') {
        this.log('Invalid config provided, using defaults', { config }, 'warn');
        return {
          autoCloseDelay: 5,
          enableAutoClose: true,
          enableCountdown: true,
          enableBackButtonPrevention: true,
          enableFormResubmissionPrevention: true,
          enableVisibilityHandling: true,
          errorRecoveryTimeout: 30000,
        };
      }

      return {
        autoCloseDelay: Math.max(1, Number(config.autoCloseDelay) || 5),
        enableAutoClose: Boolean(config.enableAutoClose),
        enableCountdown: Boolean(config.enableCountdown),
        enableBackButtonPrevention: Boolean(config.enableBackButtonPrevention),
        enableFormResubmissionPrevention: Boolean(
          config.enableFormResubmissionPrevention
        ),
        enableVisibilityHandling: Boolean(config.enableVisibilityHandling),
        errorRecoveryTimeout: Math.max(
          5000,
          Number(config.errorRecoveryTimeout) || 30000
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

      const prefix = '[DeviceFlowSuccessManager]';
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
      if (!this.countdownElement && !this.countdownTextElement) {
        this.log('No countdown elements found', null, 'error');
        return;
      }

      this.setupCountdown();
      this.setupCloseButton();
      this.setupBackButtonPrevention();
      this.setupFormResubmissionPrevention();
      this.setupVisibilityHandling();
      this.setupErrorRecovery();
    }

    /**
     * Initialize DOM element references
     */
    private initializeElements(): void {
      this.countdownElement = document.getElementById('countdown');
      this.countdownTextElement = document.getElementById('countdown-text');
      this.closeButton = document.getElementById(
        'close-window-btn'
      ) as HTMLButtonElement;
    }

    /**
     * Setup countdown timer functionality
     */
    private setupCountdown(): void {
      if (!this.config.enableCountdown) {
        this.log('Countdown disabled by configuration', null, 'log');
        return;
      }

      this.timer = window.setInterval(() => {
        this.timeLeft--;
        this.updateCountdownDisplay();

        if (this.timeLeft <= 0) {
          this.clearTimers();
          this.closeWindow();
        }
      }, 1000);

      this.backupTimer = window.setTimeout(() => {
        this.log('Backup timer triggered', null, 'warn');
        this.closeWindow();
      }, this.config.autoCloseDelay * 1000);

      this.log('Countdown started', {
        timeLeft: this.timeLeft,
        autoCloseDelay: this.config.autoCloseDelay,
      });
    }

    /**
     * Update countdown display
     */
    private updateCountdownDisplay(): void {
      if (this.countdownElement) {
        this.countdownElement.textContent = this.timeLeft.toString();
      }
      if (this.countdownTextElement) {
        this.countdownTextElement.textContent = this.timeLeft.toString();
      }
    }

    /**
     * Update countdown message
     */
    private updateCountdownMessage(message: string): void {
      if (this.countdownElement) {
        this.countdownElement.textContent = message;
      }
      if (this.countdownTextElement) {
        this.countdownTextElement.textContent = message;
      }
    }

    /**
     * Setup close button functionality
     */
    private setupCloseButton(): void {
      if (!this.closeButton) {
        this.log('Close button not found', null, 'warn');
        return;
      }

      this.closeButton.addEventListener('click', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeWindow();
      });

      this.log('Close button event listener added');
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
     * Setup visibility change handling
     */
    private setupVisibilityHandling(): void {
      if (!this.config.enableVisibilityHandling) {
        this.log('Visibility handling disabled by configuration', null, 'log');
        return;
      }

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          // User switched away, pause countdown
          this.log('Page hidden, pausing countdown', null, 'log');
          this.clearTimers();
        } else {
          // User returned, resume countdown if not already closed
          if (!this.hasAttemptedClose && this.timeLeft > 0) {
            this.log(
              'Page visible, resuming countdown',
              { timeLeft: this.timeLeft },
              'log'
            );
            this.setupCountdown();
          }
        }
      });

      this.log('Visibility change handling enabled');
    }

    /**
     * Setup error recovery
     */
    private setupErrorRecovery(): void {
      this.errorRecoveryTimer = window.setTimeout(() => {
        this.log('Error recovery timeout triggered', null, 'warn');
        this.updateCountdownMessage(this.getTranslation('errorRecovery'));
        this.clearTimers();
      }, this.errorRecoveryTimeout);

      this.log('Error recovery timer set', {
        timeout: this.errorRecoveryTimeout,
      });
    }

    /**
     * Check if window can be closed (opened by script or is a popup)
     */
    private canCloseWindow(): boolean {
      try {
        return window.opener !== null || window.parent !== window;
      } catch (e) {
        this.log(
          'Error checking if window can be closed',
          { error: e },
          'warn'
        );
        return false;
      }
    }

    /**
     * Enhanced close function with fallback options
     */
    private closeWindow(): void {
      if (this.hasAttemptedClose) {
        this.log('Close already attempted, ignoring', null, 'log');
        return;
      }

      this.hasAttemptedClose = true;
      this.clearTimers();

      this.log('Attempting to close window', {
        canClose: this.canCloseWindow(),
      });

      try {
        // Method 1: Try standard window.close()
        window.close();

        // Method 2: If close didn't work, try with a small delay
        setTimeout(() => {
          if (!window.closed) {
            this.log('First close attempt failed, trying again', null, 'warn');
            window.close();
          }
        }, 100);

        // Method 3: If still open after 500ms, try alternative approaches
        setTimeout(() => {
          if (!window.closed) {
            this.log(
              'Standard close failed, trying alternative methods',
              null,
              'warn'
            );
            if (window.parent && window.parent !== window) {
              try {
                window.parent.close();
              } catch (e) {
                this.log(
                  'Parent close failed, navigating to about:blank',
                  { error: e },
                  'warn'
                );
                // Fallback: Navigate to about:blank
                window.location.href = 'about:blank';
              }
            } else {
              // For regular tabs, navigate to a blank page
              this.log('Navigating to about:blank as fallback', null, 'warn');
              window.location.href = 'about:blank';
            }
          }
        }, 500);
      } catch (error) {
        this.log('Auto-close not supported in this context', { error }, 'warn');
        this.updateCountdownMessage(this.getTranslation('youCanClose'));
      }
    }

    /**
     * Clear all timers
     */
    private clearTimers(): void {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this.backupTimer) {
        clearTimeout(this.backupTimer);
        this.backupTimer = null;
      }
      if (this.errorRecoveryTimer) {
        clearTimeout(this.errorRecoveryTimer);
        this.errorRecoveryTimer = null;
      }
    }

    /**
     * Check if auto-close is likely to work
     */
    private checkAutoCloseCompatibility(): void {
      if (!this.canCloseWindow()) {
        this.log(
          'Window may not auto-close - opened in regular tab',
          null,
          'warn'
        );
        // Optionally show a different message
        setTimeout(
          () => {
            if (
              this.countdownElement &&
              this.countdownElement.textContent === '0'
            ) {
              this.updateCountdownMessage(this.getTranslation('readyToClose'));
            }
          },
          this.config.autoCloseDelay * 1000 + 100
        );
      }
    }
  }

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById(
      '___OIDC_DEVICE_FLOW_SUCCESS_STATE___'
    );

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');

        const deviceFlowSuccessManager = new DeviceFlowSuccessManager({
          config: data.config || {
            autoCloseDelay: 5,
            enableAutoClose: true,
            enableCountdown: true,
            enableBackButtonPrevention: true,
            enableFormResubmissionPrevention: true,
            enableVisibilityHandling: true,
            errorRecoveryTimeout: 30000,
          },
          translations: data.translations || {},
          debug: data.config?.debug || false,
          errorRecoveryTimeout: data.config?.errorRecoveryTimeout || 30000,
        });

        deviceFlowSuccessManager.run();
      } catch (error) {
        console.error(
          '[DeviceFlowSuccessManager] Failed to initialize:',
          error
        );

        // Fallback initialization with minimal config
        try {
          const deviceFlowSuccessManager = new DeviceFlowSuccessManager({
            config: {
              autoCloseDelay: 5,
              enableAutoClose: true,
              enableCountdown: true,
              enableBackButtonPrevention: true,
              enableFormResubmissionPrevention: true,
              enableVisibilityHandling: true,
              errorRecoveryTimeout: 30000,
            },
            debug: true,
          });
          deviceFlowSuccessManager.run();
        } catch (fallbackError) {
          console.error(
            '[DeviceFlowSuccessManager] Fallback initialization failed:',
            fallbackError
          );
        }
      }
    } else {
      console.error(
        '[DeviceFlowSuccessManager] No configuration data found in DOM'
      );

      try {
        const deviceFlowSuccessManager = new DeviceFlowSuccessManager({
          config: {
            autoCloseDelay: 5,
            enableAutoClose: true,
            enableCountdown: true,
            enableBackButtonPrevention: true,
            enableFormResubmissionPrevention: true,
            enableVisibilityHandling: true,
            errorRecoveryTimeout: 30000,
          },
          debug: true,
        });
        deviceFlowSuccessManager.run();
      } catch (fallbackError) {
        console.error(
          '[DeviceFlowSuccessManager] Fallback initialization failed:',
          fallbackError
        );
      }
    }
  });
})();
