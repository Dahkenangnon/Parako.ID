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

import {
  setupConfirmationHandlers,
  type TranslationMap as ConfirmTranslationMap,
} from './confirm-handler.js';
import { AvatarManager, type AvatarConfig } from './avatar.js';
import { PasswordValidator, type PasswordValidatorConfig } from './password.js';
import { LanguageSelector, type LanguageSelectorConfig } from './language.js';
import { MfaManager, type MfaConfig, type MfaMethodsEnabled } from './mfa.js';
import {
  PasswordVisibilityToggle,
  type PasswordVisibilityConfig,
} from './password-visibility.js';

/**
 * Translation map interface
 */
export type TranslationMap = ConfirmTranslationMap;

/**
 * Configuration interface for Settings page
 */
export interface SettingsConfig {
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

export interface SettingsModule {
  initialize(): void;
}

export interface SettingsDependencies {
  setupConfirmationHandlers(
    translations: TranslationMap,
    debug?: boolean
  ): void;
  createAvatarManager(config: AvatarConfig): SettingsModule;
  createPasswordValidator(config: PasswordValidatorConfig): SettingsModule;
  createLanguageSelector(config: LanguageSelectorConfig): SettingsModule;
  createMfaManager(config: MfaConfig): SettingsModule;
  createPasswordVisibilityToggle(
    config: PasswordVisibilityConfig
  ): SettingsModule;
}

const defaultSettingsDependencies: SettingsDependencies = {
  setupConfirmationHandlers,
  createAvatarManager: config => new AvatarManager(config),
  createPasswordValidator: config => new PasswordValidator(config),
  createLanguageSelector: config => new LanguageSelector(config),
  createMfaManager: config => new MfaManager(config),
  createPasswordVisibilityToggle: config =>
    new PasswordVisibilityToggle(config),
};

/**
 * SettingsCoordinator class - Main coordinator for settings page
 */
export class SettingsCoordinator {
  private config: SettingsConfig;
  private debug: boolean;

  constructor(
    config: SettingsConfig,
    private readonly dependencies: SettingsDependencies = defaultSettingsDependencies
  ) {
    this.config = config;
    this.debug = config.debug || false;
  }

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

  private initializeConfirmationHandlers(): void {
    const translations: TranslationMap = {
      backupCodesConfirmNew: this.config.translations.backupCodesConfirmNew,
      backupCodesConfirmRemove:
        this.config.translations.backupCodesConfirmRemove,
      backupEmailConfirmRemove:
        this.config.translations.backupEmailConfirmRemove,
      socialUnlinkConfirm: this.config.translations.socialUnlinkConfirm,
    };

    this.dependencies.setupConfirmationHandlers(translations, this.debug);
    this.log('Confirmation handlers initialized');
  }

  private initializeAvatarManager(): void {
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

    const avatarManager = this.dependencies.createAvatarManager(avatarConfig);
    avatarManager.initialize();

    this.log('AvatarManager initialized');
  }

  private initializePasswordValidator(): void {
    const passwordConfig = {
      isSpecialPasswordCase: this.config.isSpecialPasswordCase,
      translations: {
        passwordMismatch: this.config.translations.passwordMismatch,
      },
      debug: this.debug,
    };

    const passwordValidator =
      this.dependencies.createPasswordValidator(passwordConfig);
    passwordValidator.initialize();

    this.log('PasswordValidator initialized');
  }

  private initializeLanguageSelector(): void {
    const languageConfig = {
      updateLocaleUrl: this.config.updateLocaleUrl,
      csrfToken: this.config.csrfToken,
      translations: {
        languageUpdateError: this.config.translations.languageUpdateError,
      },
      debug: this.debug,
    };

    const languageSelector =
      this.dependencies.createLanguageSelector(languageConfig);
    languageSelector.initialize();

    this.log('LanguageSelector initialized');
  }

  private initializeMfaManager(): void {
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

    const mfaManager = this.dependencies.createMfaManager(mfaConfig);
    mfaManager.initialize();

    this.log('MfaManager initialized');
  }

  private initializePasswordVisibilityToggle(): void {
    const passwordVisibilityToggle =
      this.dependencies.createPasswordVisibilityToggle({
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

export function initializeSettingsPage(
  root: Pick<Document, 'getElementById'> = document,
  dependencies: SettingsDependencies = defaultSettingsDependencies
): SettingsCoordinator | undefined {
  const dataElement = root.getElementById('___SETTINGS_STATE___');

  if (!dataElement) {
    console.error('[SettingsCoordinator] Configuration element not found');
    return undefined;
  }

  try {
    const config: SettingsConfig = JSON.parse(dataElement.textContent || '{}');
    const coordinator = new SettingsCoordinator(config, dependencies);
    coordinator.initialize();
    return coordinator;
  } catch (error) {
    console.error(
      '[SettingsCoordinator] Failed to parse configuration:',
      error
    );
    return undefined;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeSettingsPage();
  });
}
