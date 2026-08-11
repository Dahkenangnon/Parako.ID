const DEFAULT_DUPLICATE_MESSAGE = 'Please select different questions for each.';

export function hasDuplicateQuestionSelections(values: readonly string[]) {
  const selected = values.filter(Boolean);
  return new Set(selected).size !== selected.length;
}

export function initializeSecurityQuestionsSetup(root: Document): void {
  const form = root.getElementById(
    'security-questions-form'
  ) as HTMLFormElement | null;
  const error = root.getElementById('validation-errors') as HTMLElement | null;
  if (!form || !error) return;

  const questionInputs = [1, 2, 3].map(index =>
    root.getElementById(`question_${index}`)
  ) as Array<HTMLSelectElement | null>;
  if (questionInputs.some(input => !input)) return;

  form.addEventListener('submit', event => {
    const values = questionInputs.map(input => input?.value ?? '');
    if (hasDuplicateQuestionSelections(values)) {
      event.preventDefault();
      error.textContent =
        error.dataset.duplicateMessage || DEFAULT_DUPLICATE_MESSAGE;
      error.classList.remove('hidden');
      return;
    }

    error.classList.add('hidden');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeSecurityQuestionsSetup(document);
  });
}
