import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestEmailService } from '../../../../src/services/admin/test-email.service.js';

describe('TestEmailService', () => {
  const dependencies = {
    getDeploymentUrl: vi.fn().mockReturnValue('https://id.example.com'),
    initialize: vi.fn(),
    sendEmail: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(new Date('2026-08-16T12:00:00.000Z')),
  };
  let service: TestEmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getDeploymentUrl.mockReturnValue('https://id.example.com');
    dependencies.sendEmail.mockResolvedValue(undefined);
    dependencies.now.mockReturnValue(new Date('2026-08-16T12:00:00.000Z'));
    service = new TestEmailService(dependencies);
  });

  it.each([
    [undefined, 'Email address is required'],
    ['', 'Email address is required'],
    [null, 'Email address is required'],
    [['admin@example.com'], 'Invalid email address format'],
    [{ email: 'admin@example.com' }, 'Invalid email address format'],
  ])('rejects invalid recipient input %#', async (email, error) => {
    await expect(
      service.send(email, 'admin@example.com')
    ).resolves.toMatchObject({
      status: 'invalid',
      error,
    });
    expect(dependencies.initialize).not.toHaveBeenCalled();
    expect(dependencies.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects recipients beyond the SMTP address limit', async () => {
    const email = `${'a'.repeat(245)}@example.com`;

    await expect(service.send(email, 'admin@example.com')).resolves.toEqual({
      status: 'invalid',
      error: 'Email address is too long',
      auditDescription: 'Test email failed: Email address too long',
      auditData: { emailLength: email.length },
    });
  });

  it.each(['not-an-email', 'user@-example.com', 'user@example-.com'])(
    'rejects invalid email syntax: %s',
    async email => {
      await expect(
        service.send(email, 'admin@example.com')
      ).resolves.toMatchObject({
        status: 'invalid',
        error: 'Invalid email address format',
      });
    }
  );

  it.each([
    ['admin@id.example.com', false, false],
    ['admin@sub.id.example.com', false, false],
    ['admin@gmail.com', true, true],
    ['admin@evil-id.example.com', true, false],
  ] as const)(
    'classifies %s as external=%s and free-provider=%s',
    async (email, isExternalDomain, isFreeProvider) => {
      await expect(service.send(email, 'admin@example.com')).resolves.toEqual({
        status: 'sent',
        recipientEmail: email,
        recipientDomain: email.split('@')[1],
        appDomain: 'id.example.com',
        isExternalDomain,
        isFreeProvider,
      });
    }
  );

  it('constructs deterministic text and HTML without injecting request data', async () => {
    dependencies.getDeploymentUrl.mockReturnValue(undefined);

    await service.send('admin@localhost', 'admin<script>@example.com');

    expect(dependencies.initialize).toHaveBeenCalledOnce();
    expect(dependencies.sendEmail).toHaveBeenCalledWith(
      'admin@localhost',
      'Test Email from Parako.ID',
      expect.stringContaining('Timestamp: 2026-08-16T12:00:00.000Z'),
      expect.stringContaining('admin&lt;script&gt;@example.com')
    );
  });

  it('does not hide delivery failures', async () => {
    const failure = new Error('SMTP unavailable');
    dependencies.sendEmail.mockRejectedValue(failure);

    await expect(
      service.send('admin@id.example.com', 'admin@example.com')
    ).rejects.toBe(failure);
  });
});
