import { afterEach, describe, expect, it, vi } from 'vitest';

interface MfaMethods {
  totp: boolean;
  email: boolean;
  webauthn: boolean;
}

interface MfaConfig {
  isMfaEnabled: boolean;
  mfaMethodsEnabled?: MfaMethods;
  translations: {
    mfaAlreadyEnabled: string;
    mfaMethodAlreadyEnabled?: string;
    mfaNotEnabled: string;
    mfaDisableConfirm: string;
  };
  debug?: boolean;
}

interface MfaManagerInstance {
  initialize(): void;
  setupMethodHandlers(): void;
}

type MfaManagerConstructor = new (config: MfaConfig) => MfaManagerInstance;

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  getAttribute: ReturnType<typeof vi.fn>;
}

function form(action: string | null = null): FormFixture {
  return {
    addEventListener: vi.fn(),
    getAttribute: vi.fn(() => action),
  };
}

function config(overrides: Partial<MfaConfig> = {}): MfaConfig {
  return {
    isMfaEnabled: false,
    translations: {
      mfaAlreadyEnabled: 'MFA is already enabled',
      mfaMethodAlreadyEnabled: 'This method is already enabled',
      mfaNotEnabled: 'This method is not enabled',
      mfaDisableConfirm: 'Disable this MFA method?',
    },
    ...overrides,
  };
}

async function loadManager(
  options: {
    appForm?: FormFixture | null;
    emailForm?: FormFixture | null;
    disableForms?: FormFixture[];
  } = {}
) {
  vi.resetModules();
  const showAlert = vi.fn().mockResolvedValue(undefined);
  const showConfirm = vi.fn();
  const windowRoot: {
    MfaManager?: MfaManagerConstructor;
    dialog: { showAlert: typeof showAlert; showConfirm: typeof showConfirm };
  } = { dialog: { showAlert, showConfirm } };
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) =>
      id === 'enable-mfa-app-form'
        ? (options.appForm ?? null)
        : (options.emailForm ?? null)
    ),
    querySelectorAll: vi.fn(() => options.disableForms ?? []),
  });
  await import('../../../src/assets/js/account/settings/mfa.js');
  if (!windowRoot.MfaManager) throw new Error('MfaManager was not published');
  return { Manager: windowRoot.MfaManager, showAlert, showConfirm };
}

function submitEvent() {
  return { preventDefault: vi.fn() } as unknown as Event;
}

