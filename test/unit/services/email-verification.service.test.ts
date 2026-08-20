import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUser } from '../../../src/types/user.js';
import { EmailVerificationService } from '../../../src/services/email-verification.service.js';

const user = (overrides: Partial<IUser> = {}) =>
  ({
    _id: 'user-1',
    username: 'alice',
    email: 'alice@example.test',
    email_verified: false,
    given_name: 'Alice',
    locale: 'fr',
    ...overrides,
  }) as IUser;

describe('EmailVerificationService', () => {
  const dependencies = {
    isValidEmailAddress: vi.fn().mockReturnValue(true),
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    generateVerificationToken: vi.fn().mockResolvedValue('token-1'),
    verifyEmail: vi.fn(),
    buildVerificationUrl: vi
      .fn()
      .mockReturnValue(
        'https://id.example.test/auth/verify-email?token=token-1'
      ),
    sendVerification: vi.fn().mockResolvedValue(undefined),
    info: vi.fn(),
    error: vi.fn(),
  };
  let service: EmailVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.isValidEmailAddress.mockReturnValue(true);
    dependencies.findUserByEmail.mockResolvedValue(undefined);
    dependencies.findUserById.mockResolvedValue(user());
    dependencies.generateVerificationToken.mockResolvedValue('token-1');
    dependencies.verifyEmail.mockResolvedValue(user());
    dependencies.sendVerification.mockResolvedValue(undefined);
    service = new EmailVerificationService(dependencies);
  });

  it.each([undefined, '', 'not-an-email', ['alice@example.test']])(
    'rejects invalid public request input %#',
    async email => {
      if (email === 'not-an-email') {
        dependencies.isValidEmailAddress.mockReturnValue(false);
      }

      await expect(service.request(email)).resolves.toEqual({
        status: 'invalid',
      });
      expect(dependencies.findUserByEmail).not.toHaveBeenCalled();
    }
  );

  it('sends a public verification request for an unverified account', async () => {
    dependencies.findUserByEmail.mockResolvedValue(
      user({ given_name: undefined })
    );

    await expect(service.request('alice@example.test')).resolves.toEqual({
      status: 'accepted',
    });
    expect(dependencies.generateVerificationToken).toHaveBeenCalledWith(
      'user-1'
    );
    expect(dependencies.sendVerification).toHaveBeenCalledWith(
      {
        email: 'alice@example.test',
        username: 'alice',
        locale: 'fr',
      },
      'https://id.example.test/auth/verify-email?token=token-1'
    );
  });

  it.each([
    [user({ email_verified: true }), 'already verified user'],
    [undefined, 'non-existent user'],
  ] as const)(
    'returns the same public result for %s',
    async (foundUser, logDescription) => {
      dependencies.findUserByEmail.mockResolvedValue(foundUser);

      await expect(service.request('alice@example.test')).resolves.toEqual({
        status: 'accepted',
      });
      expect(dependencies.sendVerification).not.toHaveBeenCalled();
      expect(dependencies.info).toHaveBeenCalledWith(
        expect.stringContaining(logDescription),
        { email: 'alice@example.test' }
      );
    }
  );

  it('contains public lookup and delivery failures to prevent enumeration', async () => {
    const failure = new Error('user store unavailable');
    dependencies.findUserByEmail.mockRejectedValue(failure);

    await expect(service.request('alice@example.test')).resolves.toEqual({
      status: 'accepted',
    });
    expect(dependencies.error).toHaveBeenCalledWith(
      'Error sending verification email',
      { email: 'alice@example.test', error: failure }
    );
  });

  it('distinguishes missing and already verified authenticated users', async () => {
    dependencies.findUserById.mockResolvedValueOnce(undefined);
    await expect(service.resend('missing')).resolves.toEqual({
      status: 'user_not_found',
    });

    dependencies.findUserById.mockResolvedValueOnce(user({ email: undefined }));
    await expect(service.resend('user-1')).resolves.toEqual({
      status: 'email_missing',
    });
    expect(dependencies.generateVerificationToken).not.toHaveBeenCalled();

    dependencies.findUserById.mockResolvedValueOnce(
      user({ email_verified: true })
    );
    await expect(service.resend('user-1')).resolves.toEqual({
      status: 'already_verified',
    });
  });

  it('resends verification for an authenticated account', async () => {
    await expect(service.resend('user-1')).resolves.toEqual({ status: 'sent' });
    expect(dependencies.sendVerification).toHaveBeenCalledOnce();
    expect(dependencies.info).toHaveBeenCalledWith(
      'Verification email resent',
      { userId: 'user-1', email: 'alice@example.test' }
    );
  });

  it.each([undefined, '', ['token']])(
    'rejects malformed verification tokens %#',
    async token => {
      await expect(service.verify(token)).resolves.toEqual({
        status: 'invalid_token',
      });
      expect(dependencies.verifyEmail).not.toHaveBeenCalled();
    }
  );

  it('verifies a well-formed token and returns the account', async () => {
    const verifiedUser = user({ email_verified: true });
    dependencies.verifyEmail.mockResolvedValue(verifiedUser);

    await expect(service.verify('token-1')).resolves.toEqual({
      status: 'verified',
      user: verifiedUser,
    });
  });

  it('does not hide authenticated resend or verification failures', async () => {
    const deliveryFailure = new Error('email unavailable');
    dependencies.sendVerification.mockRejectedValue(deliveryFailure);
    await expect(service.resend('user-1')).rejects.toBe(deliveryFailure);

    const verificationFailure = new Error('invalid token');
    dependencies.verifyEmail.mockRejectedValue(verificationFailure);
    await expect(service.verify('token-1')).rejects.toBe(verificationFailure);
  });
});
