import { describe, expect, it, vi } from 'vitest';

import {
  SubmissionLifecycle,
  setFormDisabled,
  setInteractiveButtonDisabled,
  type SubmissionScheduler,
  type SubmissionTimeoutHandle,
} from '../../../src/assets/js/utils/submission-lifecycle.js';

class ClassListFixture {
  private readonly values = new Set<string>();

  public add(...tokens: string[]): void {
    tokens.forEach(token => this.values.add(token));
  }

  public contains(token: string): boolean {
    return this.values.has(token);
  }

  public remove(...tokens: string[]): void {
    tokens.forEach(token => this.values.delete(token));
  }
}

function makeButton() {
  return {
    classList: new ClassListFixture(),
    disabled: false,
    style: {
      cursor: '',
      opacity: '',
      pointerEvents: '',
    },
  };
}

function makeScheduler() {
  let pending: (() => void) | undefined;
  const scheduler: SubmissionScheduler = {
    clearTimeout: vi.fn(),
    setTimeout: vi.fn(callback => {
      pending = callback;
      return 17 as unknown as SubmissionTimeoutHandle;
    }),
  };

  return {
    fire: () => pending?.(),
    scheduler,
  };
}

describe('SubmissionLifecycle', () => {
  it('allows one active submission and recovers through the configured timeout', () => {
    const { fire, scheduler } = makeScheduler();
    const stateChanges = vi.fn();
    const onTimeout = vi.fn();
    const lifecycle = new SubmissionLifecycle({
      onStateChange: stateChanges,
      onTimeout,
      scheduler,
      timeoutMs: 4_000,
    });

    expect(lifecycle.begin()).toBe(true);
    expect(lifecycle.begin()).toBe(false);
    expect(lifecycle.isSubmitting).toBe(true);
    expect(scheduler.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      4_000
    );
    expect(stateChanges).toHaveBeenCalledTimes(1);
    expect(stateChanges).toHaveBeenLastCalledWith(true);

    fire();

    expect(lifecycle.isSubmitting).toBe(false);
    expect(stateChanges).toHaveBeenLastCalledWith(false);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('releases active state once and clears its timeout', () => {
    const { scheduler } = makeScheduler();
    const stateChanges = vi.fn();
    const lifecycle = new SubmissionLifecycle({
      onStateChange: stateChanges,
      onTimeout: vi.fn(),
      scheduler,
      timeoutMs: 1_000,
    });

    lifecycle.begin();
    lifecycle.release();
    lifecycle.release();

    expect(lifecycle.isSubmitting).toBe(false);
    expect(scheduler.clearTimeout).toHaveBeenCalledOnce();
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(17);
    expect(stateChanges).toHaveBeenCalledTimes(2);
  });
});

describe('submission controls', () => {
  it('applies and restores disabled button state', () => {
    const button = makeButton();

    setInteractiveButtonDisabled(button as unknown as HTMLButtonElement, true, {
      disabledClass: true,
      inlineStyles: true,
    });

    expect(button.disabled).toBe(true);
    expect(button.classList.contains('disabled-button')).toBe(true);
    expect(button.style).toEqual({
      cursor: 'not-allowed',
      opacity: '0.6',
      pointerEvents: 'none',
    });

    setInteractiveButtonDisabled(
      button as unknown as HTMLButtonElement,
      false,
      {
        disabledClass: true,
        inlineStyles: true,
      }
    );

    expect(button.disabled).toBe(false);
    expect(button.classList.contains('disabled-button')).toBe(false);
    expect(button.style).toEqual({
      cursor: 'pointer',
      opacity: '1',
      pointerEvents: 'auto',
    });
  });

  it('toggles form interaction without requiring a form', () => {
    const form = {
      classList: new ClassListFixture(),
      style: { pointerEvents: '' },
    };

    expect(() => setFormDisabled(null, true)).not.toThrow();

    setFormDisabled(form as unknown as HTMLFormElement, true);
    expect(form.classList.contains('form-disabled')).toBe(true);
    expect(form.style.pointerEvents).toBe('none');

    setFormDisabled(form as unknown as HTMLFormElement, false);
    expect(form.classList.contains('form-disabled')).toBe(false);
    expect(form.style.pointerEvents).toBe('auto');
  });
});
