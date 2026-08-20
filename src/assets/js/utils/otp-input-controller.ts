export interface OtpInputControllerOptions {
  readonly inputs: ArrayLike<HTMLInputElement>;
  readonly hiddenInput: HTMLInputElement | null;
  readonly autoFocus: boolean;
  readonly enableBackspace: boolean;
  readonly enablePaste: boolean;
  readonly focusClasses?: readonly string[];
}

const NON_DIGIT_PATTERN = /[^0-9]/g;
const DEFAULT_FOCUS_CLASSES = ['ring-2', 'ring-primary/20'] as const;

export class OtpInputController {
  private readonly inputs: HTMLInputElement[];
  private readonly focusClasses: readonly string[];

  public constructor(private readonly options: OtpInputControllerOptions) {
    this.inputs = Array.from(options.inputs);
    this.focusClasses = options.focusClasses ?? DEFAULT_FOCUS_CLASSES;
  }

  public attach(): void {
    this.inputs.forEach((input, index) => {
      input.addEventListener('input', event => {
        this.handleInput(event, index);
      });

      if (this.options.enableBackspace) {
        input.addEventListener('keydown', event => {
          this.handleKeydown(event, index);
        });
      }

      if (this.options.enablePaste) {
        input.addEventListener('paste', event => {
          this.handlePaste(event);
        });
      }

      input.addEventListener('focus', () => {
        input.classList.add(...this.focusClasses);
      });
      input.addEventListener('blur', () => {
        input.classList.remove(...this.focusClasses);
      });
    });

    if (this.options.autoFocus) {
      this.inputs[0]?.focus();
    }
  }

  public clear(focusFirst = false): void {
    this.inputs.forEach(input => {
      input.value = '';
    });
    this.syncHiddenInput();
    if (focusFirst) {
      this.inputs[0]?.focus();
    }
  }

  private handleInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(NON_DIGIT_PATTERN, '');

    if (input.value.length === 1) {
      this.inputs[index + 1]?.focus();
    }

    this.syncHiddenInput();
  }

  private handleKeydown(event: KeyboardEvent, index: number): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Backspace' && input.value === '') {
      this.inputs[index - 1]?.focus();
    }
  }

  private handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const digits =
      event.clipboardData?.getData('text').replace(NON_DIGIT_PATTERN, '') ?? '';

    this.inputs.forEach(input => {
      input.value = '';
    });
    digits
      .slice(0, this.inputs.length)
      .split('')
      .forEach((digit, index) => {
        this.inputs[index].value = digit;
      });

    const focusIndex = Math.min(digits.length, this.inputs.length - 1);
    this.inputs[focusIndex]?.focus();
    this.syncHiddenInput();
  }

  private syncHiddenInput(): void {
    if (!this.options.hiddenInput) return;
    this.options.hiddenInput.value = this.inputs
      .map(input => input.value)
      .join('');
  }
}
