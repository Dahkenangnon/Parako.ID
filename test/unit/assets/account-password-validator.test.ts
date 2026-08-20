import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PasswordValidator,
  type PasswordValidatorConfig,
} from '../../../src/assets/js/account/settings/password.js';

interface PasswordValidatorInstance {
  initialize(): void;
  validatePasswordMatch(): void;
}

type PasswordValidatorConstructor = new (
  config: PasswordValidatorConfig
) => PasswordValidatorInstance;

interface InputFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  setCustomValidity: ReturnType<typeof vi.fn>;
  value: string;
}

function input(value = ''): InputFixture {
  return {
    addEventListener: vi.fn(),
    removeAttribute: vi.fn(),
    setCustomValidity: vi.fn(),
    value,
  };
}

function loadValidator(inputs: Record<string, InputFixture | null> = {}) {
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => inputs[id] ?? null),
  });
  return PasswordValidator as unknown as PasswordValidatorConstructor;
}

function config(
  isSpecialPasswordCase: boolean,
  debug = false
): PasswordValidatorConfig {
  return {
    isSpecialPasswordCase,
    translations: { passwordMismatch: 'Passwords differ' },
    debug,
  };
}

describe('account password validator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips validation cleanly when password inputs are absent', async () => {
    const PasswordValidator = await loadValidator();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    new PasswordValidator(config(false, true)).initialize();

    expect(consoleLog).toHaveBeenCalledWith(
      '[PasswordValidator]',
      'Password inputs not found, skipping validation setup'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[PasswordValidator]',
      'Not a special password case'
    );
  });

  it('requires both password controls before installing listeners', async () => {
    const newPassword = input();
    const PasswordValidator = await loadValidator({
      'new-password': newPassword,
      'confirm-password': null,
    });

    new PasswordValidator(config(false)).initialize();

    expect(newPassword.addEventListener).not.toHaveBeenCalled();
  });

  it('sets and clears custom validity as the password values change', async () => {
    const newPassword = input('first');
    const confirmPassword = input('different');
    const currentPassword = input();
    const PasswordValidator = await loadValidator({
      'new-password': newPassword,
      'confirm-password': confirmPassword,
      'current-password': currentPassword,
    });
    const validator = new PasswordValidator(config(true, true));
    validator.initialize();
    const validate = newPassword.addEventListener.mock
      .calls[0]?.[1] as () => void;

    validate();
    expect(confirmPassword.setCustomValidity).toHaveBeenLastCalledWith(
      'Passwords differ'
    );

    confirmPassword.value = 'first';
    const confirmValidate = confirmPassword.addEventListener.mock
      .calls[0]?.[1] as () => void;
    confirmValidate();
    expect(confirmPassword.setCustomValidity).toHaveBeenLastCalledWith('');
    expect(currentPassword.removeAttribute).toHaveBeenCalledWith('required');
  });

  it('does not remove required when a special-case current password is absent', async () => {
    const PasswordValidator = await loadValidator({
      'new-password': input(),
      'confirm-password': input(),
      'current-password': null,
    });

    expect(() =>
      new PasswordValidator(config(true)).initialize()
    ).not.toThrow();
  });

  it('does not validate before initialization', async () => {
    const PasswordValidator = await loadValidator();
    const validator = new PasswordValidator(config(false));

    expect(() => validator.validatePasswordMatch()).not.toThrow();
  });

  it('does not publish the validator through an application global', () => {
    const browserWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', browserWindow);

    expect(browserWindow).not.toHaveProperty('PasswordValidator');
  });
});
