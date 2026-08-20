import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SecuritySettingsManager,
  initializeSecuritySettingsPage,
} from '../../../src/assets/js/admin/settings/security.js';

interface SubmitEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: SubmitEvent) => void;
}

function setupDom(
  options: {
    backupCodes?: string;
    cookieSecrets?: string;
    form?: FormFixture | null;
    jwtExpiresIn?: string;
  } = {}
) {
  const form =
    options.form === undefined
      ? ({
          addEventListener: vi.fn(
            (_name: string, listener: (event: SubmitEvent) => void) => {
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
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => elements[id] ?? null),
    querySelector: vi.fn(() => form),
  });

  return {
    submit: () => {
      const event = { preventDefault: vi.fn() };
      form?.submit?.(event);
      return event;
    },
  };
}

describe('admin security settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(SecuritySettingsManager).toBeTypeOf('function');
  });

  it('initializes safely when the settings form is absent', () => {
    setupDom({ form: null });

    expect(() => initializeSecuritySettingsPage(null)).not.toThrow();
  });

  it('allows submission when no page-specific fields are present', () => {
    const { submit } = setupDom();
    initializeSecuritySettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['', '1s', '30m', '24h', '7d'])(
    'allows JWT expiration %j',
    jwtExpiresIn => {
      const { submit } = setupDom({ jwtExpiresIn });
      initializeSecuritySettingsPage(null);

      const event = submit();

      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed JWT expiration using the native alert fallback', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { submit } = setupDom({ jwtExpiresIn: '1 year' });
    initializeSecuritySettingsPage(null);

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      'JWT expiration must be in format like 1h, 30m, 7d'
    );
  });

  it.each(['', 'one-secret', 'one-secret\n  \n'])(
    'rejects insufficient cookie secrets %j',
    cookieSecrets => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const { submit } = setupDom({ cookieSecrets });
      initializeSecuritySettingsPage({ showAlert });

      const event = submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Cookie Secrets',
        'At least 2 cookie secrets are required',
        { variant: 'error' }
      );
    }
  );

  it('allows two non-empty cookie secrets', () => {
    const { submit } = setupDom({
      cookieSecrets: 'first\n  \nsecond',
    });
    initializeSecuritySettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['0', '51', 'not-a-number', '1.5'])(
    'rejects invalid backup-code count %j',
    backupCodes => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const { submit } = setupDom({ backupCodes });
      initializeSecuritySettingsPage({ showAlert });

      const event = submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Backup Codes Count',
        'Backup codes count must be between 1 and 50',
        { variant: 'error' }
      );
    }
  );

  it.each(['', '1', '50'])('allows backup-code count %j', backupCodes => {
    const { submit } = setupDom({ backupCodes });
    initializeSecuritySettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('cancels invalid submission before an asynchronous dialog resolves', () => {
    const showAlert = vi.fn(() => new Promise<void>(() => {}));
    const { submit } = setupDom({ backupCodes: '51' });
    initializeSecuritySettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
