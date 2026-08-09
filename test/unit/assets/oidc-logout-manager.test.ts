import { afterEach, describe, expect, it, vi } from 'vitest';

interface SubmitEventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

class ButtonFixture {
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public readonly style: Record<string, string> = {};
  public disabled = false;
  public innerHTML: string;

  constructor(
    public textContent: string,
    public value: string
  ) {
    this.innerHTML = textContent;
  }
}

class FormFixture {
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public readonly style: Record<string, string> = {};
  private submitListener?: (event: SubmitEventFixture) => void;

  constructor(public readonly buttons: ButtonFixture[]) {}

  public addEventListener(
    name: string,
    listener: (event: SubmitEventFixture) => void
  ): void {
    if (name === 'submit') this.submitListener = listener;
  }

  public querySelectorAll(selector: string): ButtonFixture[] {
    return selector === 'button[type="submit"]' ? this.buttons : [];
  }

  public triggerSubmit(): SubmitEventFixture {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    this.submitListener?.(event);
    return event;
  }
}

const defaultConfig = {
  enableLoadingStates: true,
  enableErrorRecovery: true,
  errorRecoveryTimeout: 10000,
  enableBackButtonPrevention: true,
  enableFormResubmissionPrevention: true,
};

function setupDom(
  options: {
    form?: FormFixture | null;
    queryError?: Error;
    replaceStateAvailable?: boolean;
    stateText?: string | null;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  let pageshow: ((event: { persisted: boolean }) => void) | undefined;
  const alert = vi.fn();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const reload = vi.fn();
  const replaceState = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({ config: defaultConfig })
      : options.stateText;

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', {
    addEventListener: vi.fn(
      (name: string, listener: (event: { persisted: boolean }) => void) => {
        if (name === 'pageshow') pageshow = listener;
      }
    ),
    history: {
      replaceState:
        options.replaceStateAvailable === false ? undefined : replaceState,
    },
    location: {
      href: 'https://id.example.test/oidc/v1/session/end',
      reload,
    },
    setTimeout,
  });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) =>
      id === '___OIDC_LOGOUT_STATE___' && stateText !== null
        ? { textContent: stateText }
        : null
    ),
    querySelector: vi.fn(() => {
      if (options.queryError) throw options.queryError;
      return options.form ?? null;
    }),
  });

  return {
    alert,
    error,
    log,
    reload,
    replaceState,
    runReady: () => ready?.(),
    showPage: (persisted: boolean) => pageshow?.({ persisted }),
    warn,
  };
}

