import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormEventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
}

class InputFixture {
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public parentNode: {
    insertBefore: ReturnType<typeof vi.fn>;
    lastElementChild: unknown;
  } | null = null;
  public value = '';
  private readonly listeners = new Map<string, Array<() => void>>();

  public addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public trigger(name: string): void {
    this.listeners.get(name)?.forEach(listener => listener());
  }

  public listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0;
  }
}

class ButtonFixture {
  public disabled = false;
  public innerHTML = '';
}

class FormFixture {
  private submitListener?: (event: FormEventFixture) => void;

  constructor(public readonly button: ButtonFixture | null) {}

  public addEventListener(
    name: string,
    listener: (event: FormEventFixture) => void
  ): void {
    if (name === 'submit') this.submitListener = listener;
  }

  public querySelector(selector: string): ButtonFixture | null {
    return selector === 'button[type="submit"]' ? this.button : null;
  }

  public submit(): FormEventFixture {
    const event = { preventDefault: vi.fn() };
    this.submitListener?.(event);
    return event;
  }
}

class ErrorElementFixture {
  public className = '';
  public id = '';
  public readonly remove = vi.fn();
  public textContent = '';
}

function setupDom(
  options: {
    button?: ButtonFixture | null;
    email?: InputFixture | null;
    form?: FormFixture | null;
    queryError?: Error;
    stateText?: string | null;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  let validationError: ErrorElementFixture | null = null;
  const alert = vi.fn();
  const button =
    options.button === undefined ? new ButtonFixture() : options.button;
  const email =
    options.email === undefined ? new InputFixture() : options.email;
  const form =
    options.form === undefined ? new FormFixture(button) : options.form;
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({
          config: {
            emailValidationTimeout: 300,
            enableEmailValidation: true,
          },
        })
      : options.stateText;

  if (email) {
    email.parentNode = {
      insertBefore: vi.fn((element: ErrorElementFixture) => {
        validationError = element;
      }),
      lastElementChild: {},
    };
  }

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    createElement: vi.fn(() => {
      const element = new ErrorElementFixture();
      element.remove.mockImplementation(() => {
        if (validationError === element) validationError = null;
      });
      return element;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === '___FORGOT_PASSWORD_STATE___') {
        return stateText === null ? null : { textContent: stateText };
      }
      if (id === 'email') return email;
      if (id === 'email-error-message') return validationError;
      return null;
    }),
    querySelector: vi.fn((selector: string) => {
      if (options.queryError) throw options.queryError;
      return selector === 'form' ? form : null;
    }),
  });

  return {
    alert,
    button,
    email,
    error,
    form,
    getValidationError: () => validationError,
    log,
    runReady: () => ready?.(),
    warn,
  };
}

