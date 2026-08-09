import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installResetPasswordBootstrap,
  setResetPasswordFormLocked,
} from '../../../src/assets/js/auth/reset-password.js';

interface EventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  target?: ElementFixture;
}

class ClassListFixture {
  public readonly add = vi.fn();
  public readonly remove = vi.fn();
}

class ElementFixture {
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

  constructor(public readonly submitButton: ElementFixture | null) {
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
  enableLanguageSelector: false,
  enablePasswordToggle: true,
  enableStrengthMeter: true,
  enablePasswordConfirmation: true,
};

const defaultPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSymbols: false,
};

function setupDom(
  options: {
    config?: Record<string, unknown>;
    domError?: Error;
    missingElementIds?: string[];
    passwordPolicy?: Record<string, unknown>;
    stateText?: string | null;
    translations?: Record<string, unknown>;
  } = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const alert = vi.fn();
  const submitButton = new ElementFixture();
  const form = new FormFixture(submitButton);
  const password = new ElementFixture();
  const confirmPassword = new ElementFixture();
  const togglePassword = new ElementFixture();
  const passwordStrength = new ElementFixture();
  const passwordFeedback = new ElementFixture();
  const languageSelector = new ElementFixture();
  const svg = new ElementFixture();
  const elements: Record<string, ElementFixture> = {
    'reset-password-form': form,
    password,
    'confirm-password': confirmPassword,
    'toggle-password': togglePassword,
    'password-strength': passwordStrength,
    'password-feedback': passwordFeedback,
    'language-selector': languageSelector,
  };
  const missingElementIds = new Set(options.missingElementIds ?? []);
  const stateText =
    options.stateText === undefined
      ? JSON.stringify({
          config: options.config ?? defaultConfig,
          passwordPolicy: options.passwordPolicy ?? defaultPolicy,
          translations: options.translations ?? {},
        })
      : options.stateText;

  password.setAttribute('type', 'password');
  confirmPassword.setAttribute('type', 'password');
  password.parentElement = new ElementFixture();
  confirmPassword.parentElement = new ElementFixture();
  togglePassword.setSvg(svg);

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === '___RESET_PASSWORD_STATE___') {
        return stateText === null ? null : { textContent: stateText };
      }
      if (options.domError) throw options.domError;
      if (missingElementIds.has(id)) return null;
      return elements[id] ?? null;
    }),
    querySelectorAll: vi.fn(() => [password, confirmPassword]),
  });

  return {
    alert,
    confirmPassword,
    form,
    languageSelector,
    password,
    passwordFeedback,
    passwordStrength,
    runReady: () => ready?.(),
    submitButton,
    svg,
    togglePassword,
  };
}

describe('setResetPasswordFormLocked', () => {
  it('locks interaction without disabling successful form controls', () => {
    const controls = [
      { name: '_csrf', disabled: false, style: {} },
      { name: 'token', disabled: false, style: {} },
      { name: 'password', disabled: false, style: {} },
      { name: 'confirm-password', disabled: false, style: {} },
    ];
    const form = {
      style: { pointerEvents: '' },
      classList: { add: vi.fn(), remove: vi.fn() },
      querySelectorAll: vi.fn().mockReturnValue(controls),
    } as unknown as HTMLFormElement;
    const submitButton = {
      disabled: false,
      style: { opacity: '', cursor: '', pointerEvents: '' },
    } as unknown as HTMLButtonElement;

    setResetPasswordFormLocked(form, submitButton, true);

    expect(submitButton.disabled).toBe(true);
    expect(form.style.pointerEvents).toBe('none');
    expect(form.classList.add).toHaveBeenCalledWith('form-disabled');
    expect(controls.every(control => control.disabled === false)).toBe(true);
  });
});

