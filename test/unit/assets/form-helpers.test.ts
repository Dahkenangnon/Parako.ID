import { afterEach, describe, expect, it, vi } from 'vitest';

type InputListener = (this: InputFixture) => void;

interface InputFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  checked: boolean;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  className: string;
  dispatchEvent: ReturnType<typeof vi.fn>;
  listener?: InputListener;
  readOnly: boolean;
  setAttribute: ReturnType<typeof vi.fn>;
  textContent: string;
  type: string;
  value: string;
}

interface FormHelpersApi {
  DEFAULT_PASSWORD_POLICY: {
    minLength: number;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecial: boolean;
    requireUppercase: boolean;
  };
  calculatePasswordStrength(
    password: string,
    policy?: Record<string, boolean | number>
  ): {
    level: 'weak' | 'fair' | 'good' | 'strong';
    requirements: Record<string, boolean>;
    score: number;
  };
  generateSecurePassword(
    policy?: Record<string, boolean | number>,
    length?: number
  ): string;
  setupAutoGeneratePassword(
    checkboxId: string,
    passwordId: string,
    confirmId?: string,
    showDuration?: number
  ): void;
  setupPasswordMatchIndicator(
    passwordId: string,
    confirmId: string,
    indicatorId: string,
    textId: string
  ): void;
  togglePasswordVisibility(inputId: string, iconId?: string): void;
  validateEmail(email: string): { message: string; valid: boolean };
  validatePassword(
    password: string,
    policy?: Record<string, boolean | number>
  ): { message: string; valid: boolean };
  validatePasswordMatch(
    password: string,
    confirmPassword: string
  ): { message: string; valid: boolean };
}

function makeInput(type = 'password'): InputFixture {
  const input: InputFixture = {
    addEventListener: vi.fn(
      (_name: string, callback: InputListener) => (input.listener = callback)
    ),
    checked: false,
    classList: { add: vi.fn(), remove: vi.fn() },
    className: '',
    dispatchEvent: vi.fn(),
    readOnly: false,
    setAttribute: vi.fn(),
    textContent: '',
    type,
    value: '',
  };
  return input;
}

function setupDom(
  elements: Record<string, InputFixture>,
  options: { lucide?: boolean; randomValues?: number[] } = {}
) {
  const createIcons = vi.fn();
  const browserWindow: Record<string, unknown> = options.lucide
    ? { lucide: { createIcons } }
    : {};
  const randomValues = [...(options.randomValues ?? [])];
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  });
  vi.stubGlobal('crypto', {
    getRandomValues: vi.fn((buffer: Uint32Array) => {
      buffer[0] = randomValues.shift() ?? 0;
      return buffer;
    }),
  });
  return { browserWindow, createIcons };
}

async function loadFormHelpers(): Promise<FormHelpersApi> {
  await import('../../../src/assets/js/utils/form-helpers.js');
  return (window as unknown as { FormHelpers: FormHelpersApi }).FormHelpers;
}

function change(input: InputFixture): void {
  input.listener?.call(input);
}

