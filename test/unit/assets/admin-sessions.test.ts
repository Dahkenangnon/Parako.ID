import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  nativeSubmit: ReturnType<typeof vi.fn>;
  onSubmit?: (event: {
    preventDefault: ReturnType<typeof vi.fn>;
  }) => Promise<void>;
  submit: ReturnType<typeof vi.fn>;
}

function makeForm(): FormFixture {
  const nativeSubmit = vi.fn();
  const form: FormFixture = {
    addEventListener: vi.fn(
      (
        _name: string,
        listener: (event: {
          preventDefault: ReturnType<typeof vi.fn>;
        }) => Promise<void>
      ) => {
        form.onSubmit = listener;
      }
    ),
    nativeSubmit,
    submit: nativeSubmit,
  };
  return form;
}

function setupDom(
  options: {
    confirmed?: boolean;
    forms?: FormFixture[];
    stateText?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const forms = options.forms ?? [makeForm()];
  const showConfirm = vi.fn().mockResolvedValue(options.confirmed ?? false);
  const state =
    options.stateText === undefined ? null : { textContent: options.stateText };
  const browserWindow: Record<string, unknown> = {
    dialog: { showConfirm },
  };
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn(() => state),
    querySelectorAll: vi.fn(() => forms),
  });
  return {
    browserWindow,
    forms,
    runReady: () => ready?.(),
    showConfirm,
    submit: async (index = 0) => {
      const event = { preventDefault: vi.fn() };
      await forms[index]?.onSubmit?.(event);
      return event;
    },
  };
}

describe('admin sessions manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/sessions/index.js')
    ).resolves.toBeDefined();
  });

  it('prevents native submission and keeps a session when revocation is cancelled', async () => {
    const { forms, runReady, showConfirm, submit } = setupDom();
    await import('../../../src/assets/js/admin/sessions/index.js');
    runReady();

    const event = await submit();

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
    expect(forms[0]?.nativeSubmit).not.toHaveBeenCalled();
  });

  it('submits the selected revoke form after localized confirmation', async () => {
    const forms = [makeForm(), makeForm()];
    const stateText = JSON.stringify({
      csrfToken: 'csrf-token',
      translations: {
        revokeCancel: 'Keep it',
        revokeConfirm: 'End it',
        revokeMessage: 'End this device session?',
        revokeTitle: 'End session',
      },
    });
    const { browserWindow, runReady, showConfirm, submit } = setupDom({
      confirmed: true,
      forms,
      stateText,
    });
    await import('../../../src/assets/js/admin/sessions/index.js');
    runReady();

    await submit(1);

    expect(showConfirm).toHaveBeenCalledWith(
      'End session',
      'End this device session?',
      {
        variant: 'danger',
        confirmText: 'End it',
        cancelText: 'Keep it',
      }
    );
    expect(forms[0]?.nativeSubmit).not.toHaveBeenCalled();
    expect(forms[1]?.nativeSubmit).toHaveBeenCalledOnce();
    expect(browserWindow.AdminSessionsManager).toEqual(expect.any(Function));
  });

  it('logs malformed state and falls back to default confirmation text', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { runReady, showConfirm, submit } = setupDom({
      stateText: '{bad json',
    });
    await import('../../../src/assets/js/admin/sessions/index.js');
    runReady();

    await submit();

    expect(error).toHaveBeenCalledWith(
      '[AdminSessionsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Session',
      expect.any(String),
      expect.objectContaining({ confirmText: 'Revoke', cancelText: 'Cancel' })
    );
  });

  it('uses defaults when the persisted state element is blank', async () => {
    const { runReady, showConfirm, submit } = setupDom({ stateText: '' });
    await import('../../../src/assets/js/admin/sessions/index.js');
    runReady();

    await submit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Session',
      expect.any(String),
      expect.objectContaining({ confirmText: 'Revoke', cancelText: 'Cancel' })
    );
  });

  it('initializes in a document-only environment without exporting globally', async () => {
    const { runReady } = setupDom({ forms: [] });
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/admin/sessions/index.js')
    ).resolves.toBeDefined();
    expect(runReady).not.toThrow();
  });
});
