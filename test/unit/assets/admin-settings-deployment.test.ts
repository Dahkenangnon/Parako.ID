import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: {
    preventDefault: ReturnType<typeof vi.fn>;
  }) => Promise<void>;
}

function setupDom(
  options: {
    allowedOrigins?: string | null;
    devAllowedOrigins?: string | null;
    dialog?: { showAlert?: ReturnType<typeof vi.fn> };
    form?: FormFixture | null;
    trustProxyHops?: string | null;
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
  const values: Record<string, string | null> = {
    'server.allowed_origins':
      options.allowedOrigins === undefined
        ? 'https://rp.test'
        : options.allowedOrigins,
    'server.dev_allowed_origins':
      options.devAllowedOrigins === undefined ? '' : options.devAllowedOrigins,
    'server.trust_proxy_hops':
      options.trustProxyHops === undefined ? '1' : options.trustProxyHops,
  };
  vi.stubGlobal('window', { dialog: options.dialog });
  const getElementById = vi.fn((id: string) => {
    const value = values[id];
    return value === null || value === undefined ? null : { value };
  });
  const querySelector = vi.fn(() => form);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById,
    querySelector,
  });
  return {
    getElementById,
    querySelector,
    runReady: () => ready?.(),
    dispatchSubmit: () => {
      const event = { preventDefault: vi.fn() };
      const completion = form?.submit?.(event);
      return { completion, event };
    },
    submit: async () => {
      const event = { preventDefault: vi.fn() };
      await form?.submit?.(event);
      return event;
    },
  };
}

describe('admin deployment settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/settings/deployment.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the deployment form is absent', async () => {
    const { runReady } = setupDom({ form: null });
    await import('../../../src/assets/js/admin/settings/deployment.js');

    expect(runReady).not.toThrow();
  });

  it.each([
    ['allowed origins are absent', { allowedOrigins: null }],
    ['allowed origins are blank', { allowedOrigins: '' }],
  ])('rejects submission when %s', async (_case, options) => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { runReady, submit } = setupDom({
      ...options,
      dialog: { showAlert },
    });
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'Allowed Origins are required.',
      { variant: 'error' }
    );
  });

  it('falls back to the native alert when the dialog service is unavailable', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { runReady, submit } = setupDom({ allowedOrigins: 'invalid origin' });
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      '"invalid origin" is not a valid origin URL.'
    );
  });

  it('does not validate the read-only application URL as a form field', async () => {
    const { getElementById, querySelector, runReady, submit } = setupDom();
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(getElementById).not.toHaveBeenCalledWith('url');
    expect(querySelector).toHaveBeenCalledWith('#deployment-form');
  });

  it('cancels an invalid native submission before awaiting its dialog', async () => {
    let resolveAlert: (() => void) | undefined;
    const showAlert = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveAlert = resolve;
        })
    );
    const { dispatchSubmit, runReady } = setupDom({
      allowedOrigins: 'not an origin',
      dialog: { showAlert },
    });
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const { completion, event } = dispatchSubmit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    resolveAlert?.();
    await completion;
  });

  it('reports the first invalid allowed origin', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { runReady, submit } = setupDom({
      allowedOrigins: ' https://rp.test, ,invalid origin,also invalid ',
      dialog: { showAlert },
    });
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Invalid Allowed Origin',
      '"invalid origin" is not a valid origin URL.',
      { variant: 'error' }
    );
  });

  it('reports the first invalid development origin', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { runReady, submit } = setupDom({
      devAllowedOrigins: 'https://dev-rp.test, bad dev origin',
      dialog: { showAlert },
    });
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Invalid Dev Allowed Origin',
      '"bad dev origin" is not a valid origin URL.',
      { variant: 'error' }
    );
  });

  it.each([null, '', '   ', 'Infinity', '-1', '11', '1.5', '1x'])(
    'rejects invalid trust-proxy hops %j',
    async trustProxyHops => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const { runReady, submit } = setupDom({
        dialog: { showAlert },
        trustProxyHops,
      });
      await import('../../../src/assets/js/admin/settings/deployment.js');
      runReady();

      const event = await submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Trust Proxy Hops',
        'Trust proxy hops must be an integer between 0 and 10.',
        { variant: 'error' }
      );
    }
  );

  it.each([
    ['lower boundary without development origins', '0', ''],
    [
      'upper boundary with development origins',
      '10',
      ' https://dev-one.test, ,https://dev-two.test ',
    ],
  ])('allows the %s', async (_case, trustProxyHops, devAllowedOrigins) => {
    const { runReady, submit } = setupDom({
      allowedOrigins: ' https://one.test, ,https://two.test ',
      devAllowedOrigins,
      trustProxyHops,
    });
    await import('../../../src/assets/js/admin/settings/deployment.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
