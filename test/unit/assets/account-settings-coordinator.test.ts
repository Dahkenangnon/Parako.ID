import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeSettingsPage,
  SettingsCoordinator,
  type SettingsConfig,
  type SettingsDependencies,
} from '../../../src/assets/js/account/settings/index.js';

function config(overrides: Partial<SettingsConfig> = {}): SettingsConfig {
  return {
    removeAvatarUrl: '/accounts/avatar',
    updateLocaleUrl: '/accounts/locale',
    csrfToken: 'csrf-token',
    isMfaEnabled: true,
    mfaMethodsEnabled: { totp: true, email: false, webauthn: true },
    isSpecialPasswordCase: false,
    translations: {
      removeConfirm: 'Remove avatar?',
      removeError: 'Avatar removal failed',
      fileReadError: 'File read failed',
      processingImage: 'Processing image',
      languageUpdateError: 'Language update failed',
      mfaAlreadyEnabled: 'MFA enabled',
      mfaMethodAlreadyEnabled: 'Method enabled',
      mfaNotEnabled: 'Method disabled',
      mfaDisableConfirm: 'Disable MFA?',
      passwordMismatch: 'Passwords do not match',
      backupCodesConfirmNew: 'Generate codes?',
      backupCodesConfirmRemove: 'Remove codes?',
      backupEmailConfirmRemove: 'Remove backup email?',
      socialUnlinkConfirm: 'Unlink provider?',
    },
    ...overrides,
  };
}

function managerFactory() {
  const initialize = vi.fn();
  const factory = vi.fn(() => ({ initialize }));
  return { factory, initialize };
}

function loadCoordinator(
  stateElement: { textContent: string | null } | null = null
) {
  const setupConfirmationHandlers = vi.fn();
  const managers = {
    AvatarManager: managerFactory(),
    PasswordValidator: managerFactory(),
    LanguageSelector: managerFactory(),
    MfaManager: managerFactory(),
    PasswordVisibilityToggle: managerFactory(),
  };
  const dependencies: SettingsDependencies = {
    setupConfirmationHandlers,
    createAvatarManager: managers.AvatarManager.factory,
    createPasswordValidator: managers.PasswordValidator.factory,
    createLanguageSelector: managers.LanguageSelector.factory,
    createMfaManager: managers.MfaManager.factory,
    createPasswordVisibilityToggle: managers.PasswordVisibilityToggle.factory,
  };
  const documentRoot = {
    getElementById: vi.fn(() => stateElement),
  };

  return {
    dependencies,
    documentRoot,
    managers,
    setupConfirmationHandlers,
  };
}

describe('account settings coordinator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes every settings module with its narrowed configuration', async () => {
    const { dependencies, managers, setupConfirmationHandlers } =
      loadCoordinator();
    const settings = config({ debug: true });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    new SettingsCoordinator(settings, dependencies).initialize();

    expect(setupConfirmationHandlers).toHaveBeenCalledWith(
      {
        backupCodesConfirmNew: 'Generate codes?',
        backupCodesConfirmRemove: 'Remove codes?',
        backupEmailConfirmRemove: 'Remove backup email?',
        socialUnlinkConfirm: 'Unlink provider?',
      },
      true
    );
    expect(managers.AvatarManager.factory).toHaveBeenCalledWith({
      removeAvatarUrl: '/accounts/avatar',
      csrfToken: 'csrf-token',
      translations: {
        removeConfirm: 'Remove avatar?',
        removeError: 'Avatar removal failed',
        fileReadError: 'File read failed',
        processingImage: 'Processing image',
      },
      debug: true,
    });
    expect(managers.PasswordValidator.factory).toHaveBeenCalledWith({
      isSpecialPasswordCase: false,
      translations: { passwordMismatch: 'Passwords do not match' },
      debug: true,
    });
    expect(managers.LanguageSelector.factory).toHaveBeenCalledWith({
      updateLocaleUrl: '/accounts/locale',
      csrfToken: 'csrf-token',
      translations: { languageUpdateError: 'Language update failed' },
      debug: true,
    });
    expect(managers.MfaManager.factory).toHaveBeenCalledWith({
      isMfaEnabled: true,
      mfaMethodsEnabled: { totp: true, email: false, webauthn: true },
      translations: {
        mfaAlreadyEnabled: 'MFA enabled',
        mfaMethodAlreadyEnabled: 'Method enabled',
        mfaNotEnabled: 'Method disabled',
        mfaDisableConfirm: 'Disable MFA?',
      },
      debug: true,
    });
    expect(managers.PasswordVisibilityToggle.factory).toHaveBeenCalledWith({
      debug: true,
    });
    for (const manager of Object.values(managers)) {
      expect(manager.initialize).toHaveBeenCalledOnce();
    }
    expect(consoleLog).toHaveBeenCalledWith(
      '[SettingsCoordinator]',
      'All settings modules initialized'
    );
  });

  it('auto-initializes from serialized page state', async () => {
    const settings = config();
    const { dependencies, documentRoot, managers, setupConfirmationHandlers } =
      loadCoordinator({ textContent: JSON.stringify(settings) });

    initializeSettingsPage(documentRoot as never, dependencies);

    expect(setupConfirmationHandlers).toHaveBeenCalledOnce();
    for (const manager of Object.values(managers)) {
      expect(manager.initialize).toHaveBeenCalledOnce();
    }
  });

  it.each([
    ['missing state', null],
    ['malformed state', { textContent: '{' }],
    ['blank state', { textContent: null }],
  ])('reports %s during auto-initialization', async (_name, stateElement) => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { dependencies, documentRoot } = loadCoordinator(stateElement);

    initializeSettingsPage(documentRoot as never, dependencies);

    expect(consoleError).toHaveBeenCalled();
  });

  it('does not expose settings modules through application globals', () => {
    const browserWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', browserWindow);

    expect(browserWindow).not.toHaveProperty('SettingsCoordinator');
    expect(browserWindow).not.toHaveProperty('AvatarManager');
    expect(browserWindow).not.toHaveProperty('PasswordValidator');
  });
});
