import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  target?: ElementFixture;
}

class ClassListFixture {
  private readonly values = new Set<string>();

  public readonly add = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.add(token));
  });

  public readonly remove = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.delete(token));
  });

  public readonly contains = vi.fn((token: string) => this.values.has(token));
}

class ElementFixture {
  public readonly children: ElementFixture[] = [];
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

  public appendChild(child: ElementFixture): void {
    this.children.push(child);
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
    event: EventFixture = eventFixture(this)
  ): EventFixture {
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
    return event;
  }
}

class FormFixture extends ElementFixture {
  public readonly nativeSubmit = vi.fn();

  constructor(public readonly submitButton: ElementFixture) {
    super();
  }

  public override querySelector(selector: string): ElementFixture | null {
    return selector === 'button[type="submit"]' ? this.submitButton : null;
  }

  public submit(): void {
    this.nativeSubmit();
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
  emailEnabled: true,
  phoneEnabled: false,
  requireFullName: false,
  customIdentifierFields: [],
};

const defaultPasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSymbols: false,
};

function setupDom(
  options: {
    config?: Record<string, unknown>;
    fallbackLookupError?: Error;
    formPresent?: boolean;
    missingElementIds?: string[];
    passwordPolicy?: Record<string, unknown>;
    rawConfig?: unknown;
    rawPasswordPolicy?: unknown;
    search?: string;
    socialProviders?: string[];
    stateText?: string | null;
    translations?: Record<string, unknown>;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const alert = vi.fn();
  const submitButton = new ElementFixture();
  const form = new FormFixture(submitButton);
  const emailTab = new ElementFixture();
  const phoneTab = new ElementFixture();
  const emailField = new ElementFixture();
  const phoneField = new ElementFixture();
  const email = new ElementFixture();
  const phone = new ElementFixture();
  const password = new ElementFixture();
  const fullname = new ElementFixture();
  const togglePassword = new ElementFixture();
  const passwordStrength = new ElementFixture();
  const passwordFeedback = new ElementFixture();
  const passwordRequirements = new ElementFixture();
  const svg = new ElementFixture();
  const socialButtons = (options.socialProviders ?? []).map(provider => {
    const button = new ElementFixture();
    button.setAttribute('data-provider', provider);
    return button;
  });
  const config = { ...defaultConfig, ...options.config };
  const elements: Record<string, ElementFixture> = {
    'email-tab': emailTab,
    'phone-tab': phoneTab,
    'email-field': emailField,
    'phone-field': phoneField,
    email,
    phone,
    password,
    fullname,
    'toggle-password': togglePassword,
    'password-strength': passwordStrength,
    'password-feedback': passwordFeedback,
    'password-requirements': passwordRequirements,
  };
  for (const field of config.customIdentifierFields as Array<{
    slot: number;
  }>) {
    elements[`custom_identifier_${field.slot}`] = new ElementFixture();
  }
  options.missingElementIds?.forEach(id => delete elements[id]);
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({
          config: options.rawConfig ?? config,
          passwordPolicy: options.rawPasswordPolicy ?? {
            ...defaultPasswordPolicy,
            ...options.passwordPolicy,
          },
          translations: options.translations ?? {},
        })
      : options.stateText;

  password.setAttribute('type', 'password');
  phoneField.classList.add('hidden');
  togglePassword.setSvg(svg);

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', {
    location: {
      href: '',
      origin: 'https://rp.example.test',
      search: options.search ?? '',
    },
    setTimeout,
  });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    createElement: vi.fn(() => new ElementFixture()),
    getElementById: vi.fn((id: string) => {
      if (id === '___REGISTER_STATE___') {
        return stateText === null ? null : { textContent: stateText };
      }
      if (options.fallbackLookupError) throw options.fallbackLookupError;
      return elements[id] ?? null;
    }),
    querySelector: vi.fn((selector: string) =>
      selector === 'form' && options.formPresent !== false ? form : null
    ),
    querySelectorAll: vi.fn((selector: string) =>
      selector === 'button[data-provider]'
        ? socialButtons
        : [email, phone, password, fullname]
    ),
  });

  return {
    alert,
    email,
    emailField,
    emailTab,
    element: (id: string) => elements[id],
    form,
    fullname,
    password,
    passwordFeedback,
    passwordRequirements,
    passwordStrength,
    phone,
    phoneField,
    phoneTab,
    runReady: () => ready?.(),
    socialButtons,
    submitButton,
    svg,
    togglePassword,
  };
}