describe('forgot password manager', () => {
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
      import('../../../src/assets/js/auth/forgot-password.js')
    ).resolves.toBeDefined();
  });

  it.each([
    { button: null, email: new InputFixture(), form: undefined },
    { button: undefined, email: null, form: undefined },
    { button: undefined, email: new InputFixture(), form: null },
  ])(
    'stops safely when a required form control is absent: %#',
    async options => {
      const { error, runReady } = setupDom(options);
      await import('../../../src/assets/js/auth/forgot-password.js');

      expect(runReady).not.toThrow();
      expect(error).toHaveBeenCalledWith(
        '[ForgotPasswordManager]',
        'Required form elements not found'
      );
    }
  );

  it.each(['', '   '])('blocks a blank email submission: %j', async value => {
    const context = setupDom();
    if (!context.email || !context.form) throw new Error('fixture unavailable');
    context.email.value = value;
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    const event = context.form.submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
    expect(context.button?.disabled).toBe(false);
  });

  it('allows a valid submission and renders a valid loading spinner', async () => {
    const context = setupDom({
      stateText: JSON.stringify({
        config: {
          emailValidationTimeout: 300,
          enableEmailValidation: true,
        },
        translations: { sendingResetLink: 'Sending reset email...' },
      }),
    });
    if (!context.email || !context.form || !context.button) {
      throw new Error('fixture unavailable');
    }
    context.email.value = 'person@example.com';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    const event = context.form.submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.alert).not.toHaveBeenCalled();
    expect(context.button.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Sending reset email...');
    expect(context.button.innerHTML).toContain('0 014 12H0');
  });

  it('shows an invalid-email error on blur and clears it after correction', async () => {
    const context = setupDom();
    if (!context.email) throw new Error('fixture unavailable');
    context.email.value = 'invalid';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    context.email.trigger('blur');

    const errorElement = context.getValidationError();
    expect(errorElement?.id).toBe('email-error-message');
    expect(errorElement?.textContent).toBe(
      'Please enter a valid email address'
    );
    expect(context.email.classList.add).toHaveBeenCalledWith(
      'border-red-500',
      'focus:border-red-500',
      'focus:ring-red-500'
    );

    context.email.value = 'person@example.com';
    context.email.trigger('blur');

    expect(errorElement?.remove).toHaveBeenCalledOnce();
    expect(context.getValidationError()).toBeNull();
    expect(context.email.classList.add).toHaveBeenCalledWith(
      'border-gray-200',
      'dark:border-gray-600',
      'focus:border-primary/30',
      'focus:ring-primary/20'
    );
  });

  it('debounces validation and validates only the latest input value', async () => {
    const context = setupDom();
    if (!context.email) throw new Error('fixture unavailable');
    context.email.value = 'invalid';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    context.email.trigger('input');
    await vi.advanceTimersByTimeAsync(299);
    expect(context.getValidationError()).toBeNull();

    context.email.value = 'person@example.com';
    context.email.trigger('input');
    await vi.advanceTimersByTimeAsync(300);

    expect(context.getValidationError()).toBeNull();
    expect(context.email.classList.add).toHaveBeenCalledWith(
      'border-gray-200',
      'dark:border-gray-600',
      'focus:border-primary/30',
      'focus:ring-primary/20'
    );
  });

  it('clamps a too-short validation delay to one hundred milliseconds', async () => {
    const context = setupDom({
      stateText: JSON.stringify({
        config: {
          emailValidationTimeout: 1,
          enableEmailValidation: true,
        },
      }),
    });
    if (!context.email) throw new Error('fixture unavailable');
    context.email.value = 'invalid';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    context.email.trigger('input');
    await vi.advanceTimersByTimeAsync(99);
    expect(context.getValidationError()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(context.getValidationError()).not.toBeNull();
  });

  it('omits validation listeners when email validation is disabled', async () => {
    const context = setupDom({
      stateText: JSON.stringify({
        config: {
          emailValidationTimeout: 300,
          enableEmailValidation: false,
        },
      }),
    });
    if (!context.email) throw new Error('fixture unavailable');
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    expect(context.email.listenerCount('input')).toBe(0);
    expect(context.email.listenerCount('blur')).toBe(1);
  });

  it('adds and removes focus animation classes', async () => {
    const context = setupDom();
    if (!context.email) throw new Error('fixture unavailable');
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    context.email.trigger('focus');
    context.email.trigger('blur');

    expect(context.email.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(context.email.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it.each([null, '', 7])(
    'falls back when invalid-email translation copy is unusable: %j',
    async translation => {
      const context = setupDom({
        stateText: JSON.stringify({
          config: {
            emailValidationTimeout: 300,
            enableEmailValidation: true,
          },
          translations: { emailInvalid: translation },
        }),
      });
      if (!context.email) throw new Error('fixture unavailable');
      context.email.value = 'invalid';
      await import('../../../src/assets/js/auth/forgot-password.js');
      context.runReady();

      expect(() => context.email?.trigger('blur')).not.toThrow();
      expect(context.getValidationError()?.textContent).toBe(
        'Please enter a valid email address'
      );
    }
  );

  it('uses secure validation defaults when embedded config is an array', async () => {
    const context = setupDom({ stateText: JSON.stringify({ config: [] }) });
    if (!context.email) throw new Error('fixture unavailable');
    await import('../../../src/assets/js/auth/forgot-password.js');

    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[ForgotPasswordManager]',
      'Invalid config provided, using defaults',
      { config: [] }
    );
    expect(context.email.listenerCount('input')).toBe(1);
  });

  it('uses secure validation defaults when embedded config has the wrong type', async () => {
    const context = setupDom({
      stateText: JSON.stringify({ config: 'invalid' }),
    });
    if (!context.email) throw new Error('fixture unavailable');
    await import('../../../src/assets/js/auth/forgot-password.js');

    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[ForgotPasswordManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
    expect(context.email.listenerCount('input')).toBe(1);
  });

  it('falls back when invalid-email copy is still a translation key', async () => {
    const context = setupDom({
      stateText: JSON.stringify({
        config: {
          emailValidationTimeout: 300,
          enableEmailValidation: true,
        },
        translations: { emailInvalid: 'auth.emailInvalid' },
      }),
    });
    if (!context.email) throw new Error('fixture unavailable');
    context.email.value = 'invalid';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    context.email.trigger('blur');

    expect(context.getValidationError()?.textContent).toBe(
      'Please enter a valid email address'
    );
    expect(context.warn).toHaveBeenCalledWith(
      '[ForgotPasswordManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it('keeps long dotted validation copy as literal text', async () => {
    const translation = `Invalid.email ${'x'.repeat(60)}`;
    const context = setupDom({
      stateText: JSON.stringify({
        config: {
          emailValidationTimeout: 300,
          enableEmailValidation: true,
        },
        translations: { emailInvalid: translation },
      }),
    });
    if (!context.email) throw new Error('fixture unavailable');
    context.email.value = 'invalid';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    context.email.trigger('blur');

    expect(context.getValidationError()?.textContent).toBe(translation);
  });

  it.each([
    { expectedDelay: 2000, timeout: 5000 },
    { expectedDelay: 300, timeout: 'invalid' },
  ])(
    'normalizes validation timeout $timeout to $expectedDelay milliseconds',
    async ({ expectedDelay, timeout }) => {
      const context = setupDom({
        stateText: JSON.stringify({
          config: {
            emailValidationTimeout: timeout,
            enableEmailValidation: true,
          },
        }),
      });
      if (!context.email) throw new Error('fixture unavailable');
      context.email.value = 'invalid';
      await import('../../../src/assets/js/auth/forgot-password.js');
      context.runReady();

      context.email.trigger('input');
      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(context.getValidationError()).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(context.getValidationError()).not.toBeNull();
    }
  );

  it('validates safely when the email input has no parent node', async () => {
    const context = setupDom();
    if (!context.email) throw new Error('fixture unavailable');
    context.email.parentNode = null;
    context.email.value = 'invalid';
    await import('../../../src/assets/js/auth/forgot-password.js');
    context.runReady();

    expect(() => context.email?.trigger('blur')).not.toThrow();
    expect(context.getValidationError()).toBeNull();
  });

  it('uses fallback initialization when embedded state is malformed', async () => {
    const context = setupDom({ stateText: '{bad json' });
    await import('../../../src/assets/js/auth/forgot-password.js');

    expect(context.runReady).not.toThrow();
    expect(context.error).toHaveBeenCalledWith(
      '[ForgotPasswordManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(context.email?.listenerCount('input')).toBe(1);
  });

  it('uses fallback initialization when embedded state is absent', async () => {
    const context = setupDom({ stateText: null });
    await import('../../../src/assets/js/auth/forgot-password.js');

    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[ForgotPasswordManager] No configuration data found in DOM'
    );
    expect(context.email?.listenerCount('input')).toBe(1);
  });

  it('uses defaults for an empty embedded state document', async () => {
    const context = setupDom({ stateText: '' });
    await import('../../../src/assets/js/auth/forgot-password.js');

    context.runReady();

    expect(context.email?.listenerCount('input')).toBe(1);
  });

  it.each([{ stateText: '{bad json' }, { stateText: null }])(
    'reports fallback initialization failure for state %#',
    async scenario => {
      const queryError = new Error('DOM query failed');
      const context = setupDom({ ...scenario, queryError });
      await import('../../../src/assets/js/auth/forgot-password.js');

      expect(context.runReady).not.toThrow();
      expect(context.error).toHaveBeenCalledWith(
        '[ForgotPasswordManager] Fallback initialization failed:',
        queryError
      );
    }
  );

  it('logs lifecycle details when debug mode is enabled', async () => {
    const context = setupDom({
      stateText: JSON.stringify({
        config: {
          debug: true,
          emailValidationTimeout: 300,
          enableEmailValidation: true,
        },
      }),
    });
    await import('../../../src/assets/js/auth/forgot-password.js');

    context.runReady();

    expect(context.log).toHaveBeenCalledWith(
      '[ForgotPasswordManager]',
      'ForgotPasswordManager initialized',
      expect.any(Object)
    );
  });
});
