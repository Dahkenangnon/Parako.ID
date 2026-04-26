/**
 * SettingsCoordinator - Coordinates all settings page modules
 *
 * This coordinator initializes and manages all settings page functionality:
 * - Confirmation dialogs (confirm-handler)
 * - Avatar upload and management
 * - Password validation
 * - Language selection
 * - Multi-Factor Authentication (MFA)
 * - Password visibility toggles
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Translation map interface
   */
  interface TranslationMap {
    [key: string]: string;
  }

  /**
   * MFA methods enabled state interface
   */
  interface MfaMethodsEnabled {
    totp: boolean;
    email: boolean;
    webauthn: boolean;
  }

  /**
   * Configuration interface for Settings page
   */
  interface SettingsConfig {
    removeAvatarUrl: string;
    updateLocaleUrl: string;
    csrfToken: string;
    isMfaEnabled: boolean;
    mfaMethodsEnabled?: MfaMethodsEnabled;
    isSpecialPasswordCase: boolean;
    translations: {
      removeConfirm: string;
      removeError: string;
      fileReadError: string;
      processingImage: string;
      languageUpdateError: string;
      // MFA translations
      mfaAlreadyEnabled: string;
      mfaMethodAlreadyEnabled?: string;
      mfaNotEnabled: string;
      mfaDisableConfirm: string;
      passwordMismatch: string;
      // Confirmation dialog translations (for confirm-handler)
      backupCodesConfirmNew: string;
      backupCodesConfirmRemove: string;
      backupEmailConfirmRemove: string;
      socialUnlinkConfirm: string;
    };
    debug?: boolean;
  }

  /**
   * SettingsCoordinator class - Main coordinator for settings page
   */
  class SettingsCoordinator {
    private config: SettingsConfig;
    private debug: boolean;

    constructor(config: SettingsConfig) {
      this.config = config;
      this.debug = config.debug || false;
    }

    /**
     * Initialize all settings modules
     */
    public initialize(): void {
      this.log('Initializing SettingsCoordinator');

      this.initializeConfirmationHandlers();

      this.initializeAvatarManager();
      this.initializePasswordValidator();
      this.initializeLanguageSelector();
      this.initializeMfaManager();
      this.initializePasswordVisibilityToggle();

      this.log('All settings modules initialized');
    }

    /**
     * Initialize confirmation handlers
     */
    private initializeConfirmationHandlers(): void {
      // Access confirm handler from window (loaded via script tag)
      const setupConfirmationHandlers = (window as any).accountSettingsUtils
        ?.setupConfirmationHandlers;

      if (!setupConfirmationHandlers) {
        console.error(
          '[SettingsCoordinator] setupConfirmationHandlers not found on window'
        );
        return;
      }

      const translations: TranslationMap = {
        backupCodesConfirmNew: this.config.translations.backupCodesConfirmNew,
        backupCodesConfirmRemove:
          this.config.translations.backupCodesConfirmRemove,
        backupEmailConfirmRemove:
          this.config.translations.backupEmailConfirmRemove,
        socialUnlinkConfirm: this.config.translations.socialUnlinkConfirm,
      };

      setupConfirmationHandlers(translations, this.debug);
      this.log('Confirmation handlers initialized');
    }

    /**
     * Initialize Avatar Manager
     */
    private initializeAvatarManager(): void {
      const AvatarManager = (window as any).AvatarManager;

      if (!AvatarManager) {
        console.error(
          '[SettingsCoordinator] AvatarManager not found on window'
        );
        return;
      }

      const avatarConfig = {
        removeAvatarUrl: this.config.removeAvatarUrl,
        csrfToken: this.config.csrfToken,
        translations: {
          removeConfirm: this.config.translations.removeConfirm,
          removeError: this.config.translations.removeError,
          fileReadError: this.config.translations.fileReadError,
          processingImage: this.config.translations.processingImage,
        },
        debug: this.debug,
      };

      const avatarManager = new AvatarManager(avatarConfig);
      avatarManager.initialize();

      this.log('AvatarManager initialized');
    }

    /**
     * Initialize Password Validator
     */
    private initializePasswordValidator(): void {
      const PasswordValidator = (window as any).PasswordValidator;

      if (!PasswordValidator) {
        console.error(
          '[SettingsCoordinator] PasswordValidator not found on window'
        );
        return;
      }

      const passwordConfig = {
        isSpecialPasswordCase: this.config.isSpecialPasswordCase,
        translations: {
          passwordMismatch: this.config.translations.passwordMismatch,
        },
        debug: this.debug,
      };

      const passwordValidator = new PasswordValidator(passwordConfig);
      passwordValidator.initialize();

      this.log('PasswordValidator initialized');
    }

    /**
     * Initialize Language Selector
     */
    private initializeLanguageSelector(): void {
      const LanguageSelector = (window as any).LanguageSelector;

      if (!LanguageSelector) {
        console.error(
          '[SettingsCoordinator] LanguageSelector not found on window'
        );
        return;
      }

      const languageConfig = {
        updateLocaleUrl: this.config.updateLocaleUrl,
        csrfToken: this.config.csrfToken,
        translations: {
          languageUpdateError: this.config.translations.languageUpdateError,
        },
        debug: this.debug,
      };

      const languageSelector = new LanguageSelector(languageConfig);
      languageSelector.initialize();

      this.log('LanguageSelector initialized');
    }

    /**
     * Initialize MFA Manager
     */
    private initializeMfaManager(): void {
      const MfaManager = (window as any).MfaManager;

      if (!MfaManager) {
        console.error('[SettingsCoordinator] MfaManager not found on window');
        return;
      }

      const mfaConfig = {
        isMfaEnabled: this.config.isMfaEnabled,
        mfaMethodsEnabled: this.config.mfaMethodsEnabled,
        translations: {
          mfaAlreadyEnabled: this.config.translations.mfaAlreadyEnabled,
          mfaMethodAlreadyEnabled:
            this.config.translations.mfaMethodAlreadyEnabled,
          mfaNotEnabled: this.config.translations.mfaNotEnabled,
          mfaDisableConfirm: this.config.translations.mfaDisableConfirm,
        },
        debug: this.debug,
      };

      const mfaManager = new MfaManager(mfaConfig);
      mfaManager.initialize();

      this.log('MfaManager initialized');
    }

    /**
     * Initialize Password Visibility Toggle
     */
    private initializePasswordVisibilityToggle(): void {
      const PasswordVisibilityToggle = (window as any).PasswordVisibilityToggle;

      if (!PasswordVisibilityToggle) {
        console.error(
          '[SettingsCoordinator] PasswordVisibilityToggle not found on window'
        );
        return;
      }

      const passwordVisibilityToggle = new PasswordVisibilityToggle({
        debug: this.debug,
      });
      passwordVisibilityToggle.initialize();

      this.log('PasswordVisibilityToggle initialized');
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[SettingsCoordinator]', ...args);
      }
    }
  }

  // Auto-initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('___SETTINGS_STATE___');

    if (!dataElement) {
      console.error('[SettingsCoordinator] Configuration element not found');
      return;
    }

    try {
      const config: SettingsConfig = JSON.parse(
        dataElement.textContent || '{}'
      );
      const coordinator = new SettingsCoordinator(config);
      coordinator.initialize();
    } catch (error) {
      console.error(
        '[SettingsCoordinator] Failed to parse configuration:',
        error
      );
    }
  });

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettingsCoordinator;
  }
})();