describe('account MFA settings manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('handles absent forms and legacy method defaults without side effects', async () => {
    const { Manager, showAlert, showConfirm } = await loadManager();
    const manager = new Manager(config());

    expect(() => manager.setupMethodHandlers()).not.toThrow();
    expect(() => manager.initialize()).not.toThrow();
    expect(showAlert).not.toHaveBeenCalled();
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('blocks already-enabled TOTP and email methods', async () => {
    const appForm = form();
    const emailForm = form();
    const { Manager, showAlert } = await loadManager({ appForm, emailForm });
    new Manager(
      config({
        mfaMethodsEnabled: { totp: true, email: true, webauthn: false },
      })
    ).initialize();
    const appSubmit = appForm.addEventListener.mock.calls[0]?.[1] as (
      event: Event
    ) => Promise<void>;
    const emailSubmit = emailForm.addEventListener.mock.calls[0]?.[1] as (
      event: Event
    ) => Promise<void>;
    const appEvent = submitEvent();
    const emailEvent = submitEvent();

    await appSubmit(appEvent);
    await emailSubmit(emailEvent);

    expect(appEvent.preventDefault).toHaveBeenCalledOnce();
    expect(emailEvent.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenNthCalledWith(
      1,
      'TOTP Already Enabled',
      'This method is already enabled',
      { variant: 'info' }
    );
    expect(showAlert).toHaveBeenNthCalledWith(
      2,
      'Email MFA Already Enabled',
      'This method is already enabled',
      { variant: 'info' }
    );
  });

  it('falls back to the global already-enabled translation', async () => {
    const appForm = form();
    const emailForm = form();
    const { Manager, showAlert } = await loadManager({ appForm, emailForm });
    const settings = config({
      mfaMethodsEnabled: { totp: true, email: true, webauthn: false },
    });
    delete settings.translations.mfaMethodAlreadyEnabled;
    new Manager(settings).initialize();

    await appForm.addEventListener.mock.calls[0]?.[1](submitEvent());
    await emailForm.addEventListener.mock.calls[0]?.[1](submitEvent());

    expect(showAlert).toHaveBeenNthCalledWith(
      1,
      'TOTP Already Enabled',
      'MFA is already enabled',
      { variant: 'info' }
    );
    expect(showAlert).toHaveBeenNthCalledWith(
      2,
      'Email MFA Already Enabled',
      'MFA is already enabled',
      { variant: 'info' }
    );
  });

  it('allows enable forms for methods that are not yet active', async () => {
    const appForm = form();
    const emailForm = form();
    const { Manager } = await loadManager({ appForm, emailForm });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    new Manager(
      config({
        debug: true,
        mfaMethodsEnabled: { totp: false, email: false, webauthn: false },
      })
    ).initialize();

    expect(appForm.addEventListener).not.toHaveBeenCalled();
    expect(emailForm.addEventListener).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith(
      '[MfaManager]',
      'TOTP enable form allowed (not enabled yet)'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[MfaManager]',
      'Email MFA enable form allowed (not enabled yet)'
    );
  });

  it('rejects disabled and unknown methods before asking for confirmation', async () => {
    const disabled = form('/account/settings?method=email');
    const unknown = form(null);
    const { Manager, showAlert, showConfirm } = await loadManager({
      disableForms: [disabled, unknown],
    });
    new Manager(
      config({
        mfaMethodsEnabled: { totp: true, email: false, webauthn: true },
      })
    ).initialize();
    const disabledEvent = submitEvent();
    const unknownEvent = submitEvent();

    await disabled.addEventListener.mock.calls[0]?.[1](disabledEvent);
    await unknown.addEventListener.mock.calls[0]?.[1](unknownEvent);

    expect(disabledEvent.preventDefault).toHaveBeenCalledOnce();
    expect(unknownEvent.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledTimes(2);
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('prevents a disable submission when confirmation is cancelled', async () => {
    const totp = form('/account/settings?method=totp');
    const { Manager, showConfirm } = await loadManager({
      disableForms: [totp],
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    showConfirm.mockResolvedValue(false);
    new Manager(
      config({
        debug: true,
        mfaMethodsEnabled: { totp: true, email: false, webauthn: false },
      })
    ).initialize();
    const event = submitEvent();

    await totp.addEventListener.mock.calls[0]?.[1](event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith(
      '[MfaManager]',
      'User cancelled disabling totp MFA'
    );
  });

  it.each([
    ['email', { totp: false, email: true, webauthn: false }],
    ['webauthn', { totp: false, email: false, webauthn: true }],
  ] as const)('allows confirmed disabling of %s', async (method, methods) => {
    const disableForm = form(`/account/settings?method=${method}`);
    const { Manager, showConfirm } = await loadManager({
      disableForms: [disableForm],
    });
    showConfirm.mockResolvedValue(true);
    new Manager(config({ mfaMethodsEnabled: methods })).initialize();
    const event = submitEvent();

    await disableForm.addEventListener.mock.calls[0]?.[1](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    'uses legacy global MFA state %s when per-method state is absent',
    async (isMfaEnabled, shouldPrevent) => {
      const disableForm = form('/account/settings');
      const { Manager, showAlert, showConfirm } = await loadManager({
        disableForms: [disableForm],
      });
      showConfirm.mockResolvedValue(true);
      new Manager(config({ isMfaEnabled })).initialize();
      const event = submitEvent();

      await disableForm.addEventListener.mock.calls[0]?.[1](event);

      expect(event.preventDefault).toHaveBeenCalledTimes(shouldPrevent ? 1 : 0);
      if (shouldPrevent) {
        expect(showAlert).toHaveBeenCalledOnce();
      } else {
        expect(showConfirm).toHaveBeenCalledOnce();
      }
    }
  );

  it('can be evaluated without a browser window', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/account/settings/mfa.js')
    ).resolves.toBeDefined();
  });
});
