import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: {
    preventDefault: ReturnType<typeof vi.fn>;
  }) => Promise<void>;
}

function setupDom(
  options: {
    dialog?: { showAlert?: ReturnType<typeof vi.fn> };
    form?: FormFixture | null;
    issuer?: string | null;
    path?: string | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const form =
    options.form === undefined
      ? ({
          addEventListener: vi.fn(
            (
              _name: string,
              listener: (event: {
                preventDefault: ReturnType<typeof vi.fn>;
              }) => Promise<void>
            ) => {
              form!.submit = listener;
            }
          ),
        } as FormFixture)
      : options.form;
  const elements = {
    'oidc.issuer':
      options.issuer === null
        ? null
        : { value: options.issuer ?? 'https://idp.test' },
    'oidc.path':
      options.path === null ? null : { value: options.path ?? '/oidc' },
  };
  vi.stubGlobal('window', { dialog: options.dialog });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: keyof typeof elements) => elements[id] ?? null),
    querySelector: vi.fn(() => form),
  });
  return {
    form,
    runReady: () => ready?.(),
    submit: async () => {
      const event = { preventDefault: vi.fn() };
      await form?.submit?.(event);
      return event;
    },
  };
}

describe('admin OIDC settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/settings/oidc.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the settings form is absent', async () => {
    const { runReady } = setupDom({ form: null });
    await import('../../../src/assets/js/admin/settings/oidc.js');

    expect(runReady).not.toThrow();
  });

  it.each([
    ['both inputs are absent', null, null],
    ['the issuer is blank', '', '/oidc'],
    ['the path is absent', 'https://idp.test', null],
    ['the path is blank', 'https://idp.test', ''],
  ])('rejects submission when %s', async (_case, issuer, path) => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { runReady, submit } = setupDom({
      dialog: { showAlert },
      issuer,
      path,
    });
    await import('../../../src/assets/js/admin/settings/oidc.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'Issuer URL and OIDC path are required fields.',
      { variant: 'error' }
    );
  });

  it('rejects an invalid issuer using the native alert fallback', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { runReady, submit } = setupDom({ issuer: 'not a URL' });
    await import('../../../src/assets/js/admin/settings/oidc.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Please enter a valid issuer URL.');
  });

  it('uses the native alert when a dialog exists without showAlert', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { runReady, submit } = setupDom({ dialog: {}, issuer: '' });
    await import('../../../src/assets/js/admin/settings/oidc.js');
    runReady();

    await submit();

    expect(alert).toHaveBeenCalledWith(
      'Issuer URL and OIDC path are required fields.'
    );
  });

  it('allows a valid issuer and path to submit', async () => {
    const { runReady, submit } = setupDom({
      issuer: 'https://idp.test/oidc/v1',
      path: '/oidc/v1',
    });
    await import('../../../src/assets/js/admin/settings/oidc.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('allows submission when the issuer is computed and only the editable path is present', async () => {
    const { runReady, submit } = setupDom({
      issuer: null,
      path: '/oidc/v1',
    });
    await import('../../../src/assets/js/admin/settings/oidc.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
