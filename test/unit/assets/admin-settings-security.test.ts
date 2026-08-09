import { afterEach, describe, expect, it, vi } from 'vitest';

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: {
    preventDefault: ReturnType<typeof vi.fn>;
  }) => Promise<void>;
}

function setupDom(
  options: {
    backupCodes?: string;
    cookieSecrets?: string;
    dialog?: { showAlert?: ReturnType<typeof vi.fn> };
    form?: FormFixture | null;
    jwtExpiresIn?: string;
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
  const elements: Record<string, { value: string } | undefined> = {
    'secrets.jwt_expires_in':
      options.jwtExpiresIn === undefined
        ? undefined
        : { value: options.jwtExpiresIn },
    'secrets.cookie_secrets':
      options.cookieSecrets === undefined
        ? undefined
        : { value: options.cookieSecrets },
    'authentication.recovery.backup_codes.count':
      options.backupCodes === undefined
        ? undefined
        : { value: options.backupCodes },
  };
  vi.stubGlobal('window', { dialog: options.dialog });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => elements[id] ?? null),
    querySelector: vi.fn(() => form),
  });
  return {
    runReady: () => ready?.(),
    submit: async () => {
      const event = { preventDefault: vi.fn() };
      await form?.submit?.(event);
      return event;
    },
  };
}

describe('admin security settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/settings/security.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the settings form is absent', async () => {
    const { runReady } = setupDom({ form: null });
    await import('../../../src/assets/js/admin/settings/security.js');

    expect(runReady).not.toThrow();
  });

  it('allows submission when no page-specific fields are present', async () => {
    const { runReady, submit } = setupDom();
    await import('../../../src/assets/js/admin/settings/security.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['', '1s', '30m', '24h', '7d'])(
    'allows JWT expiration %j',
    async jwtExpiresIn => {
      const { runReady, submit } = setupDom({ jwtExpiresIn });
      await import('../../../src/assets/js/admin/settings/security.js');
      runReady();

      const event = await submit();

      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed JWT expiration using the native alert fallback', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { runReady, submit } = setupDom({ jwtExpiresIn: '1 year' });
    await import('../../../src/assets/js/admin/settings/security.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      'JWT expiration must be in format like 1h, 30m, 7d'
    );
  });

  it.each(['', 'one-secret', 'one-secret\n  \n'])(
    'rejects insufficient cookie secrets %j',
    async cookieSecrets => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const { runReady, submit } = setupDom({
        cookieSecrets,
        dialog: { showAlert },
      });
      await import('../../../src/assets/js/admin/settings/security.js');
      runReady();

      const event = await submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Cookie Secrets',
        'At least 2 cookie secrets are required',
        { variant: 'error' }
      );
    }
  );

  it('allows two non-empty cookie secrets', async () => {
    const { runReady, submit } = setupDom({
      cookieSecrets: 'first\n  \nsecond',
    });
    await import('../../../src/assets/js/admin/settings/security.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['0', '51', 'not-a-number', '1.5'])(
    'rejects invalid backup-code count %j',
    async backupCodes => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const { runReady, submit } = setupDom({
        backupCodes,
        dialog: { showAlert },
      });
      await import('../../../src/assets/js/admin/settings/security.js');
      runReady();

      const event = await submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Backup Codes Count',
        'Backup codes count must be between 1 and 50',
        { variant: 'error' }
      );
    }
  );

  it.each(['', '1', '50'])('allows backup-code count %j', async backupCodes => {
    const { runReady, submit } = setupDom({ backupCodes });
    await import('../../../src/assets/js/admin/settings/security.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('falls back to alert when dialog has no showAlert method', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { runReady, submit } = setupDom({
      backupCodes: '51',
      dialog: {},
    });
    await import('../../../src/assets/js/admin/settings/security.js');
    runReady();

    await submit();

    expect(alert).toHaveBeenCalledWith(
      'Backup codes count must be between 1 and 50'
    );
  });
});
