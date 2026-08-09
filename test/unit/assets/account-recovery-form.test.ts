import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void;
}

interface ButtonFixture {
  disabled: boolean;
  textContent: string;
}

function setupDom(
  options: {
    button?: ButtonFixture | null;
    form?: FormFixture | null;
    identifier?: { value: string } | null;
    stateText?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const form =
    options.form === undefined
      ? ({
          addEventListener: vi.fn(
            (
              _name: string,
              listener: (event: {
                preventDefault: ReturnType<typeof vi.fn>;
              }) => void
            ) => {
              form!.submit = listener;
            }
          ),
        } as FormFixture)
      : options.form;
  const button =
    options.button === undefined
      ? ({ disabled: false, textContent: 'Continue' } as ButtonFixture)
      : options.button;
  const identifier =
    options.identifier === undefined
      ? { value: 'user@example.com' }
      : options.identifier;
  const state =
    options.stateText === undefined ? null : { textContent: options.stateText };
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === 'recovery-form') return form;
      if (id === 'submit-btn') return button;
      if (id === 'identifier') return identifier;
      if (id === '___ACCOUNT_RECOVERY_STATE___') return state;
      return null;
    }),
  });
  return {
    button,
    form,
    runReady: () => ready?.(),
    submit: () => {
      const event = { preventDefault: vi.fn() };
      form?.submit?.(event);
      return event;
    },
  };
}

describe('account recovery form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/auth/account-recovery.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the recovery form is absent', async () => {
    const { runReady } = setupDom({ form: null });

    await import('../../../src/assets/js/auth/account-recovery.js');

    expect(runReady).not.toThrow();
  });

  it.each([
    ['missing', null],
    ['blank', { value: '   ' }],
  ])(
    'prevents submission when the identifier is %s',
    async (_case, identifier) => {
      const { button, runReady, submit } = setupDom({ identifier });
      await import('../../../src/assets/js/auth/account-recovery.js');
      runReady();

      const event = submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(button).toMatchObject({
        disabled: false,
        textContent: 'Continue',
      });
    }
  );

  it('allows a valid submission when the optional button is absent', async () => {
    const { runReady, submit } = setupDom({ button: null });
    await import('../../../src/assets/js/auth/account-recovery.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['missing state', undefined, 'Processing...'],
    ['blank state', '', 'Processing...'],
    ['state without a translation', '{}', 'Processing...'],
    ['malformed state', '{bad json', 'Processing...'],
    [
      'localized state',
      JSON.stringify({ translations: { processing: 'Please wait' } }),
      'Please wait',
    ],
  ])('uses processing text from %s', async (_case, stateText, expected) => {
    const options = stateText === undefined ? {} : { stateText };
    const { button, runReady, submit } = setupDom(options);
    await import('../../../src/assets/js/auth/account-recovery.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(button).toMatchObject({ disabled: true, textContent: expected });
  });
});
