import { afterEach, describe, expect, it, vi } from 'vitest';

interface SubmitEventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

class ButtonFixture {
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public disabled = false;
  public innerHTML = '';
}

class FormFixture {
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public readonly style: Record<string, string> = {};
  public readonly submitNative = vi.fn();
  private submitListener?: (event: SubmitEventFixture) => void;

  constructor(
    public readonly action: string,
    public readonly button: ButtonFixture | null
  ) {}

  public addEventListener(
    name: string,
    listener: (event: SubmitEventFixture) => void
  ): void {
    if (name === 'submit') this.submitListener = listener;
  }

  public querySelector(selector: string): ButtonFixture | null {
    return selector === 'button[type="submit"]' ? this.button : null;
  }

  public submit(): void {
    this.submitNative();
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

function setupDom(
  options: {
    forms?: FormFixture[];
    queryError?: Error;
    stateText?: string | null;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const forms = options.forms ?? [];
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({
          config: {
            enableLoadingStates: true,
            errorRecoveryTimeout: 120000,
          },
        })
      : options.stateText;

  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) =>
      id === '___EMAIL_VERIFICATION_STATE___' && stateText !== null
        ? { textContent: stateText }
        : null
    ),
    querySelectorAll: vi.fn(() => {
      if (options.queryError) throw options.queryError;
      return forms;
    }),
  });

  return {
    error,
    log,
    runReady: () => ready?.(),
    warn,
  };
}

