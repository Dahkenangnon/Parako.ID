import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminSessionsManager } from '../../../src/assets/js/admin/sessions/index.js';

type SubmitEvent = {
  preventDefault: ReturnType<typeof vi.fn>;
};

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  dataset: Record<string, string>;
  emitSubmit: () => Promise<SubmitEvent>;
  submit: ReturnType<typeof vi.fn>;
}

function makeForm(dataset: Record<string, string> = {}): FormFixture {
  let listener: ((event: SubmitEvent) => Promise<void>) | undefined;
  const form = {
    addEventListener: vi.fn(
      (_name: string, nextListener: (event: SubmitEvent) => Promise<void>) => {
        listener = nextListener;
      }
    ),
    dataset,
    emitSubmit: async () => {
      const event = { preventDefault: vi.fn() };
      await listener?.(event);
      return event;
    },
    submit: vi.fn(),
  } satisfies FormFixture;
  return form;
}

function setupDom(
  options: { confirmed?: boolean; forms?: FormFixture[] } = {}
) {
  const forms = options.forms ?? [makeForm()];
  const showConfirm = vi.fn().mockResolvedValue(options.confirmed ?? false);
  vi.stubGlobal('window', { dialog: { showConfirm } });
  vi.stubGlobal('document', {
    querySelectorAll: vi.fn(() => forms),
  });

  return { forms, showConfirm };
}

describe('AdminSessionsManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(AdminSessionsManager).toBeTypeOf('function');
  });

  it('initializes safely when the page has no revocation forms', () => {
    setupDom({ forms: [] });

    expect(() => new AdminSessionsManager().initialize()).not.toThrow();
  });

  it('prevents native submission and keeps a session when revocation is cancelled', async () => {
    const { forms, showConfirm } = setupDom();
    new AdminSessionsManager().initialize();

    const event = await forms[0]!.emitSubmit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Session',
      'Are you sure you want to revoke this session? This will immediately log out the user from this device.',
      {
        variant: 'danger',
        confirmText: 'Revoke',
        cancelText: 'Cancel',
      }
    );
    expect(forms[0]!.submit).not.toHaveBeenCalled();
  });

  it('submits only the selected form after localized confirmation', async () => {
    const forms = [makeForm(), makeForm()];
    const { showConfirm } = setupDom({ confirmed: true, forms });
    new AdminSessionsManager({
      translations: {
        revokeCancel: 'Keep it',
        revokeConfirm: 'End it',
        revokeMessage: 'End this device session?',
        revokeTitle: 'End session',
      },
    }).initialize();

    await forms[1]!.emitSubmit();

    expect(showConfirm).toHaveBeenCalledWith(
      'End session',
      'End this device session?',
      {
        variant: 'danger',
        confirmText: 'End it',
        cancelText: 'Keep it',
      }
    );
    expect(forms[0]!.submit).not.toHaveBeenCalled();
    expect(forms[1]!.submit).toHaveBeenCalledOnce();
  });

  it('uses a form-specific message for bulk user revocation', async () => {
    const form = makeForm({
      sessionRevokeMessage:
        'Revoke every active session for alice on all devices?',
    });
    const { showConfirm } = setupDom({ forms: [form] });
    new AdminSessionsManager().initialize();

    await form.emitSubmit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Session',
      'Revoke every active session for alice on all devices?',
      expect.any(Object)
    );
  });
  it('preserves native form submission when the dialog service is unavailable', async () => {
    const form = makeForm();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { querySelectorAll: vi.fn(() => [form]) });
    new AdminSessionsManager().initialize();

    const event = await form.emitSubmit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('bootstraps with defaults when serialized state is absent', async () => {
    vi.resetModules();
    const form = makeForm();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
      querySelectorAll: vi.fn(() => [form]),
      readyState: 'complete',
    });

    await import('../../../src/assets/js/admin/sessions/index.js');

    expect(form.addEventListener).toHaveBeenCalledWith(
      'submit',
      expect.any(Function)
    );
  });

  it('waits for DOM readiness and falls back safely from malformed state', async () => {
    vi.resetModules();
    const form = makeForm();
    const listeners = new Map<string, () => void>();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      addEventListener: vi.fn((name: string, listener: () => void) =>
        listeners.set(name, listener)
      ),
      getElementById: vi.fn(() => ({ textContent: '{invalid-json' })),
      querySelectorAll: vi.fn(() => [form]),
      readyState: 'loading',
    });

    await import('../../../src/assets/js/admin/sessions/index.js');
    expect(form.addEventListener).not.toHaveBeenCalled();
    listeners.get('DOMContentLoaded')?.();

    expect(form.addEventListener).toHaveBeenCalledWith(
      'submit',
      expect.any(Function)
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[AdminSessionsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('bootstraps the page from its serialized state', async () => {
    vi.resetModules();
    const form = makeForm();
    const showConfirm = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('window', { dialog: { showConfirm } });
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => ({
        textContent: JSON.stringify({
          translations: { revokeTitle: 'Serialized session title' },
        }),
      })),
      querySelectorAll: vi.fn(() => [form]),
      readyState: 'complete',
    });

    await import('../../../src/assets/js/admin/sessions/index.js');
    await form.emitSubmit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Serialized session title',
      expect.any(String),
      expect.any(Object)
    );
    expect(
      (window as typeof window & { AdminSessionsManager?: unknown })
        .AdminSessionsManager
    ).toBeTypeOf('function');
  });
});
