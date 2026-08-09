import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ButtonFixture,
  ElementFixture,
  FormFixture,
  InputFixture,
} from './support/otp-manager-fixture.js';

class PasswordInputFixture extends InputFixture {
  public parentElement: ElementFixture | null = new ElementFixture();
  public readonly setCustomValidity = vi.fn();
  public type = 'password';
}

class TextFixture extends ElementFixture {
  public innerHTML = '';
  public textContent = '';
}

const defaultPasswordPolicy = {
  minLength: 8,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
  requireUppercase: true,
};

interface SetupOptions {
  absentIds?: string[];
  hasButton?: boolean;
  hasForm?: boolean;
  hasState?: boolean;
  querySelectorError?: Error;
  rawState?: string;
}

function setupDom(state: Record<string, unknown>, options: SetupOptions = {}) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const alert = vi.fn();
  const button = new ButtonFixture();
  const form = new FormFixture(options.hasButton === false ? null : button);
  const password = new PasswordInputFixture();
  const confirmPassword = new PasswordInputFixture();
  const passwordToggle = new ButtonFixture();
  const confirmPasswordToggle = new ButtonFixture();
  const passwordEye = new TextFixture();
  const confirmPasswordEye = new TextFixture();
  const checks = new Map(
    [
      'length-check',
      'uppercase-check',
      'lowercase-check',
      'number-check',
      'symbol-check',
    ].map(id => [id, new TextFixture()])
  );
  const elements = new Map<string, unknown>([
    ['password', password],
    ['confirmPassword', confirmPassword],
    ['password-eye', passwordEye],
    ['confirmPassword-eye', confirmPasswordEye],
    ...checks,
  ]);
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
      if (id === '___SOCIAL_PASSWORD_SETUP_STATE___') {
        return options.hasState === false
          ? null
          : { textContent: options.rawState ?? JSON.stringify(state) };
      }
      if (options.absentIds?.includes(id)) return null;
      return elements.get(id) ?? null;
    }),
    querySelector: vi.fn((selector: string) => {
      if (options.querySelectorError) throw options.querySelectorError;
      if (selector === 'form') return options.hasForm === false ? null : form;
      if (selector === '#password-toggle') {
        return options.absentIds?.includes('password-toggle')
          ? null
          : passwordToggle;
      }
      if (selector === '#confirm-password-toggle') {
        return options.absentIds?.includes('confirm-password-toggle')
          ? null
          : confirmPasswordToggle;
      }
      return null;
    }),
    querySelectorAll: vi.fn(() =>
      [
        options.absentIds?.includes('password') ? null : password,
        options.absentIds?.includes('confirmPassword') ? null : confirmPassword,
      ].filter(Boolean)
    ),
  });

  return {
    alert,
    button,
    checks,
    confirmPassword,
    confirmPasswordEye,
    confirmPasswordToggle,
    error,
    form,
    log,
    password,
    passwordEye,
    passwordToggle,
    runReady: () => ready?.(),
    warn,
  };
}

