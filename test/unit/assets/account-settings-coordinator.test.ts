import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SettingsConfig,
  SettingsCoordinator,
} from '../../../src/assets/js/account/settings/index.js';

type SettingsCoordinatorConstructor = typeof SettingsCoordinator;

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

function managerConstructor() {
  const initialize = vi.fn();
  const constructor = vi.fn(function (
    this: { initialize: typeof initialize },
    _config: unknown
  ) {
    this.initialize = initialize;
  });
  return { constructor, initialize };
}

async function loadCoordinator(
  options: {
    missing?: string;
    stateElement?: { textContent: string | null } | null;
  } = {}
) {
  vi.resetModules();
  let ready: (() => void) | undefined;
  const setupConfirmationHandlers = vi.fn();
  const managers = {
    AvatarManager: managerConstructor(),
    PasswordValidator: managerConstructor(),
    LanguageSelector: managerConstructor(),
    MfaManager: managerConstructor(),
    PasswordVisibilityToggle: managerConstructor(),
  };
  const windowRoot: Record<string, unknown> = {
    accountSettingsUtils: { setupConfirmationHandlers },
  };
  for (const [name, manager] of Object.entries(managers)) {
    if (name !== options.missing) windowRoot[name] = manager.constructor;
  }
  if (options.missing === 'setupConfirmationHandlers') {
    windowRoot.accountSettingsUtils = {};
  }
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', {
    addEventListener: vi.fn(
      (_name: string, listener: () => void) => (ready = listener)
    ),
    getElementById: vi.fn(() => options.stateElement ?? null),
  });

  const loaded =
    await import('../../../src/assets/js/account/settings/index.js');
  const Coordinator: SettingsCoordinatorConstructor =
    loaded.SettingsCoordinator;
  return {
    Coordinator,
    managers,
    ready,
    setupConfirmationHandlers,
  };
}

describe('account settings coordinator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes every settings module with its narrowed configuration', async () => {
    const { Coordinator, managers, setupConfirmationHandlers } =
      await loadCoordinator();
    const settings = config({ debug: true });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    new Coordinator(settings).initialize();

    expect(setupConfirmationHandlers).toHaveBeenCalledWith(
      {
        backupCodesConfirmNew: 'Generate codes?',
        backupCodesConfirmRemove: 'Remove codes?',
        backupEmailConfirmRemove: 'Remove backup email?',
        socialUnlinkConfirm: 'Unlink provider?',
      },
      true
    );
    expect(managers.AvatarManager.constructor).toHaveBeenCalledWith({
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
    expect(managers.PasswordValidator.constructor).toHaveBeenCalledWith({
      isSpecialPasswordCase: false,
      translations: { passwordMismatch: 'Passwords do not match' },
      debug: true,
    });
    expect(managers.LanguageSelector.constructor).toHaveBeenCalledWith({
      updateLocaleUrl: '/accounts/locale',
      csrfToken: 'csrf-token',
      translations: { languageUpdateError: 'Language update failed' },
      debug: true,
    });
    expect(managers.MfaManager.constructor).toHaveBeenCalledWith({
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
    expect(managers.PasswordVisibilityToggle.constructor).toHaveBeenCalledWith({
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

  it.each([
    'setupConfirmationHandlers',
    'AvatarManager',
    'PasswordValidator',
    'LanguageSelector',
    'MfaManager',
    'PasswordVisibilityToggle',
  ])('reports a missing %s dependency and continues', async missing => {
    const { Coordinator, managers } = await loadCoordinator({ missing });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    expect(() => new Coordinator(config()).initialize()).not.toThrow();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`${missing} not found on window`)
    );
    for (const [name, manager] of Object.entries(managers)) {
      expect(manager.initialize).toHaveBeenCalledTimes(
        name === missing ? 0 : 1
      );
    }
  });

  it('auto-initializes from serialized page state', async () => {
    const settings = config();
    const { managers, ready, setupConfirmationHandlers } =
      await loadCoordinator({
        stateElement: { textContent: JSON.stringify(settings) },
      });

    ready?.();

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
    const { ready } = await loadCoordinator({ stateElement });

    ready?.();

    expect(consoleError).toHaveBeenCalled();
  });

  it('can be imported outside a browser document', async () => {
    vi.resetModules();
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);

    const loaded =
      await import('../../../src/assets/js/account/settings/index.js');

    expect(loaded.SettingsCoordinator).toEqual(expect.any(Function));
  });
});
