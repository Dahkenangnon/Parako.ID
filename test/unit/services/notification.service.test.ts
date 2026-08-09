import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../../src/services/notification.service.js';
import type { IUser } from '../../../src/types/user.js';

const recipient = {
  email: 'alice@example.com',
  username: 'alice',
  locale: 'fr',
};

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: 'user-123',
    id: 'user-123',
    username: 'alice',
    email: 'alice@example.com',
    gender: 'F',
    roles: ['user'],
    blocked_from: [],
    account_is_anonymized: false,
    register_with: 'email',
    phone_number_verified: false,
    email_verified: true,
    ...overrides,
  } as IUser;
}

describe('NotificationService', () => {
  let emailService: any;
  let configManager: any;
  let logger: any;
  let service: NotificationService;

  beforeEach(() => {
    emailService = {
      sendVerificationEmail: vi.fn(),
      sendPasswordResetEmail: vi.fn(),
      sendWelcomeEmail: vi.fn(),
      sendSecurityAlertEmail: vi.fn(),
      sendNewSessionNotification: vi.fn(),
      sendNewDeviceOtpEmail: vi.fn(),
      sendNotificationEmail: vi.fn(),
      sendTemplatedEmail: vi.fn(),
    };
    configManager = {
      getConfig: vi.fn(() => ({
        notifications: { channels: { sms: { enabled: true } } },
      })),
    };
    logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    service = new NotificationService(emailService, configManager, logger);
  });

  describe('required recipient validation', () => {
    it.each([
      [
        'verification',
        () => service.sendVerification({}, '/verify'),
        'No email address provided for verification',
      ],
      [
        'password reset',
        () => service.sendPasswordReset({}, '/reset'),
        'No email address provided for password reset',
      ],
      [
        'welcome',
        () => service.sendWelcome({}),
        'No email address provided for welcome notification',
      ],
      [
        'security alert',
        () => service.sendSecurityAlert({}, 'password_changed', {}),
        'No email address provided for security alert',
      ],
      [
        'session alert',
        () =>
          service.sendNewSessionAlert(
            {},
            {
              ip: '127.0.0.1',
              userAgent: 'vitest',
              timestamp: new Date(),
            }
          ),
        'No email address provided for new session alert',
      ],
      [
        'OTP',
        () =>
          service.sendOtp({}, '123456', {
            deviceInfo: 'Browser',
            ip: '127.0.0.1',
          }),
        'No email address provided for OTP notification',
      ],
      [
        'generic',
        () => service.sendGeneric({}, 'Title', 'Content'),
        'No email address provided for generic notification',
      ],
      [
        'template',
        () => service.sendTemplatedEmail('', 'Subject', 'mail.njk', {}),
        'No email address provided for templated notification',
      ],
      [
        'backup warning',
        () => service.sendBackupCodeWarning({}, 2, '/settings'),
        'No email address provided for backup code warning',
      ],
    ])('rejects a missing email for %s', async (_name, send, error) => {
      await expect(send()).resolves.toEqual({
        success: false,
        channel: 'email',
        error,
      });
      expect(
        (Object.values(emailService) as Array<ReturnType<typeof vi.fn>>).some(
          mock => mock.mock.calls.length > 0
        )
      ).toBe(false);
    });

    it('rejects a whitespace-only email instead of passing it to SMTP', async () => {
      await expect(
        service.sendVerification({ email: '   ' }, '/verify')
      ).resolves.toEqual({
        success: false,
        channel: 'email',
        error: 'No email address provided for verification',
      });
      expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('successful delivery', () => {
    it('sends verification email with locale and username', async () => {
      await expect(
        service.sendVerification(recipient, '/verify')
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'alice',
        '/verify',
        'fr'
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Verification notification sent',
        { channel: 'email', recipient: 'alice@example.com' }
      );
    });

    it('sends password reset email with the default username', async () => {
      await expect(
        service.sendPasswordReset(
          { email: 'alice@example.com', locale: 'en' },
          '/reset'
        )
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'User',
        '/reset',
        'en'
      );
    });

    it('sends welcome email', async () => {
      await expect(service.sendWelcome(recipient)).resolves.toEqual({
        success: true,
        channel: 'email',
      });
      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'alice',
        'fr'
      );
    });

    it('serializes security-alert details in insertion order', async () => {
      await expect(
        service.sendSecurityAlert(recipient, 'account_recovered', {
          method: 'sms',
          attempts: 2,
        })
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendSecurityAlertEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'alice',
        'account_recovered',
        'method: sms, attempts: 2',
        'fr'
      );
    });

    it('sends the complete new-session context', async () => {
      const timestamp = new Date('2026-08-01T00:00:00.000Z');
      await expect(
        service.sendNewSessionAlert(recipient, {
          ip: '127.0.0.1',
          userAgent: 'vitest',
          timestamp,
        })
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendNewSessionNotification).toHaveBeenCalledWith({
        email: 'alice@example.com',
        username: 'alice',
        ip: '127.0.0.1',
        userAgent: 'vitest',
        timestamp,
        locale: 'fr',
      });
    });

    it('sends OTP context', async () => {
      await expect(
        service.sendOtp(recipient, '123456', {
          deviceInfo: 'Chrome on Linux',
          ip: '127.0.0.1',
        })
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendNewDeviceOtpEmail).toHaveBeenCalledWith({
        email: 'alice@example.com',
        username: 'alice',
        otp: '123456',
        deviceInfo: 'Chrome on Linux',
        ip: '127.0.0.1',
        locale: 'fr',
      });
    });

    it.each([
      [undefined, undefined, undefined],
      [{ url: '/account', text: 'Open' }, '/account', 'Open'],
    ])(
      'sends generic content and optional action %# while preserving locale',
      async (action, expectedUrl, expectedText) => {
        await expect(
          service.sendGeneric(recipient, 'Title', 'Content', action)
        ).resolves.toEqual({ success: true, channel: 'email' });
        expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
          'alice@example.com',
          'alice',
          'Title',
          'Content',
          expectedUrl,
          expectedText,
          'fr'
        );
      }
    );

    it('sends a templated email with all arguments', async () => {
      await expect(
        service.sendTemplatedEmail(
          'alice@example.com',
          'Subject',
          'mail.njk',
          { value: 1 },
          'fr'
        )
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendTemplatedEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'Subject',
        'mail.njk',
        { value: 1 },
        'fr'
      );
    });

    it.each([
      [
        0,
        'Backup Codes Depleted',
        'You have used all your backup recovery codes. Please generate new codes immediately to ensure you can recover your account if needed.',
      ],
      [
        1,
        'Only 1 Backup Code Remaining',
        'You have only 1 backup recovery code remaining. We recommend generating new codes soon to ensure account recovery is always available.',
      ],
      [
        2,
        'Only 2 Backup Codes Remaining',
        'You have only 2 backup recovery codes remaining. We recommend generating new codes soon to ensure account recovery is always available.',
      ],
    ])(
      'renders the correct backup-code warning for count=%s',
      async (count, title, content) => {
        await expect(
          service.sendBackupCodeWarning(recipient, count, '/settings')
        ).resolves.toEqual({ success: true, channel: 'email' });
        expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
          'alice@example.com',
          'alice',
          title,
          content,
          '/settings',
          'Generate New Codes',
          'fr'
        );
      }
    );

    it('sends an admin alert to every configured address', async () => {
      await expect(
        service.sendAdminAlert(
          ['admin-1@example.com', 'admin-2@example.com'],
          'Incident',
          'Details'
        )
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendNotificationEmail).toHaveBeenCalledTimes(2);
      expect(emailService.sendNotificationEmail).toHaveBeenNthCalledWith(
        1,
        'admin-1@example.com',
        'Administrator',
        'Incident',
        'Details'
      );
      expect(emailService.sendNotificationEmail).toHaveBeenNthCalledWith(
        2,
        'admin-2@example.com',
        'Administrator',
        'Incident',
        'Details'
      );
    });

    it('uses the default username consistently across notification templates', async () => {
      const anonymousRecipient = {
        email: 'anonymous@example.com',
        locale: 'en',
      };
      await service.sendVerification(anonymousRecipient, '/verify');
      await service.sendWelcome(anonymousRecipient);
      await service.sendSecurityAlert(anonymousRecipient, 'alert', {});
      await service.sendNewSessionAlert(anonymousRecipient, {
        ip: '127.0.0.1',
        userAgent: 'vitest',
        timestamp: new Date(),
      });
      await service.sendOtp(anonymousRecipient, '123456', {
        deviceInfo: 'Browser',
        ip: '127.0.0.1',
      });
      await service.sendGeneric(anonymousRecipient, 'Title', 'Content');
      await service.sendBackupCodeWarning(anonymousRecipient, 2, '/settings');

      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        'anonymous@example.com',
        'User',
        '/verify',
        'en'
      );
      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'anonymous@example.com',
        'User',
        'en'
      );
      expect(emailService.sendSecurityAlertEmail).toHaveBeenCalledWith(
        'anonymous@example.com',
        'User',
        'alert',
        '',
        'en'
      );
      expect(emailService.sendNewSessionNotification).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'User' })
      );
      expect(emailService.sendNewDeviceOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'User' })
      );
      expect(emailService.sendNotificationEmail).toHaveBeenNthCalledWith(
        1,
        'anonymous@example.com',
        'User',
        'Title',
        'Content',
        undefined,
        undefined,
        'en'
      );
      expect(emailService.sendNotificationEmail).toHaveBeenNthCalledWith(
        2,
        'anonymous@example.com',
        'User',
        'Only 2 Backup Codes Remaining',
        expect.any(String),
        '/settings',
        'Generate New Codes',
        'en'
      );
    });
  });

  describe('delivery failures', () => {
    const failureCases = [
      [
        'verification',
        'sendVerificationEmail',
        (instance: NotificationService) =>
          instance.sendVerification(recipient, '/verify'),
        'Failed to send verification notification',
      ],
      [
        'password reset',
        'sendPasswordResetEmail',
        (instance: NotificationService) =>
          instance.sendPasswordReset(recipient, '/reset'),
        'Failed to send password reset notification',
      ],
      [
        'welcome',
        'sendWelcomeEmail',
        (instance: NotificationService) => instance.sendWelcome(recipient),
        'Failed to send welcome notification',
      ],
      [
        'security alert',
        'sendSecurityAlertEmail',
        (instance: NotificationService) =>
          instance.sendSecurityAlert(recipient, 'alert', {}),
        'Failed to send security alert notification',
      ],
      [
        'session alert',
        'sendNewSessionNotification',
        (instance: NotificationService) =>
          instance.sendNewSessionAlert(recipient, {
            ip: '127.0.0.1',
            userAgent: 'vitest',
            timestamp: new Date(),
          }),
        'Failed to send new session alert notification',
      ],
      [
        'OTP',
        'sendNewDeviceOtpEmail',
        (instance: NotificationService) =>
          instance.sendOtp(recipient, '123456', {
            deviceInfo: 'Browser',
            ip: '127.0.0.1',
          }),
        'Failed to send OTP notification',
      ],
      [
        'generic',
        'sendNotificationEmail',
        (instance: NotificationService) =>
          instance.sendGeneric(recipient, 'Title', 'Content'),
        'Failed to send generic notification',
      ],
      [
        'template',
        'sendTemplatedEmail',
        (instance: NotificationService) =>
          instance.sendTemplatedEmail(
            'alice@example.com',
            'Subject',
            'mail.njk',
            {}
          ),
        'Failed to send templated email notification',
      ],
      [
        'backup warning',
        'sendNotificationEmail',
        (instance: NotificationService) =>
          instance.sendBackupCodeWarning(recipient, 2, '/settings'),
        'Failed to send backup code warning notification',
      ],
    ] as const;

    it.each(failureCases)(
      'returns a failure result when %s delivery rejects',
      async (_name, dependencyMethod, send, logMessage) => {
        emailService[dependencyMethod].mockRejectedValue(
          new Error('SMTP unavailable')
        );
        await expect(send(service)).resolves.toEqual({
          success: false,
          channel: 'email',
          error: 'SMTP unavailable',
        });
        expect(logger.error).toHaveBeenCalledWith(
          logMessage,
          expect.objectContaining({ error: 'SMTP unavailable' })
        );
      }
    );

    it('normalizes non-Error rejection values without leaking undefined', async () => {
      emailService.sendWelcomeEmail.mockRejectedValue('SMTP unavailable');
      await expect(service.sendWelcome(recipient)).resolves.toEqual({
        success: false,
        channel: 'email',
        error: 'Unknown notification error',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send welcome notification',
        expect.objectContaining({ error: 'Unknown notification error' })
      );
    });

    it.each([null, []])(
      'rejects absent admin recipients %#',
      async adminEmails => {
        await expect(
          service.sendAdminAlert(
            adminEmails as unknown as string[],
            'Subject',
            'Content'
          )
        ).resolves.toEqual({
          success: false,
          channel: 'email',
          error: 'No admin email addresses provided',
        });
      }
    );

    it('rejects an admin recipient list containing only blank addresses', async () => {
      await expect(
        service.sendAdminAlert(['   '], 'Subject', 'Content')
      ).resolves.toEqual({
        success: false,
        channel: 'email',
        error: 'No admin email addresses provided',
      });
      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('trims admin recipient addresses before delivery', async () => {
      await expect(
        service.sendAdminAlert([' admin@example.com '], 'Subject', 'Content')
      ).resolves.toEqual({ success: true, channel: 'email' });
      expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
        'admin@example.com',
        'Administrator',
        'Subject',
        'Content'
      );
    });

    it('returns a failure if any admin delivery rejects', async () => {
      emailService.sendNotificationEmail
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('second failed'));
      await expect(
        service.sendAdminAlert(
          ['admin-1@example.com', 'admin-2@example.com'],
          'Subject',
          'Content'
        )
      ).resolves.toEqual({
        success: false,
        channel: 'email',
        error: 'second failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send admin alert notification',
        {
          error: 'second failed',
          adminEmails: ['admin-1@example.com', 'admin-2@example.com'],
        }
      );
    });
  });

  describe('channel selection', () => {
    it.each([
      [
        'explicit email',
        makeUser({
          notification_preferences: {
            preferred_channel: 'email',
            security_alerts: true,
            new_session_alerts: true,
            marketing: false,
          },
        }),
        'email',
      ],
      [
        'explicit SMS',
        makeUser({
          email: undefined,
          phone_number: '+22997000000',
          notification_preferences: {
            preferred_channel: 'sms',
            security_alerts: true,
            new_session_alerts: true,
            marketing: false,
          },
        }),
        'sms',
      ],
      ['automatic email', makeUser(), 'email'],
      [
        'fallback email for unavailable explicit SMS',
        makeUser({
          phone_number: undefined,
          notification_preferences: {
            preferred_channel: 'sms',
            security_alerts: true,
            new_session_alerts: true,
            marketing: false,
          },
        }),
        'email',
      ],
      [
        'automatic SMS',
        makeUser({ email: undefined, phone_number: '+22997000000' }),
        'sms',
      ],
      [
        'email default without contact methods',
        makeUser({ email: undefined, phone_number: undefined }),
        'email',
      ],
    ])('selects %s', (_name, user, expected) => {
      expect(service.getPreferredChannel(user)).toBe(expected);
    });

    it('falls back to email when SMS is disabled', () => {
      configManager.getConfig.mockReturnValue({
        notifications: { channels: { sms: { enabled: false } } },
      });
      expect(
        service.getPreferredChannel(
          makeUser({ email: undefined, phone_number: '+22997000000' })
        )
      ).toBe('email');
    });

    it('falls back to email when SMS configuration is absent', () => {
      configManager.getConfig.mockReturnValue({});
      expect(
        service.getPreferredChannel(
          makeUser({ email: undefined, phone_number: '+22997000000' })
        )
      ).toBe('email');
    });

    it('falls back safely when channel configuration cannot be read', () => {
      configManager.getConfig.mockImplementation(() => {
        throw new Error('configuration unavailable');
      });
      expect(
        service.getPreferredChannel(
          makeUser({ email: undefined, phone_number: '+22997000000' })
        )
      ).toBe('email');
      expect(logger.warn).toHaveBeenCalledWith(
        'Could not read notification config, defaulting to email only'
      );
    });

    it.each([
      [false, ['email']],
      [true, ['email', 'sms']],
    ])(
      'reports available channels when SMS enabled=%s',
      (enabled, expected) => {
        configManager.getConfig.mockReturnValue({
          notifications: { channels: { sms: { enabled } } },
        });
        expect(service.getAvailableChannels()).toEqual(expected);
      }
    );

    it('returns email only and logs when available-channel config fails', () => {
      configManager.getConfig.mockImplementation(() => {
        throw new Error('configuration unavailable');
      });
      expect(service.getAvailableChannels()).toEqual(['email']);
      expect(logger.warn).toHaveBeenCalledWith(
        'Could not read notification config, defaulting to email only'
      );
    });
  });
});
