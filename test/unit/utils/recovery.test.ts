import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryUtils } from '../../../src/utils/recovery.js';
import type { IUser } from '../../../src/types/user.js';

describe('RecoveryUtils', () => {
  const configManager = { getConfig: vi.fn() };
  const passwordUtils = {
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
  };
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
  };
  let recovery: RecoveryUtils;

  beforeEach(() => {
    vi.resetAllMocks();
    recovery = new RecoveryUtils(
      configManager as never,
      passwordUtils as never,
      logger as never
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('treats invalid expiration dates as expired across recovery methods', async () => {
    const invalidDate = new Date(Number.NaN);
    const emailToken = 'email-token';
    const smsCode = '123456';
    const emailTokenHash = crypto
      .createHash('sha256')
      .update(emailToken)
      .digest('hex');
    const smsCodeHash = crypto
      .createHash('sha256')
      .update(smsCode)
      .digest('hex');
    passwordUtils.verifyPassword.mockResolvedValue({
      valid: true,
      needsUpgrade: false,
    });

    await expect(
      recovery.verifyBackupCode('ABCD-1234', ['stored-hash'], invalidDate)
    ).resolves.toMatchObject({
      valid: false,
      error: 'Invalid expiration date',
    });
    expect(
      recovery.verifySecondaryEmailToken(
        emailToken,
        emailTokenHash,
        invalidDate
      )
    ).toMatchObject({ valid: false, error: 'Invalid expiration date' });
    expect(
      recovery.verifySmsCode(smsCode, smsCodeHash, invalidDate)
    ).toMatchObject({ valid: false, error: 'Invalid expiration date' });
    expect(
      recovery.areBackupCodesExpired({
        recovery: {
          enabled: true,
          methods: ['backup_codes'],
          backup_codes: {
            codes: ['stored-hash'],
            generated_at: new Date(),
            expires_at: invalidDate,
          },
        },
      } as never)
    ).toBe(true);
    expect(passwordUtils.verifyPassword).not.toHaveBeenCalled();
  });

  it('preserves Unicode letters and numbers when normalizing security answers', () => {
    expect(recovery.normalizeSecurityAnswer('  Élise  O’Connor!  ')).toBe(
      'élise oconnor'
    );
    expect(recovery.normalizeSecurityAnswer('東京市 42。')).toBe('東京市 42');
    expect(recovery.validateSecurityAnswer('Élodie')).toEqual({
      valid: true,
      normalized: 'élodie',
    });
  });

  it('reads recovery configuration from one consistent snapshot', () => {
    configManager.getConfig.mockReturnValue({
      security: {
        authentication: {
          recovery: {
            enabled: true,
            backup_codes: { enabled: true, count: 8, expiry_days: 180 },
            secondary_email: { enabled: false },
            sms: { enabled: true },
            security_questions: { enabled: false },
          },
        },
      },
    });

    expect(recovery.getRecoveryConfig()).toEqual({
      enabled: true,
      methods: {
        backup_codes: { enabled: true, count: 8, expiryDays: 180 },
        secondary_email: { enabled: false },
        sms: { enabled: true },
        security_questions: { enabled: false },
      },
    });
    expect(configManager.getConfig).toHaveBeenCalledTimes(1);
  });

  it('does not truncate malformed email addresses while masking', () => {
    expect(recovery.maskEmail('user@example.com')).toBe('u***@example.com');
    expect(recovery.maskEmail('user@example.com@evil.test')).toBe(
      'user@example.com@evil.test'
    );
  });

  it('does not compare truncated domains from malformed email addresses', () => {
    expect(
      recovery.checkSecondaryEmailDomain(
        'user@example.com@evil.test',
        'backup@example.com@other.test'
      )
    ).toEqual({ sameDomain: false });
  });

  describe('backup codes', () => {
    it('generates ten unique, hashed, one-year recovery codes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      passwordUtils.hashPassword.mockImplementation(async code =>
        Promise.resolve(`hash:${code}`)
      );

      const result = await recovery.generateBackupCodes();

      expect(result.codes).toHaveLength(10);
      expect(new Set(result.codes)).toHaveLength(10);
      expect(result.codes).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^[0-9A-F]{4}-[0-9A-F]{4}$/),
        ])
      );
      expect(result.hashedCodes).toEqual(
        result.codes.map(code => `hash:${code}`)
      );
      expect(result.generatedAt).toEqual(new Date('2026-08-01T10:00:00.000Z'));
      expect(result.expiresAt).toEqual(new Date('2027-08-01T10:00:00.000Z'));
    });

    it('logs and wraps backup-code generation failures', async () => {
      const failure = new Error('hash unavailable');
      passwordUtils.hashPassword.mockRejectedValue(failure);

      await expect(recovery.generateBackupCodes()).rejects.toThrow(
        'Failed to generate backup codes'
      );
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'backup_codes_generation_failed',
      });
    });

    it.each([
      [null, 'ABCD-1234', 'No backup codes configured for this account'],
      [
        { recovery: { enabled: true, methods: [] } },
        'ABCD-1234',
        'No backup codes configured for this account',
      ],
      [
        {
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: {
              codes: ['hash'],
              generated_at: new Date(0),
              expires_at: new Date(0),
            },
          },
        },
        'ABCD-1234',
        'Backup codes have expired',
      ],
    ])(
      'rejects unavailable user backup codes',
      async (user, code, expectedError) => {
        await expect(
          recovery.verifyUserBackupCode(user as never, code)
        ).resolves.toMatchObject({ valid: false, error: expectedError });
      }
    );

    it('delegates user backup-code verification and handles unexpected errors', async () => {
      const future = new Date(Date.now() + 60_000);
      const user = {
        _id: 'user-1',
        recovery: {
          enabled: true,
          methods: ['backup_codes'],
          backup_codes: {
            codes: ['hash'],
            generated_at: new Date(),
            expires_at: future,
          },
        },
      } as never;
      const delegated = vi
        .spyOn(recovery, 'verifyBackupCode')
        .mockResolvedValue({
          valid: true,
          method: 'backup_codes',
          matchedCode: 'hash',
        });

      await expect(
        recovery.verifyUserBackupCode(user, 'ABCD-1234')
      ).resolves.toMatchObject({ valid: true, matchedCode: 'hash' });
      expect(delegated).toHaveBeenCalledWith('ABCD-1234', ['hash'], future);

      delegated.mockRejectedValueOnce(new Error('verification unavailable'));
      await expect(
        recovery.verifyUserBackupCode(user, 'ABCD-1234')
      ).resolves.toMatchObject({
        valid: false,
        error: 'Backup code verification failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: 'user_backup_code_verification_error',
          userId: 'user-1',
          hasBackupCodes: true,
        })
      );
    });

    it.each([
      ['', ['hash'], new Date(Date.now() + 60_000), 'Backup code is required'],
      [
        'ABCD-1234',
        [],
        new Date(Date.now() + 60_000),
        'No backup codes available',
      ],
      ['ABCD-1234', ['hash'], new Date(0), 'Backup codes have expired'],
      [
        'bad',
        ['hash'],
        new Date(Date.now() + 60_000),
        'Backup code must be exactly 8 characters',
      ],
    ])(
      'validates backup-code verification inputs',
      async (code, hashes, expiresAt, expectedError) => {
        await expect(
          recovery.verifyBackupCode(code, hashes, expiresAt)
        ).resolves.toMatchObject({ valid: false, error: expectedError });
      }
    );

    it('checks every valid stored hash and returns the matched hash', async () => {
      passwordUtils.verifyPassword
        .mockResolvedValueOnce({ valid: true, needsUpgrade: false })
        .mockResolvedValueOnce({ valid: false, needsUpgrade: false });

      await expect(
        recovery.verifyBackupCode(
          'abcd 1234',
          ['', 'first-hash', 'second-hash'],
          new Date(Date.now() + 60_000)
        )
      ).resolves.toEqual({
        valid: true,
        method: 'backup_codes',
        error: undefined,
        matchedCode: 'first-hash',
      });
      expect(passwordUtils.verifyPassword).toHaveBeenNthCalledWith(
        1,
        'ABCD-1234',
        'first-hash'
      );
      expect(passwordUtils.verifyPassword).toHaveBeenNthCalledWith(
        2,
        'ABCD-1234',
        'second-hash'
      );
    });

    it('returns invalid or a safe failure when no hash matches', async () => {
      passwordUtils.verifyPassword.mockResolvedValue({
        valid: false,
        needsUpgrade: false,
      });
      await expect(
        recovery.verifyBackupCode(
          'ABCD-1234',
          ['hash'],
          new Date(Date.now() + 60_000)
        )
      ).resolves.toMatchObject({
        valid: false,
        error: 'Invalid backup code',
      });

      passwordUtils.verifyPassword.mockRejectedValueOnce(
        new Error('argon unavailable')
      );
      await expect(
        recovery.verifyBackupCode(
          'ABCD-1234',
          ['hash'],
          new Date(Date.now() + 60_000)
        )
      ).resolves.toMatchObject({
        valid: false,
        error: 'Backup code verification failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'backup_code_verification_error' })
      );
    });
  });

  describe('secondary email verification', () => {
    it('normalizes the email and generates a hashed 24-hour token', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));

      const result = recovery.generateSecondaryEmailVerification(
        '  PERSON@Example.COM '
      );

      expect(result.email).toBe('person@example.com');
      expect(result.verificationToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.tokenHash).toBe(
        crypto
          .createHash('sha256')
          .update(result.verificationToken)
          .digest('hex')
      );
      expect(result.expiresAt).toEqual(new Date('2026-08-02T10:00:00.000Z'));
    });

    it.each([[''], ['invalid'], [null]])(
      'logs and wraps invalid secondary emails',
      email => {
        expect(() =>
          recovery.generateSecondaryEmailVerification(email as never)
        ).toThrow('Failed to generate secondary email verification');
        expect(logger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            context: 'secondary_email_verification_generation_failed',
          })
        );
      }
    );

    it.each([
      [
        '',
        'hash',
        new Date(Date.now() + 60_000),
        'Verification token is required',
      ],
      ['token', '', new Date(Date.now() + 60_000), 'Invalid stored token'],
      ['token', 'hash', new Date(0), 'Verification token has expired'],
    ])(
      'validates secondary email tokens',
      (token, stored, expiresAt, expectedError) => {
        expect(
          recovery.verifySecondaryEmailToken(token, stored, expiresAt)
        ).toMatchObject({ valid: false, error: expectedError });
      }
    );

    it('verifies token hashes in constant time and handles comparison errors', () => {
      const token = ' token-value ';
      const hash = crypto
        .createHash('sha256')
        .update(token.trim())
        .digest('hex');
      const future = new Date(Date.now() + 60_000);

      expect(
        recovery.verifySecondaryEmailToken(token, hash, future)
      ).toMatchObject({ valid: true, error: undefined });
      expect(
        recovery.verifySecondaryEmailToken(token, 'short', future)
      ).toMatchObject({ valid: false, error: 'Invalid verification token' });
      expect(
        recovery.verifySecondaryEmailToken(token, '0'.repeat(64), future)
      ).toMatchObject({ valid: false, error: 'Invalid verification token' });

      vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
        throw new Error('comparison failed');
      });
      expect(
        recovery.verifySecondaryEmailToken(token, hash, future)
      ).toMatchObject({
        valid: false,
        error: 'Secondary email verification failed',
      });
    });
  });

  describe('SMS verification', () => {
    it('generates a hashed six-digit code expiring after 15 minutes', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      vi.spyOn(crypto, 'randomInt').mockImplementation(
        ((_min: number, _max?: number) => 123456) as typeof crypto.randomInt
      );

      const result = recovery.generateSmsVerificationCode();

      expect(result).toEqual({
        code: '123456',
        hash: crypto.createHash('sha256').update('123456').digest('hex'),
        expiresAt: new Date('2026-08-01T10:15:00.000Z'),
      });
    });

    it('logs and wraps SMS generation failures', () => {
      const failure = new Error('rng failed');
      vi.spyOn(crypto, 'randomInt').mockImplementation(() => {
        throw failure;
      });

      expect(() => recovery.generateSmsVerificationCode()).toThrow(
        'Failed to generate SMS verification code'
      );
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'sms_verification_code_generation_failed',
      });
    });

    it.each([
      [
        '',
        'hash',
        new Date(Date.now() + 60_000),
        'Verification code is required',
      ],
      ['123456', '', new Date(Date.now() + 60_000), 'Invalid stored code'],
      ['123456', 'hash', new Date(0), 'Verification code has expired'],
      [
        '12345',
        'hash',
        new Date(Date.now() + 60_000),
        'Code must be exactly 6 digits',
      ],
    ])('validates SMS codes', (code, stored, expiresAt, expectedError) => {
      expect(recovery.verifySmsCode(code, stored, expiresAt)).toMatchObject({
        valid: false,
        error: expectedError,
      });
    });

    it('verifies sanitized SMS codes in constant time and handles errors', () => {
      const hash = crypto.createHash('sha256').update('123456').digest('hex');
      const future = new Date(Date.now() + 60_000);

      expect(recovery.verifySmsCode('123 456', hash, future)).toMatchObject({
        valid: true,
        error: undefined,
      });
      expect(recovery.verifySmsCode('123456', 'short', future)).toMatchObject({
        valid: false,
        error: 'Invalid verification code',
      });
      expect(
        recovery.verifySmsCode('123456', '0'.repeat(64), future)
      ).toMatchObject({ valid: false, error: 'Invalid verification code' });

      vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
        throw new Error('comparison failed');
      });
      expect(recovery.verifySmsCode('123456', hash, future)).toMatchObject({
        valid: false,
        error: 'SMS verification failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'sms_verification_error' })
      );
    });
  });

  describe('configuration and state helpers', () => {
    it('reports enabled user recovery methods from usable configured data', () => {
      const future = new Date(Date.now() + 60_000);
      const user = {
        recovery: {
          enabled: true,
          methods: ['backup_codes', 'secondary_email', 'security_questions'],
          backup_codes: {
            codes: ['hash'],
            generated_at: new Date(),
            expires_at: future,
          },
          secondary_email: { email: 'backup@example.com', verified: true },
          security_questions: {
            questions: [
              { id: 'q-id', question_key: 'q1', answer_hash: 'hash' },
            ],
          },
        },
      } as never;

      expect(recovery.isRecoveryEnabled(user)).toBe(true);
      expect(recovery.hasBackupCodes(user)).toBe(true);
      expect(recovery.hasSecondaryEmail(user)).toBe(true);
      expect(recovery.hasSecurityQuestions(user)).toBe(true);
      expect(recovery.getAvailableRecoveryMethods(user)).toEqual([
        'backup_codes',
        'secondary_email',
        'security_questions',
      ]);
      expect(recovery.getRemainingBackupCodesCounts(user)).toBe(1);
    });

    it('returns unavailable states for disabled, missing, empty, or expired recovery data', () => {
      const disabled = { recovery: { enabled: false, methods: [] } } as never;
      const empty = {
        recovery: {
          enabled: true,
          methods: [],
          backup_codes: {
            codes: [],
            generated_at: new Date(),
            expires_at: new Date(Date.now() + 60_000),
          },
          secondary_email: { email: '', verified: false },
          security_questions: { questions: [] },
        },
      } as never;
      const expired = {
        recovery: {
          enabled: true,
          methods: ['backup_codes'],
          backup_codes: {
            codes: ['hash'],
            generated_at: new Date(0),
            expires_at: new Date(0),
          },
        },
      } as never;

      expect(recovery.getAvailableRecoveryMethods(disabled)).toEqual([]);
      expect(
        recovery.getAvailableRecoveryMethods({
          recovery: { enabled: true, methods: [] },
        } as never)
      ).toEqual([]);
      expect(recovery.hasBackupCodes(empty)).toBe(false);
      expect(recovery.hasBackupCodes(expired)).toBe(false);
      expect(recovery.hasSecondaryEmail(empty)).toBe(false);
      expect(recovery.hasSecurityQuestions(empty)).toBe(false);
      expect(recovery.getRemainingBackupCodesCounts(disabled)).toBe(0);
      expect(recovery.areBackupCodesExpired(disabled)).toBe(true);
    });

    it('creates recovery configuration variants without sharing defaults', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));

      expect(recovery.createRecoveryConfig()).toEqual({
        enabled: true,
        methods: ['backup_codes', 'secondary_email'],
      });
      expect(
        recovery.createRecoveryConfig(false, ['sms'], {
          sms: { phone_number: '+2290000', verified: true },
        })
      ).toEqual({
        enabled: false,
        methods: ['sms'],
        sms: { phone_number: '+2290000', verified: true },
      });
      expect(recovery.createBackupCodesRecoveryConfig(['hash'])).toEqual({
        enabled: true,
        methods: ['backup_codes'],
        backup_codes: {
          codes: ['hash'],
          generated_at: new Date('2026-08-01T10:00:00.000Z'),
          expires_at: new Date('2027-08-01T10:00:00.000Z'),
        },
      });
      expect(
        recovery.createSecondaryEmailRecoveryConfig(
          ' PERSON@Example.COM ',
          true
        )
      ).toEqual({
        enabled: true,
        methods: ['secondary_email'],
        secondary_email: { email: 'person@example.com', verified: true },
      });
      expect(recovery.createDisabledRecoveryConfig()).toEqual({
        enabled: false,
        methods: [],
      });
    });

    it.each([[null], [{}], [[]]])(
      'rejects invalid backup-code configuration %j',
      codes => {
        expect(() =>
          recovery.createBackupCodesRecoveryConfig(codes as never)
        ).toThrow('Valid backup codes array is required');
      }
    );

    it.each([[''], ['invalid'], [null]])(
      'rejects invalid secondary-email configuration %j',
      email => {
        expect(() =>
          recovery.createSecondaryEmailRecoveryConfig(email as never)
        ).toThrow('Valid email address');
      }
    );

    it('masks valid contact details and preserves values that cannot be masked', () => {
      expect(recovery.maskEmail('')).toBe('');
      expect(recovery.maskEmail(null as never)).toBe('');
      expect(recovery.maskEmail('no-domain')).toBe('no-domain');
      expect(recovery.maskEmail('a@example.com')).toBe('a@example.com');
      expect(recovery.maskEmail('@example.com')).toBe('@example.com');
      expect(recovery.maskEmail('user@')).toBe('user@');
      expect(recovery.maskPhoneNumber('')).toBe('');
      expect(recovery.maskPhoneNumber(null as never)).toBe('');
      expect(recovery.maskPhoneNumber('123')).toBe('123');
      expect(recovery.maskPhoneNumber('call-me')).toBe('call-me');
      expect(recovery.maskPhoneNumber('+229 97 12 34 56')).toBe('*******3456');
      expect(recovery.maskPhoneNumber('1234')).toBe('*1234');
    });

    it('maps configured method support and lists enabled methods', () => {
      configManager.getConfig.mockReturnValue({
        security: {
          authentication: {
            recovery: {
              enabled: true,
              backup_codes: { enabled: true, count: 10, expiry_days: 365 },
              secondary_email: { enabled: false },
              sms: { enabled: true },
              security_questions: { enabled: true },
            },
          },
        },
      });

      expect(recovery.isMethodSupported('backup_codes')).toBe(true);
      expect(recovery.isMethodSupported('secondary_email')).toBe(false);
      expect(recovery.isMethodSupported('sms')).toBe(true);
      expect(recovery.isMethodSupported('security_questions')).toBe(true);
      expect(recovery.isMethodSupported('unsupported' as never)).toBe(false);
      expect(recovery.getAvailableMethods()).toEqual([
        'backup_codes',
        'sms',
        'security_questions',
      ]);

      configManager.getConfig.mockReturnValue({
        security: {
          authentication: {
            recovery: {
              enabled: true,
              backup_codes: { enabled: false, count: 10, expiry_days: 365 },
              secondary_email: { enabled: true },
              sms: { enabled: false },
              security_questions: { enabled: false },
            },
          },
        },
      });
      expect(recovery.getAvailableMethods()).toEqual(['secondary_email']);
    });

    it.each([
      ['', { valid: false, error: 'Backup code is required' }],
      [null, { valid: false, error: 'Backup code is required' }],
      [
        'ABC',
        {
          valid: false,
          error: 'Backup code must be exactly 8 characters',
        },
      ],
      ['ab cd-12 34', { valid: true, sanitized: 'ABCD1234' }],
    ])('validates backup-code format %j', (code, expected) => {
      expect(recovery.validateBackupCodeFormat(code as never)).toEqual(
        expected
      );
    });
  });

  describe('recovery lockout and cooldown', () => {
    it('reports absent, active, and inactive recovery lockouts', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));

      expect(recovery.checkRecoveryLockout({} as never)).toEqual({
        locked: false,
        failedAttempts: 0,
        remainingAttempts: 5,
      });
      const lockedUntil = new Date('2026-08-01T10:05:01.000Z');
      expect(
        recovery.checkRecoveryLockout({
          recovery: {
            lockout: { failed_attempts: 4, locked_until: lockedUntil },
          },
        } as never)
      ).toEqual({
        locked: true,
        failedAttempts: 4,
        lockedUntil,
        minutesRemaining: 6,
        remainingAttempts: 0,
      });
      expect(
        recovery.checkRecoveryLockout({
          recovery: {
            lockout: {
              locked_until: new Date('2026-08-01T10:01:00.000Z'),
            },
          },
        } as never)
      ).toMatchObject({ locked: true, failedAttempts: 0 });
      expect(
        recovery.checkRecoveryLockout({ recovery: { lockout: {} } } as never)
      ).toEqual({
        locked: false,
        failedAttempts: 0,
        remainingAttempts: 5,
      });
      expect(
        recovery.checkRecoveryLockout({
          recovery: { lockout: { failed_attempts: 9 } },
        } as never)
      ).toEqual({
        locked: false,
        failedAttempts: 9,
        remainingAttempts: 0,
      });
    });

    it('initializes, increments, resets, and triggers recovery lockouts', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      const newUser = { _id: 'u1', username: 'person' } as never;
      expect(recovery.recordFailedRecoveryAttempt(newUser)).toEqual({
        locked: false,
        failedAttempts: 1,
      });

      const noLockout = {
        recovery: { enabled: true, methods: [] },
      } as never;
      expect(recovery.recordFailedRecoveryAttempt(noLockout)).toEqual({
        locked: false,
        failedAttempts: 1,
      });

      const expired = {
        recovery: {
          enabled: true,
          methods: [],
          lockout: {
            failed_attempts: 4,
            locked_until: new Date('2026-08-01T09:00:00.000Z'),
          },
        },
      } as never;
      expect(recovery.recordFailedRecoveryAttempt(expired)).toEqual({
        locked: false,
        failedAttempts: 1,
      });

      const threshold = {
        _id: 'u2',
        username: 'locked-person',
        recovery: {
          enabled: true,
          methods: [],
          lockout: { failed_attempts: 4 },
        },
      } as never;
      expect(recovery.recordFailedRecoveryAttempt(threshold)).toEqual({
        locked: true,
        failedAttempts: 5,
        lockedUntil: new Date('2026-08-01T10:30:00.000Z'),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'Recovery lockout triggered',
        expect.objectContaining({ userId: 'u2', failedAttempts: 5 })
      );
    });

    it('clears lockouts and publishes lockout configuration', () => {
      const user = {
        recovery: {
          lockout: {
            failed_attempts: 3,
            last_failed_at: new Date(),
            locked_until: new Date(),
          },
        },
      };
      recovery.clearRecoveryLockout(user as unknown as IUser);
      expect(user.recovery.lockout).toEqual({
        failed_attempts: 0,
        last_failed_at: undefined,
        locked_until: undefined,
      });
      expect(() => recovery.clearRecoveryLockout({} as never)).not.toThrow();
      expect(recovery.getLockoutConfig()).toEqual({
        maxAttempts: 5,
        lockoutMinutes: 30,
      });
    });

    it('tracks the 24-hour recovery cooldown', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      expect(recovery.checkRecoveryCooldown({} as never)).toEqual({
        inCooldown: false,
      });
      const active = {
        recovery: {
          last_recovered_at: new Date('2026-08-01T09:00:00.000Z'),
        },
      };
      expect(
        recovery.checkRecoveryCooldown(active as unknown as IUser)
      ).toEqual({
        inCooldown: true,
        cooldownEndsAt: new Date('2026-08-02T09:00:00.000Z'),
        hoursRemaining: 23,
      });
      expect(recovery.isInRecoveryCooldown(active as unknown as IUser)).toBe(
        true
      );
      expect(
        recovery.checkRecoveryCooldown({
          recovery: {
            last_recovered_at: new Date('2026-07-30T09:00:00.000Z'),
          },
        } as never)
      ).toEqual({ inCooldown: false });

      const user: { recovery?: IUser['recovery'] } = {};
      recovery.setLastRecoveredAt(user as IUser);
      expect(user.recovery!.last_recovered_at).toEqual(
        new Date('2026-08-01T10:00:00.000Z')
      );
      const existing: { recovery: NonNullable<IUser['recovery']> } = {
        recovery: { enabled: true, methods: [] },
      };
      recovery.setLastRecoveredAt(existing as unknown as IUser);
      expect(existing.recovery.last_recovered_at).toEqual(
        new Date('2026-08-01T10:00:00.000Z')
      );
      expect(recovery.getCooldownConfig()).toEqual({ cooldownHours: 24 });
    });

    it('compares only valid secondary-email domains case-insensitively', () => {
      expect(recovery.checkSecondaryEmailDomain('', 'b@example.com')).toEqual({
        sameDomain: false,
      });
      expect(
        recovery.checkSecondaryEmailDomain('invalid', 'b@example.com')
      ).toEqual({ sameDomain: false });
      expect(
        recovery.checkSecondaryEmailDomain('@example.com', 'b@example.com')
      ).toEqual({ sameDomain: false });
      expect(
        recovery.checkSecondaryEmailDomain(
          'person@Example.COM',
          'backup@example.com'
        )
      ).toMatchObject({ sameDomain: true, warning: expect.any(String) });
      expect(
        recovery.checkSecondaryEmailDomain(
          'person@example.com',
          'backup@other.test'
        )
      ).toEqual({ sameDomain: false });
    });
  });

  describe('security questions', () => {
    it.each([
      ['', { valid: false, error: 'Answer is required' }],
      [null, { valid: false, error: 'Answer is required' }],
      ['a!', { valid: false, error: 'Answer must be at least 3 characters' }],
      [
        'x'.repeat(201),
        {
          valid: false,
          error: 'Answer must be less than 200 characters',
        },
      ],
      ['yes', { valid: false, error: 'Please provide a more specific answer' }],
      ['Specific Answer', { valid: true, normalized: 'specific answer' }],
    ])('validates security answer %j', (answer, expected) => {
      expect(recovery.validateSecurityAnswer(answer as never)).toEqual(
        expected
      );
    });

    it('normalizes, hashes, and verifies security answers', async () => {
      expect(recovery.normalizeSecurityAnswer('')).toBe('');
      expect(recovery.normalizeSecurityAnswer(null as never)).toBe('');
      passwordUtils.hashPassword.mockResolvedValue('answer-hash');
      passwordUtils.verifyPassword.mockResolvedValue({
        valid: true,
        needsUpgrade: false,
      });

      await expect(recovery.hashSecurityAnswer(' My Answer! ')).resolves.toBe(
        'answer-hash'
      );
      expect(passwordUtils.hashPassword).toHaveBeenCalledWith('my answer');
      await expect(
        recovery.verifySecurityAnswer(' MY answer!!! ', 'answer-hash')
      ).resolves.toBe(true);
      expect(passwordUtils.verifyPassword).toHaveBeenCalledWith(
        'my answer',
        'answer-hash'
      );
      await expect(recovery.hashSecurityAnswer('!!!')).rejects.toThrow(
        'Cannot hash empty answer'
      );
      await expect(recovery.verifySecurityAnswer('', 'hash')).resolves.toBe(
        false
      );
      await expect(recovery.verifySecurityAnswer('answer', '')).resolves.toBe(
        false
      );
      await expect(recovery.verifySecurityAnswer('!!!', 'hash')).resolves.toBe(
        false
      );
    });

    it('rejects invalid security-question setup requests', async () => {
      await expect(recovery.setupSecurityQuestions([])).resolves.toEqual({
        valid: false,
        error: 'At least one security question is required',
      });
      await expect(
        recovery.setupSecurityQuestions([
          { question_key: 'unknown', answer: 'specific answer' },
        ])
      ).resolves.toEqual({
        valid: false,
        error: 'Invalid question key: unknown',
      });
      await expect(
        recovery.setupSecurityQuestions([
          { question_key: 'q1', answer: 'first answer' },
          { question_key: 'q1', answer: 'second answer' },
        ])
      ).resolves.toEqual({
        valid: false,
        error: 'Duplicate questions are not allowed',
      });
      await expect(
        recovery.setupSecurityQuestions([{ question_key: 'q1', answer: 'no' }])
      ).resolves.toEqual({
        valid: false,
        error:
          'Invalid answer for question q1: Answer must be at least 3 characters',
      });
    });

    it('creates security questions with independent identifiers and hashes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      passwordUtils.hashPassword
        .mockResolvedValueOnce('hash-one')
        .mockResolvedValueOnce('hash-two');
      vi.spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');

      await expect(
        recovery.setupSecurityQuestions([
          { question_key: 'q1', answer: 'First Answer' },
          { question_key: 'q2', answer: 'Second Answer' },
        ])
      ).resolves.toEqual({
        valid: true,
        questions: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            question_key: 'q1',
            answer_hash: 'hash-one',
          },
          {
            id: '00000000-0000-4000-8000-000000000002',
            question_key: 'q2',
            answer_hash: 'hash-two',
          },
        ],
        setup_at: new Date('2026-08-01T10:00:00.000Z'),
      });
    });

    it('validates completeness before verifying stored security questions', async () => {
      await expect(
        recovery.verifySecurityQuestions({} as never, new Map())
      ).resolves.toEqual({
        valid: false,
        error: 'Security questions not configured',
      });
      const user = {
        recovery: {
          security_questions: {
            questions: [
              { id: 'q-id', question_key: 'q1', answer_hash: 'hash' },
            ],
          },
        },
      } as never;
      await expect(
        recovery.verifySecurityQuestions(user, new Map())
      ).resolves.toEqual({
        valid: false,
        error: 'All security questions must be answered',
      });
      await expect(
        recovery.verifySecurityQuestions(
          user,
          new Map([['wrong-id', 'answer']])
        )
      ).resolves.toEqual({
        valid: false,
        error: 'Missing answer for question q-id',
      });
    });

    it('reports incorrect answers and accepts a complete correct set', async () => {
      const user = {
        recovery: {
          security_questions: {
            questions: [
              { id: 'one', question_key: 'q1', answer_hash: 'hash-one' },
              { id: 'two', question_key: 'q2', answer_hash: 'hash-two' },
            ],
          },
        },
      } as never;
      const answers = new Map([
        ['one', 'answer one'],
        ['two', 'answer two'],
      ]);
      const verify = vi.spyOn(recovery, 'verifySecurityAnswer');
      verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(
        recovery.verifySecurityQuestions(user, answers)
      ).resolves.toEqual({
        valid: false,
        allCorrect: false,
        incorrectCount: 1,
        error: '1 answer(s) are incorrect',
      });

      verify.mockReset().mockResolvedValue(true);
      await expect(
        recovery.verifySecurityQuestions(user, answers)
      ).resolves.toEqual({
        valid: true,
        allCorrect: true,
        incorrectCount: 0,
      });
    });

    it('reports absent, active, and inactive security-question lockouts', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      expect(recovery.checkSecurityQuestionsLockout({} as never)).toEqual({
        locked: false,
        failedAttempts: 0,
        remainingAttempts: 3,
      });
      const lockedUntil = new Date('2026-08-01T10:02:01.000Z');
      expect(
        recovery.checkSecurityQuestionsLockout({
          recovery: {
            security_questions: {
              questions: [],
              failed_attempts: 2,
              locked_until: lockedUntil,
            },
          },
        } as never)
      ).toEqual({
        locked: true,
        failedAttempts: 2,
        lockedUntil,
        minutesRemaining: 3,
        remainingAttempts: 0,
      });
      expect(
        recovery.checkSecurityQuestionsLockout({
          recovery: {
            security_questions: {
              questions: [],
              locked_until: new Date('2026-08-01T10:01:00.000Z'),
            },
          },
        } as never)
      ).toMatchObject({ locked: true, failedAttempts: 0 });
      expect(
        recovery.checkSecurityQuestionsLockout({
          recovery: { security_questions: { questions: [] } },
        } as never)
      ).toEqual({
        locked: false,
        failedAttempts: 0,
        remainingAttempts: 3,
      });
      expect(
        recovery.checkSecurityQuestionsLockout({
          recovery: {
            security_questions: { questions: [], failed_attempts: 9 },
          },
        } as never)
      ).toEqual({
        locked: false,
        failedAttempts: 9,
        remainingAttempts: 0,
      });
    });

    it('initializes, resets, and triggers security-question lockouts', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      expect(recovery.recordFailedSecurityQuestionAttempt({} as never)).toEqual(
        { locked: false, remainingAttempts: 2 }
      );
      expect(
        recovery.recordFailedSecurityQuestionAttempt({
          recovery: { enabled: true, methods: [] },
        } as never)
      ).toEqual({ locked: false, remainingAttempts: 2 });
      expect(
        recovery.recordFailedSecurityQuestionAttempt({
          recovery: {
            security_questions: {
              questions: [],
              failed_attempts: 2,
              locked_until: new Date('2026-08-01T09:00:00.000Z'),
            },
          },
        } as never)
      ).toEqual({ locked: false, remainingAttempts: 2 });

      const threshold = {
        _id: 'user-1',
        username: 'person',
        recovery: {
          security_questions: { questions: [], failed_attempts: 2 },
        },
      } as never;
      expect(recovery.recordFailedSecurityQuestionAttempt(threshold)).toEqual({
        locked: true,
        remainingAttempts: 0,
        lockedUntil: new Date('2026-08-01T10:15:00.000Z'),
        minutesRemaining: 15,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'Security questions lockout triggered',
        expect.objectContaining({ userId: 'user-1', failedAttempts: 3 })
      );
    });

    it('clears security-question lockouts and returns defensive configuration copies', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
      const user = {
        recovery: {
          security_questions: {
            questions: [],
            failed_attempts: 2,
            last_failed_at: new Date(),
            locked_until: new Date(),
          },
        },
      };
      recovery.clearSecurityQuestionsLockout(user as unknown as IUser);
      expect(user.recovery.security_questions).toMatchObject({
        failed_attempts: 0,
        last_failed_at: undefined,
        locked_until: undefined,
        last_used_at: new Date('2026-08-01T10:00:00.000Z'),
      });
      expect(() =>
        recovery.clearSecurityQuestionsLockout({} as never)
      ).not.toThrow();

      const keys = recovery.getAvailableQuestionKeys();
      expect(keys).toEqual([
        'q1',
        'q2',
        'q3',
        'q4',
        'q5',
        'q6',
        'q7',
        'q8',
        'q9',
        'q10',
      ]);
      keys.pop();
      expect(recovery.getAvailableQuestionKeys()).toHaveLength(10);
      expect(recovery.getSecurityQuestionsConfig()).toEqual({
        minAnswerLength: 3,
        maxAttempts: 3,
        lockoutMinutes: 15,
        availableQuestionKeys: recovery.getAvailableQuestionKeys(),
      });
    });
  });
});
