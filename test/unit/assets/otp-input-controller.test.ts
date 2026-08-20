import { describe, expect, it, vi } from 'vitest';

import { OtpInputController } from '../../../src/assets/js/utils/otp-input-controller.js';
import { InputFixture } from './support/otp-manager-fixture.js';

function createFixture(
  options: {
    autoFocus?: boolean;
    enableBackspace?: boolean;
    enablePaste?: boolean;
  } = {}
) {
  const inputs = Array.from({ length: 4 }, () => new InputFixture());
  const hiddenInput = new InputFixture();
  const controller = new OtpInputController({
    inputs: inputs as unknown as HTMLInputElement[],
    hiddenInput: hiddenInput as unknown as HTMLInputElement,
    autoFocus: options.autoFocus ?? true,
    enableBackspace: options.enableBackspace ?? true,
    enablePaste: options.enablePaste ?? true,
  });

  return { controller, hiddenInput, inputs };
}

describe('OtpInputController', () => {
  it('sanitizes input, advances focus, and synchronizes the aggregate value', () => {
    const { controller, hiddenInput, inputs } = createFixture();
    controller.attach();

    expect(inputs[0].focus).toHaveBeenCalledOnce();
    inputs[0].value = 'a7';
    inputs[0].trigger('input');

    expect(inputs[0].value).toBe('7');
    expect(inputs[1].focus).toHaveBeenCalledOnce();
    expect(hiddenInput.value).toBe('7');
  });

  it('replaces pasted digits and owns focus styling', () => {
    const { controller, hiddenInput, inputs } = createFixture();
    controller.attach();
    inputs.forEach(input => {
      input.value = '9';
    });

    const pasteEvent = inputs[2].trigger('paste', {
      clipboardData: { getData: vi.fn(() => '1a2') },
    });
    inputs[0].trigger('focus');
    inputs[0].trigger('blur');

    expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
    expect(inputs.map(input => input.value)).toEqual(['1', '2', '', '']);
    expect(hiddenInput.value).toBe('12');
    expect(inputs[2].focus).toHaveBeenCalledOnce();
    expect(inputs[0].classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(inputs[0].classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it('honors disabled features and clears visible and aggregate state together', () => {
    const { controller, hiddenInput, inputs } = createFixture({
      autoFocus: false,
      enableBackspace: false,
      enablePaste: false,
    });
    controller.attach();

    expect(inputs[0].focus).not.toHaveBeenCalled();
    expect(inputs[0].listeners.has('keydown')).toBe(false);
    expect(inputs[0].listeners.has('paste')).toBe(false);

    inputs.forEach(input => {
      input.value = '8';
    });
    hiddenInput.value = '8888';
    controller.clear(true);

    expect(inputs.every(input => input.value === '')).toBe(true);
    expect(hiddenInput.value).toBe('');
    expect(inputs[0].focus).toHaveBeenCalledOnce();
  });
});
