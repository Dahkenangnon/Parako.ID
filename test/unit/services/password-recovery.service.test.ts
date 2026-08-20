import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordRecoveryService } from '../../../src/services/password-recovery.service.js';
import type { IUser } from '../../../src/types/user.js';

const user = {
  _id: 'user-1',
  username: 'alice',
  email: 'alice@example.test',
  given_name: 'Alice',
  family_name: 'Doe',
  locale: 'fr',
} as IUser;

describe('PasswordRecoveryService', () => {
  const dependencies = {
    isValidEmailAddress: vi.fn().mockReturnValue(true),
    getPasswordPolicy: vi.fn().mockReturnValue({
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSymbols: false,
      maxAgeDays: 90,
    }),
    validatePassword: vi.fn().mockReturnValue({ isValid: true, messages: [] }),
    resetPassword: vi.fn().mockResolvedValue(user),
    generatePasswordResetToken: vi
      .fn()
      .mockResolvedValue({ user, resetToken: 'reset-token' }),
    buildResetUrl: vi
      .fn()
      .mockReturnValue('https://id.example.test/auth/reset?token=reset-token'),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    revokeSessions: vi.fn().mockResolvedValue(2),
    sendResetNotification: vi.fn().mockResolvedValue(undefined),
    applicationTitle: vi.fn().mockReturnValue('Parako'),
    formatResetTime: vi.fn().mockReturnValue('8/19/2026, 12:00:00 PM'),
    info: vi.fn(),
    error: vi.fn(),
  };
  let service: PasswordRecoveryService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.isValidEmailAddress.mockReturnValue(true);
    dependencies.validatePassword.mockReturnValue({
      isValid: true,
      messages: [],
    });
    dependencies.resetPassword.mockResolvedValue(user);
    dependencies.generatePasswordResetToken.mockResolvedValue({
      user,
      resetToken: 'reset-token',
    });
    dependencies.buildResetUrl.mockReturnValue(
      'https://id.example.test/auth/reset?token=reset-token'
    );
    dependencies.sendPasswordReset.mockResolvedValue(undefined);
    dependencies.revokeSessions.mockResolvedValue(2);
    dependencies.sendResetNotification.mockResolvedValue(undefined);
    service = new PasswordRecoveryService(dependencies as never);
  });

  it('requires a scalar reset token before exposing the password policy', () => {
    expect(service.resetPage(undefined)).toEqual({ status: 'missing_token' });
    expect(service.resetPage(['reset-token'])).toEqual({
      status: 'missing_token',
    });
    expect(service.resetPage('reset-token')).toEqual({
      status: 'ready',
      token: 'reset-token',
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: false,
        maxAgeDays: 90,
      },
    });
  });

  it.each([
    [{ password: 'valid', 'confirm-password': 'valid' }, 'missing_token'],
    [
      {
        token: 'reset-token',
        password: ['structured'],
        'confirm-password': ['structured'],
      },
      'invalid_password',
    ],
    [
      {
        token: 'reset-token',
        password: 'valid',
        'confirm-password': 'different',
      },
      'passwords_do_not_match',
    ],
  ] as const)('rejects malformed reset input %#', async (input, status) => {
    await expect(service.submitReset(input)).resolves.toMatchObject({ status });
    expect(dependencies.resetPassword).not.toHaveBeenCalled();
  });

  it('returns password-policy messages without changing credentials', async () => {
    dependencies.validatePassword.mockReturnValue({
      isValid: false,
      messages: ['Use 12 characters', 'Use a number'],
    });

    await expect(
      service.submitReset({
        token: 'reset-token',
        password: 'weak',
        'confirm-password': 'weak',
      })
    ).resolves.toEqual({
      status: 'invalid_password',
      token: 'reset-token',
      messages: ['Use 12 characters', 'Use a number'],
    });
    expect(dependencies.resetPassword).not.toHaveBeenCalled();
  });

  it('changes the password before revoking sessions and sending notification', async () => {
    await expect(
      service.submitReset({
        token: 'reset-token',
        password: 'valid-password',
        'confirm-password': 'valid-password',
      })
    ).resolves.toEqual({ status: 'success', user });

    expect(dependencies.resetPassword).toHaveBeenCalledWith(
      'reset-token',
      'valid-password'
    );
    expect(dependencies.revokeSessions).toHaveBeenCalledWith('alice');
    expect(dependencies.sendResetNotification).toHaveBeenCalledWith(
      'alice@example.test',
      'Your Parako password has been reset',
      'email/mail.njk',
      expect.objectContaining({
        title: 'Your Parako password has been reset',
        username: 'Alice Doe',
        content: expect.stringContaining('8/19/2026, 12:00:00 PM'),
      })
    );
  });

  it.each(['revokeSessions', 'sendResetNotification'] as const)(
    'contains a %s failure after the credential change',
    async dependency => {
      dependencies[dependency].mockRejectedValue(new Error('offline'));

      await expect(
        service.submitReset({
          token: 'reset-token',
          password: 'valid-password',
          'confirm-password': 'valid-password',
        })
      ).resolves.toEqual({ status: 'success', user });
      expect(dependencies.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context:
            dependency === 'revokeSessions'
              ? 'session_revocation_after_reset_failed'
              : 'password_reset_notification_failed',
        })
      );
    }
  );

  it.each([undefined, '', ['alice@example.test'], 'invalid'])(
    'rejects an invalid reset request identifier %j',
    async email => {
      dependencies.isValidEmailAddress.mockReturnValue(false);

      await expect(service.requestReset(email)).resolves.toEqual({
        status: 'invalid_email',
      });
      expect(dependencies.generatePasswordResetToken).not.toHaveBeenCalled();
    }
  );

  it('builds and delivers a reset URL for a valid identifier', async () => {
    await expect(service.requestReset('alice@example.test')).resolves.toEqual({
      status: 'accepted',
    });

    expect(dependencies.buildResetUrl).toHaveBeenCalledWith('reset-token');
    expect(dependencies.sendPasswordReset).toHaveBeenCalledWith(
      {
        email: 'alice@example.test',
        username: 'Alice',
        locale: 'fr',
      },
      'https://id.example.test/auth/reset?token=reset-token'
    );
  });

  it('returns the same accepted result when lookup or delivery fails', async () => {
    dependencies.generatePasswordResetToken.mockRejectedValue(
      new Error('unknown account')
    );

    await expect(service.requestReset('unknown@example.test')).resolves.toEqual(
      { status: 'accepted' }
    );
    expect(dependencies.error).toHaveBeenCalledWith(expect.any(Error), {
      email: 'unknown@example.test',
      context: 'password_reset_token_generation_failed',
    });
  });
});
