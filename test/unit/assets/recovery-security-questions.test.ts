import { afterEach, describe, expect, it, vi } from 'vitest';

interface AnswerFixture {
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  value: string;
}

function makeAnswer(value: string): AnswerFixture {
  return {
    classList: { add: vi.fn(), remove: vi.fn() },
    value,
  };
}

function setupDom(
  options: {
    answers?: AnswerFixture[];
    button?: { disabled: boolean; textContent: string } | null;
    form?: boolean;
    stateText?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  let submit:
    ((event: { preventDefault: ReturnType<typeof vi.fn> }) => void) | undefined;
  const button =
    options.button === undefined
      ? { disabled: false, textContent: 'Continue' }
      : options.button;
  const form =
    options.form === false
      ? null
      : {
          addEventListener: vi.fn(
            (
              _name: string,
              listener: (event: {
                preventDefault: ReturnType<typeof vi.fn>;
              }) => void
            ) => {
              submit = listener;
            }
          ),
          querySelectorAll: vi.fn(() => options.answers ?? []),
        };
  const state =
    options.stateText === undefined ? null : { textContent: options.stateText };
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === 'security-questions-form') return form;
      if (id === 'submit-btn') return button;
      if (id === '___RECOVERY_SECURITY_QUESTIONS_STATE___') return state;
      return null;
    }),
  });
  return {
    button,
    form,
    runReady: () => ready?.(),
    submit: () => {
      const event = { preventDefault: vi.fn() };
      submit?.(event);
      return event;
    },
  };
}

describe('recovery security questions form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/auth/recovery-security-questions.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely without its form', async () => {
    const { runReady } = setupDom({ form: false });
    await import('../../../src/assets/js/auth/recovery-security-questions.js');
    expect(runReady).not.toThrow();
  });

  it('does nothing on submit when the optional button is absent', async () => {
    const { runReady, submit } = setupDom({
      answers: [makeAnswer('valid answer')],
      button: null,
    });
    await import('../../../src/assets/js/auth/recovery-security-questions.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('prevents submission and marks every short answer', async () => {
    const short = makeAnswer('ab');
    const valid = makeAnswer('  enough  ');
    const { button, runReady, submit } = setupDom({ answers: [short, valid] });
    await import('../../../src/assets/js/auth/recovery-security-questions.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(short.classList.add).toHaveBeenCalledWith('border-red-500');
    expect(valid.classList.remove).toHaveBeenCalledWith('border-red-500');
    expect(button).toMatchObject({ disabled: false, textContent: 'Continue' });
  });

  it.each([
    ['missing state', undefined, 'Processing...'],
    ['blank state', '', 'Processing...'],
    ['missing translation', '{}', 'Processing...'],
    ['malformed state', '{bad json', 'Processing...'],
    [
      'localized state',
      JSON.stringify({ translations: { processing: 'Checking answers' } }),
      'Checking answers',
    ],
  ])('submits valid answers using %s', async (_case, stateText, expected) => {
    const options = {
      answers: [makeAnswer('first answer'), makeAnswer('second answer')],
      ...(stateText === undefined ? {} : { stateText }),
    };
    const { button, runReady, submit } = setupDom(options);
    await import('../../../src/assets/js/auth/recovery-security-questions.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(button).toMatchObject({ disabled: true, textContent: expected });
  });
});
