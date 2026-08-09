import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

class ElementFixture {
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public readonly listeners = new Map<
    string,
    Array<(event?: EventFixture) => void>
  >();
  public parentElement: ElementFixture | null = null;

  public addEventListener(
    name: string,
    listener: (event?: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public trigger(name: string, event?: EventFixture): void {
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
  }

  public listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0;
  }
}

class InputFixture extends ElementFixture {
  public readonly focus = vi.fn();
  public validationMessage: unknown = '';
  public value = '';

  public setCustomValidity(message: unknown): void {
    this.validationMessage = message;
  }
}

class ButtonFixture extends ElementFixture {
  public disabled = false;
  public innerHTML = '';
  public readonly style = {
    cursor: '',
    opacity: '',
    pointerEvents: '',
  };
}

class FormFixture extends ElementFixture {
  public readonly nativeSubmit = vi.fn();
  public readonly style = { pointerEvents: '' };

  public constructor(private readonly button: ButtonFixture | null) {
    super();
  }

  public querySelector(selector: string): ButtonFixture | null {
    return selector === 'button[type="submit"]' ? this.button : null;
  }

  public submit(): void {
    this.nativeSubmit();
  }

  public dispatchSubmit(): EventFixture {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    this.trigger('submit', event);
    return event;
  }
}

function setupDom(
  state: Record<string, unknown>,
  options: {
    hasButton?: boolean;
    hasEmail?: boolean;
    hasForm?: boolean;
    hasPhone?: boolean;
    hasState?: boolean;
    querySelectorError?: Error;
    rawState?: string;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const alert = vi.fn();
  const button = new ButtonFixture();
  const email = new InputFixture();
  const phone = new InputFixture();
  const form = new FormFixture(options.hasButton === false ? null : button);

  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === '___SOCIAL_CONTACT_INFO_STATE___') {
        return options.hasState === false
          ? null
          : { textContent: options.rawState ?? JSON.stringify(state) };
      }
      if (id === 'email') return options.hasEmail === false ? null : email;
      if (id === 'phone_number') {
        return options.hasPhone === false ? null : phone;
      }
      return null;
    }),
    querySelector: vi.fn((selector: string) => {
      if (options.querySelectorError) throw options.querySelectorError;
      return selector === 'form' && options.hasForm !== false ? form : null;
    }),
    querySelectorAll: vi.fn(() =>
      [
        options.hasEmail === false ? null : email,
        options.hasPhone === false ? null : phone,
      ].filter(Boolean)
    ),
  });

  return {
    alert,
    button,
    email,
    error,
    form,
    log,
    phone,
    runReady: () => ready?.(),
    warn,
  };
}

