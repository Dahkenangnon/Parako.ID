import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: () => void;
}

interface ButtonFixture {
  disabled: boolean;
  textContent: string;
}

function setupDom(
  options: {
    button?: ButtonFixture | null;
    countdownParent?: { style: { display: string } } | null;
    countdownPresent?: boolean;
    form?: FormFixture | null;
    retryText?: string | null;
    stateText?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const form =
    options.form === undefined
      ? ({
          addEventListener: vi.fn((_name: string, listener: () => void) => {
            form!.submit = listener;
          }),
        } as FormFixture)
      : options.form;
  const button =
    options.button === undefined
      ? ({ disabled: true, textContent: 'Send code' } as ButtonFixture)
      : options.button;
  const retrySeconds =
    options.retryText === undefined ? null : { textContent: options.retryText };
  const countdownParent =
    options.countdownParent === undefined
      ? { style: { display: '' } }
      : options.countdownParent;
  const countdown =
    options.countdownPresent === false
      ? null
      : { parentElement: countdownParent };
  const state =
    options.stateText === undefined ? null : { textContent: options.stateText };

  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === 'retry-seconds') return retrySeconds;
      if (id === 'send-btn') return button;
      if (id === 'send-code-form') return form;
      if (id === 'retry-countdown') return countdown;
      if (id === '___RECOVERY_SMS_STATE___') return state;
      return null;
    }),
  });

  return {
    button,
    countdownParent,
    form,
    retrySeconds,
    runReady: () => ready?.(),
    submit: () => form?.submit?.(),
  };
}

describe('recovery SMS form', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/auth/recovery-sms.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the countdown and form are absent', async () => {
    const { runReady } = setupDom({ button: null, form: null });
    await import('../../../src/assets/js/auth/recovery-sms.js');

    expect(runReady).not.toThrow();
  });

  it('counts down, hides its container, and enables sending at zero', async () => {
    vi.useFakeTimers();
    const { button, countdownParent, retrySeconds, runReady } = setupDom({
      retryText: '2',
    });
    await import('../../../src/assets/js/auth/recovery-sms.js');
    runReady();

    await vi.advanceTimersByTimeAsync(1000);
    expect(retrySeconds?.textContent).toBe('1');
    expect(countdownParent?.style.display).toBe('');
    expect(button?.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(retrySeconds?.textContent).toBe('0');
    expect(countdownParent?.style.display).toBe('none');
    expect(button?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['missing countdown container', { countdownPresent: false }],
    ['detached countdown container', { countdownParent: null }],
    ['missing send button', { button: null }],
  ])('finishes safely with a %s', async (_case, options) => {
    vi.useFakeTimers();
    const { retrySeconds, runReady } = setupDom({ retryText: '', ...options });
    await import('../../../src/assets/js/auth/recovery-sms.js');
    runReady();

    await vi.advanceTimersByTimeAsync(1000);

    expect(retrySeconds?.textContent).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats malformed countdown text as an expired countdown', async () => {
    vi.useFakeTimers();
    const { button, retrySeconds, runReady } = setupDom({ retryText: 'soon' });
    await import('../../../src/assets/js/auth/recovery-sms.js');
    runReady();

    await vi.advanceTimersByTimeAsync(1000);

    expect(retrySeconds?.textContent).toBe('0');
    expect(button?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not register submission handling when the button is absent', async () => {
    const { form, runReady } = setupDom({ button: null });
    await import('../../../src/assets/js/auth/recovery-sms.js');
    runReady();

    expect(form?.addEventListener).not.toHaveBeenCalled();
  });

  it.each([
    ['missing state', undefined, 'Sending...'],
    ['blank state', '', 'Sending...'],
    ['missing translation', '{}', 'Sending...'],
    ['malformed state', '{bad json', 'Sending...'],
    [
      'localized state',
      JSON.stringify({ translations: { sending: 'Envoi en cours' } }),
      'Envoi en cours',
    ],
  ])('submits using text from %s', async (_case, stateText, expected) => {
    const options = stateText === undefined ? {} : { stateText };
    const { button, runReady, submit } = setupDom(options);
    await import('../../../src/assets/js/auth/recovery-sms.js');
    runReady();

    submit();

    expect(button).toMatchObject({ disabled: true, textContent: expected });
  });
});
