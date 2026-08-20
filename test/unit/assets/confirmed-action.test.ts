import { describe, expect, it, vi } from 'vitest';

import { requestConfirmation } from '../../../src/assets/js/utils/confirmed-action.js';

const prompt = {
  title: 'Delete item',
  message: 'Delete this item?',
  variant: 'danger' as const,
  confirmText: 'Delete',
  cancelText: 'Cancel',
};

describe('requestConfirmation', () => {
  it('uses the dialog with the complete prompt', async () => {
    const showConfirm = vi.fn().mockResolvedValue(true);

    await expect(requestConfirmation({ showConfirm }, prompt)).resolves.toBe(
      true
    );
    expect(showConfirm).toHaveBeenCalledWith(prompt.title, prompt.message, {
      variant: prompt.variant,
      confirmText: prompt.confirmText,
      cancelText: prompt.cancelText,
    });
  });

  it('uses the fallback when the dialog is unavailable', async () => {
    const fallback = vi.fn().mockReturnValue(false);

    await expect(requestConfirmation(null, prompt, fallback)).resolves.toBe(
      false
    );
    expect(fallback).toHaveBeenCalledWith(prompt.message);
  });

  it('uses the fallback when the dialog rejects', async () => {
    const fallback = vi.fn().mockReturnValue(true);
    const showConfirm = vi.fn().mockRejectedValue(new Error('dialog failed'));

    await expect(
      requestConfirmation({ showConfirm }, prompt, fallback)
    ).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledWith(prompt.message);
  });
});
