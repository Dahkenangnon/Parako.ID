import { afterEach, describe, expect, it, vi } from 'vitest';

import { installConsentSubmissionGuard } from '../../../src/assets/js/auth/oidc/consent.js';

describe('installConsentSubmissionGuard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['form', { form: null, button: {} }],
    ['submit button', { form: { addEventListener: vi.fn() }, button: null }],
  ])('does nothing when the consent %s is absent', (_name, elements) => {
    const root = {
      getElementById: vi.fn((id: string) =>
        id === 'consent-form' ? elements.form : elements.button
      ),
    };

    installConsentSubmissionGuard(root as never);

    if (elements.form) {
      expect(elements.form.addEventListener).not.toHaveBeenCalled();
    } else {
      expect(root.getElementById).toHaveBeenCalledTimes(2);
    }
  });

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

  it('installs against an explicit browser document', () => {
    const documentRoot = {
      getElementById: vi.fn(() => null),
    };
    installConsentSubmissionGuard(documentRoot);

    expect(documentRoot.getElementById).toHaveBeenCalledWith('consent-form');
  });

  it('installs automatically when evaluated in a browser document', async () => {
    const documentRoot = { getElementById: vi.fn(() => null) };
    vi.stubGlobal('document', documentRoot);
    vi.resetModules();

    // Resetting the module cache is intentional: this verifies the browser
    // entrypoint side effect rather than the exported installer.
    await import('../../../src/assets/js/auth/oidc/consent.js');

    expect(documentRoot.getElementById).toHaveBeenCalledWith('consent-form');
  });
});
