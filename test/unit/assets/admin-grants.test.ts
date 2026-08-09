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
    csrfInput?: { value: string } | null;
    csrfMeta?: { getAttribute: ReturnType<typeof vi.fn> } | null;
    form?: FormFixture | null;
    stateText?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const form = options.form === undefined ? makeForm() : options.form;
  const showAlert = vi.fn().mockResolvedValue(undefined);
  const showConfirm = vi.fn().mockResolvedValue(options.confirmed ?? false);
  const reload = vi.fn();
  const browserWindow: Record<string, unknown> = {
    dialog: { showAlert, showConfirm },
    location: { reload },
  };
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === 'revoke-grant-form') return form;
      if (
        id === '___ADMIN_GRANTS_STATE___' &&
        options.stateText !== undefined
      ) {
        return { textContent: options.stateText };
      }
      return null;
    }),
    querySelector: vi.fn((selector: string) =>
      selector === 'input[name="_csrf"]'
        ? (options.csrfInput ?? null)
        : selector === 'meta[name="csrf-token"]'
          ? (options.csrfMeta ?? null)
          : null
    ),
  });
  return {
    browserWindow,
    form,
    reload,
    runReady: () => ready?.(),
    showAlert,
    showConfirm,
    submit: async () => {
      const event = { preventDefault: vi.fn() };
      await form?.onSubmit?.(event);
      return event;
    },
  };
}

describe('admin grants manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/grants/index.js')
    ).resolves.toBeDefined();
  });

  it('initializes without a revoke form in a document-only environment', async () => {
    const { runReady } = setupDom({ form: null });
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/admin/grants/index.js')
    ).resolves.toBeDefined();
    expect(runReady).not.toThrow();
  });

  it('logs malformed persisted state and initializes with safe defaults', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { browserWindow, runReady } = setupDom({ stateText: '{bad json' });
    await import('../../../src/assets/js/admin/grants/index.js');

    expect(runReady).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[AdminGrantsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
    expect(browserWindow.revokeGrant).toEqual(expect.any(Function));
  });

  it('uses defaults when the persisted state element is blank', async () => {
    const { runReady, showConfirm, submit } = setupDom({ stateText: '' });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await submit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Authorization',
      expect.any(String),
      expect.objectContaining({ confirmText: 'Revoke', cancelText: 'Cancel' })
    );
  });

  it('prevents native form submission and keeps a grant when revocation is cancelled', async () => {
    const { browserWindow, form, runReady, showConfirm, submit } = setupDom();
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Authorization',
      'Are you sure you want to revoke this authorization? This action cannot be undone.',
      {
        variant: 'danger',
        confirmText: 'Revoke',
        cancelText: 'Cancel',
      }
    );
    expect(form?.nativeSubmit).not.toHaveBeenCalled();
    expect(browserWindow).toMatchObject({
      AdminGrantsManager: expect.any(Function),
      revokeGrant: expect.any(Function),
    });
  });

  it('submits the revoke form after localized confirmation', async () => {
    const { form, runReady, showConfirm, submit } = setupDom({
      confirmed: true,
      stateText: JSON.stringify({
        translations: {
          revokeCancel: 'Keep it',
          revokeConfirm: 'Remove it',
          revokeMessage: 'Remove this authorization?',
          revokeTitle: 'Confirm removal',
        },
      }),
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await submit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Confirm removal',
      'Remove this authorization?',
      {
        variant: 'danger',
        confirmText: 'Remove it',
        cancelText: 'Keep it',
      }
    );
    expect(form?.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('does not call the revoke endpoint when AJAX revocation is cancelled', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { browserWindow, runReady } = setupDom();
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant-1'
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it('revokes through the configured route with an encoded grant id', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    const { browserWindow, reload, runReady, showAlert } = setupDom({
      confirmed: true,
      csrfInput: { value: 'page-csrf' },
      stateText: JSON.stringify({
        csrfToken: 'configured-csrf',
        routes: { revokeGrant: '/custom/grants/{id}/remove' },
      }),
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant/1'
    );

    expect(fetch).toHaveBeenCalledWith('/custom/grants/grant%2F1/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CSRF-Token': 'page-csrf',
      },
    });
    expect(showAlert).toHaveBeenCalledWith(
      'Success',
      'Authorization revoked successfully',
      { variant: 'success' }
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  it('uses the safe default route when the configured route is blank', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    const { browserWindow, runReady } = setupDom({
      confirmed: true,
      stateText: JSON.stringify({ routes: { revokeGrant: '' } }),
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant/1'
    );

    expect(fetch).toHaveBeenCalledWith(
      '/admin/user-grants/grant%2F1/revoke',
      expect.any(Object)
    );
  });

  it('shows the server error and does not reload when revocation is rejected', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        error: 'Grant is already inactive',
        success: false,
      }),
    });
    vi.stubGlobal('fetch', fetch);
    const { browserWindow, reload, runReady, showAlert } = setupDom({
      confirmed: true,
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant-1'
    );

    expect(showAlert).toHaveBeenCalledWith(
      'Error',
      'Failed to revoke authorization: Grant is already inactive',
      { variant: 'error' }
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('uses the unknown-error fallback when a rejection has no details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
    );
    const { browserWindow, runReady, showAlert } = setupDom({
      confirmed: true,
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant-1'
    );

    expect(showAlert).toHaveBeenCalledWith(
      'Error',
      'Failed to revoke authorization: Unknown error',
      { variant: 'error' }
    );
  });

  it('uses the meta CSRF token when the hidden token is empty', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    const csrfMeta = { getAttribute: vi.fn(() => 'meta-csrf') };
    const { browserWindow, runReady } = setupDom({
      confirmed: true,
      csrfInput: { value: '' },
      csrfMeta,
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant-1'
    );

    expect(csrfMeta.getAttribute).toHaveBeenCalledWith('content');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'CSRF-Token': 'meta-csrf' }),
      })
    );
  });

  it('falls back to the configured CSRF token when the meta token is empty', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    const csrfMeta = { getAttribute: vi.fn(() => '') };
    const { browserWindow, runReady } = setupDom({
      confirmed: true,
      csrfMeta,
      stateText: JSON.stringify({ csrfToken: 'configured-csrf' }),
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant-1'
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'CSRF-Token': 'configured-csrf',
        }),
      })
    );
  });

  it('logs transport failures and shows a retryable error', async () => {
    const failure = new Error('network unavailable');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    const { browserWindow, reload, runReady, showAlert } = setupDom({
      confirmed: true,
    });
    await import('../../../src/assets/js/admin/grants/index.js');
    runReady();

    await (browserWindow.revokeGrant as (grantId: string) => Promise<void>)(
      'grant-1'
    );

    expect(error).toHaveBeenCalledWith(
      'Error revoking authorization:',
      failure
    );
    expect(showAlert).toHaveBeenCalledWith(
      'Error',
      'Failed to revoke authorization. Please try again.',
      { variant: 'error' }
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