describe('OIDC logout manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when browser globals are unavailable', async () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/auth/oidc/logout.js')
    ).resolves.toBeDefined();
  });

  it('stops safely when the logout form is absent', async () => {
    const { error, runReady } = setupDom();
    await import('../../../src/assets/js/auth/oidc/logout.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      'Required form elements not found'
    );
  });

  it('stops safely when the logout form has no submit buttons', async () => {
    const form = new FormFixture([]);
    const { error, runReady } = setupDom({ form });
    await import('../../../src/assets/js/auth/oidc/logout.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      'Required form elements not found'
    );
    expect(form.triggerSubmit().preventDefault).not.toHaveBeenCalled();
  });

  it('disables every action, renders loading state, and blocks duplicate submission', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const no = new ButtonFixture('Stay signed in', 'no');
    const form = new FormFixture([yes, no]);
    const { runReady, warn } = setupDom({ form });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    const first = form.triggerSubmit();
    const duplicate = form.triggerSubmit();

    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopPropagation).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      'Double submission prevented'
    );
    expect(yes.disabled).toBe(true);
    expect(no.disabled).toBe(true);
    expect(yes.innerHTML).toContain('Signing Out...');
    expect(yes.innerHTML).toContain('0 014 12H0');
    expect(no.innerHTML).toBe('Stay signed in');
    expect(form.style.pointerEvents).toBe('none');
  });

  it('keeps loading copy untouched when loading states are disabled', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { runReady } = setupDom({
      form,
      stateText: JSON.stringify({
        config: { ...defaultConfig, enableLoadingStates: false },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    form.triggerSubmit();

    expect(yes.disabled).toBe(true);
    expect(yes.innerHTML).toBe('Confirm');
  });

  it('restores localized actions and reports a translated recovery error', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const no = new ButtonFixture('Stay', 'no');
    const form = new FormFixture([yes, no]);
    const { alert, runReady, warn } = setupDom({
      form,
      stateText: JSON.stringify({
        config: { ...defaultConfig, errorRecoveryTimeout: 5000 },
        translations: {
          errorRecovery: 'Please retry',
          signingOut: 'Continuing...',
          yesSignOut: 'Sign out now',
        },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();
    form.triggerSubmit();

    await vi.advanceTimersByTimeAsync(4999);
    expect(yes.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(warn).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      'Error recovery timeout triggered'
    );
    expect(alert).toHaveBeenCalledWith('Please retry');
    expect(yes.disabled).toBe(false);
    expect(no.disabled).toBe(false);
    expect(yes.innerHTML).toBe('Sign out now');
    expect(form.style.pointerEvents).toBe('auto');
    expect(form.triggerSubmit().preventDefault).not.toHaveBeenCalled();
  });

  it('does not schedule recovery when it is disabled', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { alert, runReady } = setupDom({
      form,
      stateText: JSON.stringify({
        config: { ...defaultConfig, enableErrorRecovery: false },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();
    form.triggerSubmit();

    await vi.advanceTimersByTimeAsync(60000);

    expect(yes.disabled).toBe(true);
    expect(alert).not.toHaveBeenCalled();
  });

  it('reloads only pages restored from the back-forward cache', async () => {
    const form = new FormFixture([new ButtonFixture('Confirm', 'yes')]);
    const { reload, runReady, showPage } = setupDom({ form });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    showPage(false);
    expect(reload).not.toHaveBeenCalled();
    showPage(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('can disable back-button and refresh resubmission prevention', async () => {
    const form = new FormFixture([new ButtonFixture('Confirm', 'yes')]);
    const { reload, replaceState, runReady, showPage } = setupDom({
      form,
      stateText: JSON.stringify({
        config: {
          ...defaultConfig,
          enableBackButtonPrevention: false,
          enableFormResubmissionPrevention: false,
        },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    showPage(true);

    expect(reload).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('replaces browser history when refresh resubmission prevention is enabled', async () => {
    const form = new FormFixture([new ButtonFixture('Confirm', 'yes')]);
    const { replaceState, runReady } = setupDom({ form });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'https://id.example.test/oidc/v1/session/end'
    );
  });

  it('tolerates a browser without history.replaceState', async () => {
    const form = new FormFixture([new ButtonFixture('Confirm', 'yes')]);
    const { runReady } = setupDom({ form, replaceStateAvailable: false });
    await import('../../../src/assets/js/auth/oidc/logout.js');

    expect(runReady).not.toThrow();
  });

  it('does not mistake ordinary dotted loading copy for a translation key', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { runReady, warn } = setupDom({
      form,
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { signingOut: 'Continuing...' },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    form.triggerSubmit();

    expect(yes.innerHTML).toContain('Continuing...');
    expect(warn).not.toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it.each([null, '', 7])(
    'falls back when loading translation copy is unusable: %j',
    async translation => {
      const yes = new ButtonFixture('Confirm', 'yes');
      const form = new FormFixture([yes]);
      const { runReady } = setupDom({
        form,
        stateText: JSON.stringify({
          config: defaultConfig,
          translations: { signingOut: translation },
        }),
      });
      await import('../../../src/assets/js/auth/oidc/logout.js');
      runReady();

      form.triggerSubmit();

      expect(yes.innerHTML).toContain('Signing Out...');
    }
  );

  it('falls back when loading copy is still a translation key', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { runReady, warn } = setupDom({
      form,
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { signingOut: 'auth.signingOut' },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    form.triggerSubmit();

    expect(yes.innerHTML).toContain('Signing Out...');
    expect(warn).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it('keeps long dotted loading copy as literal text', async () => {
    const translation = `Continuing.status ${'x'.repeat(60)}`;
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { runReady } = setupDom({
      form,
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { signingOut: translation },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    form.triggerSubmit();

    expect(yes.innerHTML).toContain(translation);
  });

  it.each([{ config: [] }, { config: 'invalid' }])(
    'uses safe defaults when embedded config is invalid: %j',
    async ({ config }) => {
      const yes = new ButtonFixture('Confirm', 'yes');
      const form = new FormFixture([yes]);
      const { runReady, warn } = setupDom({
        form,
        stateText: JSON.stringify({ config }),
      });
      await import('../../../src/assets/js/auth/oidc/logout.js');
      runReady();

      form.triggerSubmit();

      expect(warn).toHaveBeenCalledWith(
        '[OIDCLogoutManager]',
        'Invalid config provided, using defaults',
        { config }
      );
      expect(yes.innerHTML).toContain('Signing Out...');
    }
  );

  it.each([
    { expectedTimeout: 60000, timeout: 999999 },
    { expectedTimeout: 10000, timeout: 'invalid' },
  ])(
    'normalizes recovery timeout $timeout to $expectedTimeout milliseconds',
    async ({ expectedTimeout, timeout }) => {
      const yes = new ButtonFixture('Confirm', 'yes');
      const form = new FormFixture([yes]);
      const { runReady } = setupDom({
        form,
        stateText: JSON.stringify({
          config: { ...defaultConfig, errorRecoveryTimeout: timeout },
        }),
      });
      await import('../../../src/assets/js/auth/oidc/logout.js');
      runReady();
      form.triggerSubmit();

      await vi.advanceTimersByTimeAsync(expectedTimeout - 1);
      expect(yes.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(yes.disabled).toBe(false);
    }
  );

  it('uses fallback initialization when embedded state is malformed', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { error, runReady } = setupDom({ form, stateText: '{bad json' });
    await import('../../../src/assets/js/auth/oidc/logout.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLogoutManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    form.triggerSubmit();
    expect(yes.disabled).toBe(true);
  });

  it('uses fallback initialization when embedded state is absent', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { error, runReady } = setupDom({ form, stateText: null });
    await import('../../../src/assets/js/auth/oidc/logout.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[OIDCLogoutManager] No configuration data found in DOM'
    );
    form.triggerSubmit();
    expect(yes.disabled).toBe(true);
  });

  it('uses defaults for an empty embedded state document', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { runReady } = setupDom({ form, stateText: '' });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    form.triggerSubmit();

    expect(yes.disabled).toBe(true);
  });

  it.each([{ stateText: '{bad json' }, { stateText: null }])(
    'reports fallback initialization failure for state %#',
    async scenario => {
      const queryError = new Error('DOM query failed');
      const { error, runReady } = setupDom({ ...scenario, queryError });
      await import('../../../src/assets/js/auth/oidc/logout.js');

      expect(runReady).not.toThrow();
      expect(error).toHaveBeenCalledWith(
        '[OIDCLogoutManager] Fallback initialization failed:',
        queryError
      );
    }
  );

  it('logs lifecycle details when debug mode is enabled', async () => {
    const yes = new ButtonFixture('Confirm', 'yes');
    const form = new FormFixture([yes]);
    const { log, runReady } = setupDom({
      form,
      stateText: JSON.stringify({
        config: { ...defaultConfig, debug: true },
      }),
    });
    await import('../../../src/assets/js/auth/oidc/logout.js');
    runReady();

    form.triggerSubmit();

    expect(log).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      'OIDCLogoutManager initialized',
      expect.any(Object)
    );
    expect(log).toHaveBeenCalledWith(
      '[OIDCLogoutManager]',
      'Form submission detected'
    );
  });
});
