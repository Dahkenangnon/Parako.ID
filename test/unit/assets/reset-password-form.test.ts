import { describe, expect, it, vi } from 'vitest';

import { setResetPasswordFormLocked } from '../../../src/assets/js/auth/reset-password.js';

describe('setResetPasswordFormLocked', () => {
  it('locks interaction without disabling successful form controls', () => {
    const controls = [
      { name: '_csrf', disabled: false, style: {} },
      { name: 'token', disabled: false, style: {} },
      { name: 'password', disabled: false, style: {} },
      { name: 'confirm-password', disabled: false, style: {} },
    ];
    const form = {
      style: { pointerEvents: '' },
      classList: { add: vi.fn(), remove: vi.fn() },
      querySelectorAll: vi.fn().mockReturnValue(controls),
    } as unknown as HTMLFormElement;
    const submitButton = {
      disabled: false,
      style: { opacity: '', cursor: '', pointerEvents: '' },
    } as unknown as HTMLButtonElement;

    setResetPasswordFormLocked(form, submitButton, true);

    expect(submitButton.disabled).toBe(true);
    expect(form.style.pointerEvents).toBe('none');
    expect(form.classList.add).toHaveBeenCalledWith('form-disabled');
    expect(controls.every(control => control.disabled === false)).toBe(true);
  });
});