describe('email verification manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when browser globals are unavailable', async () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/auth/email-verification.js')
    ).resolves.toBeDefined();
  });

  it('stops safely when no verification form exists', async () => {
    const { error, runReady } = setupDom();
    await import('../../../src/assets/js/auth/email-verification.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[EmailVerificationManager]',
      'No forms found'
    );
  });

  it('leaves native submission untouched when loading states are disabled', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/auth/email-verification/resend', button);
    const { runReady } = setupDom({
      forms: [form],
      stateText: JSON.stringify({
        config: {
          enableLoadingStates: false,
          errorRecoveryTimeout: 120000,
        },
      }),
    });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    const event = form.triggerSubmit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(form.style.pointerEvents).toBeUndefined();
  });

  it('locks every form, blocks duplicates, and submits the selected form once', async () => {
    const resendButton = new ButtonFixture();
    const requestButton = new ButtonFixture();
    const resendForm = new FormFixture(
      '/auth/email-verification/resend',
      resendButton
    );
    const requestForm = new FormFixture(
      '/auth/email-verification/request',
      requestButton
    );
    const buttonlessForm = new FormFixture('/ignored', null);
    const { runReady } = setupDom({
      forms: [resendForm, requestForm, buttonlessForm],
    });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    const firstEvent = resendForm.triggerSubmit();
    const duplicateEvent = requestForm.triggerSubmit();

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(firstEvent.stopPropagation).not.toHaveBeenCalled();
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(resendButton.disabled).toBe(true);
    expect(requestButton.disabled).toBe(true);
    expect(resendButton.classList.add).toHaveBeenCalledWith('disabled-button');
    expect(resendForm.style.pointerEvents).toBe('none');
    expect(requestForm.style.pointerEvents).toBe('none');
    expect(resendButton.innerHTML).toContain('text-gray-700');
    expect(resendButton.innerHTML).toContain('Sending...');
    expect(resendButton.innerHTML).toContain('0 014 12H0');
    expect(requestButton.innerHTML).toBe('');

    await vi.advanceTimersByTimeAsync(99);
    expect(resendForm.submitNative).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(resendForm.submitNative).toHaveBeenCalledOnce();
    expect(requestForm.submitNative).not.toHaveBeenCalled();
  });

  it('uses the white loading spinner for a verification request', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/auth/email-verification/request', button);
    const { runReady } = setupDom({ forms: [form] });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    form.triggerSubmit();

    expect(button.innerHTML).toContain('text-white');
    expect(button.innerHTML).toContain('0 014 12H0');
  });

  it('restores forms after the configured recovery timeout', async () => {
    const resendButton = new ButtonFixture();
    const requestButton = new ButtonFixture();
    const resendForm = new FormFixture('/verification/resend', resendButton);
    const requestForm = new FormFixture('/verification/request', requestButton);
    const buttonlessForm = new FormFixture('/verification/other', null);
    const { runReady, warn } = setupDom({
      forms: [resendForm, requestForm, buttonlessForm],
      stateText: JSON.stringify({
        config: {
          enableLoadingStates: true,
          errorRecoveryTimeout: 10000,
        },
        translations: {
          resendVerificationEmail: 'Resend now',
          sendVerificationLink: 'Send now',
        },
      }),
    });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();
    resendForm.triggerSubmit();

    await vi.advanceTimersByTimeAsync(9999);
    expect(resendButton.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(warn).toHaveBeenCalledWith(
      '[EmailVerificationManager]',
      'Error recovery timeout triggered'
    );
    expect(resendButton.disabled).toBe(false);
    expect(requestButton.disabled).toBe(false);
    expect(resendButton.innerHTML).toBe('Resend now');
    expect(requestButton.innerHTML).toBe('Send now');
    expect(resendForm.style.pointerEvents).toBe('auto');
    expect(requestForm.style.pointerEvents).toBe('auto');
    expect(resendForm.classList.remove).toHaveBeenCalledWith('form-disabled');
  });

  it('does not mistake ordinary dotted copy for a translation key', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { runReady, warn } = setupDom({ forms: [form] });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    form.triggerSubmit();

    expect(button.innerHTML).toContain('Sending...');
    expect(warn).not.toHaveBeenCalledWith(
      '[EmailVerificationManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it.each([null, '', 7])(
    'falls back when loading translation copy is unusable: %j',
    async translation => {
      const button = new ButtonFixture();
      const form = new FormFixture('/verification/request', button);
      const { runReady } = setupDom({
        forms: [form],
        stateText: JSON.stringify({
          config: {
            enableLoadingStates: true,
            errorRecoveryTimeout: 120000,
          },
          translations: { sending: translation },
        }),
      });
      await import('../../../src/assets/js/auth/email-verification.js');
      runReady();

      form.triggerSubmit();

      expect(button.innerHTML).toContain('Sending...');
    }
  );

  it('falls back when loading copy is still a translation key', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { runReady, warn } = setupDom({
      forms: [form],
      stateText: JSON.stringify({
        config: {
          enableLoadingStates: true,
          errorRecoveryTimeout: 120000,
        },
        translations: { sending: 'auth.sending' },
      }),
    });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    form.triggerSubmit();

    expect(button.innerHTML).toContain('Sending...');
    expect(warn).toHaveBeenCalledWith(
      '[EmailVerificationManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it('keeps long dotted loading copy as literal text', async () => {
    const translation = `Sending.status ${'x'.repeat(60)}`;
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { runReady } = setupDom({
      forms: [form],
      stateText: JSON.stringify({
        config: {
          enableLoadingStates: true,
          errorRecoveryTimeout: 120000,
        },
        translations: { sending: translation },
      }),
    });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    form.triggerSubmit();

    expect(button.innerHTML).toContain(translation);
  });

  it.each([{ config: [] }, { config: 'invalid' }])(
    'uses secure defaults when embedded config is invalid: %j',
    async ({ config }) => {
      const button = new ButtonFixture();
      const form = new FormFixture('/verification/request', button);
      const { runReady, warn } = setupDom({
        forms: [form],
        stateText: JSON.stringify({ config }),
      });
      await import('../../../src/assets/js/auth/email-verification.js');
      runReady();

      const event = form.triggerSubmit();

      expect(warn).toHaveBeenCalledWith(
        '[EmailVerificationManager]',
        'Invalid config provided, using defaults',
        { config }
      );
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
  );

  it.each([
    { expectedTimeout: 300000, timeout: 999999 },
    { expectedTimeout: 120000, timeout: 'invalid' },
  ])(
    'normalizes recovery timeout $timeout to $expectedTimeout milliseconds',
    async ({ expectedTimeout, timeout }) => {
      const button = new ButtonFixture();
      const form = new FormFixture('/verification/request', button);
      const { runReady } = setupDom({
        forms: [form],
        stateText: JSON.stringify({
          config: {
            enableLoadingStates: true,
            errorRecoveryTimeout: timeout,
          },
        }),
      });
      await import('../../../src/assets/js/auth/email-verification.js');
      runReady();
      form.triggerSubmit();

      await vi.advanceTimersByTimeAsync(expectedTimeout - 1);
      expect(button.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(button.disabled).toBe(false);
    }
  );

  it('uses fallback initialization when embedded state is malformed', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { error, runReady } = setupDom({
      forms: [form],
      stateText: '{bad json',
    });
    await import('../../../src/assets/js/auth/email-verification.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[EmailVerificationManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(form.triggerSubmit().preventDefault).toHaveBeenCalledOnce();
  });

  it('uses fallback initialization when embedded state is absent', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { error, runReady } = setupDom({ forms: [form], stateText: null });
    await import('../../../src/assets/js/auth/email-verification.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[EmailVerificationManager] No configuration data found in DOM'
    );
    expect(form.triggerSubmit().preventDefault).toHaveBeenCalledOnce();
  });

  it('uses defaults for an empty embedded state document', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { runReady } = setupDom({ forms: [form], stateText: '' });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    expect(form.triggerSubmit().preventDefault).toHaveBeenCalledOnce();
  });

  it.each([{ stateText: '{bad json' }, { stateText: null }])(
    'reports fallback initialization failure for state %#',
    async scenario => {
      const queryError = new Error('DOM query failed');
      const { error, runReady } = setupDom({ ...scenario, queryError });
      await import('../../../src/assets/js/auth/email-verification.js');

      expect(runReady).not.toThrow();
      expect(error).toHaveBeenCalledWith(
        '[EmailVerificationManager] Fallback initialization failed:',
        queryError
      );
    }
  );

  it('logs lifecycle details when debug mode is enabled', async () => {
    const button = new ButtonFixture();
    const form = new FormFixture('/verification/request', button);
    const { log, runReady } = setupDom({
      forms: [form],
      stateText: JSON.stringify({
        config: {
          debug: true,
          enableLoadingStates: true,
          errorRecoveryTimeout: 120000,
        },
      }),
    });
    await import('../../../src/assets/js/auth/email-verification.js');
    runReady();

    form.triggerSubmit();

    expect(log).toHaveBeenCalledWith(
      '[EmailVerificationManager]',
      'EmailVerificationManager initialized',
      expect.any(Object)
    );
    expect(log).toHaveBeenCalledWith(
      '[EmailVerificationManager]',
      'Form submission detected',
      expect.any(Object)
    );
  });
});
