import dialogService, { type DialogService } from '../../utils/dialog.js';

export type ValidationDialog = Pick<DialogService, 'showAlert'>;

export interface ValidationError {
  message: string;
  title: string;
}

export async function showValidationError(
  error: ValidationError,
  dialog: ValidationDialog | null = dialogService
): Promise<void> {
  if (dialog) {
    await dialog.showAlert(error.title, error.message, { variant: 'error' });
    return;
  }

  alert(error.message);
}

export function bindSynchronousFormValidation(
  form: HTMLFormElement,
  validate: () => ValidationError | null,
  dialog: ValidationDialog | null = dialogService
): void {
  form.addEventListener('submit', event => {
    const validationError = validate();
    if (!validationError) return;

    event.preventDefault();
    void showValidationError(validationError, dialog);
  });
}
