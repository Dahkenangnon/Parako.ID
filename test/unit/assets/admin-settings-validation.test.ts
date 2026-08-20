import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bindSynchronousFormValidation,
  showValidationError,
  type ValidationError,
} from '../../../src/assets/js/admin/settings/validation.js';

const validationError: ValidationError = {
  title: 'Invalid field',
  message: 'The field is invalid.',
};

describe('admin settings validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leaves valid native submissions untouched', () => {
    let submit: ((event: SubmitEvent) => void) | undefined;
    const form = {
      addEventListener: vi.fn(
        (_name: string, listener: (event: SubmitEvent) => void) => {
          submit = listener;
        }
      ),
    };
    const showAlert = vi.fn();

    bindSynchronousFormValidation(
      form as unknown as HTMLFormElement,
      () => null,
      { showAlert }
    );
    const event = { preventDefault: vi.fn() };
    submit?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
  });

  it('cancels invalid native submissions before the dialog resolves', async () => {
    let submit: ((event: SubmitEvent) => void) | undefined;
    let resolveAlert: (() => void) | undefined;
    const form = {
      addEventListener: vi.fn(
        (_name: string, listener: (event: SubmitEvent) => void) => {
          submit = listener;
        }
      ),
    };
    const showAlert = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveAlert = resolve;
        })
    );

    bindSynchronousFormValidation(
      form as unknown as HTMLFormElement,
      () => validationError,
      { showAlert }
    );
    const event = { preventDefault: vi.fn() };
    submit?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Invalid field',
      'The field is invalid.',
      { variant: 'error' }
    );

    resolveAlert?.();
    await Promise.resolve();
  });

  it('uses native alert when no dialog service is available', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);

    await showValidationError(validationError, null);

    expect(alert).toHaveBeenCalledWith('The field is invalid.');
  });
});

interface SubmitEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}