describe('register manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when translated validation copy is not a string', async () => {
    const context = setupDom({ translations: { emailRequired: 42 } });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });

  it('falls back when localized validation copy is still a translation key', async () => {
    const context = setupDom({
      translations: { emailRequired: 'common.auth.email_required' },
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });

  it('uses the default recovery window when the configured timeout is invalid', async () => {
    const context = setupDom({
      config: { errorRecoveryTimeout: 'invalid' },
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    vi.advanceTimersByTime(119_999);
    expect(context.submitButton.disabled).toBe(true);
    expect(context.alert).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(context.submitButton.disabled).toBe(false);
    expect(context.alert).toHaveBeenCalledWith(
      'Session timed out. Please try again.'
    );
  });

  it('switches between enabled email and phone registration methods', async () => {
    const context = setupDom({
      config: {
        bothMethodsEnabled: true,
        emailEnabled: true,
        phoneEnabled: true,
      },
    });
    context.email.value = 'user@example.test';
    context.phone.value = '+2290100000000';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();

    expect(context.phone.disabled).toBe(true);
    context.phoneTab.trigger('click');
    expect(context.email.disabled).toBe(true);
    expect(context.email.value).toBe('');
    expect(context.phone.disabled).toBe(false);
    expect(context.phoneField.classList.remove).toHaveBeenCalledWith('hidden');

    context.emailTab.trigger('click');
    expect(context.email.disabled).toBe(false);
    expect(context.phone.disabled).toBe(true);
    expect(context.phone.value).toBe('');
    expect(context.emailField.classList.remove).toHaveBeenCalledWith('hidden');
  });

  it('toggles password visibility and updates the eye icon', async () => {
    const context = setupDom();

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.togglePassword.trigger('click');

    expect(context.password.getAttribute('type')).toBe('text');
    expect(context.svg.innerHTML).toContain('M13.875 18.825');

    context.togglePassword.trigger('click');
    expect(context.password.getAttribute('type')).toBe('password');
    expect(context.svg.innerHTML).toContain('M15 12a3 3');
  });

  it('does not display a green meter while a configured requirement is unmet', async () => {
    const context = setupDom({
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
      },
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.password.value = 'Aa1!';
    context.password.trigger('input');

    expect(context.passwordStrength.className).toContain('bg-yellow-500');
    expect(context.passwordFeedback.classList.remove).toHaveBeenCalledWith(
      'hidden'
    );
    expect(context.passwordRequirements.children).toHaveLength(1);
    expect(context.passwordRequirements.children[0]?.textContent).toBe(
      'At least 8 characters'
    );
  });

  it('renders every strength state and hides feedback for a compliant password', async () => {
    const context = setupDom({
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
      },
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();

    for (const [password, color] of [
      ['', 'bg-red-500'],
      ['Aa', 'bg-orange-500'],
      ['Aa1', 'bg-yellow-500'],
      ['Abcdefgh1!', 'bg-green-500'],
    ]) {
      context.password.value = password;
      context.password.trigger('input');
      expect(context.passwordStrength.className).toContain(color);
    }

    expect(context.passwordStrength.style.width).toBe('100%');
    expect(context.passwordFeedback.classList.add).toHaveBeenCalledWith(
      'hidden'
    );
  });

  it('applies the default password policy when the minimum length is invalid', async () => {
    const context = setupDom({ passwordPolicy: { minLength: 'invalid' } });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.password.value = 'abcdefgh';
    context.password.trigger('input');

    expect(context.passwordStrength.style.width).toBe('100%');
    expect(context.passwordStrength.className).toContain('bg-green-500');
  });

  it('requires a phone number in phone-only registration mode', async () => {
    const context = setupDom({
      config: {
        emailEnabled: false,
        phoneEnabled: true,
      },
      translations: { phoneRequired: 'Enter a mobile number' },
    });
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Enter a mobile number');
    expect(context.phone.focus).toHaveBeenCalledOnce();
    expect(context.submitButton.disabled).toBe(false);
  });

  it('validates only the visible method when email and phone are both enabled', async () => {
    const context = setupDom({
      config: {
        bothMethodsEnabled: true,
        emailEnabled: true,
        phoneEnabled: true,
      },
      translations: {
        emailRequired: 'Enter an email',
        phoneRequired: 'Enter a phone',
      },
    });
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');
    expect(context.alert).toHaveBeenLastCalledWith('Enter an email');

    context.phoneTab.trigger('click');
    context.form.trigger('submit');
    expect(context.alert).toHaveBeenLastCalledWith('Enter a phone');
    expect(context.alert).toHaveBeenCalledTimes(2);
  });

  it('requires a password before registration submission', async () => {
    const context = setupDom({
      translations: { passwordRequired: 'Choose a password' },
    });
    context.email.value = 'user@example.test';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Choose a password');
    expect(context.submitButton.disabled).toBe(false);
  });

  it('rejects a blank full name when the field is required', async () => {
    const context = setupDom({
      config: { requireFullName: true },
      translations: { fullNameRequired: 'Enter your full name' },
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';
    context.fullname.value = '   ';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Enter your full name');
    expect(context.submitButton.disabled).toBe(false);
  });

  it('requires tenant custom identifiers configured for registration', async () => {
    const context = setupDom({
      config: {
        customIdentifierFields: [
          {
            slot: 2,
            key: 'employee_id',
            name: 'Employee ID',
            hint_for_user: '',
            validation_type: 'none',
            required_for_registration: true,
            edit_policy: 'user_editable',
          },
        ],
      },
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Employee ID is required');
    expect(context.element('custom_identifier_2')?.value).toBe('');
    expect(context.submitButton.disabled).toBe(false);
  });

  it('rejects custom identifiers that do not match their configured pattern', async () => {
    const context = setupDom({
      config: {
        customIdentifierFields: [
          {
            slot: 1,
            key: 'country_code',
            name: 'Country code',
            hint_for_user: '',
            validation_type: 'regex',
            pattern: '^[A-Z]{3}$',
            required_for_registration: false,
            edit_policy: 'user_editable',
          },
        ],
      },
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';
    context.element('custom_identifier_1')!.value = 'ben';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Invalid Country code format');
    expect(context.submitButton.disabled).toBe(false);
  });

  it('fails closed when a custom identifier regex is malformed', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({
      config: {
        customIdentifierFields: [
          {
            slot: 3,
            key: 'membership',
            name: 'Membership',
            hint_for_user: '',
            validation_type: 'regex',
            pattern: '[',
            required_for_registration: false,
            edit_policy: 'user_editable',
          },
        ],
      },
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';
    context.element('custom_identifier_3')!.value = 'member-1';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(error).toHaveBeenCalledWith(
      '[RegisterManager]',
      'Invalid pattern regex',
      expect.objectContaining({ patternError: expect.any(SyntaxError) })
    );
    expect(context.alert).toHaveBeenCalledWith('Invalid Membership format');
    expect(context.submitButton.disabled).toBe(false);
    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).not.toHaveBeenCalled();
  });

  it('rejects protocol-relative continuation URLs during social registration', async () => {
    const context = setupDom({
      search: '?continue=%2F%2Fevil.example%2Fcallback',
      socialProviders: ['google'],
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.socialButtons[0]!.trigger('click');
    vi.advanceTimersByTime(100);

    expect(window.location.href).toBe(
      'https://rp.example.test/auth/social/google/register'
    );
  });

  it('submits a valid registration once and blocks duplicate submissions', async () => {
    const context = setupDom({
      config: {
        bothMethodsEnabled: true,
        emailEnabled: true,
        phoneEnabled: true,
      },
      socialProviders: ['github'],
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    const first = context.form.trigger('submit');
    const duplicate = context.form.trigger('submit');

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(context.submitButton.disabled).toBe(true);
    expect(context.socialButtons[0]?.disabled).toBe(true);
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopPropagation).toHaveBeenCalledOnce();
    const emailTabClick = context.emailTab.trigger('click');
    const phoneTabClick = context.phoneTab.trigger('click');
    const socialClick = context.socialButtons[0]!.trigger('click');
    expect(emailTabClick.preventDefault).toHaveBeenCalledOnce();
    expect(emailTabClick.stopPropagation).toHaveBeenCalledOnce();
    expect(phoneTabClick.preventDefault).toHaveBeenCalledOnce();
    expect(phoneTabClick.stopPropagation).toHaveBeenCalledOnce();
    expect(socialClick.preventDefault).toHaveBeenCalledOnce();
    expect(socialClick.stopPropagation).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    expect(window.location.href).toBe('');
  });

  it('preserves a same-origin continuation URL during social registration', async () => {
    const context = setupDom({
      search: '?redirectTo=%2Faccounts%3Ftab%3Dsecurity',
      socialProviders: ['facebook'],
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.socialButtons[0]!.trigger('click');
    vi.advanceTimersByTime(100);

    expect(window.location.href).toBe(
      'https://rp.example.test/auth/social/facebook/register?continue=%2Faccounts%3Ftab%3Dsecurity'
    );
  });

  it('adds and removes the focus ring on registration inputs', async () => {
    const context = setupDom();
    const container = new ElementFixture();
    context.email.parentElement = container;

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.email.trigger('focus');
    expect(container.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );

    context.email.trigger('blur');
    expect(container.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(() => context.phone.trigger('focus')).not.toThrow();
    expect(() => context.phone.trigger('blur')).not.toThrow();
  });

  it('supports a password toggle without an inline SVG icon', async () => {
    const context = setupDom();
    context.togglePassword.setSvg(null);

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    expect(() => context.togglePassword.trigger('click')).not.toThrow();
    expect(context.password.getAttribute('type')).toBe('text');
  });

  it('falls back to a working registration form when embedded state is malformed', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({ stateText: '{malformed' });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(error).toHaveBeenCalledWith(
      '[RegisterManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });

  it('falls back to a working registration form when embedded state is absent', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({ stateText: null });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(error).toHaveBeenCalledWith(
      '[RegisterManager] No configuration data found in DOM'
    );
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });

  it('uses safe defaults when embedded config and password policy have invalid types', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const context = setupDom({
      rawConfig: 'invalid',
      rawPasswordPolicy: 'invalid',
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(warn).toHaveBeenCalledWith(
      '[RegisterManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
    expect(warn).toHaveBeenCalledWith(
      '[RegisterManager]',
      'Invalid password policy provided, using defaults',
      { policy: 'invalid' }
    );
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });

  it('restores social buttons after the bounded recovery timeout', async () => {
    const context = setupDom({
      config: { errorRecoveryTimeout: 1 },
      socialProviders: ['google', 'custom'],
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');
    vi.advanceTimersByTime(999);
    expect(context.socialButtons[0]?.disabled).toBe(true);

    vi.advanceTimersByTime(1);
    expect(context.socialButtons[0]?.disabled).toBe(false);
    expect(context.socialButtons[0]?.innerHTML).toContain(
      'viewBox="0 0 24 24"'
    );
    expect(context.socialButtons[1]?.innerHTML).toBe('');
    expect(context.alert).toHaveBeenCalledWith(
      'Session timed out. Please try again.'
    );
  });

  it('ignores syntactically invalid continuation URLs', async () => {
    const context = setupDom({
      search: '?continue=http%3A%2F%2F%5B%3A%3A1',
      socialProviders: ['linkedin'],
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.socialButtons[0]!.trigger('click');
    vi.advanceTimersByTime(100);

    expect(window.location.href).toBe(
      'https://rp.example.test/auth/social/linkedin/register'
    );
  });

  it('runs safely when optional registration markup is absent', async () => {
    const context = setupDom({
      formPresent: false,
      missingElementIds: [
        'email-tab',
        'phone-tab',
        'toggle-password',
        'password-strength',
      ],
      socialProviders: ['github'],
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.socialButtons[0]!.trigger('click');
    vi.advanceTimersByTime(120_000);

    expect(window.location.href).toBe(
      'https://rp.example.test/auth/social/github/register'
    );
    expect(context.socialButtons[0]?.disabled).toBe(false);
  });

  it('ignores admin-only and missing custom identifier controls', async () => {
    const context = setupDom({
      config: {
        customIdentifierFields: [
          {
            slot: 4,
            key: 'internal_id',
            name: 'Internal ID',
            validation_type: 'none',
            required_for_registration: true,
            edit_policy: 'admin_only',
          },
          {
            slot: 5,
            key: 'legacy_id',
            name: 'Legacy ID',
            validation_type: 'none',
            required_for_registration: true,
            edit_policy: 'user_editable',
          },
        ],
      },
      missingElementIds: ['custom_identifier_5'],
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');
    vi.advanceTimersByTime(100);

    expect(context.alert).not.toHaveBeenCalled();
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('allows an optional custom identifier to remain empty', async () => {
    const context = setupDom({
      config: {
        customIdentifierFields: [
          {
            slot: 6,
            key: 'optional_code',
            name: 'Optional code',
            validation_type: 'regex',
            pattern: '^[A-Z]+$',
            required_for_registration: false,
            edit_policy: 'user_editable',
          },
        ],
      },
    });
    context.email.value = 'user@example.test';
    context.password.value = 'Abcdefgh1!';

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');
    vi.advanceTimersByTime(100);

    expect(context.alert).not.toHaveBeenCalled();
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('does not focus a contact field when no contact method is enabled', async () => {
    const context = setupDom({
      config: { emailEnabled: false, phoneEnabled: false },
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Please enter your password');
    expect(context.email.focus).not.toHaveBeenCalled();
    expect(context.phone.focus).not.toHaveBeenCalled();
  });

  it('handles absent contact inputs while switching registration methods', async () => {
    const context = setupDom({
      config: {
        bothMethodsEnabled: true,
        emailEnabled: true,
        phoneEnabled: true,
      },
      missingElementIds: ['email', 'phone'],
    });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();

    expect(() => context.phoneTab.trigger('click')).not.toThrow();
    expect(() => context.emailTab.trigger('click')).not.toThrow();
  });

  it('handles enabled single-method contact inputs that are absent from the DOM', async () => {
    const context = setupDom({
      config: {
        bothMethodsEnabled: false,
        emailEnabled: true,
        phoneEnabled: true,
      },
      missingElementIds: ['email', 'phone'],
    });

    await import('../../../src/assets/js/auth/register.js');
    expect(() => context.runReady()).not.toThrow();
  });

  it('uses bootstrap defaults when the embedded state is empty', async () => {
    const context = setupDom({ stateText: '' });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your email address'
    );
  });

  it('contains fallback initialization failures', async () => {
    const failure = new Error('DOM unavailable');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({
      fallbackLookupError: failure,
      stateText: null,
    });

    await import('../../../src/assets/js/auth/register.js');
    expect(() => context.runReady()).not.toThrow();

    expect(error).toHaveBeenCalledWith(
      '[RegisterManager] Fallback initialization failed:',
      failure
    );
  });

  it('ignores social buttons without a provider identifier', async () => {
    const context = setupDom({ socialProviders: [''] });

    await import('../../../src/assets/js/auth/register.js');
    context.runReady();
    context.socialButtons[0]!.trigger('click');
    vi.advanceTimersByTime(100);

    expect(window.location.href).toBe('');
    expect(context.socialButtons[0]?.disabled).toBe(false);
  });
});
