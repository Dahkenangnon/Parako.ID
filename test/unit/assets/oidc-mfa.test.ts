import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ButtonFixture,
  ElementFixture,
  setupOtpDom,
  type SetupOtpDomOptions,
} from './support/otp-manager-fixture.js';

const defaultConfig = {
  autoFocus: true,
  codeLength: 6,
  enableBackspace: true,
  enableCustomDialog: false,
  enablePaste: true,
  shakeAnimationDuration: 500,
  timerDuration: 300,
};

function setupDom(
  state: Record<string, unknown>,
  options: SetupOtpDomOptions = {}
) {
  return setupOtpDom('___OIDC_MFA_STATE___', state, options);
}

function setupInteractiveDom(state: Record<string, unknown>) {
  const timer = new ElementFixture();
  const resend = new ButtonFixture();
  const tryAnotherMethod = new ButtonFixture();
  const customAlert = new ElementFixture();
  const backdrop = new ElementFixture();
  const title = new ElementFixture();
  const message = new ElementFixture();
  const close = new ElementFixture();
  const dialogContent = new ElementFixture();
  customAlert.classList.add('hidden');
  customAlert.setQueryResult(dialogContent);

  return {
    ...setupDom(state, {
      elements: {
        'custom-alert': customAlert,
        'dialog-backdrop': backdrop,
        'dialog-close': close,
        'dialog-message': message,
        'dialog-title': title,
        'resend-code': resend,
        timer,
        'try-another-method': tryAnotherMethod,
      },
    }),
    backdrop,
    close,
    customAlert,
    dialogContent,
    message,
    resend,
    timer,
    title,
    tryAnotherMethod,
  };
}