describe('social contact information manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when a translation is not a string', async () => {
    const context = setupDom({
      config: {
        allowBoth: true,
        emailPlaceholder: 'Email',
        phonePlaceholder: 'Phone',
        requireEmail: true,
        requirePhone: false,
      },
      translations: { emailInvalid: 42 },
    });
    context.email.value = 'invalid';

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();
    context.email.trigger('input');

    expect(context.email.validationMessage).toBe(
      'Please enter a valid email address'
    );
  });

  it('falls back safely when a translation is blank', async () => {
    const context = setupDom({
      config: { requireEmail: false, requirePhone: false },
      translations: { phoneInvalid: '   ' },
    });
    context.phone.value = '000';

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();
    context.phone.trigger('input');

    expect(context.phone.validationMessage).toBe(
      'Please enter a valid phone number'
    );
  });

  it('marks malformed contact values invalid and clears them after correction', async () => {
    const context = setupDom({
      config: {
        allowBoth: true,
        requireEmail: false,
        requirePhone: false,
      },
      translations: {
        emailInvalid: 'Email is malformed',
        phoneInvalid: 'Phone is malformed',
      },
    });

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();

    context.email.value = 'invalid';
    context.email.trigger('input');
    expect(context.email.validationMessage).toBe('Email is malformed');
    expect(context.email.classList.add).toHaveBeenCalledWith(
      'border-red-500',
      'focus:border-red-500',
      'focus:ring-red-500'
    );

    context.email.value = 'person@example.com';
    context.email.trigger('input');
    expect(context.email.validationMessage).toBe('');
    expect(context.email.classList.remove).toHaveBeenCalledWith(
      'border-red-500',
      'focus:border-red-500',
      'focus:ring-red-500'
    );

    context.phone.value = '000';
    context.phone.trigger('input');
    expect(context.phone.validationMessage).toBe('Phone is malformed');
    expect(context.phone.classList.add).toHaveBeenCalledWith(
      'border-red-500',
      'focus:border-red-500',
      'focus:ring-red-500'
    );

    context.phone.value = '+1 (555) 123-4567';
    context.phone.trigger('input');
    expect(context.phone.validationMessage).toBe('');
    expect(context.phone.classList.remove).toHaveBeenCalledWith(
      'border-red-500',
      'focus:border-red-500',
      'focus:ring-red-500'
    );
  });

  it.each([
    {
      config: { requireEmail: false, requirePhone: false },
      email: '',
      expected: 'Please provide either an email address or phone number',
      focus: null,
      phone: '',
    },
    {
      config: { requireEmail: true, requirePhone: false },
      email: '',
      expected: 'Please enter your email address',
      focus: 'email',
      phone: '+15551234567',
    },
    {
      config: { requireEmail: false, requirePhone: true },
      email: 'person@example.com',
      expected: 'Please enter your phone number',
      focus: 'phone',
      phone: '',
    },
    {
      config: { requireEmail: false, requirePhone: false },
      email: 'invalid',
      expected: 'Please enter a valid email address',
      focus: 'email',
      phone: '',
    },
    {
      config: { requireEmail: false, requirePhone: false },
      email: '',
      expected: 'Please enter a valid phone number',
      focus: 'phone',
      phone: '000',
    },
  ])(
    'blocks invalid submission: $expected',
    async ({ config, email, expected, focus, phone }) => {
      const context = setupDom({
        config: { allowBoth: true, ...config },
      });
      context.email.value = email;
      context.phone.value = phone;

      await import('../../../src/assets/js/auth/social-contact-info.js');
      context.runReady();
      const event = context.form.dispatchSubmit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(context.alert).toHaveBeenCalledWith(expected);
      expect(context.button.disabled).toBe(false);
      expect(context.email.focus).toHaveBeenCalledTimes(
        focus === 'email' ? 1 : 0
      );
      expect(context.phone.focus).toHaveBeenCalledTimes(
        focus === 'phone' ? 1 : 0
      );
    }
  );

  it('submits valid contact data once and restores interaction after timeout', async () => {
    const context = setupDom({
      config: {
        allowBoth: true,
        errorRecoveryTimeout: 250,
        requireEmail: true,
        requirePhone: true,
      },
      translations: {
        completeRegistration: 'Complete profile',
        completingRegistration: 'Saving profile...',
        errorRecovery: 'Please retry',
      },
    });
    context.email.value = 'person@example.com';
    context.phone.value = '+1 (555) 123-4567';

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();

    const firstEvent = context.form.dispatchSubmit();
    const duplicateEvent = context.form.dispatchSubmit();

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Saving profile...');
    expect(context.form.style.pointerEvents).toBe('none');
    expect(context.form.classList.add).toHaveBeenCalledWith('form-disabled');

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(150);
    expect(context.alert).toHaveBeenCalledWith('Please retry');
    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toBe('Complete profile');
    expect(context.button.style).toEqual({
      cursor: 'pointer',
      opacity: '1',
      pointerEvents: 'auto',
    });
    expect(context.form.style.pointerEvents).toBe('auto');
    expect(context.form.classList.remove).toHaveBeenCalledWith('form-disabled');
  });

  it('animates the input container on focus and tolerates detached inputs', async () => {
    const context = setupDom({ config: {} });
    const emailContainer = new ElementFixture();
    context.email.parentElement = emailContainer;

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();

    context.email.trigger('focus');
    context.email.trigger('blur');
    context.phone.trigger('focus');
    context.phone.trigger('blur');

    expect(emailContainer.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(emailContainer.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it.each([
    { options: { rawState: '{' }, expectedLog: 'Failed to initialize:' },
    {
      options: { hasState: false },
      expectedLog: 'No configuration data found in DOM',
    },
  ])(
    'uses the default form behavior when embedded state is unavailable: $expectedLog',
    async ({ expectedLog, options }) => {
      const context = setupDom({}, options);
      context.phone.value = '+15551234567';

      await import('../../../src/assets/js/auth/social-contact-info.js');
      context.runReady();
      context.form.dispatchSubmit();

      expect(context.error).toHaveBeenCalledWith(
        expect.stringContaining(expectedLog),
        ...((expectedLog === 'Failed to initialize:'
          ? [expect.any(SyntaxError)]
          : []) as unknown[])
      );
      expect(context.alert).toHaveBeenCalledWith(
        'Please enter your email address'
      );
    }
  );

  it.each([
    { hasState: true, rawState: '{' },
    { hasState: false, rawState: undefined },
  ])(
    'contains a DOM failure during fallback initialization: %#',
    async ({ hasState, rawState }) => {
      const queryError = new Error('DOM unavailable');
      const context = setupDom(
        {},
        { hasState, querySelectorError: queryError, rawState }
      );

      await import('../../../src/assets/js/auth/social-contact-info.js');

      expect(context.runReady).not.toThrow();
      expect(context.error).toHaveBeenCalledWith(
        '[SocialContactInfoManager] Fallback initialization failed:',
        queryError
      );
    }
  );

  it('normalizes invalid configuration and translation-key placeholders', async () => {
    const longLocalizedMessage =
      'localized.validation.message.with.enough.segments.to.exceed.the.key.limit';
    const context = setupDom({
      config: 'invalid',
      translations: {
        emailInvalid: longLocalizedMessage,
        emailRequired: 'auth.emailRequired',
      },
    });
    context.phone.value = '+15551234567';

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();
    context.form.dispatchSubmit();

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
    expect(context.warn).toHaveBeenCalledWith(
      '[SocialContactInfoManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
    expect(context.warn).toHaveBeenCalledWith(
      '[SocialContactInfoManager]',
      expect.stringContaining("Translation key detected for 'emailRequired'")
    );

    context.email.value = 'invalid';
    context.email.trigger('input');
    expect(context.email.validationMessage).toBe(longLocalizedMessage);
  });

  it.each([{ hasForm: false }, { hasButton: false }])(
    'does not attach submission handling when a required form element is absent: %#',
    async options => {
      const context = setupDom({ config: {} }, options);

      await import('../../../src/assets/js/auth/social-contact-info.js');
      context.runReady();

      expect(context.form.listenerCount('submit')).toBe(0);
      expect(context.email.listenerCount('input')).toBe(1);
      expect(context.phone.listenerCount('input')).toBe(1);
    }
  );

  it.each([
    {
      options: { hasEmail: false },
      state: { config: { requireEmail: false, requirePhone: true } },
      value: 'phone',
    },
    {
      options: { hasPhone: false },
      state: { config: { requireEmail: true, requirePhone: false } },
      value: 'email',
    },
  ])(
    'submits with the available required contact input: $value',
    async ({ options, state }) => {
      const context = setupDom(state, options);
      context.email.value = 'person@example.com';
      context.phone.value = '+15551234567';

      await import('../../../src/assets/js/auth/social-contact-info.js');
      context.runReady();
      context.form.dispatchSubmit();
      vi.advanceTimersByTime(100);

      expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
      expect(context.alert).not.toHaveBeenCalled();
      expect(context.email.listenerCount('input')).toBe(
        options.hasEmail === false ? 0 : 1
      );
      expect(context.phone.listenerCount('input')).toBe(
        options.hasPhone === false ? 0 : 1
      );
    }
  );

  it.each([
    {
      expected: 'Please enter your email address',
      options: { hasEmail: false },
      state: { config: { requireEmail: true, requirePhone: false } },
    },
    {
      expected: 'Please enter your phone number',
      options: { hasPhone: false },
      state: { config: { requireEmail: false, requirePhone: true } },
    },
  ])(
    'reports a missing required input without trying to focus it: $expected',
    async ({ expected, options, state }) => {
      const context = setupDom(state, options);
      context.email.value = 'person@example.com';
      context.phone.value = '+15551234567';

      await import('../../../src/assets/js/auth/social-contact-info.js');
      context.runReady();
      context.form.dispatchSubmit();

      expect(context.alert).toHaveBeenCalledWith(expected);
      expect(context.email.focus).not.toHaveBeenCalled();
      expect(context.phone.focus).not.toHaveBeenCalled();
    }
  );

  it('uses default state when the embedded state element is empty', async () => {
    const context = setupDom({}, { rawState: '' });
    context.phone.value = '+15551234567';

    await import('../../../src/assets/js/auth/social-contact-info.js');
    context.runReady();
    context.form.dispatchSubmit();

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });
});
