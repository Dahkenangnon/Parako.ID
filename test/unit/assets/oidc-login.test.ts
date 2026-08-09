import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
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
  public readonly classList = new ClassListFixture();
  public readonly style: Record<string, string> = {};
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
  private readonly queryResults = new Map<string, ElementFixture>();

  public addEventListener(
    name: string,
    listener: (event: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public querySelector(selector: string): ElementFixture | null {
    return this.queryResults.get(selector) ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public setQueryResult(selector: string, element: ElementFixture): void {
    this.queryResults.set(selector, element);
  }

  public trigger(name: string): EventFixture {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
    return event;
  }
}

class FormFixture extends ElementFixture {
  public readonly submit = vi.fn();

  public constructor(private readonly submitButton: ElementFixture) {
    super();
  }

  public override querySelector(selector: string): ElementFixture | null {
    return selector === 'button[type="submit"]' ? this.submitButton : null;
  }
}

function setupDom(
  options: {
    config?: Record<string, unknown>;
    legacyMethods?: boolean;
    missingElementIds?: string[];
    passwordIcon?: boolean;
    provider?: string | null;
    search?: string;
    stateText?: string;
    throwOnElementId?: string;
    translations?: Record<string, unknown>;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const alert = vi.fn();
  const email = new ElementFixture();
  const emailField = new ElementFixture();
  const emailTab = new ElementFixture();
  const submitButton = new ElementFixture();
  const form = new FormFixture(submitButton);
  const identifier = new ElementFixture();
  const eyeIcon = new ElementFixture();
  const loginMethod = new ElementFixture();
  const password = new ElementFixture();
  const phone = new ElementFixture();
  const phoneField = new ElementFixture();
  const phoneTab = new ElementFixture();
  const socialButton = new ElementFixture();
  const state = new ElementFixture();
  const togglePassword = new ElementFixture();
  const location = {
    href: 'https://id.example.test/oidc/v1/interaction/interaction-1',
    origin: 'https://id.example.test',
    search: options.search ?? '',
  };
  const missingElementIds = new Set(options.missingElementIds ?? []);
  const legacyElementIds = new Set([
    'email',
    'email-field',
    'email-tab',
    'phone',
    'phone-field',
    'phone-tab',
  ]);

  if (options.provider !== null) {
    socialButton.setAttribute('data-provider', options.provider ?? 'google');
  }
  email.setAttribute('type', 'email');
  identifier.setAttribute('type', 'text');
  identifier.parentElement = new ElementFixture();
  password.setAttribute('type', 'password');
  password.parentElement = new ElementFixture();
  phone.setAttribute('type', 'tel');
  email.parentElement = new ElementFixture();
  phone.parentElement = new ElementFixture();
  if (options.passwordIcon !== false) {
    togglePassword.setQueryResult('svg', eyeIcon);
  }
  state.textContent =
    options.stateText ??
    JSON.stringify({
      config: {
        bothMethodsEnabled: false,
        emailEnabled: true,
        phoneEnabled: false,
        oidcPath: '/oidc/v1',
        uid: 'interaction-1',
        clientId: 'client-1',
        ...options.config,
      },
      translations: options.translations,
    });

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', { location, setTimeout });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === options.throwOnElementId) {
        throw new Error(`DOM lookup failed for ${id}`);
      }
      if (missingElementIds.has(id)) return null;
      if (!options.legacyMethods && legacyElementIds.has(id)) return null;
      if (id === '___OIDC_LOGIN_STATE___') return state;
      if (id === 'email') return email;
      if (id === 'email-field') return emailField;
      if (id === 'email-tab') return emailTab;
      if (id === 'login-form') return form;
      if (id === 'login') return identifier;
      if (id === 'login_method') return loginMethod;
      if (id === 'password') return password;
      if (id === 'phone') return phone;
      if (id === 'phone-field') return phoneField;
      if (id === 'phone-tab') return phoneTab;
      if (id === 'toggle-password') return togglePassword;
      return null;
    }),
    querySelectorAll: vi.fn((selector: string) =>
      selector === '[data-provider]'
        ? [socialButton]
        : selector.includes('input[type="text"]')
          ? options.legacyMethods
            ? [identifier, email, phone, password]
            : [identifier, password]
          : options.legacyMethods
            ? [email, phone, password]
            : [password]
    ),
  });

  return {
    alert,
    email,
    emailField,
    emailTab,
    error,
    eyeIcon,
    form,
    identifier,
    loginMethod,
    log,
    location,
    phone,
    phoneField,
    phoneTab,
    runReady: () => ready?.(),
    socialButton,
    submitButton,
    togglePassword,
    warn,
  };
}

