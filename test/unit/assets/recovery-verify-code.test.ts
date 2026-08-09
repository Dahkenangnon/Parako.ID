import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultOtpConfig,
  setupOtpDom,
  type SetupOtpDomOptions,
} from './support/otp-manager-fixture.js';

function setupDom(
  state: Record<string, unknown>,
  options: SetupOtpDomOptions = {}
) {
  return setupOtpDom('___RECOVERY_VERIFY_CODE_STATE___', state, options);
}

describe('recovery verification code manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when a translation is not a non-blank string', async () => {
    const context = setupDom({
      config: defaultOtpConfig,
      translations: { codeInvalid: 42 },
    });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
  });

  it('replaces the existing OTP when a shorter code is pasted', async () => {
    const context = setupDom({ config: defaultOtpConfig });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    context.otpInputs.forEach((input, index) => {
      input.value = String(index + 1);
    });
    context.otpInputs[5].trigger('paste', {
      clipboardData: { getData: vi.fn(() => '4x2') },
    });

    expect(context.otpInputs.map(input => input.value)).toEqual([
      '4',
      '2',
      '',
      '',
      '',
      '',
    ]);
    expect(context.hiddenInput.value).toBe('42');
    expect(context.otpInputs[2].focus).toHaveBeenCalledOnce();
  });

  it('handles empty paste, typed input, keyboard navigation, and focus state', async () => {
    const context = setupDom({ config: defaultOtpConfig });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();

    context.otpInputs.forEach(input => {
      input.value = '7';
    });
    context.otpInputs[0].trigger('paste');
    expect(context.otpInputs.every(input => input.value === '')).toBe(true);
    expect(context.hiddenInput.value).toBe('');

    context.otpInputs[0].value = 'x8';
    context.otpInputs[0].trigger('input');
    expect(context.otpInputs[0].value).toBe('8');
    expect(context.otpInputs[1].focus).toHaveBeenCalledOnce();
    expect(context.hiddenInput.value).toBe('8');

    context.otpInputs[5].value = '9';
    context.otpInputs[5].trigger('input');
    expect(context.hiddenInput.value).toBe('89');

    context.otpInputs[2].trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1].focus).toHaveBeenCalledTimes(2);
    context.otpInputs[2].value = '3';
    context.otpInputs[2].trigger('keydown', { key: 'Backspace' });
    context.otpInputs[2].trigger('keydown', { key: 'Delete' });
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

  it('honors disabled navigation features and autofocus', async () => {
    const context = setupDom({
      config: {
        ...defaultOtpConfig,
        autoFocus: false,
        enableBackspace: false,
        enablePaste: false,
      },
    });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();

    expect(context.otpInputs[0].focus).not.toHaveBeenCalled();
    expect(context.otpInputs[0].listeners.has('keydown')).toBe(false);
    expect(context.otpInputs[0].listeners.has('paste')).toBe(false);
  });

  it('submits once and restores all controls after the recovery timeout', async () => {
    const context = setupDom({
      config: { ...defaultOtpConfig, errorRecoveryTimeout: 1000 },
      translations: {
        errorRecovery: 'Request a new recovery code',
        verifyingCode: 'Checking recovery code',
        verifyCode: 'Check recovery code',
      },
    });
    context.hiddenInput.value = '123456';

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    const firstSubmit = context.form.trigger('submit');
    const duplicateSubmit = context.form.trigger('submit');

    expect(firstSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Checking recovery code');
    expect(context.form.classList.add).toHaveBeenCalledWith('form-disabled');
    expect(context.otpInputs.every(input => input.disabled)).toBe(true);

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(900);

    expect(context.alert).toHaveBeenCalledWith('Request a new recovery code');
    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toBe('Check recovery code');
    expect(context.form.classList.remove).toHaveBeenCalledWith('form-disabled');
    expect(context.otpInputs.every(input => !input.disabled)).toBe(true);
  });

  it('focuses the first empty cell and falls back from translation keys', async () => {
    const context = setupDom({
      config: defaultOtpConfig,
      translations: { codeInvalid: 'auth.codeInvalid' },
    });
    context.otpInputs[0].value = '1';

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    const event = context.form.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(context.otpInputs[1].focus).toHaveBeenCalledOnce();
    expect(context.otpContainer.classList.add).toHaveBeenCalledWith(
      'animate-pulse'
    );
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
    expect(context.warn).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager]',
      expect.stringContaining('Translation key detected')
    );

    vi.advanceTimersByTime(500);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('preserves long dotted user-facing translation copy', async () => {
    const translation =
      'recovery.code.invalid.but.this.is.a.deliberately.long.user.message';
    const context = setupDom({
      config: defaultOtpConfig,
      translations: { codeInvalid: translation },
    });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(translation);
  });

  it.each([
    {
      codeLength: 2,
      code: '1234',
      inputCount: 4,
      shakeAnimationDuration: 10,
    },
    {
      codeLength: 99,
      code: '1234567890',
      inputCount: 10,
      shakeAnimationDuration: 9999,
    },
  ])(
    'clamps configuration bounds for a $inputCount-digit recovery code',
    async ({ code, codeLength, inputCount, shakeAnimationDuration }) => {
      const context = setupDom(
        {
          config: {
            ...defaultOtpConfig,
            codeLength,
            shakeAnimationDuration,
          },
        },
        { inputCount }
      );
      context.hiddenInput.value = code;

      await import('../../../src/assets/js/auth/recovery-verify-code.js');
      context.runReady();
      context.form.trigger('submit');
      vi.advanceTimersByTime(100);

      expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    }
  );

  it('uses validated defaults for a malformed truthy configuration', async () => {
    const context = setupDom({ config: 'invalid configuration' });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid configuration' }
    );
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();
  });

  it('normalizes invalid numeric values and emits debug lifecycle logs', async () => {
    const context = setupDom({
      config: {
        ...defaultOtpConfig,
        codeLength: 'not-a-number',
        debug: true,
        shakeAnimationDuration: 'not-a-number',
      },
    });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    expect(context.log).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager]',
      'RecoveryVerifyCodeManager initialized',
      expect.objectContaining({ config: expect.any(Object) })
    );

    context.form.trigger('submit');
    vi.advanceTimersByTime(499);
    expect(context.otpContainer.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('focuses the first rendered OTP when a fully filled short form is invalid', async () => {
    const context = setupDom({ config: defaultOtpConfig }, { inputCount: 4 });
    context.otpInputs.forEach(input => {
      input.value = '1';
    });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();
    context.otpInputs[0].trigger('input');
    context.form.trigger('submit');

    expect(context.otpInputs[0].focus).toHaveBeenCalledTimes(2);
  });

  it('does not install form handling without both form and submit button', async () => {
    const noForm = setupDom({ config: defaultOtpConfig }, { hasForm: false });
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    noForm.runReady();
    expect(noForm.form.listeners.has('submit')).toBe(false);

    vi.resetModules();
    const noButton = setupDom(
      { config: defaultOtpConfig },
      { hasButton: false }
    );
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    noButton.runReady();
    expect(noButton.form.listeners.has('submit')).toBe(false);
  });

  it('contains missing optional verification elements', async () => {
    const noHiddenInput = setupDom(
      { config: defaultOtpConfig },
      { hasHiddenInput: false }
    );
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    noHiddenInput.runReady();
    noHiddenInput.otpInputs[0].value = '1';
    noHiddenInput.otpInputs[0].trigger('input');
    noHiddenInput.form.trigger('submit');
    expect(noHiddenInput.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );

    vi.resetModules();
    const noContainer = setupDom(
      { config: defaultOtpConfig },
      { hasOtpContainer: false }
    );
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    noContainer.runReady();
    noContainer.form.trigger('submit');
    expect(noContainer.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
  });

  it('logs and stops when no OTP inputs are rendered', async () => {
    const context = setupDom({ config: defaultOtpConfig }, { inputCount: 0 });

    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager]',
      'No OTP inputs found'
    );
    expect(context.form.listeners.has('submit')).toBe(false);
  });

  it('uses fallback configuration for malformed, empty, and absent state', async () => {
    const malformed = setupDom({}, { rawState: '{bad json' });
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    malformed.runReady();
    expect(malformed.error).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(malformed.form.listeners.has('submit')).toBe(true);

    vi.resetModules();
    const empty = setupDom({}, { rawState: '' });
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    empty.runReady();
    empty.form.trigger('submit');
    expect(empty.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );

    vi.resetModules();
    const absent = setupDom({}, { hasState: false });
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    absent.runReady();
    expect(absent.error).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager] No configuration data found in DOM'
    );
    expect(absent.otpInputs[0].focus).toHaveBeenCalledOnce();
  });

  it('contains initialization and both fallback failure paths', async () => {
    const failure = new Error('DOM unavailable');
    const configured = setupDom(
      { config: defaultOtpConfig },
      { querySelectorError: failure }
    );
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    configured.runReady();
    expect(configured.error).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager] Failed to initialize:',
      failure
    );
    expect(configured.error).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager] Fallback initialization failed:',
      failure
    );

    vi.resetModules();
    const absent = setupDom(
      {},
      { hasState: false, querySelectorError: failure }
    );
    await import('../../../src/assets/js/auth/recovery-verify-code.js');
    absent.runReady();
    expect(absent.error).toHaveBeenCalledWith(
      '[RecoveryVerifyCodeManager] Fallback initialization failed:',
      failure
    );
  });
});