describe('OIDC MFA manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when localized validation copy is not a string', async () => {
    const context = setupDom({
      config: defaultConfig,
      translations: { codeRequired: 42 },
    });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter the verification code'
    );
  });

  it('falls back when localized validation copy is still a translation key', async () => {
    const context = setupDom({
      config: defaultConfig,
      translations: { codeRequired: 'auth.code_required' },
    });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter the verification code'
    );
  });

  it('uses the default recovery window when the configured timeout is invalid', async () => {
    const context = setupDom({
      config: { ...defaultConfig, errorRecoveryTimeout: 'invalid' },
    });
    context.hiddenInput.value = '123456';

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    context.form.trigger('submit');

    vi.advanceTimersByTime(119_999);
    expect(context.button.disabled).toBe(true);
    expect(context.alert).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(context.button.disabled).toBe(false);
    expect(context.alert).toHaveBeenCalledWith(
      'Session timed out. Please try again.'
    );
  });

  it('replaces the existing OTP when a shorter code is pasted', async () => {
    const context = setupDom({ config: defaultConfig });
    context.otpInputs.forEach((input, index) => {
      input.value = String(index + 1);
    });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    context.otpInputs[3]!.trigger('paste', {
      clipboardData: { getData: vi.fn(() => '1a2') },
    });

    expect(context.otpInputs.map(input => input.value)).toEqual([
      '1',
      '2',
      '',
      '',
      '',
      '',
    ]);
    expect(context.hiddenInput.value).toBe('12');
  });

  it('sanitizes OTP editing, navigation, and focus states', async () => {
    const context = setupDom({ config: defaultConfig });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    expect(context.otpInputs[0]?.focus).toHaveBeenCalledOnce();

    context.otpInputs[0]!.value = 'a7';
    context.otpInputs[0]!.trigger('input');
    expect(context.otpInputs[0]?.value).toBe('7');
    expect(context.otpInputs[1]?.focus).toHaveBeenCalledOnce();
    expect(context.hiddenInput.value).toBe('7');

    context.otpInputs[2]!.trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1]?.focus).toHaveBeenCalledTimes(2);
    context.otpInputs[2]!.value = '3';
    context.otpInputs[2]!.trigger('keydown', { key: 'Backspace' });
    expect(context.otpInputs[1]?.focus).toHaveBeenCalledTimes(2);

    context.otpInputs[0]!.trigger('focus');
    context.otpInputs[0]!.trigger('blur');
    expect(context.otpInputs[0]?.classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(context.otpInputs[0]?.classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );

    context.otpInputs[0]!.trigger('paste');
    expect(context.otpInputs.every(input => input.value === '')).toBe(true);
    expect(context.hiddenInput.value).toBe('');
  });

  it('respects disabled autofocus, backspace, and paste behaviors', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        autoFocus: false,
        enableBackspace: false,
        enablePaste: false,
      },
    });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();

    expect(context.otpInputs[0]?.focus).not.toHaveBeenCalled();
    expect(context.otpInputs[0]?.listeners.has('keydown')).toBe(false);
    expect(context.otpInputs[0]?.listeners.has('paste')).toBe(false);

    context.otpInputs.at(-1)!.value = '7';
    context.otpInputs.at(-1)!.trigger('input');
    expect(context.otpInputs.at(-1)?.focus).not.toHaveBeenCalled();
    expect(context.hiddenInput.value).toBe('7');
  });

  it('counts down, resends a code, and closes the custom dialog', async () => {
    const context = setupInteractiveDom({
      config: {
        ...defaultConfig,
        enableCustomDialog: true,
        timerDuration: 2,
      },
      translations: {
        codeResent: 'Sent again',
        codeResentMessage: 'Use the new code',
      },
    });
    context.otpInputs.forEach(input => {
      input.value = '7';
    });
    context.hiddenInput.value = '777777';

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    expect(context.timer.textContent).toBe('1:00');
    context.triggerDocument('keydown', { key: 'Enter' });
    expect(context.customAlert.classList.add).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(context.timer.textContent).toBe('0:00');
    expect(context.timer.classList.add).toHaveBeenCalledWith(
      'text-red-500',
      'dark:text-red-400'
    );

    context.resend.trigger('click');
    expect(context.hiddenInput.value).toBe('');
    expect(context.otpInputs.every(input => input.value === '')).toBe(true);
    expect(context.timer.classList.remove).toHaveBeenCalledWith(
      'text-red-500',
      'dark:text-red-400'
    );
    expect(context.title.textContent).toBe('Sent again');
    expect(context.message.textContent).toBe('Use the new code');
    expect(context.customAlert.classList.remove).toHaveBeenCalledWith('hidden');

    vi.advanceTimersByTime(10);
    expect(context.dialogContent.classList.add).toHaveBeenCalledWith(
      'animate-in',
      'fade-in',
      'duration-300'
    );
    context.close.trigger('click');
    vi.advanceTimersByTime(200);
    expect(context.customAlert.classList.add).toHaveBeenCalledWith('hidden');

    context.resend.trigger('click');
    context.backdrop.trigger('click');
    vi.advanceTimersByTime(200);
    context.resend.trigger('click');
    context.triggerDocument('keydown', { key: 'Escape' });
    vi.advanceTimersByTime(200);
    expect(context.customAlert.classList.add).toHaveBeenCalledTimes(4);
  });

  it('submits a complete code once and restores every interactive control', async () => {
    const context = setupInteractiveDom({
      config: { ...defaultConfig, errorRecoveryTimeout: 1000 },
      translations: {
        errorRecovery: 'Try the code again',
        verify: 'Check code',
        verifying: 'Checking code',
      },
    });
    context.hiddenInput.value = '123456';

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    const first = context.form.trigger('submit');
    const duplicate = context.form.trigger('submit');
    context.resend.trigger('click');

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.resend.disabled).toBe(true);
    expect(context.tryAnotherMethod.disabled).toBe(true);
    expect(context.otpInputs.every(input => input.disabled)).toBe(true);
    expect(context.hiddenInput.value).toBe('123456');

    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(900);
    expect(context.alert).toHaveBeenCalledWith('Try the code again');
    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toBe('Check code');
    expect(context.resend.disabled).toBe(false);
    expect(context.tryAnotherMethod.disabled).toBe(false);
    expect(context.otpInputs.every(input => !input.disabled)).toBe(true);
  });

  it('focuses the first OTP when an invalid code has no empty visible cell', async () => {
    const context = setupDom({ config: defaultConfig });
    context.otpInputs.forEach(input => {
      input.value = '1';
    });
    context.hiddenInput.value = '123';

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    context.form.trigger('submit');
    expect(context.otpInputs[0]?.focus).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(500);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );
  });

  it('uses an alert when resend dialogs are disabled', async () => {
    const resend = new ButtonFixture();
    const context = setupDom(
      { config: defaultConfig },
      { elements: { 'resend-code': resend } }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    resend.trigger('click');

    expect(context.alert).toHaveBeenCalledWith(
      'A new verification code has been sent to your device.'
    );
  });

  it('uses safe defaults when the embedded MFA config has an invalid type', async () => {
    const context = setupDom({ config: 'invalid' });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[MFAManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
    expect(context.otpInputs[0]?.focus).toHaveBeenCalledOnce();
  });

  it('uses bounded defaults when numeric MFA settings are zero', async () => {
    const timer = new ElementFixture();
    const context = setupDom(
      {
        config: {
          ...defaultConfig,
          codeLength: 0,
          shakeAnimationDuration: 0,
          timerDuration: 0,
        },
      },
      { elements: { timer } }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();

    expect(timer.textContent).toBe('5:00');
    context.form.trigger('submit');
    vi.advanceTimersByTime(499);
    expect(context.otpContainer.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.otpContainer.classList.remove).toHaveBeenCalledWith(
      'animate-pulse'
    );

    context.hiddenInput.value = '123456';
    context.form.trigger('submit');
    vi.advanceTimersByTime(100);
    expect(context.form.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('stops safely when required MFA form markup is missing', async () => {
    const context = setupDom({ config: defaultConfig }, { hasForm: false });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    expect(() => context.runReady()).not.toThrow();
    expect(context.error).toHaveBeenCalledWith(
      '[MFAManager]',
      'Required form elements not found'
    );
  });

  it('supports OTP input markup without a hidden aggregate field', async () => {
    const context = setupDom(
      { config: defaultConfig },
      { hasHiddenInput: false }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    context.otpInputs[0]!.value = '7';
    expect(() => context.otpInputs[0]!.trigger('input')).not.toThrow();
    expect(context.form.listeners.has('submit')).toBe(false);
  });

  it('reports an invalid code when the optional OTP container is missing', async () => {
    const context = setupDom(
      { config: defaultConfig },
      { hasOtpContainer: false }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();

    expect(() => context.form.trigger('submit')).not.toThrow();
    expect(context.alert).toHaveBeenCalledWith(
      'Please enter the verification code'
    );
    expect(context.otpInputs[0]?.focus).toHaveBeenCalledTimes(2);
  });

  it('contains incomplete custom dialog markup', async () => {
    const resend = new ButtonFixture();
    const close = new ElementFixture();
    const customAlert = new ElementFixture();
    const message = new ElementFixture();
    const context = setupDom(
      { config: { ...defaultConfig, enableCustomDialog: true } },
      {
        elements: {
          'custom-alert': customAlert,
          'dialog-close': close,
          'dialog-message': message,
          'resend-code': resend,
        },
      }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    expect(() => resend.trigger('click')).not.toThrow();
    expect(() => close.trigger('click')).not.toThrow();
  });

  it('ignores dialog-close events when the alert container is missing', async () => {
    const close = new ElementFixture();
    const context = setupDom(
      { config: { ...defaultConfig, enableCustomDialog: true } },
      { elements: { 'dialog-close': close } }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();

    expect(() => close.trigger('click')).not.toThrow();
    expect(context.alert).not.toHaveBeenCalled();
  });

  it('opens and closes a custom dialog without an animation panel', async () => {
    const resend = new ButtonFixture();
    const close = new ElementFixture();
    const customAlert = new ElementFixture();
    const title = new ElementFixture();
    const message = new ElementFixture();
    const context = setupDom(
      { config: { ...defaultConfig, enableCustomDialog: true } },
      {
        elements: {
          'custom-alert': customAlert,
          'dialog-close': close,
          'dialog-message': message,
          'dialog-title': title,
          'resend-code': resend,
        },
      }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    context.runReady();
    resend.trigger('click');
    vi.advanceTimersByTime(10);
    close.trigger('click');

    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(customAlert.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('falls back on malformed or missing embedded MFA state', async () => {
    const malformed = setupDom({}, { rawState: '{malformed' });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    malformed.runReady();
    expect(malformed.error).toHaveBeenCalledWith(
      '[MFAManager] Failed to initialize:',
      expect.any(SyntaxError)
    );

    vi.resetModules();
    const missing = setupDom({}, { hasState: false });
    await import('../../../src/assets/js/auth/oidc/mfa.js');
    missing.runReady();
    expect(missing.error).toHaveBeenCalledWith(
      '[MFAManager] No configuration data found in DOM'
    );
  });

  it('initializes from safe defaults when the embedded MFA state is empty', async () => {
    const context = setupDom({}, { rawState: '' });

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    expect(() => context.runReady()).not.toThrow();

    expect(context.otpInputs[0]?.focus).toHaveBeenCalledOnce();
    expect(context.error).not.toHaveBeenCalled();
  });

  it('contains fallback initialization failures', async () => {
    const failure = new Error('DOM unavailable');
    const context = setupDom(
      {},
      { querySelectorError: failure, rawState: '{malformed' }
    );

    await import('../../../src/assets/js/auth/oidc/mfa.js');
    expect(() => context.runReady()).not.toThrow();
    expect(context.error).toHaveBeenCalledWith(
      '[MFAManager] Fallback initialization failed:',
      failure
    );
  });
});
