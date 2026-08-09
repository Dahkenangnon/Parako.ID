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
  return setupOtpDom('___SETUP_MFA_STATE___', state, options);
}

describe('MFA setup manager', () => {
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

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
  });

  it('replaces the existing OTP when a shorter code is pasted', async () => {
    const context = setupDom({ config: defaultOtpConfig });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.otpInputs.forEach((input, index) => {
      input.value = String(index + 1);
    });
    context.otpInputs[4].trigger('paste', {
      clipboardData: { getData: vi.fn(() => '8x9') },
    });

    expect(context.otpInputs.map(input => input.value)).toEqual([
      '8',
      '9',
      '',
      '',
      '',
      '',
    ]);
    expect(context.hiddenInput.value).toBe('89');
    expect(context.otpInputs[2].focus).toHaveBeenCalledOnce();
  });

  it('clears the OTP when the clipboard has no digits', async () => {
    const context = setupDom({ config: defaultOtpConfig });
    context.otpInputs.forEach(input => {
      input.value = '7';
    });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.otpInputs[0].trigger('paste');

    expect(context.otpInputs.every(input => input.value === '')).toBe(true);
    expect(context.hiddenInput.value).toBe('');
    expect(context.otpInputs[0].focus).toHaveBeenCalledTimes(2);
  });

  it('sanitizes OTP input, advances focus, and updates the complete code', async () => {
    const context = setupDom({ config: defaultOtpConfig });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();

    context.otpInputs[0].value = 'a7';
    context.otpInputs[0].trigger('input');
    expect(context.otpInputs[0].value).toBe('7');
    expect(context.otpInputs[1].focus).toHaveBeenCalledOnce();
    expect(context.hiddenInput.value).toBe('7');

    context.otpInputs[5].value = '9';
    context.otpInputs[5].trigger('input');
    expect(context.hiddenInput.value).toBe('79');
  });

  it('moves backward only from an empty non-first input', async () => {
    const context = setupDom({ config: defaultOtpConfig });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.otpInputs[2].trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1].focus).toHaveBeenCalledOnce();

    context.otpInputs[2].value = '3';
    context.otpInputs[2].trigger('keydown', { key: 'Backspace' });
    context.otpInputs[2].trigger('keydown', { key: 'Delete' });
    context.otpInputs[0].trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1].focus).toHaveBeenCalledOnce();
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

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.otpInputs[0].focus).not.toHaveBeenCalled();
    expect(context.otpInputs[0].listeners.has('keydown')).toBe(false);
    expect(context.otpInputs[0].listeners.has('paste')).toBe(false);
  });

  it('uses focus rings and removes them on blur', async () => {
    const context = setupDom({ config: defaultOtpConfig });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
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

  it('submits a complete OTP once and recovers interactive controls on timeout', async () => {
    const context = setupDom({
      config: { ...defaultOtpConfig, errorRecoveryTimeout: 1000 },
      translations: {
        enableMFA: 'Enable protection',
        enablingMFA: 'Enabling protection',
        errorRecovery: 'Try the code again',
      },
    });
    context.hiddenInput.value = '123456';

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    const firstSubmit = context.form.trigger('submit');
    const duplicateSubmit = context.form.trigger('submit');

    expect(firstSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Enabling protection');
    expect(context.form.classList.add).toHaveBeenCalledWith('form-disabled');
    expect(context.otpInputs.every(input => input.disabled)).toBe(true);

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(900);

    expect(context.alert).toHaveBeenCalledWith('Try the code again');
    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toBe('Enable protection');
    expect(context.form.classList.remove).toHaveBeenCalledWith('form-disabled');
    expect(context.otpInputs.every(input => !input.disabled)).toBe(true);
  });

  it('focuses the first empty OTP and falls back from translation keys', async () => {
    const context = setupDom({
      config: defaultOtpConfig,
      translations: { codeInvalid: 'auth.codeInvalid' },
    });
    context.otpInputs[0].value = '1';

    await import('../../../src/assets/js/auth/setup-mfa.js');
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
      '[SetupMFAManager]',
      expect.stringContaining('Translation key detected')
    );

    vi.advanceTimersByTime(500);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('preserves a long dotted translation that is user-facing copy', async () => {
    const translation =
      'validation.code.invalid.but.this.is.a.deliberately.long.user.message';
    const context = setupDom({
      config: defaultOtpConfig,
      translations: { codeInvalid: translation },
    });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(translation);
  });

  it('clamps lower configuration bounds and accepts a four-digit OTP', async () => {
    const context = setupDom(
      {
        config: {
          ...defaultOtpConfig,
          codeLength: 2,
          shakeAnimationDuration: 10,
        },
      },
      { inputCount: 4 }
    );
    context.hiddenInput.value = '1234';

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');
    vi.advanceTimersByTime(100);

    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('clamps upper configuration bounds and accepts a ten-digit OTP', async () => {
    const context = setupDom(
      {
        config: {
          ...defaultOtpConfig,
          codeLength: 99,
          shakeAnimationDuration: 9999,
        },
      },
      { inputCount: 10 }
    );
    context.hiddenInput.value = '1234567890';

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');
    vi.advanceTimersByTime(100);

    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('uses validated defaults for a malformed truthy configuration', async () => {
    const context = setupDom({ config: 'invalid configuration' });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[SetupMFAManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid configuration' }
    );
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();
  });

  it('normalizes invalid numeric configuration values', async () => {
    const context = setupDom({
      config: {
        ...defaultOtpConfig,
        codeLength: 'not-a-number',
        shakeAnimationDuration: 'not-a-number',
      },
    });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');
    vi.advanceTimersByTime(499);
    expect(context.otpContainer.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('emits lifecycle logs when debug mode is enabled', async () => {
    const context = setupDom({
      config: { ...defaultOtpConfig, debug: true },
    });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.log).toHaveBeenCalledWith(
      '[SetupMFAManager]',
      'SetupMFAManager initialized',
      expect.objectContaining({ config: expect.any(Object) })
    );
  });

  it('focuses the first OTP when every rendered cell is filled but code length is invalid', async () => {
    const context = setupDom({ config: defaultOtpConfig }, { inputCount: 4 });
    context.otpInputs.forEach(input => {
      input.value = '1';
    });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.otpInputs[0].trigger('input');
    context.form.trigger('submit');

    expect(context.otpInputs[0].focus).toHaveBeenCalledTimes(2);
  });

  it('does not install form handling when the form or submit button is absent', async () => {
    const noForm = setupDom({ config: defaultOtpConfig }, { hasForm: false });
    await import('../../../src/assets/js/auth/setup-mfa.js');
    noForm.runReady();
    expect(noForm.form.listeners.has('submit')).toBe(false);

    vi.resetModules();
    const noButton = setupDom(
      { config: defaultOtpConfig },
      { hasButton: false }
    );
    await import('../../../src/assets/js/auth/setup-mfa.js');
    noButton.runReady();
    expect(noButton.form.listeners.has('submit')).toBe(false);
  });

  it('contains a missing hidden code field as an invalid submission', async () => {
    const context = setupDom(
      { config: defaultOtpConfig },
      { hasHiddenInput: false }
    );

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.otpInputs[0].value = '1';
    context.otpInputs[0].trigger('input');
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
  });

  it('validates without animation when the OTP container is absent', async () => {
    const context = setupDom(
      { config: defaultOtpConfig },
      { hasOtpContainer: false }
    );

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
  });

  it('logs and stops cleanly when no OTP inputs are rendered', async () => {
    const context = setupDom({ config: defaultOtpConfig }, { inputCount: 0 });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[SetupMFAManager]',
      'No OTP inputs found'
    );
    expect(context.form.listeners.has('submit')).toBe(false);
  });

  it('uses default configuration after malformed state JSON', async () => {
    const context = setupDom({}, { rawState: '{bad json' });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[SetupMFAManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();
    expect(context.form.listeners.has('submit')).toBe(true);
  });

  it('uses default configuration and translations from an empty state body', async () => {
    const context = setupDom({}, { rawState: '' });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.otpInputs[0].focus).toHaveBeenCalledTimes(2);
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a valid 6-digit verification code'
    );
  });

  it('uses default configuration when state is absent', async () => {
    const context = setupDom({}, { hasState: false });

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[SetupMFAManager] No configuration data found in DOM'
    );
    expect(context.otpInputs[0].focus).toHaveBeenCalledOnce();
  });

  it('contains initialization and fallback failures', async () => {
    const failure = new Error('DOM unavailable');
    const context = setupDom(
      { config: defaultOtpConfig },
      { querySelectorError: failure }
    );

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[SetupMFAManager] Failed to initialize:',
      failure
    );
    expect(context.error).toHaveBeenCalledWith(
      '[SetupMFAManager] Fallback initialization failed:',
      failure
    );
  });

  it('contains fallback failure when state is absent', async () => {
    const failure = new Error('DOM unavailable');
    const context = setupDom(
      {},
      { hasState: false, querySelectorError: failure }
    );

    await import('../../../src/assets/js/auth/setup-mfa.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[SetupMFAManager] Fallback initialization failed:',
      failure
    );
  });
});
