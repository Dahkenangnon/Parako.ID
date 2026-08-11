import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  target?: ElementFixture;
}

class ClassListFixture {
  private readonly values = new Set<string>();
  public readonly add = vi.fn((...names: string[]) => {
    names.forEach(name => this.values.add(name));
  });
  public readonly remove = vi.fn((...names: string[]) => {
    names.forEach(name => this.values.delete(name));
  });

  public contains(name: string): boolean {
    return this.values.has(name);
  }
}

class ElementFixture {
  public readonly appendChild = vi.fn();
  public readonly classList = new ClassListFixture();
  public readonly focus = vi.fn();
  public readonly style: Record<string, string> = {};
  public className = '';
  public disabled = false;
  public innerHTML = '';
  public parentElement: ElementFixture | null = null;
  public textContent = '';
  public value = '';
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  private svg: ElementFixture | null = null;

  public addEventListener(
    name: string,
    listener: (event: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public closest(selector: string): ElementFixture | null {
    return selector === 'button[data-provider]' ? this : null;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public querySelector(selector: string): ElementFixture | null {
    return selector === 'svg' ? this.svg : null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public setSvg(svg: ElementFixture | null): void {
    this.svg = svg;
  }

  public trigger(
    name: string,
    event: EventFixture = eventFixture()
  ): EventFixture {
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
    return event;
  }
}

class FormFixture extends ElementFixture {
  public readonly submitNative = vi.fn();

  constructor(public readonly submitButton: ElementFixture | null) {
    super();
  }

  public override querySelector(selector: string): ElementFixture | null {
    return selector === 'button[type="submit"]' ? this.submitButton : null;
  }

  public submit(): void {
    this.submitNative();
  }
}

function eventFixture(target?: ElementFixture): EventFixture {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target,
  };
}

const defaultConfig = {
  bothMethodsEnabled: false,
  customIdentifiers: [],
  emailEnabled: true,
  phoneEnabled: false,
};

function setupDom(
  options: {
    config?: Record<string, unknown>;
    form?: FormFixture | null;
    missingElementIds?: string[];
    queryError?: Error;
    search?: string;
    socialButtons?: ElementFixture[];
    stateText?: string | null;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const alert = vi.fn();
  const email = new ElementFixture();
  const emailField = new ElementFixture();
  const emailTab = new ElementFixture();
  const password = new ElementFixture();
  const phone = new ElementFixture();
  const phoneField = new ElementFixture();
  const phoneTab = new ElementFixture();
  const togglePassword = new ElementFixture();
  const submitButton = new ElementFixture();
  const form =
    options.form === undefined ? new FormFixture(submitButton) : options.form;
  const elements: Record<string, ElementFixture> = {
    email,
    'email-field': emailField,
    'email-tab': emailTab,
    password,
    phone,
    'phone-field': phoneField,
    'phone-tab': phoneTab,
    'toggle-password': togglePassword,
  };
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({ config: options.config ?? defaultConfig })
      : options.stateText;
  const location = {
    href: 'https://id.example.test/auth/login',
    origin: 'https://id.example.test',
    search: options.search ?? '',
  };
  const missingElementIds = new Set(options.missingElementIds ?? []);

  email.setAttribute('type', 'email');
  password.setAttribute('type', 'password');
  phone.setAttribute('type', 'tel');
  email.parentElement = new ElementFixture();
  password.parentElement = new ElementFixture();
  phone.parentElement = new ElementFixture();

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', {
    location,
    setTimeout,
  });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    createElement: vi.fn(() => new ElementFixture()),
    createTextNode: vi.fn((text: string) => ({ textContent: text })),
    getElementById: vi.fn((id: string) => {
      if (id === '___LOGIN_STATE___') {
        return stateText === null ? null : { textContent: stateText };
      }
      if (missingElementIds.has(id)) return null;
      return elements[id] ?? null;
    }),
    querySelector: vi.fn(() => {
      if (options.queryError) throw options.queryError;
      return form;
    }),
    querySelectorAll: vi.fn((selector: string) =>
      selector === 'button[data-provider]'
        ? (options.socialButtons ?? [])
        : [email, phone, password]
    ),
  });

