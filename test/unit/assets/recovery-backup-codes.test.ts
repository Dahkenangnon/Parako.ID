import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setupOtpDom,
  type SetupOtpDomOptions,
} from './support/otp-manager-fixture.js';

const defaultBackupCodeConfig = {
  allowUppercase: true,
  autoFocus: true,
  codeFormat: 'XXXX-XXXX',
  codeLength: 8,
  enableBackspace: true,
  enablePaste: true,
  shakeAnimationDuration: 500,
};

function setupDom(
  state: Record<string, unknown>,
  options: SetupOtpDomOptions = {}
) {
  return setupOtpDom('___RECOVERY_BACKUP_CODES_STATE___', state, {
    containerId: 'backup-code-container',
    inputCount: 8,
    ...options,
  });
}

describe('recovery backup codes manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when a translation is not a non-blank string', async () => {
    const context = setupDom({
      config: defaultBackupCodeConfig,
      translations: { codeInvalid: 42 },
    });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 8-character backup code'
    );
  });

  it('replaces the pasted suffix instead of retaining stale characters', async () => {
    const context = setupDom({ config: defaultBackupCodeConfig });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    'ABCDEF12'.split('').forEach((value, index) => {
      context.otpInputs[index].value = value;
    });
    context.otpInputs[4].trigger('paste', {
      clipboardData: { getData: vi.fn(() => '3-4') },
    });

    expect(context.otpInputs.map(input => input.value)).toEqual([
      'A',
      'B',
      'C',
      'D',
      '3',
      '4',
      '',
      '',
    ]);
    expect(context.hiddenInput.value).toBe('ABCD34');
    expect(context.otpInputs[6].focus).toHaveBeenCalledOnce();
  });

  it('normalizes typed input, serializes dashed codes, and handles navigation', async () => {
    const context = setupDom({ config: defaultBackupCodeConfig });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();

    context.otpInputs.forEach(input => {
      input.value = 'F';
    });
    context.otpInputs[0].trigger('paste');
    expect(context.otpInputs.every(input => input.value === '')).toBe(true);
    expect(context.hiddenInput.value).toBe('');

    'abcd-ef12'
      .replace('-', '')
      .split('')
      .forEach((value, index) => {
        context.otpInputs[index].value = value;
        context.otpInputs[index].trigger('input');
      });
    expect(context.otpInputs.map(input => input.value)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      '1',
      '2',
    ]);
    expect(context.hiddenInput.value).toBe('ABCD-EF12');

    context.otpInputs[2].value = '';
    context.otpInputs[2].trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1].focus).toHaveBeenCalledTimes(2);
    context.otpInputs[2].value = 'C';
    context.otpInputs[2].trigger('keydown', { key: 'Backspace' });
    context.otpInputs[2].trigger('keydown', { key: 'Delete' });
    context.otpInputs[0].value = '';
    context.otpInputs[0].trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1].focus).toHaveBeenCalledTimes(2);

    context.otpInputs[0].trigger('focus');
    context.otpInputs[0].trigger('blur');
    expect(context.otpInputs[0].classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(context.otpInputs[0].classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it('preserves case and serializes an undashed code when uppercase is disabled', async () => {
    const context = setupDom({
      config: {
        ...defaultBackupCodeConfig,
        allowUppercase: false,
        codeFormat: 'XXXXXXXX',
      },
    });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    context.otpInputs[0].value = 'z-a1';
    context.otpInputs[0].trigger('input');
    expect(context.otpInputs[0].value).toBe('a1');

    context.otpInputs[1].trigger('paste', {
      clipboardData: { getData: vi.fn(() => 'bC-23') },
    });
    expect(context.otpInputs.slice(1, 5).map(input => input.value)).toEqual([
      'b',
      'C',
      '2',
      '3',
    ]);
    expect(context.hiddenInput.value).toBe('a1bC23');
  });

  it('honors disabled navigation features and autofocus', async () => {
    const context = setupDom({
      config: {
        ...defaultBackupCodeConfig,
        autoFocus: false,
        enableBackspace: false,
        enablePaste: false,
      },
    });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();

    expect(context.otpInputs[0].focus).not.toHaveBeenCalled();
    expect(context.otpInputs[0].listeners.has('keydown')).toBe(false);
    expect(context.otpInputs[0].listeners.has('paste')).toBe(false);
  });

  it('submits once and restores every control after the recovery timeout', async () => {
    const context = setupDom({
      config: { ...defaultBackupCodeConfig, errorRecoveryTimeout: 1000 },
      translations: {
        errorRecovery: 'Try another backup code',
        recoverAccount: 'Recover now',
        recoveringAccount: 'Recovering account',
      },
    });
    context.hiddenInput.value = 'ABCD-EF12';

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    const firstSubmit = context.form.trigger('submit');
    const duplicateSubmit = context.form.trigger('submit');

    expect(firstSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Recovering account');
    expect(context.form.classList.add).toHaveBeenCalledWith('form-disabled');
    expect(context.otpInputs.every(input => input.disabled)).toBe(true);

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(900);

    expect(context.alert).toHaveBeenCalledWith('Try another backup code');
    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toBe('Recover now');
    expect(context.form.classList.remove).toHaveBeenCalledWith('form-disabled');
    expect(context.otpInputs.every(input => !input.disabled)).toBe(true);
  });

  it('focuses the first empty cell and falls back from translation keys', async () => {
    const context = setupDom({
      config: defaultBackupCodeConfig,
      translations: { codeInvalid: 'auth.codeInvalid' },
    });
    context.otpInputs[0].value = 'A';

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    const event = context.form.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(context.otpInputs[1].focus).toHaveBeenCalledOnce();
    expect(context.otpContainer.classList.add).toHaveBeenCalledWith(
      'animate-pulse'
    );
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 8-character backup code'
    );
    expect(context.warn).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager]',
      expect.stringContaining('Translation key detected')
    );

    vi.advanceTimersByTime(500);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('preserves long dotted user-facing translation copy', async () => {
    const translation =
      'recovery.backup.code.invalid.but.this.is.a.long.user.message';
    const context = setupDom({
      config: defaultBackupCodeConfig,
      translations: { codeInvalid: translation },
    });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(translation);
  });

  it.each([
    { codeLength: 2, code: 'ABCDEF', inputCount: 6 },
    { codeLength: 99, code: 'ABCDEF123456', inputCount: 12 },
  ])(
    'clamps configuration bounds for a $inputCount-character backup code',
    async ({ code, codeLength, inputCount }) => {
      const context = setupDom(
        {
          config: {
            ...defaultBackupCodeConfig,
            codeFormat: 'XXXXXXXX',
            codeLength,
          },
        },
        { inputCount }
      );
      context.hiddenInput.value = code;

      await import('../../../src/assets/js/auth/recovery-backup-codes.js');
      context.runReady();
      context.form.trigger('submit');
      vi.advanceTimersByTime(100);

      expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    }
  );

  it('uses validated defaults for malformed configuration', async () => {
    const context = setupDom({ config: 'invalid configuration' });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid configuration' }
    );
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();
  });

  it('normalizes configuration values and emits debug lifecycle logs', async () => {
    const context = setupDom({
      config: {
        ...defaultBackupCodeConfig,
        codeFormat: 'invalid',
        codeLength: 'invalid',
        debug: true,
        shakeAnimationDuration: 'invalid',
      },
    });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    expect(context.log).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager]',
      'RecoveryBackupCodesManager initialized',
      expect.objectContaining({ config: expect.any(Object) })
    );

    context.otpInputs[0].value = 'A';
    context.otpInputs[0].trigger('input');
    expect(context.hiddenInput.value).toBe('A');
    context.form.trigger('submit');
    vi.advanceTimersByTime(499);
    expect(context.otpContainer.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('focuses the first rendered input when a filled short form is invalid', async () => {
    const context = setupDom(
      { config: defaultBackupCodeConfig },
      { inputCount: 4 }
    );
    context.otpInputs.forEach(input => {
      input.value = 'A';
    });

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();
    context.otpInputs[0].trigger('input');
    context.form.trigger('submit');

    expect(context.otpInputs[0].focus).toHaveBeenCalledTimes(2);
  });

  it('does not install form handling without both form and submit button', async () => {
    const noForm = setupDom(
      { config: defaultBackupCodeConfig },
      { hasForm: false }
    );
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    noForm.runReady();
    expect(noForm.form.listeners.has('submit')).toBe(false);

    vi.resetModules();
    const noButton = setupDom(
      { config: defaultBackupCodeConfig },
      { hasButton: false }
    );
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    noButton.runReady();
    expect(noButton.form.listeners.has('submit')).toBe(false);
  });

  it('contains missing optional recovery elements', async () => {
    const noHiddenInput = setupDom(
      { config: defaultBackupCodeConfig },
      { hasHiddenInput: false }
    );
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    noHiddenInput.runReady();
    noHiddenInput.otpInputs[0].value = 'A';
    noHiddenInput.otpInputs[0].trigger('input');
    noHiddenInput.form.trigger('submit');
    expect(noHiddenInput.alert).toHaveBeenCalledWith(
      'Please enter a valid 8-character backup code'
    );

    vi.resetModules();
    const noContainer = setupDom(
      { config: defaultBackupCodeConfig },
      { hasOtpContainer: false }
    );
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    noContainer.runReady();
    noContainer.form.trigger('submit');
    expect(noContainer.alert).toHaveBeenCalledWith(
      'Please enter a valid 8-character backup code'
    );
  });

  it('logs and stops when no backup-code inputs are rendered', async () => {
    const context = setupDom(
      { config: defaultBackupCodeConfig },
      { inputCount: 0 }
    );

    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager]',
      'No backup code inputs found'
    );
    expect(context.form.listeners.has('submit')).toBe(false);
  });

  it('uses fallback configuration for malformed, empty, and absent state', async () => {
    const malformed = setupDom({}, { rawState: '{bad json' });
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    malformed.runReady();
    expect(malformed.error).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(malformed.form.listeners.has('submit')).toBe(true);

    vi.resetModules();
    const empty = setupDom({}, { rawState: '' });
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    empty.runReady();
    empty.form.trigger('submit');
    expect(empty.alert).toHaveBeenCalledWith(
      'Please enter a valid 8-character backup code'
    );

    vi.resetModules();
    const absent = setupDom({}, { hasState: false });
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    absent.runReady();
    expect(absent.error).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager] No configuration data found in DOM'
    );
    expect(absent.otpInputs[0].focus).toHaveBeenCalledOnce();
  });

  it('contains initialization and both fallback failure paths', async () => {
    const failure = new Error('DOM unavailable');
    const configured = setupDom(
      { config: defaultBackupCodeConfig },
      { querySelectorError: failure }
    );
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    configured.runReady();
    expect(configured.error).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager] Failed to initialize:',
      failure
    );
    expect(configured.error).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager] Fallback initialization failed:',
      failure
    );

    vi.resetModules();
    const absent = setupDom(
      {},
      { hasState: false, querySelectorError: failure }
    );
    await import('../../../src/assets/js/auth/recovery-backup-codes.js');
    absent.runReady();
    expect(absent.error).toHaveBeenCalledWith(
      '[RecoveryBackupCodesManager] Fallback initialization failed:',
      failure
    );
  });
});
