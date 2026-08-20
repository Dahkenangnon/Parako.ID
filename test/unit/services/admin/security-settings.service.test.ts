import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultFullConfig } from '../../../../src/config/constants.js';
import { maskSensitiveValue } from '../../../../src/utils/settings.helper.js';
import {
  SecuritySettingsService,
  validateSecuritySettings,
} from '../../../../src/services/admin/security-settings.service.js';

describe('validateSecuritySettings', () => {
  it('reports secret and MFA requirements without throwing on malformed values', () => {
    expect(
      validateSecuritySettings({
        secrets: {
          jwt_secret: 'short',
          cookie_secrets: ['valid-secret-that-is-at-least-32-characters', 42],
        },
        authentication: {
          multi_factor: {
            totp: { enabled: true, issuer_name: '   ' },
            webauthn: { enabled: true, rp_id: '', rp_name: '\t' },
          },
        },
      })
    ).toEqual([
      'JWT secret must be at least 32 characters long for security',
      'Cookie secrets must be an array or newline-separated string',
      'TOTP issuer name is required when TOTP is enabled',
      'WebAuthn Relying Party ID is required when WebAuthn is enabled',
      'WebAuthn Relying Party name is required when WebAuthn is enabled',
    ]);
  });
});

describe('SecuritySettingsService', () => {
  const config = getDefaultFullConfig();
  const dependencies = {
    getCurrentConfig: vi.fn(() => config),
    updateSecurity: vi.fn().mockResolvedValue(undefined),
  };
  let service: SecuritySettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getCurrentConfig.mockReturnValue(config);
    service = new SecuritySettingsService(dependencies);
  });

  it('converts and persists request data without transport metadata', async () => {
    await expect(
      service.update({
        _csrf: 'request-token',
        _deviceInfo: '{"visitorId":"browser"}',
        authentication: {
          login: { password_policy: { min_length: '12' } },
        },
        protection: { trusted_domains: 'example.com\ninternal.example.com' },
      })
    ).resolves.toMatchObject({ status: 'success', fieldsModified: 2 });

    expect(dependencies.updateSecurity).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication: expect.objectContaining({
          login: expect.objectContaining({
            password_policy: expect.objectContaining({ min_length: 12 }),
          }),
        }),
        protection: expect.objectContaining({
          trusted_domains: ['example.com', 'internal.example.com'],
        }),
      })
    );
    const persisted = dependencies.updateSecurity.mock.calls[0][0];
    expect(persisted).not.toHaveProperty('_csrf');
    expect(persisted).not.toHaveProperty('_deviceInfo');
  });

  it('restores a masked secret before persistence', async () => {
    const secret = 'secret-value-that-is-at-least-32-characters';
    const current = getDefaultFullConfig();
    current.security.secrets.jwt_secret = secret;
    dependencies.getCurrentConfig.mockReturnValue(current);

    await expect(
      service.update({
        secrets: { jwt_secret: maskSensitiveValue(secret) },
      })
    ).resolves.toEqual({
      status: 'success',
      fieldsModified: 1,
      restoredFields: ['security.secrets.jwt_secret'],
    });
    expect(dependencies.updateSecurity).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: expect.objectContaining({ jwt_secret: secret }),
      })
    );
  });

  it('preserves existing cookie secrets when the field is not submitted', async () => {
    const current = getDefaultFullConfig();
    current.security.secrets.cookie_secrets = [
      'existing-cookie-secret-that-is-at-least-32-characters',
    ];
    dependencies.getCurrentConfig.mockReturnValue(current);

    await service.update({ protection: { trusted_domains: 'example.com' } });

    expect(dependencies.updateSecurity).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: expect.objectContaining({
          cookie_secrets: current.security.secrets.cookie_secrets,
        }),
      })
    );
  });

  it('returns validation errors without reading or writing configuration', async () => {
    await expect(
      service.update({ secrets: { cookie_secrets: { invalid: true } } })
    ).resolves.toEqual({
      status: 'invalid',
      errors: [
        'Cookie secrets must be an array or newline-separated string',
        'At least one cookie secret is required',
      ],
    });
    expect(dependencies.getCurrentConfig).not.toHaveBeenCalled();
    expect(dependencies.updateSecurity).not.toHaveBeenCalled();
  });

  it('does not report success when persistence fails', async () => {
    const failure = new Error('write failed');
    dependencies.updateSecurity.mockRejectedValue(failure);

    await expect(service.update({ protection: {} })).rejects.toBe(failure);
  });
});