describe('form helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('gives the latest generated password its full reveal duration', async () => {
    vi.useFakeTimers();
    const checkbox = makeInput('checkbox');
    const password = makeInput();
    setupDom({ checkbox, password });
    const helpers = await loadFormHelpers();
    helpers.setupAutoGeneratePassword('checkbox', 'password', undefined, 3000);

    checkbox.checked = true;
    change(checkbox);
    await vi.advanceTimersByTimeAsync(1000);
    checkbox.checked = false;
    change(checkbox);
    checkbox.checked = true;
    change(checkbox);

    await vi.advanceTimersByTimeAsync(2000);
    expect(password.type).toBe('text');
    await vi.advanceTimersByTimeAsync(1000);
    expect(password.type).toBe('password');
  });

  it('can be imported without browser globals', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/utils/form-helpers.js')
    ).resolves.toBeDefined();
  });

  it('exposes the API and legacy visibility helper in a browser', async () => {
    const { browserWindow } = setupDom({});
    const helpers = await loadFormHelpers();

    expect(browserWindow.FormHelpers).toBe(helpers);
    expect(browserWindow.togglePasswordVisibility).toBe(
      helpers.togglePasswordVisibility
    );
    expect(helpers.DEFAULT_PASSWORD_POLICY).toEqual({
      minLength: 8,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecial: true,
      requireUppercase: true,
    });
  });

  it('warns when password visibility has no target input', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupDom({});
    const helpers = await loadFormHelpers();

    helpers.togglePasswordVisibility('missing');

    expect(warning).toHaveBeenCalledWith(
      "[FormHelpers] Input element 'missing' not found"
    );
  });

  it('shows and hides passwords while refreshing custom Lucide icons', async () => {
    const password = makeInput();
    const icon = makeInput('icon');
    const { createIcons } = setupDom(
      { custom: icon, password },
      { lucide: true }
    );
    const helpers = await loadFormHelpers();

    helpers.togglePasswordVisibility('password', 'custom');
    expect(password.type).toBe('text');
    expect(icon.setAttribute).toHaveBeenCalledWith('data-lucide', 'eye-off');

    helpers.togglePasswordVisibility('password', 'custom');
    expect(password.type).toBe('password');
    expect(icon.setAttribute).toHaveBeenCalledWith('data-lucide', 'eye');
    expect(createIcons).toHaveBeenCalledTimes(2);
  });

  it('toggles without an icon or Lucide runtime', async () => {
    const password = makeInput();
    setupDom({ password });
    const helpers = await loadFormHelpers();

    helpers.togglePasswordVisibility('password');
    helpers.togglePasswordVisibility('password');

    expect(password.type).toBe('password');
  });

  it('generates a secure password meeting the default policy and minimum length', async () => {
    setupDom({}, { randomValues: Array.from({ length: 64 }, (_, i) => i) });
    const helpers = await loadFormHelpers();

    const password = helpers.generateSecurePassword({}, 4);

    expect(password).toHaveLength(8);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/);
  });

  it('uses the complete character pool when a policy has no required groups', async () => {
    setupDom({});
    const helpers = await loadFormHelpers();

    const password = helpers.generateSecurePassword(
      {
        minLength: 3,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecial: false,
        requireUppercase: false,
      },
      3
    );

    expect(password).toBe('AAA');
  });

  it.each([
    ['', { message: 'Email is required', valid: false }],
    [
      'bad-address',
      { message: 'Please enter a valid email address', valid: false },
    ],
    ['  user@example.com  ', { message: '', valid: true }],
  ])('validates email %j', async (email, expected) => {
    setupDom({});
    const helpers = await loadFormHelpers();
    expect(helpers.validateEmail(email)).toEqual(expected);
  });

  it('rejects a non-string email at runtime', async () => {
    setupDom({});
    const helpers = await loadFormHelpers();
    expect(helpers.validateEmail(null as unknown as string)).toEqual({
      message: 'Email is required',
      valid: false,
    });
  });

  it.each([
    ['', 'password', 'Both password fields are required'],
    ['password', '', 'Both password fields are required'],
    ['password', 'different', 'Passwords do not match'],
    ['password', 'password', 'Passwords match'],
  ])(
    'validates matching password fields',
    async (password, confirm, message) => {
      setupDom({});
      const helpers = await loadFormHelpers();
      expect(helpers.validatePasswordMatch(password, confirm)).toEqual({
        message,
        valid: message === 'Passwords match',
      });
    }
  );

  it.each([
    ['a', 'weak', 20],
    ['abcdefgh', 'fair', 40],
    ['Abcdefgh', 'good', 60],
    ['Abcdefg1', 'strong', 80],
    ['Abcdefg1!', 'strong', 100],
  ] as const)('rates %s as %s', async (password, level, score) => {
    setupDom({});
    const helpers = await loadFormHelpers();
    const result = helpers.calculatePasswordStrength(password);
    expect(result.level).toBe(level);
    expect(result.score).toBe(score);
  });

  it('treats disabled strength requirements as met', async () => {
    setupDom({});
    const helpers = await loadFormHelpers();
    const result = helpers.calculatePasswordStrength('abc', {
      minLength: 3,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecial: false,
      requireUppercase: false,
    });
    expect(result).toEqual({
      level: 'strong',
      requirements: {
        length: true,
        lowercase: true,
        numbers: true,
        special: true,
        uppercase: true,
      },
      score: 100,
    });
  });

  it.each([
    ['', 'Password is required'],
    ['Ab1!', 'Password must be at least 8 characters'],
    ['abcdefg1!', 'Password must contain at least one uppercase letter'],
    ['ABCDEFG1!', 'Password must contain at least one lowercase letter'],
    ['Abcdefgh!', 'Password must contain at least one number'],
    ['Abcdefgh1', 'Password must contain at least one special character'],
    ['Abcdefgh1!', 'Password meets requirements'],
  ])('validates password policy outcome for %j', async (password, message) => {
    setupDom({});
    const helpers = await loadFormHelpers();
    expect(helpers.validatePassword(password)).toEqual({
      message,
      valid: message === 'Password meets requirements',
    });
  });

  it('accepts a password when optional policy checks are disabled', async () => {
    setupDom({});
    const helpers = await loadFormHelpers();
    expect(
      helpers.validatePassword('abc', {
        minLength: 3,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecial: false,
        requireUppercase: false,
      })
    ).toEqual({ message: 'Password meets requirements', valid: true });
  });

  it.each(['password', 'confirm', 'indicator', 'text'])(
    'warns when password-match setup lacks %s',
    async missing => {
      const elements = {
        confirm: makeInput(),
        indicator: makeInput('div'),
        password: makeInput(),
        text: makeInput('span'),
      };
      delete elements[missing as keyof typeof elements];
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setupDom(elements);
      const helpers = await loadFormHelpers();

      helpers.setupPasswordMatchIndicator(
        'password',
        'confirm',
        'indicator',
        'text'
      );

      expect(warning).toHaveBeenCalledWith(
        '[FormHelpers] Missing elements for password match setup'
      );
    }
  );

  it('updates password-match feedback for empty, mismatched, and matching input', async () => {
    const password = makeInput();
    const confirm = makeInput();
    const indicator = makeInput('div');
    const text = makeInput('span');
    setupDom({ confirm, indicator, password, text });
    const helpers = await loadFormHelpers();
    helpers.setupPasswordMatchIndicator(
      'password',
      'confirm',
      'indicator',
      'text'
    );

    password.listener?.call(password);
    expect(indicator.classList.add).toHaveBeenCalledWith('hidden');

    password.value = 'first';
    confirm.value = 'second';
    confirm.listener?.call(confirm);
    expect(indicator.classList.remove).toHaveBeenCalledWith('hidden');
    expect(text.textContent).toBe('✗ Passwords do not match');
    expect(text.className).toContain('text-red-600');

    confirm.value = 'first';
    confirm.listener?.call(confirm);
    expect(text.textContent).toBe('✓ Passwords match');
    expect(text.className).toContain('text-green-600');
  });

  it.each(['checkbox', 'password'])(
    'warns when auto-generation setup lacks %s',
    async missing => {
      const elements = {
        checkbox: makeInput('checkbox'),
        password: makeInput(),
      };
      delete elements[missing as keyof typeof elements];
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setupDom(elements);
      const helpers = await loadFormHelpers();

      helpers.setupAutoGeneratePassword('checkbox', 'password');

      expect(warning).toHaveBeenCalledWith(
        '[FormHelpers] Missing elements for auto-generate password setup'
      );
    }
  );

  it('generates, reveals, hides, and clears both password fields', async () => {
    vi.useFakeTimers();
    const checkbox = makeInput('checkbox');
    const password = makeInput();
    const confirm = makeInput();
    setupDom({ checkbox, confirm, password });
    const helpers = await loadFormHelpers();
    helpers.setupAutoGeneratePassword('checkbox', 'password', 'confirm');

    checkbox.checked = true;
    change(checkbox);
    expect(password.value).toHaveLength(12);
    expect(confirm.value).toBe(password.value);
    expect(password.readOnly).toBe(true);
    expect(confirm.readOnly).toBe(true);
    expect(password.type).toBe('text');
    expect(confirm.type).toBe('text');
    expect(password.dispatchEvent).toHaveBeenCalledWith(expect.any(Event));
    expect(confirm.dispatchEvent).toHaveBeenCalledWith(expect.any(Event));

    await vi.advanceTimersByTimeAsync(3000);
    expect(password.type).toBe('password');
    expect(confirm.type).toBe('password');

    checkbox.checked = false;
    change(checkbox);
    expect(password.value).toBe('');
    expect(confirm.value).toBe('');
    expect(password.readOnly).toBe(false);
    expect(confirm.readOnly).toBe(false);
  });
});
