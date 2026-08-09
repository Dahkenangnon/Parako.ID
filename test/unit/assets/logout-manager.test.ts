import { afterEach, describe, expect, it, vi } from 'vitest';

interface TestEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}

class ButtonFixture {
  private readonly listeners: Array<(event: TestEvent) => void> = [];

  public addEventListener(name: string, listener: (event: TestEvent) => void) {
    if (name === 'click') this.listeners.push(listener);
  }

  public click(): TestEvent {
    const event = { preventDefault: vi.fn() };
    this.listeners.forEach(listener => listener(event));
    return event;
  }
}

class LogoutFormFixture {
  constructor(
    public readonly button: ButtonFixture | null,
    public readonly typeInput: { value: string } | null
  ) {}

  public querySelector(selector: string): unknown {
    return selector === 'button[type="submit"]' ? this.button : this.typeInput;
  }
}

function setupDom(
  options: {
    accountCount?: string | null;
    accountElements?: number;
    confirmResult?: boolean;
    forms?: LogoutFormFixture[];
    missingCountAttribute?: boolean;
    queryAllError?: Error;
    stateText?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const confirm = vi.fn(() => options.confirmResult ?? false);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const forms = options.forms ?? [];
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({ config: { enableConfirmation: true } })
      : options.stateText;

  vi.stubGlobal('confirm', confirm);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) =>
      id === '___LOGOUT_STATE___' && stateText !== null
        ? { textContent: stateText }
        : null
    ),
    querySelector: vi.fn((selector: string) => {
      if (
        selector !== '[data-account-count]' ||
        options.accountCount === null
      ) {
        return null;
      }
      return {
        getAttribute: vi.fn(() =>
          options.missingCountAttribute ? null : (options.accountCount ?? '1')
        ),
      };
    }),
    querySelectorAll: vi.fn((selector: string) => {
      if (options.queryAllError) throw options.queryAllError;
      if (selector === 'form[action*="logout"]') return forms;
      if (selector === '[data-account-id]') {
        return Array.from({ length: options.accountElements ?? 0 });
      }
      return forms.flatMap(form => (form.button ? [form.button] : []));
    }),
  });

  return {
    confirm,
    error,
    log,
    runReady: () => ready?.(),
    warn,
  };
}

