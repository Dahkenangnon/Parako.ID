import { describe, expect, it, vi } from 'vitest';

import {
  hasDuplicateQuestionSelections,
  initializeSecurityQuestionsSetup,
} from '../../../src/assets/js/account/security-questions-setup.js';

function setupFixture(options: { missing?: string } = {}) {
  let submit:
    ((event: { preventDefault: ReturnType<typeof vi.fn> }) => void) | undefined;
  const form = {
    addEventListener: vi.fn(
      (
        _type: string,
        listener: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
      ) => {
        submit = listener;
      }
    ),
  };
  const error = {
    classList: { add: vi.fn(), remove: vi.fn() },
    dataset: { duplicateMessage: 'Choose three different questions.' },
    textContent: '',
  };
  const questions = [{ value: 'q1' }, { value: 'q2' }, { value: 'q3' }];
  const elements: Record<string, unknown> = {
    'security-questions-form': form,
    'validation-errors': error,
    question_1: questions[0],
    question_2: questions[1],
    question_3: questions[2],
  };
  if (options.missing) delete elements[options.missing];
  const root = {
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  };

  initializeSecurityQuestionsSetup(root as unknown as Document);

  return {
    error,
    form,
    questions,
    submit() {
      const event = { preventDefault: vi.fn() };
      submit?.(event);
      return event;
    },
  };
}

describe('account security-question setup', () => {
  it('detects only repeated non-empty selections', () => {
    expect(hasDuplicateQuestionSelections(['q1', '', 'q2'])).toBe(false);
    expect(hasDuplicateQuestionSelections(['q1', 'q2', 'q1'])).toBe(true);
  });

  it.each([
    'security-questions-form',
    'validation-errors',
    'question_1',
    'question_2',
    'question_3',
  ])('initializes safely without %s', missing => {
    const { form } = setupFixture({ missing });
    if (missing === 'security-questions-form') {
      expect(form.addEventListener).not.toHaveBeenCalled();
    }
  });

  it('prevents duplicate questions and displays the localized error', () => {
    const fixture = setupFixture();
    fixture.questions[2]!.value = 'q1';

    const event = fixture.submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.error.textContent).toBe('Choose three different questions.');
    expect(fixture.error.classList.remove).toHaveBeenCalledWith('hidden');
  });

  it('allows distinct questions and clears an earlier error', () => {
    const fixture = setupFixture();

    const event = fixture.submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.error.classList.add).toHaveBeenCalledWith('hidden');
  });
});