describe('social password setup manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('wires both password toggles using the selectors shipped by the template', async () => {
    const context = setupDom({ passwordPolicy: defaultPasswordPolicy });

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.passwordToggle.trigger('click');
    context.confirmPasswordToggle.trigger('click');

    expect(context.password.type).toBe('text');
    expect(context.confirmPassword.type).toBe('text');
    expect(context.passwordEye.innerHTML).toContain('M13.875');
    expect(context.confirmPasswordEye.innerHTML).toContain('M13.875');

    context.passwordToggle.trigger('click');
    context.confirmPasswordToggle.trigger('click');
    expect(context.password.type).toBe('password');
    expect(context.confirmPassword.type).toBe('password');
    expect(context.passwordEye.innerHTML).toContain('M15 12');
    expect(context.confirmPasswordEye.innerHTML).toContain('M15 12');
  });

  it('falls back safely when a translation is not a non-blank string', async () => {
    const context = setupDom({
      passwordPolicy: defaultPasswordPolicy,
      translations: { passwordRequired: 42 },
    });

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith('Please enter your password');
  });

  it('updates every strength indicator for weak and strong passwords', async () => {
    const context = setupDom({ passwordPolicy: defaultPasswordPolicy });

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.password.value = 'weak';
    context.password.trigger('input');
    expect(
      [...context.checks.values()].map(check => check.textContent)
    ).toEqual(['❌', '❌', '✅', '❌', '❌']);

    context.password.value = 'Strong1!';
    context.password.trigger('input');
    expect(
      [...context.checks.values()].map(check => check.textContent)
    ).toEqual(['✅', '✅', '✅', '✅', '✅']);
  });

  it('sets and clears confirmation validity using localized mismatch copy', async () => {
    const context = setupDom({
      passwordPolicy: defaultPasswordPolicy,
      translations: { passwordsDoNotMatch: 'Passwords differ' },
    });

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.password.value = 'Strong1!';
    context.confirmPassword.value = 'Different1!';
    context.confirmPassword.trigger('input');
    expect(context.confirmPassword.setCustomValidity).toHaveBeenLastCalledWith(
      'Passwords differ'
    );

    context.confirmPassword.value = 'Strong1!';
    context.confirmPassword.trigger('input');
    context.confirmPassword.value = '';
    context.confirmPassword.trigger('input');
    expect(context.confirmPassword.setCustomValidity).toHaveBeenLastCalledWith(
      ''
    );
  });

  it('validates required and matching fields in user-correctable order', async () => {
    const context = setupDom({
      passwordPolicy: defaultPasswordPolicy,
      translations: {
        confirmPasswordRequired: 'Confirm it',
        passwordRequired: 'Enter it',
        passwordsDoNotMatch: 'Match them',
      },
    });

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.form.trigger('submit');
    expect(context.alert).toHaveBeenLastCalledWith('Enter it');
    expect(context.password.focus).toHaveBeenCalledOnce();

    context.password.value = 'Strong1!';
    context.form.trigger('submit');
    expect(context.alert).toHaveBeenLastCalledWith('Confirm it');
    expect(context.confirmPassword.focus).toHaveBeenCalledOnce();

    context.confirmPassword.value = 'Different1!';
    context.form.trigger('submit');
    expect(context.alert).toHaveBeenLastCalledWith('Match them');
    expect(context.confirmPassword.focus).toHaveBeenCalledTimes(2);
  });

  it('submits once and restores controls after the recovery timeout', async () => {
    const context = setupDom({
      config: { errorRecoveryTimeout: 1000 },
      passwordPolicy: defaultPasswordPolicy,
      translations: {
        completeRegistration: 'Complete now',
        completingRegistration: 'Completing now',
        errorRecovery: 'Please retry',
      },
    });
    context.password.value = 'Strong1!';
    context.confirmPassword.value = 'Strong1!';

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    const firstSubmit = context.form.trigger('submit');
    const duplicateSubmit = context.form.trigger('submit');

    expect(firstSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.passwordToggle.disabled).toBe(true);
    expect(context.confirmPasswordToggle.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Completing now');

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(900);

    expect(context.alert).toHaveBeenCalledWith('Please retry');
    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toBe('Complete now');
    expect(context.passwordToggle.disabled).toBe(false);
    expect(context.confirmPasswordToggle.disabled).toBe(false);
    expect(context.form.classList.remove).toHaveBeenCalledWith('form-disabled');
  });

  it('adds and removes focus rings, including inputs without wrappers', async () => {
    const context = setupDom({ passwordPolicy: defaultPasswordPolicy });
    const passwordParent = context.password.parentElement!;

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.password.trigger('focus');
    context.password.trigger('blur');
    expect(passwordParent.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-blue-500/20'
    );
    expect(passwordParent.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-blue-500/20'
    );

    context.confirmPassword.parentElement = null;
    context.confirmPassword.trigger('focus');
    context.confirmPassword.trigger('blur');
  });

  it('falls back from translation-key placeholders but preserves long dotted copy', async () => {
    const keyed = setupDom({
      passwordPolicy: defaultPasswordPolicy,
      translations: { passwordRequired: 'auth.passwordRequired' },
    });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    keyed.runReady();
    keyed.form.trigger('submit');
    expect(keyed.alert).toHaveBeenCalledWith('Please enter your password');
    expect(keyed.warn).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager]',
      expect.stringContaining('Translation key detected')
    );

    vi.resetModules();
    const literal =
      'password.required.but.this.is.a.deliberately.long.user.message';
    const dotted = setupDom({
      passwordPolicy: defaultPasswordPolicy,
      translations: { passwordRequired: literal },
    });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    dotted.runReady();
    dotted.form.trigger('submit');
    expect(dotted.alert).toHaveBeenCalledWith(literal);
  });

  it('normalizes malformed and partial password policies', async () => {
    const malformed = setupDom({ passwordPolicy: 'invalid' });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    malformed.runReady();
    expect(malformed.warn).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager]',
      'Invalid password policy provided, using defaults',
      { policy: 'invalid' }
    );

    vi.resetModules();
    const partial = setupDom({
      config: { debug: true },
      passwordPolicy: { minLength: 0 },
    });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    partial.runReady();
    expect(partial.log).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager]',
      'SocialPasswordSetupManager initialized',
      expect.objectContaining({ passwordPolicy: expect.any(Object) })
    );
    partial.password.value = '12345678';
    partial.password.trigger('input');
    expect(partial.checks.get('length-check')?.textContent).toBe('✅');
  });

  it('contains absent optional inputs, checks, toggles, and eyes', async () => {
    const context = setupDom(
      { passwordPolicy: defaultPasswordPolicy },
      {
        absentIds: [
          'confirmPassword',
          'confirm-password-toggle',
          'length-check',
          'uppercase-check',
          'lowercase-check',
          'number-check',
          'symbol-check',
        ],
      }
    );

    await import('../../../src/assets/js/auth/social-password-setup.js');
    context.runReady();
    context.password.value = 'Strong1!';
    context.password.trigger('input');
    context.passwordToggle.trigger('click');
    expect(context.password.type).toBe('text');

    vi.resetModules();
    const missingEye = setupDom(
      { passwordPolicy: defaultPasswordPolicy },
      { absentIds: ['password-eye'] }
    );
    await import('../../../src/assets/js/auth/social-password-setup.js');
    missingEye.runReady();
    missingEye.passwordToggle.trigger('click');
    expect(missingEye.password.type).toBe('password');

    vi.resetModules();
    const missingPassword = setupDom(
      { passwordPolicy: defaultPasswordPolicy },
      { absentIds: ['password', 'password-toggle'] }
    );
    await import('../../../src/assets/js/auth/social-password-setup.js');
    missingPassword.runReady();
    missingPassword.confirmPassword.value = 'Strong1!';
    missingPassword.form.trigger('submit');
    vi.advanceTimersByTime(100);
    expect(missingPassword.form.nativeSubmit).toHaveBeenCalledOnce();

    vi.resetModules();
    const missingToggles = setupDom(
      {
        config: { errorRecoveryTimeout: 1000 },
        passwordPolicy: defaultPasswordPolicy,
      },
      { absentIds: ['password-toggle', 'confirm-password-toggle'] }
    );
    missingToggles.password.value = 'Strong1!';
    missingToggles.confirmPassword.value = 'Strong1!';
    await import('../../../src/assets/js/auth/social-password-setup.js');
    missingToggles.runReady();
    missingToggles.form.trigger('submit');
    vi.advanceTimersByTime(1000);
    expect(missingToggles.button.disabled).toBe(false);
  });

  it('does not install submission handling without a form or submit button', async () => {
    const noForm = setupDom(
      { passwordPolicy: defaultPasswordPolicy },
      { hasForm: false }
    );
    await import('../../../src/assets/js/auth/social-password-setup.js');
    noForm.runReady();
    expect(noForm.form.listeners.has('submit')).toBe(false);

    vi.resetModules();
    const noButton = setupDom(
      { passwordPolicy: defaultPasswordPolicy },
      { hasButton: false }
    );
    await import('../../../src/assets/js/auth/social-password-setup.js');
    noButton.runReady();
    expect(noButton.form.listeners.has('submit')).toBe(false);
  });

  it('uses fallback configuration for malformed, empty, and absent state', async () => {
    const malformed = setupDom({}, { rawState: '{bad json' });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    malformed.runReady();
    expect(malformed.error).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(malformed.form.listeners.has('submit')).toBe(true);

    vi.resetModules();
    const empty = setupDom({}, { rawState: '' });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    empty.runReady();
    empty.form.trigger('submit');
    expect(empty.alert).toHaveBeenCalledWith('Please enter your password');

    vi.resetModules();
    const absent = setupDom({}, { hasState: false });
    await import('../../../src/assets/js/auth/social-password-setup.js');
    absent.runReady();
    expect(absent.error).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager] No configuration data found in DOM'
    );
    expect(absent.form.listeners.has('submit')).toBe(true);
  });

  it('contains initialization and both fallback failure paths', async () => {
    const failure = new Error('DOM unavailable');
    const configured = setupDom(
      { passwordPolicy: defaultPasswordPolicy },
      { querySelectorError: failure }
    );
    await import('../../../src/assets/js/auth/social-password-setup.js');
    configured.runReady();
    expect(configured.error).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager] Failed to initialize:',
      failure
    );
    expect(configured.error).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager] Fallback initialization failed:',
      failure
    );

    vi.resetModules();
    const absent = setupDom(
      {},
      { hasState: false, querySelectorError: failure }
    );
    await import('../../../src/assets/js/auth/social-password-setup.js');
    absent.runReady();
    expect(absent.error).toHaveBeenCalledWith(
      '[SocialPasswordSetupManager] Fallback initialization failed:',
      failure
    );
  });
});
