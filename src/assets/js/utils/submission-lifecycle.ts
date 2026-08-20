export type SubmissionTimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

export interface SubmissionScheduler {
  clearTimeout(handle: SubmissionTimeoutHandle): void;
  setTimeout(callback: () => void, delayMs: number): SubmissionTimeoutHandle;
}

export interface SubmissionLifecycleOptions {
  onStateChange(isSubmitting: boolean): void;
  onTimeout(): void;
  scheduler: SubmissionScheduler;
  timeoutMs: number;
}

export class SubmissionLifecycle {
  private state: 'idle' | 'submitting' = 'idle';
  private timeoutHandle: SubmissionTimeoutHandle | null = null;

  public constructor(private readonly options: SubmissionLifecycleOptions) {}

  public get isSubmitting(): boolean {
    return this.state === 'submitting';
  }

  public begin(): boolean {
    if (this.isSubmitting) return false;

    this.state = 'submitting';
    try {
      this.options.onStateChange(true);
      this.timeoutHandle = this.options.scheduler.setTimeout(() => {
        this.release();
        this.options.onTimeout();
      }, this.options.timeoutMs);
      return true;
    } catch (error) {
      this.state = 'idle';
      this.timeoutHandle = null;
      throw error;
    }
  }

  public release(): void {
    if (!this.isSubmitting) return;

    const timeoutHandle = this.timeoutHandle;
    this.timeoutHandle = null;
    this.state = 'idle';

    if (timeoutHandle !== null) {
      this.options.scheduler.clearTimeout(timeoutHandle);
    }
    this.options.onStateChange(false);
  }
}

export const browserSubmissionScheduler: SubmissionScheduler = {
  clearTimeout: handle => globalThis.clearTimeout(handle),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

export interface InteractiveButtonOptions {
  disabledClass?: boolean;
  inlineStyles?: boolean;
}

export function setInteractiveButtonDisabled(
  button: HTMLButtonElement | null,
  disabled: boolean,
  options: InteractiveButtonOptions = {}
): void {
  if (!button) return;

  button.disabled = disabled;
  if (options.disabledClass) {
    button.classList[disabled ? 'add' : 'remove']('disabled-button');
  }
  if (options.inlineStyles) {
    button.style.opacity = disabled ? '0.6' : '1';
    button.style.cursor = disabled ? 'not-allowed' : 'pointer';
    button.style.pointerEvents = disabled ? 'none' : 'auto';
  }
}

export function setFormDisabled(
  form: HTMLFormElement | null,
  disabled: boolean
): void {
  if (!form) return;

  form.style.pointerEvents = disabled ? 'none' : 'auto';
  form.classList[disabled ? 'add' : 'remove']('form-disabled');
}
