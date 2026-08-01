import { describe, expect, it, vi } from 'vitest';

import { installConsentSubmissionGuard } from '../../../src/assets/js/auth/oidc/consent.js';

describe('installConsentSubmissionGuard', () => {
  it('allows one consent submission and rejects a replay', () => {
    let submitHandler: ((event: Event) => void) | undefined;
    const button = { disabled: false, textContent: 'Allow' };
    const form = {
      addEventListener: vi.fn(
        (_event: string, handler: (event: Event) => void) => {
          submitHandler = handler;
        }
      ),
    };
    const root = {
      getElementById: vi.fn((id: string) =>
        id === 'consent-form' ? form : button
      ),
    };
    const first = { preventDefault: vi.fn() } as unknown as Event;
    const replay = { preventDefault: vi.fn() } as unknown as Event;

    installConsentSubmissionGuard(root as never);
    submitHandler?.(first);
    submitHandler?.(replay);

    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(replay.preventDefault).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Continuing…');
  });
});