describe('logout manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/auth/logout.js')
    ).resolves.toBeDefined();
  });

  it('does nothing when no logout form exists', async () => {
    const { error, runReady } = setupDom();
    await import('../../../src/assets/js/auth/logout.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[LogoutManager]',
      'No logout forms found'
    );
  });

  it('does not confirm when confirmation is disabled', async () => {
    const button = new ButtonFixture();
    const form = new LogoutFormFixture(button, { value: 'all' });
    const { confirm, runReady } = setupDom({
      forms: [form],
      stateText: JSON.stringify({ config: { enableConfirmation: false } }),
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    const event = button.click();

    expect(confirm).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('prevents signing out all accounts when confirmation is declined', async () => {
    const button = new ButtonFixture();
    const form = new LogoutFormFixture(button, { value: 'all' });
    const { confirm, runReady } = setupDom({
      accountCount: '3',
      forms: [form],
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    const event = button.click();

    expect(confirm).toHaveBeenCalledWith(
      'Are you sure you want to sign out from all 3 accounts? This will remove all signed-in accounts from this device.'
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('falls back to rendered accounts when the account-count attribute is malformed', async () => {
    const button = new ButtonFixture();
    const form = new LogoutFormFixture(button, { value: 'all' });
    const { confirm, runReady } = setupDom({
      accountCount: '3 accounts',
      accountElements: 2,
      forms: [form],
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    button.click();

    expect(confirm).toHaveBeenCalledWith(
      'Are you sure you want to sign out from all 2 accounts? This will remove all signed-in accounts from this device.'
    );
  });

  it('continues signing out when confirmation is accepted', async () => {
    const button = new ButtonFixture();
    const form = new LogoutFormFixture(button, { value: 'all' });
    const { runReady } = setupDom({
      accountCount: '2',
      confirmResult: true,
      forms: [form],
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    const event = button.click();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores single-account forms and incomplete logout controls', async () => {
    const singleButton = new ButtonFixture();
    const missingTypeButton = new ButtonFixture();
    const { confirm, runReady } = setupDom({
      forms: [
        new LogoutFormFixture(singleButton, { value: 'single' }),
        new LogoutFormFixture(missingTypeButton, null),
        new LogoutFormFixture(null, { value: 'all' }),
      ],
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    singleButton.click();
    missingTypeButton.click();

    expect(confirm).not.toHaveBeenCalled();
  });

  it('uses a single-account message when no count is available', async () => {
    const button = new ButtonFixture();
    const { confirm, runReady } = setupDom({
      accountCount: null,
      forms: [new LogoutFormFixture(button, { value: 'all' })],
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    button.click();

    expect(confirm).toHaveBeenCalledWith(
      'Are you sure you want to sign out from your account?'
    );
  });

  it('uses custom translated confirmation copy', async () => {
    const button = new ButtonFixture();
    const { confirm, runReady } = setupDom({
      accountCount: '2',
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: JSON.stringify({
        config: { enableConfirmation: true },
        translations: { confirmSignOutAll: 'Sign out {count} profiles?' },
      }),
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    button.click();

    expect(confirm).toHaveBeenCalledWith('Sign out 2 profiles?');
  });

  it('falls back when translated confirmation copy is still a translation key', async () => {
    const button = new ButtonFixture();
    const { confirm, runReady, warn } = setupDom({
      accountCount: '2',
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: JSON.stringify({
        config: { enableConfirmation: true },
        translations: { confirmSignOutAll: 'auth.confirmSignOutAll' },
      }),
    });
    await import('../../../src/assets/js/auth/logout.js');
    runReady();

    button.click();

    expect(confirm).toHaveBeenCalledWith(
      'Are you sure you want to sign out from all 2 accounts? This will remove all signed-in accounts from this device.'
    );
    expect(warn).toHaveBeenCalledWith(
      '[LogoutManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it.each([null, '', 7])(
    'falls back when translated confirmation copy is unusable: %j',
    async translation => {
      const button = new ButtonFixture();
      const { confirm, runReady } = setupDom({
        accountCount: '2',
        forms: [new LogoutFormFixture(button, { value: 'all' })],
        stateText: JSON.stringify({
          config: { enableConfirmation: true },
          translations: { confirmSignOutAll: translation },
        }),
      });
      await import('../../../src/assets/js/auth/logout.js');
      runReady();

      expect(() => button.click()).not.toThrow();
      expect(confirm).toHaveBeenCalledWith(
        'Are you sure you want to sign out from all 2 accounts? This will remove all signed-in accounts from this device.'
      );
    }
  );

  it('uses fallback initialization when the embedded state is malformed', async () => {
    const button = new ButtonFixture();
    const { confirm, error, runReady } = setupDom({
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: '{bad json',
    });
    await import('../../../src/assets/js/auth/logout.js');

    expect(runReady).not.toThrow();
    button.click();

    expect(error).toHaveBeenCalledWith(
      '[LogoutManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(confirm).toHaveBeenCalledWith(
      'Are you sure you want to sign out from your account?'
    );
  });

  it('uses fallback initialization when the state element is absent', async () => {
    const button = new ButtonFixture();
    const { confirm, error, runReady } = setupDom({
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: null,
    });
    await import('../../../src/assets/js/auth/logout.js');

    runReady();
    button.click();

    expect(error).toHaveBeenCalledWith(
      '[LogoutManager] No configuration data found in DOM'
    );
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('uses secure defaults when the embedded config has the wrong type', async () => {
    const button = new ButtonFixture();
    const { confirm, runReady, warn } = setupDom({
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: JSON.stringify({ config: 'invalid' }),
    });
    await import('../../../src/assets/js/auth/logout.js');

    runReady();
    button.click();

    expect(warn).toHaveBeenCalledWith(
      '[LogoutManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('uses secure defaults when the embedded config is an array', async () => {
    const button = new ButtonFixture();
    const { confirm, runReady, warn } = setupDom({
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: JSON.stringify({ config: [] }),
    });
    await import('../../../src/assets/js/auth/logout.js');

    runReady();
    button.click();

    expect(warn).toHaveBeenCalledWith(
      '[LogoutManager]',
      'Invalid config provided, using defaults',
      { config: [] }
    );
    expect(confirm).toHaveBeenCalledOnce();
  });

  it.each([
    { accountCount: '0', missingCountAttribute: false },
    { accountCount: 'ignored', missingCountAttribute: true },
  ])(
    'uses rendered accounts for an unusable count attribute: $accountCount',
    async ({ accountCount, missingCountAttribute }) => {
      const button = new ButtonFixture();
      const { confirm, runReady } = setupDom({
        accountCount,
        accountElements: 2,
        forms: [new LogoutFormFixture(button, { value: 'all' })],
        missingCountAttribute,
      });
      await import('../../../src/assets/js/auth/logout.js');
      runReady();

      button.click();

      expect(confirm).toHaveBeenCalledWith(
        'Are you sure you want to sign out from all 2 accounts? This will remove all signed-in accounts from this device.'
      );
    }
  );

  it('uses defaults for an empty embedded state document', async () => {
    const button = new ButtonFixture();
    const { confirm, runReady } = setupDom({
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: '',
    });
    await import('../../../src/assets/js/auth/logout.js');

    runReady();
    button.click();

    expect(confirm).toHaveBeenCalledOnce();
  });

  it('logs debug lifecycle information when enabled', async () => {
    const button = new ButtonFixture();
    const { log, runReady } = setupDom({
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: JSON.stringify({
        config: { debug: true, enableConfirmation: true },
      }),
    });
    await import('../../../src/assets/js/auth/logout.js');

    runReady();
    button.click();

    expect(log).toHaveBeenCalledWith(
      '[LogoutManager]',
      'LogoutManager initialized',
      expect.any(Object)
    );
    expect(log).toHaveBeenCalledWith(
      '[LogoutManager]',
      'Showing all accounts logout confirmation',
      expect.any(Object)
    );
  });

  it('keeps long dotted translation text as literal copy', async () => {
    const translation = `Sign.out ${'x'.repeat(60)} {count}`;
    const button = new ButtonFixture();
    const { confirm, runReady } = setupDom({
      accountCount: '2',
      forms: [new LogoutFormFixture(button, { value: 'all' })],
      stateText: JSON.stringify({
        config: { enableConfirmation: true },
        translations: { confirmSignOutAll: translation },
      }),
    });
    await import('../../../src/assets/js/auth/logout.js');

    runReady();
    button.click();

    expect(confirm).toHaveBeenCalledWith(translation.replace('{count}', '2'));
  });

  it('reports a fallback initialization failure without escaping the ready handler', async () => {
    const storageError = new Error('DOM query failed');
    const { error, runReady } = setupDom({
      queryAllError: storageError,
      stateText: '{bad json',
    });
    await import('../../../src/assets/js/auth/logout.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[LogoutManager] Fallback initialization failed:',
      storageError
    );
  });

  it('reports a fallback failure when configuration state is absent', async () => {
    const queryError = new Error('DOM unavailable');
    const { error, runReady } = setupDom({
      queryAllError: queryError,
      stateText: null,
    });
    await import('../../../src/assets/js/auth/logout.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[LogoutManager] Fallback initialization failed:',
      queryError
    );
  });
});
