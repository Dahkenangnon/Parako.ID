import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretRevealService } from '../../../../src/services/admin/secret-reveal.service.js';

describe('SecretRevealService', () => {
  const dependencies = {
    loadDecryptedConfiguration: vi.fn(),
  };
  let service: SecretRevealService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.loadDecryptedConfiguration.mockResolvedValue({
      security: { secrets: { jwt_secret: 'actual-jwt-secret' } },
      integrations: { email: {} },
    });
    service = new SecretRevealService(dependencies);
  });

  it.each([undefined, '', 42, [], {}])(
    'rejects a missing or malformed path %#',
    async fieldPath => {
      await expect(service.reveal(fieldPath)).resolves.toEqual({
        status: 'invalid',
        error: 'Field path is required',
      });
      expect(dependencies.loadDecryptedConfiguration).not.toHaveBeenCalled();
    }
  );

  it('rejects fields outside the secret allowlist', async () => {
    await expect(service.reveal('application.name')).resolves.toEqual({
      status: 'invalid',
      error: 'Invalid field path',
    });
    expect(dependencies.loadDecryptedConfiguration).not.toHaveBeenCalled();
  });

  it('reports an absent persisted configuration', async () => {
    dependencies.loadDecryptedConfiguration.mockResolvedValue(null);

    await expect(
      service.reveal('security.secrets.jwt_secret')
    ).resolves.toEqual({ status: 'not_found' });
  });

  it.each([
    ['security.secrets.jwt_secret', 'actual-jwt-secret'],
    ['integrations.email.smtp_password', ''],
  ] as const)('reveals the allowlisted path %s', async (fieldPath, value) => {
    await expect(service.reveal(fieldPath)).resolves.toEqual({
      status: 'success',
      fieldPath,
      value,
    });
  });

  it('preserves non-string secret values', async () => {
    dependencies.loadDecryptedConfiguration.mockResolvedValue({
      security: { secrets: { cookie_secrets: ['first', 'second'] } },
    });

    await expect(
      service.reveal('security.secrets.cookie_secrets')
    ).resolves.toEqual({
      status: 'success',
      fieldPath: 'security.secrets.cookie_secrets',
      value: ['first', 'second'],
    });
  });

  it('does not hide decryption failures', async () => {
    const failure = new Error('KMS unavailable');
    dependencies.loadDecryptedConfiguration.mockRejectedValue(failure);

    await expect(service.reveal('security.secrets.jwt_secret')).rejects.toBe(
      failure
    );
  });
});