describe('OIDC login manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('redirects social login through a same-origin relative OIDC path', async () => {
    const { alert, location, runReady, socialButton } = setupDom();
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      '/oidc/v1/social/google?uid=interaction-1&client_id=client-1'
    );
    expect(alert).not.toHaveBeenCalled();
  });

  it('falls back to the default OIDC path when the configured path is blank', async () => {
    const { location, runReady, socialButton } = setupDom({
      config: { oidcPath: '' },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'oidc/v1/social/google?uid=interaction-1&client_id=client-1'
    );
  });

  it('does not mistake ordinary ellipsis copy for a translation key', async () => {
    const { runReady, socialButton, warn } = setupDom({
      translations: { connecting: 'Continuing...' },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');

    expect(socialButton.innerHTML).toContain('Continuing...');
    expect(warn).not.toHaveBeenCalledWith(
      '[OIDCLoginManager]',
      expect.stringContaining('Translation key detected')
    );
  });

  it('emits diagnostic details when OIDC login debug mode is enabled', async () => {
    const { log, runReady } = setupDom({ config: { debug: true } });
    await import('../../../src/assets/js/auth/oidc/login.js');

    runReady();

    expect(log).toHaveBeenCalledWith(
      '[OIDCLoginManager]',
      'OIDCLoginManager initialized',
      expect.objectContaining({
        config: expect.objectContaining({ uid: 'interaction-1' }),
      })
    );
  });

  it('falls back when social-loading translation copy is not a string', async () => {
    const { runReady, socialButton } = setupDom({
      translations: { connecting: null },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(() => socialButton.trigger('click')).not.toThrow();
    expect(socialButton.innerHTML).toContain('Connecting...');
  });

  it('falls back when social-loading translation copy is blank', async () => {
    const { runReady, socialButton } = setupDom({
      translations: { connecting: '   ' },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');

    expect(socialButton.innerHTML).toContain('Connecting...');
  });

  it('falls back when translated copy contains an unresolved key', async () => {
    const { runReady, socialButton, warn } = setupDom({
      translations: { connecting: 'auth.connecting' },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');

    expect(socialButton.innerHTML).toContain('Connecting...');
    expect(warn).toHaveBeenCalledWith(
      '[OIDCLoginManager]',
      expect.stringContaining("Translation key detected for 'connecting'")
    );
  });

  it('rejects an OIDC redirect host outside the configured allowlist', async () => {
    const { alert, location, runReady, socialButton } = setupDom({
      config: {
        oidcPath: 'https://evil.example.test/oidc/v1',
        allowedRedirectHosts: ['id.example.test'],
      },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/oidc/v1/interaction/interaction-1'
    );
    expect(alert).toHaveBeenCalledWith(
      'Invalid redirect URL detected. Please try again.'
    );
  });

  it('adds and removes focus styling on the unified identifier input', async () => {
    const { identifier, runReady } = setupDom();
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    identifier.trigger('focus');
    expect(identifier.parentElement?.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );

    identifier.trigger('blur');
    expect(identifier.parentElement?.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it('rejects malformed provider identifiers instead of rewriting them', async () => {
    const { alert, location, runReady, socialButton } = setupDom({
      provider: 'google<script>',
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/oidc/v1/interaction/interaction-1'
    );
    expect(alert).toHaveBeenCalledWith(
      'Failed to build login URL. Please try again.'
    );
    expect(socialButton.disabled).toBe(false);
  });

  it('recovers when URL encoding fails with a non-Error value', async () => {
    const { alert, runReady, socialButton } = setupDom();
    vi.stubGlobal(
      'encodeURIComponent',
      vi.fn(() => {
        throw 'encoding failed';
      })
    );
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(() => socialButton.trigger('click')).not.toThrow();

    expect(alert).toHaveBeenCalledWith(
      'Failed to build login URL. Please try again.'
    );
    expect(socialButton.disabled).toBe(false);
  });

  it('ignores a social-login button without a provider identifier', async () => {
    const { alert, location, runReady, socialButton } = setupDom({
      provider: null,
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/oidc/v1/interaction/interaction-1'
    );
    expect(socialButton.disabled).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('blocks duplicate social-login clicks while redirecting', async () => {
    const { location, runReady, socialButton } = setupDom();
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    const first = socialButton.trigger('click');
    const duplicate = socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(location.href).toBe(
      '/oidc/v1/social/google?uid=interaction-1&client_id=client-1'
    );
  });

  it('submits the login form once while blocking duplicate submissions', async () => {
    const { form, runReady, submitButton } = setupDom();
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    const first = form.trigger('submit');
    const duplicate = form.trigger('submit');

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(first.stopPropagation).not.toHaveBeenCalled();
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopPropagation).toHaveBeenCalledOnce();
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.innerHTML).toContain('Signing in...');

    await vi.advanceTimersByTimeAsync(99);
    expect(form.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('submits only the currently visible phone login method', async () => {
    const { email, emailField, form, phone, runReady } = setupDom({
      legacyMethods: true,
    });
    emailField.classList.add('hidden');
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    form.trigger('submit');

    expect(email.disabled).toBe(true);
    expect(phone.disabled).toBe(false);
  });

  it('submits safely when a legacy visibility marker has no legacy inputs', async () => {
    const { emailField, form, runReady } = setupDom({
      legacyMethods: true,
      missingElementIds: ['email', 'phone'],
    });
    emailField.classList.add('hidden');
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(() => form.trigger('submit')).not.toThrow();
    await vi.advanceTimersByTimeAsync(100);

    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('enables the phone input when phone is the only configured login method', async () => {
    const { phone, runReady } = setupDom({
      config: {
        emailEnabled: false,
        phoneEnabled: true,
      },
      legacyMethods: true,
    });
    phone.disabled = true;
    await import('../../../src/assets/js/auth/oidc/login.js');

    runReady();

    expect(phone.disabled).toBe(false);
  });

  it('restores provider button content after a failed social login', async () => {
    const { emailTab, phoneTab, runReady, socialButton } = setupDom({
      legacyMethods: true,
      provider: 'google<script>',
    });
    socialButton.innerHTML = '<span>Continue with Google</span>';
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');

    expect(socialButton.innerHTML).toBe('<span>Continue with Google</span>');
    expect(emailTab.disabled).toBe(false);
    expect(phoneTab.disabled).toBe(false);

    socialButton.trigger('click');
    expect(socialButton.innerHTML).toBe('<span>Continue with Google</span>');
  });

  it('restores the login UI after the configured recovery timeout', async () => {
    const { alert, form, runReady, socialButton, submitButton } = setupDom({
      config: { errorRecoveryTimeout: 5000 },
      translations: {
        errorRecovery: 'Please retry',
        signIn: 'Continue',
      },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();
    form.trigger('submit');

    await vi.advanceTimersByTimeAsync(4999);
    expect(submitButton.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(alert).toHaveBeenCalledWith('Please retry');
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.innerHTML).toBe('Continue');
    expect(socialButton.disabled).toBe(false);
    expect(form.style.pointerEvents).toBe('auto');
  });

  it('rejects a protocol-relative OIDC path without an explicit host allowlist', async () => {
    const { alert, location, runReady, socialButton } = setupDom({
      config: { oidcPath: '//evil.example.test/oidc/v1' },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/oidc/v1/interaction/interaction-1'
    );
    expect(alert).toHaveBeenCalledWith(
      'Invalid redirect URL detected. Please try again.'
    );
  });

  it('allows an explicitly allowlisted external OIDC host', async () => {
    const { alert, location, runReady, socialButton } = setupDom({
      config: {
        oidcPath: 'https://login.example.test/oidc/v1',
        allowedRedirectHosts: [' LOGIN.EXAMPLE.TEST '],
      },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://login.example.test/oidc/v1/social/google?uid=interaction-1&client_id=client-1'
    );
    expect(alert).not.toHaveBeenCalled();
  });

  it.each([
    ['an unsupported protocol', 'ftp://id.example.test/oidc/v1'],
    ['a dangerous protocol token', '/oidc/v1/javascript:'],
    ['suspicious markup', '/oidc/v1/<script>'],
    ['an oversized path', `/${'a'.repeat(2050)}`],
    ['a malformed absolute URL', 'http://['],
  ])('rejects %s in the OIDC path', async (_label, oidcPath) => {
    const { alert, location, runReady, socialButton } = setupDom({
      config: { oidcPath },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      'https://id.example.test/oidc/v1/interaction/interaction-1'
    );
    expect(alert).toHaveBeenCalledWith(
      'Invalid redirect URL detected. Please try again.'
    );
  });

  it('forwards encoded OIDC parameters while ignoring unrelated query input', async () => {
    const { location, runReady, socialButton } = setupDom({
      config: { prompt: 'login', acrValues: 'urn:mfa' },
      search: '?state=state-1&scope=openid%20profile&ignored=value',
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      '/oidc/v1/social/google?uid=interaction-1&client_id=client-1' +
        '&prompt=login&acr_values=urn%3Amfa' +
        '&state=state-1&scope=openid%20profile'
    );
  });

  it('does not forward dangerous or suspicious OIDC query values', async () => {
    const { location, runReady, socialButton } = setupDom({
      search:
        '?state=javascript%3Aalert(1)&nonce=%3Cscript%3E&scope=&ignored=safe',
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      '/oidc/v1/social/google?uid=interaction-1&client_id=client-1'
    );
  });

  it('does not forward oversized OIDC query values', async () => {
    const { location, runReady, socialButton } = setupDom({
      search: `?state=${'a'.repeat(1001)}`,
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe(
      '/oidc/v1/social/google?uid=interaction-1&client_id=client-1'
    );
  });

  it('toggles password visibility and its accessible icon state', async () => {
    const { eyeIcon, runReady, togglePassword } = setupDom();
    const password = document.getElementById(
      'password'
    ) as unknown as ElementFixture;
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    togglePassword.trigger('click');
    expect(password.getAttribute('type')).toBe('text');
    expect(eyeIcon.innerHTML).toContain('M13.875 18.825');

    togglePassword.trigger('click');
    expect(password.getAttribute('type')).toBe('password');
    expect(eyeIcon.innerHTML).toContain('M15 12');
  });

  it('toggles password visibility when the optional icon is absent', async () => {
    const { runReady, togglePassword } = setupDom({ passwordIcon: false });
    const password = document.getElementById(
      'password'
    ) as unknown as ElementFixture;
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(() => togglePassword.trigger('click')).not.toThrow();
    expect(password.getAttribute('type')).toBe('text');
  });

  it.each(['toggle-password', 'password'])(
    'initializes safely when optional %s control is absent',
    async missingId => {
      const { runReady } = setupDom({ missingElementIds: [missingId] });
      await import('../../../src/assets/js/auth/oidc/login.js');

      expect(runReady).not.toThrow();
    }
  );

  it('switches between configured email and phone login methods', async () => {
    const {
      email,
      emailField,
      emailTab,
      loginMethod,
      phone,
      phoneField,
      phoneTab,
      runReady,
    } = setupDom({
      config: { bothMethodsEnabled: true, phoneEnabled: true },
      legacyMethods: true,
    });
    email.value = 'old@example.test';
    phone.value = 'old phone';
    phoneField.classList.add('hidden');
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    phoneTab.trigger('click');
    expect(phoneField.classList.contains('hidden')).toBe(false);
    expect(emailField.classList.contains('hidden')).toBe(true);
    expect(phone.disabled).toBe(false);
    expect(email.disabled).toBe(true);
    expect(email.value).toBe('');
    expect(loginMethod.value).toBe('phone');

    emailTab.trigger('click');
    expect(emailField.classList.contains('hidden')).toBe(false);
    expect(phoneField.classList.contains('hidden')).toBe(true);
    expect(email.disabled).toBe(false);
    expect(phone.disabled).toBe(true);
    expect(phone.value).toBe('');
    expect(loginMethod.value).toBe('email');
  });

  it('initializes safely when both methods are configured without legacy controls', async () => {
    const { runReady } = setupDom({
      config: { bothMethodsEnabled: true, phoneEnabled: true },
    });
    await import('../../../src/assets/js/auth/oidc/login.js');

    expect(runReady).not.toThrow();
  });

  it('supports an email tab when its optional legacy companion controls are absent', async () => {
    const { emailTab, runReady } = setupDom({
      config: { bothMethodsEnabled: true, phoneEnabled: true },
      legacyMethods: true,
      missingElementIds: [
        'phone-tab',
        'email-field',
        'phone-field',
        'email',
        'phone',
        'login_method',
      ],
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(() => emailTab.trigger('click')).not.toThrow();
  });

  it('supports a phone tab when its optional legacy companion controls are absent', async () => {
    const { phoneTab, runReady } = setupDom({
      config: { bothMethodsEnabled: true, phoneEnabled: true },
      legacyMethods: true,
      missingElementIds: [
        'email-tab',
        'email-field',
        'phone-field',
        'email',
        'phone',
        'login_method',
      ],
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(() => phoneTab.trigger('click')).not.toThrow();
  });

  it('blocks login-method switching during an active submission', async () => {
    const { emailTab, form, phoneTab, runReady } = setupDom({
      config: { bothMethodsEnabled: true, phoneEnabled: true },
      legacyMethods: true,
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();
    form.trigger('submit');

    const emailEvent = emailTab.trigger('click');
    const phoneEvent = phoneTab.trigger('click');

    expect(emailEvent.preventDefault).toHaveBeenCalledOnce();
    expect(emailEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(phoneEvent.preventDefault).toHaveBeenCalledOnce();
    expect(phoneEvent.stopPropagation).toHaveBeenCalledOnce();
  });

  it('initializes safely when the OIDC login form is absent', async () => {
    const { error, runReady } = setupDom({
      missingElementIds: ['login-form'],
    });
    await import('../../../src/assets/js/auth/oidc/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLoginManager]',
      'Required form elements not found'
    );
  });

  it('falls back safely when embedded OIDC login state is malformed', async () => {
    const { error, runReady, socialButton } = setupDom({ stateText: '{' });
    await import('../../../src/assets/js/auth/oidc/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLoginManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(() => socialButton.trigger('click')).not.toThrow();
  });

  it('falls back safely when embedded OIDC login state is absent', async () => {
    const { error, runReady, socialButton } = setupDom({
      missingElementIds: ['___OIDC_LOGIN_STATE___'],
    });
    await import('../../../src/assets/js/auth/oidc/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLoginManager] No configuration data found in DOM'
    );
    expect(() => socialButton.trigger('click')).not.toThrow();
  });

  it('uses the embedded-state defaults when its script content is empty', async () => {
    const { location, runReady, socialButton } = setupDom({ stateText: '' });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe('oidc/v1/social/google?uid=&client_id=');
  });

  it('contains a DOM failure during malformed-state fallback', async () => {
    const { error, runReady } = setupDom({
      stateText: '{',
      throwOnElementId: 'email-tab',
    });
    await import('../../../src/assets/js/auth/oidc/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLoginManager] Fallback initialization failed:',
      expect.objectContaining({ message: 'DOM lookup failed for email-tab' })
    );
  });

  it('contains a DOM failure during missing-state fallback', async () => {
    const { error, runReady } = setupDom({
      missingElementIds: ['___OIDC_LOGIN_STATE___'],
      throwOnElementId: 'email-tab',
    });
    await import('../../../src/assets/js/auth/oidc/login.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[OIDCLoginManager] Fallback initialization failed:',
      expect.objectContaining({ message: 'DOM lookup failed for email-tab' })
    );
  });

  it('uses safe defaults when embedded OIDC config is not an object', async () => {
    const { location, runReady, socialButton, warn } = setupDom({
      stateText: JSON.stringify({ config: 'invalid' }),
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    socialButton.trigger('click');
    await vi.advanceTimersByTimeAsync(100);

    expect(location.href).toBe('oidc/v1/social/google?uid=&client_id=');
    expect(warn).toHaveBeenCalledWith(
      '[OIDCLoginManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
  });

  it('uses safe defaults when embedded OIDC config is an array', async () => {
    const { runReady, warn } = setupDom({
      stateText: JSON.stringify({ config: [] }),
    });
    await import('../../../src/assets/js/auth/oidc/login.js');
    runReady();

    expect(warn).toHaveBeenCalledWith(
      '[OIDCLoginManager]',
      'Invalid config provided, using defaults',
      { config: [] }
    );
  });
});