  return {
    alert,
    email,
    emailField,
    emailTab,
    error,
    form,
    log,
    location,
    password,
    phone,
    phoneField,
    phoneTab,
    runReady: () => ready?.(),
    submitButton,
    togglePassword,
    warn,
  };
}

describe('login manager', () => {
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
      import('../../../src/assets/js/auth/login.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the login form is absent', async () => {
    const { runReady } = setupDom({ form: null });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
  });

  it('initializes safely when the login form has no submit button', async () => {
    const { runReady } = setupDom({ form: new FormFixture(null) });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
  });

  it('initializes safely when a single-method email input is absent', async () => {
    const { runReady } = setupDom({ missingElementIds: ['email'] });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
  });

  it('initializes safely when a single-method phone input is absent', async () => {
    const { runReady } = setupDom({
      config: {
        ...defaultConfig,
        emailEnabled: false,
        phoneEnabled: true,
      },
      missingElementIds: ['phone'],
    });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
  });

  it('rejects a whitespace-only email before submitting', async () => {
    const { alert, email, form, password, runReady } = setupDom();
    email.value = '   ';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    const event = form!.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Please enter your email address');
    expect(email.focus).toHaveBeenCalledOnce();
  });

  it('rejects a whitespace-only phone number before submitting', async () => {
    const { alert, form, password, phone, runReady } = setupDom({
      config: {
        ...defaultConfig,
        emailEnabled: false,
        phoneEnabled: true,
      },
    });
    phone.value = '   ';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    const event = form!.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Please enter your phone number');
    expect(phone.focus).toHaveBeenCalledOnce();
  });

  it('rejects a whitespace-only active phone number when both methods are enabled', async () => {
    const { alert, emailField, form, password, phone, phoneField, runReady } =
      setupDom({
        config: {
          ...defaultConfig,
          bothMethodsEnabled: true,
          phoneEnabled: true,
        },
      });
    emailField.classList.add('hidden');
    phoneField.classList.remove('hidden');
    phone.value = '   ';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    const event = form!.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Please enter your phone number');
    expect(phone.focus).toHaveBeenCalledOnce();
  });

  it('rejects an empty active email when both methods are enabled', async () => {
    const { alert, email, form, password, phoneField, runReady } = setupDom({
      config: {
        ...defaultConfig,
        bothMethodsEnabled: true,
        phoneEnabled: true,
      },
    });
    phoneField.classList.add('hidden');
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    form!.trigger('submit');

    expect(alert).toHaveBeenCalledWith('Please enter your email address');
    expect(email.focus).toHaveBeenCalledOnce();
  });

  it('rejects a whitespace-only password before submitting', async () => {
    const { alert, email, form, password, runReady } = setupDom();
    email.value = 'user@example.test';
    password.value = '   ';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    const event = form!.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Please enter your password');
  });

  it('shows loading state and performs one native submission for valid credentials', async () => {
    const { email, form, password, runReady, submitButton } = setupDom();
    email.value = 'user@example.test';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    const first = form!.trigger('submit');
    const duplicate = form!.trigger('submit');

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(first.stopPropagation).not.toHaveBeenCalled();
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopPropagation).toHaveBeenCalledOnce();
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.innerHTML).toContain('Signing in...');
    expect(submitButton.innerHTML).toContain('A7.962 7.962 0 0 1 4 12H0');

    await vi.advanceTimersByTimeAsync(99);
    expect(form!.submitNative).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(form!.submitNative).toHaveBeenCalledOnce();
  });

  it('blocks login-method switching while a submission is active', async () => {
    const { email, emailTab, form, password, phoneField, phoneTab, runReady } =
      setupDom({
        config: {
          ...defaultConfig,
          bothMethodsEnabled: true,
          phoneEnabled: true,
        },
      });
    email.value = 'user@example.test';
    password.value = 'correct horse battery staple';
    phoneField.classList.add('hidden');
    await import('../../../src/assets/js/auth/login.js');
    runReady();
    form!.trigger('submit');

    const emailEvent = emailTab.trigger('click');
    const phoneEvent = phoneTab.trigger('click');

    expect(emailEvent.preventDefault).toHaveBeenCalledOnce();
    expect(emailEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(phoneEvent.preventDefault).toHaveBeenCalledOnce();
    expect(phoneEvent.stopPropagation).toHaveBeenCalledOnce();
  });

  it('does not forward a protocol-relative continue URL to social login', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google');
    const { location, runReady } = setupDom({
      search: '?continue=%2F%2Fevil.example.test%2Fcallback',
      socialButtons: [socialButton],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/auth/social/google/login'
    );
  });

  it('renders a valid loading spinner for social login', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'github');
    const { runReady } = setupDom({ socialButtons: [socialButton] });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));

    const spinner = socialButton.appendChild.mock.calls[0]?.[0] as
      ElementFixture | undefined;
    const path = spinner?.appendChild.mock.calls[1]?.[0] as
      ElementFixture | undefined;
    expect(path?.getAttribute('d')).toContain('M4 12a8 8 0 0 1 8-8V0');
    expect(path?.getAttribute('d')).toContain('A7.962 7.962 0 0 1 4 12H0');
  });

  it('ignores social-login clicks without an element target', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'github');
    const { location, runReady } = setupDom({ socialButtons: [socialButton] });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    expect(() => socialButton.trigger('click', eventFixture())).not.toThrow();
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe('https://id.example.test/auth/login');
  });

  it('rejects provider identifiers instead of rewriting them', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google<script>');
    const { location, runReady, warn } = setupDom({
      socialButtons: [socialButton],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe('https://id.example.test/auth/login');
    expect(socialButton.disabled).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[LoginManager]',
      'Invalid provider parameter',
      { provider: 'google<script>' }
    );
  });

  it('ignores a social-login button without a provider identifier', async () => {
    const socialButton = new ElementFixture();
    const { location, runReady } = setupDom({ socialButtons: [socialButton] });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe('https://id.example.test/auth/login');
    expect(socialButton.disabled).toBe(false);
  });

  it('forwards a same-origin continue URL to social login', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google');
    const { location, runReady } = setupDom({
      search: '?continue=%2Faccounts',
      socialButtons: [socialButton],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/auth/social/google/login?continue=%2Faccounts'
    );
  });

  it('uses a valid redirectTo fallback for social login', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'github');
    const { location, runReady } = setupDom({
      search: '?redirectTo=%2Fadmin',
      socialButtons: [socialButton],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/auth/social/github/login?continue=%2Fadmin'
    );
  });

  it('ignores a malformed continue URL for social login', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google');
    const { location, runReady } = setupDom({
      search: '?continue=http%3A%2F%2F%5B',
      socialButtons: [socialButton],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/auth/social/google/login'
    );
  });

  it('ignores duplicate social-login clicks while redirecting', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google');
    const { runReady } = setupDom({ socialButtons: [socialButton] });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    socialButton.trigger('click', eventFixture(socialButton));

    expect(document.createTextNode).toHaveBeenCalledOnce();
  });

  it('recovers from invalid social login with optional form controls absent', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'invalid!');
    const { runReady } = setupDom({
      form: null,
      missingElementIds: ['email-tab', 'phone-tab'],
      socialButtons: [socialButton],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));
    await vi.advanceTimersByTimeAsync(100);

    expect(socialButton.disabled).toBe(false);
  });

  it('switches between enabled email and phone login methods', async () => {
    const {
      email,
      emailField,
      emailTab,
      phone,
      phoneField,
      phoneTab,
      runReady,
    } = setupDom({
      config: {
        ...defaultConfig,
        bothMethodsEnabled: true,
        phoneEnabled: true,
      },
    });
    email.value = 'old@example.test';
    phone.value = 'old phone';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    phoneTab.trigger('click');

    expect(phone.disabled).toBe(false);
    expect(email.disabled).toBe(true);
    expect(email.value).toBe('');
    expect(phoneField.classList.remove).toHaveBeenCalledWith('hidden');
    expect(emailField.classList.add).toHaveBeenCalledWith('hidden');

    emailTab.trigger('click');

    expect(email.disabled).toBe(false);
    expect(phone.disabled).toBe(true);
    expect(phone.value).toBe('');
    expect(emailField.classList.remove).toHaveBeenCalledWith('hidden');
    expect(phoneField.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('switches to email when optional phone controls are absent', async () => {
    const { emailTab, runReady } = setupDom({
      config: {
        ...defaultConfig,
        bothMethodsEnabled: true,
        phoneEnabled: true,
      },
      missingElementIds: [
        'email',
        'email-field',
        'phone',
        'phone-field',
        'phone-tab',
      ],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    expect(() => emailTab.trigger('click')).not.toThrow();
  });

  it('switches to phone when optional email controls are absent', async () => {
    const { phoneTab, runReady } = setupDom({
      config: {
        ...defaultConfig,
        bothMethodsEnabled: true,
        phoneEnabled: true,
      },
      missingElementIds: [
        'email',
        'email-field',
        'email-tab',
        'phone',
        'phone-field',
      ],
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    expect(() => phoneTab.trigger('click')).not.toThrow();
  });

  it('toggles password visibility and the corresponding icon', async () => {
    const { password, runReady, togglePassword } = setupDom();
    const icon = new ElementFixture();
    togglePassword.setSvg(icon);
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    togglePassword.trigger('click');

    expect(password.getAttribute('type')).toBe('text');
    expect(icon.innerHTML).toContain('13.875 18.825');

    togglePassword.trigger('click');

    expect(password.getAttribute('type')).toBe('password');
    expect(icon.innerHTML).toContain('M15 12a3 3');
  });

  it('initializes when the password visibility control is absent', async () => {
    const { runReady } = setupDom({
      missingElementIds: ['toggle-password'],
    });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
  });

  it('toggles password visibility when the icon is absent', async () => {
    const { password, runReady, togglePassword } = setupDom();
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    expect(() => togglePassword.trigger('click')).not.toThrow();
    expect(password.getAttribute('type')).toBe('text');
  });

  it('adds and removes focus styling on credential inputs', async () => {
    const { email, runReady } = setupDom();
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    email.trigger('focus');
    expect(email.parentElement?.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );

    email.trigger('blur');
    expect(email.parentElement?.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it('restores the login UI after the configured recovery timeout', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google');
    const {
      alert,
      email,
      emailTab,
      form,
      password,
      phoneTab,
      runReady,
      submitButton,
    } = setupDom({
      config: { ...defaultConfig, errorRecoveryTimeout: 5000 },
      socialButtons: [socialButton],
      stateText: JSON.stringify({
        config: { ...defaultConfig, errorRecoveryTimeout: 5000 },
        translations: {
          errorRecovery: 'Please retry',
          signIn: 'Continue',
        },
      }),
    });
    email.value = 'user@example.test';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();
    form!.trigger('submit');

    await vi.advanceTimersByTimeAsync(4999);
    expect(submitButton.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(alert).toHaveBeenCalledWith('Please retry');
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.innerHTML).toBe('Continue');
    expect(socialButton.disabled).toBe(false);
    expect(socialButton.innerHTML).toContain('<svg');
    expect(emailTab.disabled).toBe(false);
    expect(phoneTab.disabled).toBe(false);
    expect(form!.style.pointerEvents).toBe('auto');
  });

  it('falls back when loading translation copy is not a string', async () => {
    const { email, form, password, runReady, submitButton } = setupDom({
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { signingIn: null },
      }),
    });
    email.value = 'user@example.test';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    form!.trigger('submit');

    expect(submitButton.innerHTML).toContain('Signing in...');
  });

  it('falls back when loading translation copy is blank', async () => {
    const { email, form, password, runReady, submitButton } = setupDom({
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { signingIn: '   ' },
      }),
    });
    email.value = 'user@example.test';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    form!.trigger('submit');

    expect(submitButton.innerHTML).toContain('Signing in...');
  });

  it('falls back when translated copy contains an unresolved key', async () => {
    const { email, form, password, runReady, submitButton, warn } = setupDom({
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { signingIn: 'auth.signingIn' },
      }),
    });
    email.value = 'user@example.test';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    form!.trigger('submit');

    expect(submitButton.innerHTML).toContain('Signing in...');
    expect(warn).toHaveBeenCalledWith(
      '[LoginManager]',
      expect.stringContaining("Translation key detected for 'signingIn'")
    );
  });

  it('does not mistake ordinary dotted social-loading copy for a translation key', async () => {
    const socialButton = new ElementFixture();
    socialButton.setAttribute('data-provider', 'google');
    const { runReady, warn } = setupDom({
      socialButtons: [socialButton],
      stateText: JSON.stringify({
        config: defaultConfig,
        translations: { connecting: 'Continuing...' },
      }),
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    socialButton.trigger('click', eventFixture(socialButton));

    expect(document.createTextNode).toHaveBeenCalledWith('Continuing...');
    expect(warn).not.toHaveBeenCalledWith(
      '[LoginManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it('uses safe defaults when embedded login config is an array', async () => {
    const { alert, email, form, password, runReady, warn } = setupDom({
      stateText: JSON.stringify({ config: [] }),
    });
    email.value = '';
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    form!.trigger('submit');

    expect(warn).toHaveBeenCalledWith(
      '[LoginManager]',
      'Invalid config provided, using defaults',
      { config: [] }
    );
    expect(alert).toHaveBeenCalledWith('Please enter your email address');
  });

  it('normalizes unsupported custom identifiers and enables debug logging', async () => {
    const { log, runReady } = setupDom({
      stateText: JSON.stringify({
        config: {
          ...defaultConfig,
          customIdentifiers: 'unsupported',
          debug: true,
        },
      }),
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    expect(log).toHaveBeenCalledWith(
      '[LoginManager]',
      'LoginManager initialized',
      expect.objectContaining({
        config: expect.objectContaining({ customIdentifiers: [] }),
      })
    );
  });

  it('handles validation when neither identifier method is enabled', async () => {
    const { alert, form, runReady } = setupDom({
      config: {
        ...defaultConfig,
        emailEnabled: false,
        phoneEnabled: false,
      },
    });
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    expect(() => form!.trigger('submit')).not.toThrow();
    expect(alert).toHaveBeenCalledWith('Please enter your password');
  });

  it('uses default configuration for empty embedded state', async () => {
    const { alert, form, password, runReady } = setupDom({ stateText: '' });
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');
    runReady();

    form!.trigger('submit');

    expect(alert).toHaveBeenCalledWith('Please enter your email address');
  });

  it('uses fallback initialization when embedded login state is malformed', async () => {
    const { alert, error, form, password, runReady } = setupDom({
      stateText: '{bad json',
    });
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[LoginManager] Failed to initialize:',
      expect.any(SyntaxError)
    );

    form!.trigger('submit');
    expect(alert).toHaveBeenCalledWith('Please enter your email address');
  });

  it('uses fallback initialization when embedded login state is absent', async () => {
    const { alert, error, form, password, runReady } = setupDom({
      stateText: null,
    });
    password.value = 'correct horse battery staple';
    await import('../../../src/assets/js/auth/login.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[LoginManager] No configuration data found in DOM'
    );
    form!.trigger('submit');
    expect(alert).toHaveBeenCalledWith('Please enter your email address');
  });

  it('contains fallback initialization failures for malformed state', async () => {
    const queryError = new Error('DOM query failed');
    const { error, runReady } = setupDom({
      queryError,
      stateText: '{bad json',
    });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[LoginManager] Fallback initialization failed:',
      queryError
    );
  });

  it('contains fallback initialization failures when state is absent', async () => {
    const queryError = new Error('DOM query failed');
    const { error, runReady } = setupDom({
      queryError,
      stateText: null,
    });
    await import('../../../src/assets/js/auth/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[LoginManager] Fallback initialization failed:',
      queryError
    );
  });
});