describe('reset password manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when a translation is not a non-blank string', async () => {
    const context = setupDom({
      translations: { passwordRequired: 42 },
    });

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your new password'
    );
  });

  it('never renders password strength beyond the meter boundary', async () => {
    const context = setupDom({
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
      },
    });

    installResetPasswordBootstrap();
    context.runReady();
    context.password.value = 'Abcdefgh1!';
    context.password.trigger('input');

    expect(context.passwordStrength.style.width).toBe('100%');
    expect(context.passwordFeedback.textContent).toBe('Strong password');
  });

  it('does not award strength for missing required character classes', async () => {
    const context = setupDom({
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
      },
    });

    installResetPasswordBootstrap();
    context.runReady();

    for (const password of [
      'abcdefgh1!',
      'ABCDEFGH1!',
      'Abcdefgh!',
      'Abcdefgh1',
    ]) {
      context.password.value = password;
      context.password.trigger('input');
      expect(context.passwordStrength.style.width).toBe('75%');
      expect(context.passwordFeedback.textContent).toBe('Good password');
    }
  });

  it('submits valid passwords once and restores interaction after timeout', async () => {
    const context = setupDom({
      config: { ...defaultConfig, errorRecoveryTimeout: 1000 },
      translations: {
        errorRecovery: 'Try the reset again',
        resetPassword: 'Reset it',
        resettingPassword: 'Resetting now',
      },
    });
    context.password.value = 'Abcdefgh1!';
    context.confirmPassword.value = 'Abcdefgh1!';

    installResetPasswordBootstrap();
    context.runReady();
    const firstSubmit = context.form.trigger('submit');
    const duplicateSubmit = context.form.trigger('submit');

    expect(firstSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.stopPropagation).toHaveBeenCalledOnce();
    expect(context.submitButton.disabled).toBe(true);
    expect(context.submitButton.innerHTML).toContain('Resetting now');

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(900);
    expect(context.submitButton.disabled).toBe(false);
    expect(context.submitButton.innerHTML).toBe('Reset it');
    expect(context.alert).toHaveBeenCalledWith('Try the reset again');
  });

  it('uses the default recovery window when the configured timeout is invalid', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        errorRecoveryTimeout: 'invalid',
      },
    });
    context.password.value = 'Abcdefgh1!';
    context.confirmPassword.value = 'Abcdefgh1!';

    installResetPasswordBootstrap();
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

  it.each([
    { configuredTimeout: 10, expectedTimeout: 1_000 },
    { configuredTimeout: 999_999, expectedTimeout: 300_000 },
  ])(
    'bounds recovery timeout $configuredTimeout to $expectedTimeout milliseconds',
    async ({ configuredTimeout, expectedTimeout }) => {
      const context = setupDom({
        config: {
          ...defaultConfig,
          errorRecoveryTimeout: configuredTimeout,
        },
      });
      context.password.value = 'Abcdefgh1!';
      context.confirmPassword.value = 'Abcdefgh1!';

      installResetPasswordBootstrap();
      context.runReady();
      context.form.trigger('submit');

      vi.advanceTimersByTime(expectedTimeout - 1);
      expect(context.submitButton.disabled).toBe(true);

      vi.advanceTimersByTime(1);
      expect(context.submitButton.disabled).toBe(false);
    }
  );

  it('requires password confirmation before submission', async () => {
    const context = setupDom({
      translations: { confirmPasswordRequired: 'Confirm the password' },
    });
    context.password.value = 'Abcdefgh1!';

    installResetPasswordBootstrap();
    context.runReady();
    const submission = context.form.trigger('submit');

    expect(submission.preventDefault).toHaveBeenCalledOnce();
    expect(context.alert).toHaveBeenCalledWith('Confirm the password');
    expect(context.confirmPassword.focus).toHaveBeenCalledOnce();
    expect(context.form.nativeSubmit).not.toHaveBeenCalled();
  });

  it('fails safely when the password input is missing from the form', async () => {
    const context = setupDom({ missingElementIds: ['password'] });

    installResetPasswordBootstrap();
    context.runReady();

    expect(() => context.form.trigger('submit')).not.toThrow();
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your new password'
    );
    expect(context.password.focus).not.toHaveBeenCalled();
  });

  it('fails safely when the required confirmation input is missing', async () => {
    const context = setupDom({
      missingElementIds: ['confirm-password'],
    });
    context.password.value = 'Abcdefgh1!';

    installResetPasswordBootstrap();
    context.runReady();

    expect(() => context.form.trigger('submit')).not.toThrow();
    expect(context.alert).toHaveBeenCalledWith(
      'Please confirm your new password'
    );
    expect(context.confirmPassword.focus).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match the password', async () => {
    const context = setupDom({
      translations: { passwordsDoNotMatch: 'Use the same password twice' },
    });
    context.password.value = 'Abcdefgh1!';
    context.confirmPassword.value = 'Different1!';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Use the same password twice');
    expect(context.confirmPassword.focus).toHaveBeenCalledOnce();
    expect(context.submitButton.disabled).toBe(false);
  });

  it('reports every unmet configured password requirement', async () => {
    const context = setupDom({
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
      },
      translations: {
        passwordRequiresLowercase: 'Add lowercase',
        passwordRequiresNumbers: 'Add a number',
        passwordRequiresSymbols: 'Add a symbol',
        passwordRequiresUppercase: 'Add uppercase',
        passwordTooShort: 'Use {minLength} characters',
      },
    });
    context.password.value = 'ABC';
    context.confirmPassword.value = 'ABC';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      [
        'Password requirements not met:',
        'Use 12 characters',
        'Add lowercase',
        'Add a number',
        'Add a symbol',
      ].join('\n')
    );
    expect(context.password.focus).toHaveBeenCalledOnce();
  });

  it('rejects a password missing a configured uppercase character', async () => {
    const context = setupDom({
      passwordPolicy: {
        ...defaultPolicy,
        requireUppercase: true,
      },
      translations: {
        passwordRequiresUppercase: 'Add an uppercase character',
      },
    });
    context.password.value = 'abcdefgh';
    context.confirmPassword.value = 'abcdefgh';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Password requirements not met:\nAdd an uppercase character'
    );
    expect(context.submitButton.disabled).toBe(false);
  });

  it('updates password-strength feedback across every visible state', async () => {
    const context = setupDom();

    installResetPasswordBootstrap();
    context.runReady();

    for (const [password, feedback, color] of [
      ['a', 'Weak password', 'bg-red-500'],
      ['abcdefgh', 'Fair password', 'bg-orange-500'],
      ['Abcdefgh', 'Good password', 'bg-yellow-500'],
      ['Abcdefgh1', 'Strong password', 'bg-green-500'],
      ['Abcdefgh1!', 'Strong password', 'bg-green-500'],
      ['ABCDEFGH1!', 'Strong password', 'bg-green-500'],
    ]) {
      context.password.value = password;
      context.password.trigger('input');
      expect(context.passwordFeedback.textContent).toBe(feedback);
      expect(context.passwordStrength.className).toContain(color);
    }
  });

  it('toggles password visibility and its accessible icon state', async () => {
    const context = setupDom();

    installResetPasswordBootstrap();
    context.runReady();
    context.togglePassword.trigger('click');

    expect(context.password.getAttribute('type')).toBe('text');
    expect(context.svg.innerHTML).toContain('M13.875 18.825');

    context.togglePassword.trigger('click');
    expect(context.password.getAttribute('type')).toBe('password');
    expect(context.svg.innerHTML).toContain('M15 12a3 3');
  });

  it('toggles password visibility when the optional eye icon is absent', async () => {
    const context = setupDom();
    context.togglePassword.setSvg(null);

    installResetPasswordBootstrap();
    context.runReady();

    expect(() => context.togglePassword.trigger('click')).not.toThrow();
    expect(context.password.getAttribute('type')).toBe('text');
  });

  it('adds and removes focus feedback on password fields', async () => {
    const context = setupDom();

    installResetPasswordBootstrap();
    context.runReady();
    context.password.trigger('focus');
    context.password.trigger('blur');

    expect(context.password.parentElement?.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(
      context.password.parentElement?.classList.remove
    ).toHaveBeenCalledWith('ring-2', 'ring-primary/20');
  });

  it('uses secure defaults for malformed configuration and policy data', async () => {
    const context = setupDom({
      config: 'invalid' as unknown as Record<string, unknown>,
      passwordPolicy: 'invalid' as unknown as Record<string, unknown>,
    });
    context.password.value = 'abcdefgh';
    context.confirmPassword.value = 'abcdefgh';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.submitButton.disabled).toBe(true);
    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('uses the secure default when minimum password length is zero', async () => {
    const context = setupDom({
      passwordPolicy: {
        ...defaultPolicy,
        minLength: 0,
      },
    });
    context.password.value = 'abcdefg';
    context.confirmPassword.value = 'abcdefg';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Password requirements not met:\nPassword must be at least 8 characters long'
    );
    expect(context.submitButton.disabled).toBe(false);
  });

  it('falls back when localized copy is still a translation key', async () => {
    const context = setupDom({
      translations: { passwordRequired: 'common.auth.password_required' },
    });

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter your new password'
    );
  });

  it('initializes safely without optional enhancements or a form', async () => {
    const context = setupDom({
      config: {
        enableLanguageSelector: false,
        enablePasswordToggle: false,
        enableStrengthMeter: false,
        enablePasswordConfirmation: false,
      },
      missingElementIds: [
        'reset-password-form',
        'toggle-password',
        'password-strength',
        'password-feedback',
        'language-selector',
      ],
    });

    installResetPasswordBootstrap();

    expect(() => context.runReady()).not.toThrow();
    expect(context.submitButton.disabled).toBe(false);
  });

  it('reports language selection when diagnostics are enabled', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const context = setupDom({
      config: {
        ...defaultConfig,
        debug: true,
        enableLanguageSelector: true,
      },
    });
    context.languageSelector.value = 'fr';

    installResetPasswordBootstrap();
    context.runReady();
    context.languageSelector.trigger('change');

    expect(log).toHaveBeenCalledWith(
      '[ResetPasswordManager]',
      'Language changed to:',
      'fr'
    );
  });

  it('recovers with secure defaults when embedded state is malformed', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({ stateText: '{invalid' });
    context.password.value = 'abcdefgh';
    context.confirmPassword.value = 'abcdefgh';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(error).toHaveBeenCalledWith(
      '[ResetPasswordManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(context.submitButton.disabled).toBe(true);
    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('uses secure defaults when the embedded state is empty', async () => {
    const context = setupDom({ stateText: '' });
    context.password.value = 'abcdefgh';
    context.confirmPassword.value = 'abcdefgh';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(context.submitButton.disabled).toBe(true);
    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('recovers with secure defaults when embedded state is absent', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({ stateText: null });
    context.password.value = 'abcdefgh';
    context.confirmPassword.value = 'abcdefgh';

    installResetPasswordBootstrap();
    context.runReady();
    context.form.trigger('submit');

    expect(error).toHaveBeenCalledWith(
      '[ResetPasswordManager] No configuration data found in DOM'
    );
    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('contains DOM failures during fallback initialization', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const domError = new Error('DOM unavailable');
    const context = setupDom({ domError, stateText: '{invalid' });

    installResetPasswordBootstrap();

    expect(() => context.runReady()).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[ResetPasswordManager] Fallback initialization failed:',
      domError
    );
  });
});
