import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryService } from '../../../src/services/recovery.service.js';
import type { IUser } from '../../../src/types/user.js';
import type {
  RecoveryDeviceInfo,
  RecoveryMethod,
} from '../../../src/di/interfaces/recovery-service.interface.js';

const deviceInfo: RecoveryDeviceInfo = {
  ip: '127.0.0.1',
  userAgent: 'vitest',
  location: 'Cotonou',
};

const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: 'user-123',
    id: 'user-123',
    email: 'alice@example.com',
    username: 'alice',
    locale: 'en',
    gender: 'F',
    roles: ['user'],
    blocked_from: [],
    account_is_anonymized: false,
    register_with: 'email',
    phone_number_verified: true,
    email_verified: true,
    recovery: {
      enabled: true,
      methods: ['backup_codes', 'secondary_email', 'sms', 'security_questions'],
      backup_codes: {
        codes: ['hash-1', 'hash-2', 'hash-3'],
        generated_at: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: new Date('2027-01-01T00:00:00.000Z'),
      },
      secondary_email: {
        email: 'alice.recovery@example.net',
        verified: true,
      },
      sms: {
        phone_number: '+22997000000',
        verified: true,
        verification_code: 'stored-hash',
        verification_expires: new Date('2027-01-01T00:00:00.000Z'),
      },
      security_questions: {
        questions: [
          {
            id: 'question-1',
            question_key: 'q1',
            answer_hash: 'answer-hash',
          },
        ],
        setup_at: new Date('2026-01-01T00:00:00.000Z'),
        last_used_at: new Date('2026-02-01T00:00:00.000Z'),
      },
    },
    ...overrides,
  } as IUser;
}

function makeRecoveryConfig() {
  return {
    enabled: true,
    methods: {
      backup_codes: { enabled: true, count: 10, expiryDays: 365 },
      secondary_email: { enabled: true },
      sms: { enabled: true },
      security_questions: { enabled: true },
    },
  };
}

describe('RecoveryService', () => {
  let logger: any;
  let configManager: any;
  let userService: any;
  let activityService: any;
  let notificationService: any;
  let recoveryUtils: any;
  let service: RecoveryService;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    configManager = {
      getConfig: vi.fn(() => ({
        notifications: { channels: { sms: { enabled: true } } },
        deployment: {
          url: 'https://id.example.com',
          routes: {
            accounts: '/accounts',
            account_routes: { settings: '/settings' },
          },
        },
      })),
    };
    userService = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByPhoneNumber: vi.fn(),
      findByUsername: vi.fn(),
      updateById: vi.fn(),
    };
    activityService = {
      success: vi.fn(),
      failed: vi.fn(),
    };
    notificationService = {
      sendSecurityAlert: vi.fn(),
      sendBackupCodeWarning: vi.fn(),
    };
    recoveryUtils = {
      getRecoveryConfig: vi.fn(() => makeRecoveryConfig()),
      areBackupCodesExpired: vi.fn(() => false),
      getRemainingBackupCodesCounts: vi.fn(() => 3),
      hasSecurityQuestions: vi.fn(() => true),
      checkRecoveryLockout: vi.fn(() => ({
        locked: false,
        failedAttempts: 0,
        remainingAttempts: 5,
      })),
      checkSecurityQuestionsLockout: vi.fn(() => ({
        locked: false,
        failedAttempts: 0,
        remainingAttempts: 3,
      })),
      isInRecoveryCooldown: vi.fn(() => false),
      generateBackupCodes: vi.fn(),
      setupSecurityQuestions: vi.fn(),
      verifyUserBackupCode: vi.fn(),
      recordFailedRecoveryAttempt: vi.fn(),
      clearRecoveryLockout: vi.fn(),
      setLastRecoveredAt: vi.fn(),
      verifySecurityQuestions: vi.fn(),
      recordFailedSecurityQuestionAttempt: vi.fn(),
      clearSecurityQuestionsLockout: vi.fn(),
      verifySmsCode: vi.fn(),
    };

    service = new RecoveryService(
      logger,
      configManager,
      userService,
      activityService,
      notificationService,
      recoveryUtils
    );
  });

  describe('initiateRecovery', () => {
    it.each([
      ['alice@example.com', 'findByEmail', 'alice@example.com'],
      ['+229 97-00-00-00', 'findByPhoneNumber', '+22997000000'],
      ['alice', 'findByUsername', 'alice'],
    ])(
      'finds %s through %s and starts an available recovery method',
      async (identifier, lookup, expectedIdentifier) => {
        const user = makeUser();
        userService[lookup].mockResolvedValue(user);
        userService.findById.mockResolvedValue(user);

        await expect(
          service.initiateRecovery(identifier, 'backup_codes', deviceInfo)
        ).resolves.toEqual({
          success: true,
          attemptId: expect.stringMatching(uuidV4Pattern),
          method: 'backup_codes',
          requiresVerification: true,
        });

        expect(userService[lookup]).toHaveBeenCalledWith(expectedIdentifier);
        expect(activityService.failed).toHaveBeenCalledWith(
          'recovery_attempt_failed',
          'Failed recovery attempt via backup_codes',
          user,
          expect.objectContaining({
            metadata: expect.objectContaining({ stage: 'initiated' }),
          })
        );
      }
    );

    it('returns indistinguishable successful responses for an unknown user and an unavailable method', async () => {
      const expectedPublicResponse = {
        success: true,
        attemptId: expect.stringMatching(uuidV4Pattern),
        method: 'backup_codes',
        requiresVerification: true,
      };
      userService.findByEmail.mockResolvedValueOnce(null);
      const unknownUserResult = await service.initiateRecovery(
        'missing@example.com',
        'backup_codes',
        deviceInfo
      );
      expect(unknownUserResult).toEqual(expectedPublicResponse);

      const user = makeUser({ recovery: undefined });
      userService.findByEmail.mockResolvedValueOnce(user);
      userService.findById.mockResolvedValueOnce(user);
      recoveryUtils.hasSecurityQuestions.mockReturnValueOnce(false);

      const unavailableMethodResult = await service.initiateRecovery(
        'alice@example.com',
        'backup_codes',
        deviceInfo
      );
      expect(unavailableMethodResult).toEqual(expectedPublicResponse);
      expect(unknownUserResult.attemptId).not.toBe(
        unavailableMethodResult.attemptId
      );
      expect(unknownUserResult.attemptId).not.toBe('user-123');
      expect(unavailableMethodResult.attemptId).not.toBe('user-123');
    });

    it('does not expose the user id as the recovery attempt id', async () => {
      const user = makeUser();
      userService.findByEmail.mockResolvedValue(user);
      userService.findById.mockResolvedValue(user);

      await expect(
        service.initiateRecovery(
          'alice@example.com',
          'backup_codes',
          deviceInfo
        )
      ).resolves.toEqual(
        expect.objectContaining({
          attemptId: expect.not.stringMatching(/^user-123$/),
        })
      );
    });

    it('returns a safe error and logs dependency failures', async () => {
      const failure = new Error('database offline');
      userService.findByUsername.mockRejectedValue(failure);

      await expect(
        service.initiateRecovery('alice', 'backup_codes', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'An error occurred. Please try again.',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'recovery_initiation_failed',
        identifier: 'alice',
        method: 'backup_codes',
      });
    });

    it.each([
      ['+22997000000', 'findByPhoneNumber'],
      ['missing-user', 'findByUsername'],
    ])(
      'normalizes a missing %s lookup to the generic response',
      async (identifier, lookup) => {
        userService[lookup].mockResolvedValue(undefined);
        await expect(
          service.initiateRecovery(identifier, 'backup_codes', deviceInfo)
        ).resolves.toEqual({
          success: true,
          attemptId: expect.stringMatching(uuidV4Pattern),
          method: 'backup_codes',
          requiresVerification: true,
        });
      }
    );
  });

  it('directs callers to the specific completion methods', async () => {
    await expect(
      service.completeRecovery('attempt', 'verification', deviceInfo)
    ).resolves.toEqual({
      success: false,
      error: 'Use specific verification methods instead',
    });
  });

  describe('getAvailableMethods', () => {
    it('returns no methods when the user does not exist', async () => {
      userService.findById.mockResolvedValue(null);
      await expect(service.getAvailableMethods('missing')).resolves.toEqual([]);
    });

    it('returns configured and available method details', async () => {
      const user = makeUser({ phone_number: '+22997000000' });
      userService.findById.mockResolvedValue(user);

      await expect(service.getAvailableMethods('user-123')).resolves.toEqual([
        {
          method: 'backup_codes',
          available: true,
          configured: true,
          details: {
            remainingCodes: 3,
            expiresAt: user.recovery?.backup_codes?.expires_at,
          },
        },
        {
          method: 'secondary_email',
          available: true,
          configured: true,
          details: { verified: true },
        },
        {
          method: 'security_questions',
          available: true,
          configured: true,
          details: {
            lastUsedAt: user.recovery?.security_questions?.last_used_at,
          },
        },
        {
          method: 'sms',
          available: true,
          configured: true,
          details: { maskedPhone: '+2*******000' },
        },
      ]);
    });

    it('marks unconfigured methods unavailable and masks short phone numbers', async () => {
      const user = makeUser({
        phone_number: '12345',
        recovery: {
          enabled: false,
          methods: [],
          secondary_email: {
            email: 'unverified@example.net',
            verified: false,
          },
        },
      });
      userService.findById.mockResolvedValue(user);
      recoveryUtils.hasSecurityQuestions.mockReturnValue(false);
      configManager.getConfig.mockReturnValue({
        notifications: { channels: { sms: { enabled: false } } },
      });

      await expect(service.getAvailableMethods('user-123')).resolves.toEqual([
        {
          method: 'backup_codes',
          available: false,
          configured: false,
          details: undefined,
        },
        {
          method: 'secondary_email',
          available: false,
          configured: true,
          details: { verified: false },
        },
        {
          method: 'security_questions',
          available: false,
          configured: false,
          details: undefined,
        },
        {
          method: 'sms',
          available: false,
          configured: true,
          details: { maskedPhone: '***' },
        },
      ]);
      expect(recoveryUtils.areBackupCodesExpired).not.toHaveBeenCalled();
    });

    it('marks expired backup codes unavailable and honors disabled method configuration', async () => {
      const user = makeUser({ phone_number: undefined });
      userService.findById.mockResolvedValue(user);
      recoveryUtils.areBackupCodesExpired.mockReturnValue(true);
      recoveryUtils.getRecoveryConfig.mockReturnValue({
        ...makeRecoveryConfig(),
        methods: {
          ...makeRecoveryConfig().methods,
          secondary_email: { enabled: false },
          security_questions: { enabled: false },
        },
      });

      const methods = await service.getAvailableMethods('user-123');
      expect(methods).toEqual([
        expect.objectContaining({
          method: 'backup_codes',
          available: false,
          configured: true,
        }),
        expect.objectContaining({
          method: 'secondary_email',
          available: false,
          configured: true,
        }),
        expect.objectContaining({
          method: 'security_questions',
          available: false,
          configured: true,
        }),
        {
          method: 'sms',
          available: false,
          configured: false,
          details: undefined,
        },
      ]);
    });

    it('returns an empty list and logs lookup errors', async () => {
      const failure = new Error('lookup failed');
      userService.findById.mockRejectedValue(failure);
      await expect(service.getAvailableMethods('user-123')).resolves.toEqual(
        []
      );
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'get_available_methods_failed',
        userId: 'user-123',
      });
    });
  });

  describe('lockout and cooldown checks', () => {
    it('returns the default unlocked status for an unknown user', async () => {
      userService.findById.mockResolvedValue(null);
      await expect(service.checkLockout('missing')).resolves.toEqual({
        locked: false,
        failedAttempts: 0,
        maxAttempts: 5,
        remainingAttempts: 5,
      });
    });

    it('maps general recovery lockout status and default counters', async () => {
      const user = makeUser();
      const lockedUntil = new Date('2026-02-01T00:00:00.000Z');
      userService.findById.mockResolvedValue(user);
      recoveryUtils.checkRecoveryLockout.mockReturnValue({
        locked: true,
        lockedUntil,
        minutesRemaining: 9,
      });

      await expect(
        service.checkLockout('user-123', 'backup_codes')
      ).resolves.toEqual({
        locked: true,
        lockedUntil,
        minutesRemaining: 9,
        failedAttempts: 0,
        maxAttempts: 5,
        remainingAttempts: 5,
      });
    });

    it('maps security-question lockout status and counters', async () => {
      const user = makeUser();
      userService.findById.mockResolvedValue(user);
      recoveryUtils.checkSecurityQuestionsLockout.mockReturnValue({
        locked: false,
        failedAttempts: 2,
        remainingAttempts: 1,
      });

      await expect(
        service.checkLockout('user-123', 'security_questions')
      ).resolves.toEqual({
        locked: false,
        lockedUntil: undefined,
        minutesRemaining: undefined,
        failedAttempts: 2,
        maxAttempts: 3,
        remainingAttempts: 1,
      });
    });

    it('uses security-question counter defaults when utilities omit them', async () => {
      userService.findById.mockResolvedValue(makeUser());
      recoveryUtils.checkSecurityQuestionsLockout.mockReturnValue({
        locked: false,
      });
      await expect(
        service.checkLockout('user-123', 'security_questions')
      ).resolves.toEqual({
        locked: false,
        lockedUntil: undefined,
        minutesRemaining: undefined,
        failedAttempts: 0,
        maxAttempts: 3,
        remainingAttempts: 3,
      });
    });

    it('fails closed with a logged temporary lockout when lookup fails', async () => {
      const failure = new Error('lookup failed');
      userService.findById.mockRejectedValue(failure);
      await expect(service.checkLockout('user-123', 'sms')).resolves.toEqual({
        locked: true,
        minutesRemaining: 1,
        failedAttempts: 5,
        maxAttempts: 5,
        remainingAttempts: 0,
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'check_lockout_failed',
        userId: 'user-123',
        method: 'sms',
      });
    });

    it.each([
      [null, false],
      [makeUser(), true],
    ])('returns cooldown state for %s', async (user, expected) => {
      userService.findById.mockResolvedValue(user);
      recoveryUtils.isInRecoveryCooldown.mockReturnValue(true);
      await expect(service.isInCooldownPeriod('user-123')).resolves.toBe(
        expected
      );
    });

    it('fails closed and logs cooldown lookup errors', async () => {
      const failure = new Error('lookup failed');
      userService.findById.mockRejectedValue(failure);
      await expect(service.isInCooldownPeriod('user-123')).resolves.toBe(true);
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'cooldown_check_failed',
        userId: 'user-123',
      });
    });
  });

  describe('logAttempt', () => {
    it.each([
      [
        true,
        'success',
        'account_recovery_successful',
        'Account recovered via sms',
      ],
      [
        false,
        'failed',
        'recovery_attempt_failed',
        'Failed recovery attempt via sms',
      ],
    ])(
      'records success=%s through the %s activity channel',
      async (success, channel, type, description) => {
        const user = makeUser();
        userService.findById.mockResolvedValue(user);
        await service.logAttempt('user-123', 'sms', success, deviceInfo, {
          reason: 'test',
        });

        expect(activityService[channel]).toHaveBeenCalledWith(
          type,
          description,
          user,
          {
            ip_address: '127.0.0.1',
            user_agent: 'vitest',
            actor: user,
            target: { target_type: 'none' },
            metadata: {
              method: 'sms',
              location: 'Cotonou',
              reason: 'test',
            },
          }
        );
      }
    );

    it('does not write an activity for an unknown user', async () => {
      userService.findById.mockResolvedValue(null);
      await service.logAttempt('missing', 'sms', false, deviceInfo);
      expect(activityService.success).not.toHaveBeenCalled();
      expect(activityService.failed).not.toHaveBeenCalled();
    });

    it('contains activity failures and logs their context', async () => {
      const failure = new Error('audit unavailable');
      userService.findById.mockResolvedValue(makeUser());
      activityService.success.mockRejectedValue(failure);
      await expect(
        service.logAttempt('user-123', 'sms', true, deviceInfo)
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'log_attempt_failed',
        userId: 'user-123',
        method: 'sms',
        success: true,
      });
    });
  });

  describe('recovery method management', () => {
    it('generates, stores, and returns backup codes', async () => {
      const user = makeUser({ recovery: undefined });
      const generatedAt = new Date('2026-03-01T00:00:00.000Z');
      const expiresAt = new Date('2027-03-01T00:00:00.000Z');
      userService.findById.mockResolvedValue(user);
      recoveryUtils.generateBackupCodes.mockResolvedValue({
        codes: ['plain-1', 'plain-2'],
        hashedCodes: ['hash-1', 'hash-2'],
        generatedAt,
        expiresAt,
      });

      await expect(service.generateBackupCodes('user-123')).resolves.toEqual({
        codes: ['plain-1', 'plain-2'],
        expiresAt,
      });
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: {
          methods: [],
          enabled: true,
          backup_codes: {
            codes: ['hash-1', 'hash-2'],
            generated_at: generatedAt,
            expires_at: expiresAt,
          },
        },
      });
    });

    it.each([
      [null, new Error('User not found')],
      [makeUser(), new Error('generation failed')],
    ])(
      'logs and rethrows backup code generation failures',
      async (user, failure) => {
        userService.findById.mockResolvedValue(user);
        recoveryUtils.generateBackupCodes.mockRejectedValue(failure);
        await expect(service.generateBackupCodes('user-123')).rejects.toThrow(
          failure.message
        );
        expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
          context: 'generate_backup_codes_failed',
          userId: 'user-123',
        });
      }
    );

    it('returns not found when setting up security questions for an unknown user', async () => {
      userService.findById.mockResolvedValue(null);
      await expect(
        service.setupSecurityQuestions('missing', [])
      ).resolves.toEqual({ success: false, error: 'User not found' });
    });

    it('returns validation failures without updating the user', async () => {
      userService.findById.mockResolvedValue(makeUser());
      recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: false,
        error: 'Choose three distinct questions',
      });
      await expect(
        service.setupSecurityQuestions('user-123', [])
      ).resolves.toEqual({
        success: false,
        error: 'Choose three distinct questions',
      });
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('stores valid security questions while preserving existing recovery state', async () => {
      const user = makeUser();
      const questions = [
        { id: 'q-id', question_key: 'q1', answer_hash: 'answer-hash' },
      ];
      userService.findById.mockResolvedValue(user);
      recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: true,
        questions,
      });
      const before = Date.now();
      await expect(
        service.setupSecurityQuestions('user-123', [
          { question_key: 'q1', answer: 'answer' },
        ])
      ).resolves.toEqual({ success: true });
      const update = userService.updateById.mock.calls[0][1];
      expect(update.recovery).toEqual({
        ...user.recovery,
        enabled: true,
        security_questions: {
          questions,
          setup_at: expect.any(Date),
        },
      });
      expect(
        update.recovery.security_questions.setup_at.getTime()
      ).toBeGreaterThanOrEqual(before);
    });

    it('creates recovery defaults when security questions are the first method', async () => {
      userService.findById.mockResolvedValue(makeUser({ recovery: undefined }));
      recoveryUtils.setupSecurityQuestions.mockResolvedValue({
        valid: true,
        questions: [],
      });
      await expect(
        service.setupSecurityQuestions('user-123', [])
      ).resolves.toEqual({ success: true });
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: expect.objectContaining({ enabled: true, methods: [] }),
      });
    });

    it('returns a safe setup failure and logs dependency errors', async () => {
      const failure = new Error('hashing failed');
      userService.findById.mockResolvedValue(makeUser());
      recoveryUtils.setupSecurityQuestions.mockRejectedValue(failure);
      await expect(
        service.setupSecurityQuestions('user-123', [])
      ).resolves.toEqual({
        success: false,
        error: 'Failed to set up security questions',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'setup_security_questions_failed',
        userId: 'user-123',
      });
    });

    it.each([
      ['backup_codes', 'backup_codes'],
      ['secondary_email', 'secondary_email'],
      ['security_questions', 'security_questions'],
      ['sms', 'sms'],
    ] as const)(
      'removes %s from both its state and the configured method list',
      async (method, field) => {
        const user = makeUser();
        userService.findById.mockResolvedValue(user);
        await expect(
          service.removeRecoveryMethod('user-123', method)
        ).resolves.toEqual({ success: true });
        const update = userService.updateById.mock.calls[0][1].recovery;
        expect(update[field]).toBeUndefined();
        expect(update.methods).not.toContain(method);
        expect(update.enabled).toBe(true);
      }
    );

    it('disables recovery after removing the only configured method', async () => {
      userService.findById.mockResolvedValue(
        makeUser({
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: {
              codes: ['hash'],
              generated_at: new Date(),
              expires_at: new Date(),
            },
          },
        })
      );
      await service.removeRecoveryMethod('user-123', 'backup_codes');
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: expect.objectContaining({ enabled: false, methods: [] }),
      });
    });

    it('returns not found without updating recovery state', async () => {
      userService.findById.mockResolvedValue(null);
      await expect(
        service.removeRecoveryMethod('missing', 'backup_codes')
      ).resolves.toEqual({ success: false, error: 'User not found' });
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('creates safe defaults when removing a method from legacy empty state', async () => {
      userService.findById.mockResolvedValue(makeUser({ recovery: undefined }));
      await expect(
        service.removeRecoveryMethod('user-123', 'backup_codes')
      ).resolves.toEqual({ success: true });
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: {
          enabled: false,
          methods: [],
          backup_codes: undefined,
        },
      });
    });

    it('rejects unsupported recovery method values defensively', async () => {
      userService.findById.mockResolvedValue(makeUser());
      await expect(
        service.removeRecoveryMethod(
          'user-123',
          'unsupported' as RecoveryMethod
        )
      ).resolves.toEqual({
        success: false,
        error: 'Invalid recovery method',
      });
    });

    it('returns a safe removal failure and logs dependency errors', async () => {
      const failure = new Error('update failed');
      userService.findById.mockResolvedValue(makeUser());
      userService.updateById.mockRejectedValue(failure);
      await expect(
        service.removeRecoveryMethod('user-123', 'backup_codes')
      ).resolves.toEqual({
        success: false,
        error: 'Failed to remove recovery method',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'remove_recovery_method_failed',
        userId: 'user-123',
        method: 'backup_codes',
      });
    });
  });

  describe('verifyAndConsumeBackupCode', () => {
    it('rejects verification while the user is locked out', async () => {
      const user = makeUser();
      userService.findById.mockResolvedValue(user);
      recoveryUtils.checkRecoveryLockout.mockReturnValue({
        locked: true,
        minutesRemaining: 12,
      });

      await expect(
        service.verifyAndConsumeBackupCode(user, 'code', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'Too many failed attempts. Try again in 12 minutes.',
      });
      expect(recoveryUtils.verifyUserBackupCode).not.toHaveBeenCalled();
    });

    it.each([
      ['Expired backup code', 'Expired backup code'],
      [undefined, 'Invalid backup code'],
    ])(
      'persists and audits a failed backup-code attempt (%s)',
      async (utilityError, expectedError) => {
        const user = makeUser();
        userService.findById.mockResolvedValue(user);
        recoveryUtils.verifyUserBackupCode.mockResolvedValue({
          valid: false,
          error: utilityError,
        });

        await expect(
          service.verifyAndConsumeBackupCode(user, 'bad-code', deviceInfo)
        ).resolves.toEqual({ success: false, error: expectedError });
        expect(recoveryUtils.recordFailedRecoveryAttempt).toHaveBeenCalledWith(
          user
        );
        expect(userService.updateById).toHaveBeenCalledWith('user-123', {
          recovery: user.recovery,
        });
        expect(activityService.failed).toHaveBeenCalledWith(
          'recovery_attempt_failed',
          'Failed recovery attempt via backup_codes',
          user,
          expect.objectContaining({
            metadata: expect.objectContaining({
              method: 'backup_codes',
              error: utilityError,
            }),
          })
        );
      }
    );

    it('consumes a valid backup code and warns when only two remain', async () => {
      const user = makeUser();
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({
        valid: true,
        matchedCode: 'hash-2',
      });

      await expect(
        service.verifyAndConsumeBackupCode(user, 'plain-code', deviceInfo)
      ).resolves.toEqual({
        success: true,
        userId: 'user-123',
        method: 'backup_codes',
        remainingCodes: 2,
      });
      expect(recoveryUtils.clearRecoveryLockout).toHaveBeenCalledWith(user);
      expect(recoveryUtils.setLastRecoveredAt).toHaveBeenCalledWith(user);
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: expect.objectContaining({
          methods: user.recovery?.methods,
          backup_codes: expect.objectContaining({
            codes: ['hash-1', 'hash-3'],
          }),
        }),
      });
      expect(activityService.success).toHaveBeenCalled();
      expect(notificationService.sendSecurityAlert).toHaveBeenCalled();
      expect(notificationService.sendBackupCodeWarning).toHaveBeenCalledWith(
        expect.any(Object),
        2,
        'https://id.example.com/accounts/settings#recovery'
      );
    });

    it('does not warn when more than two backup codes remain', async () => {
      const user = makeUser({
        recovery: {
          enabled: true,
          methods: ['backup_codes'],
          backup_codes: {
            codes: ['hash-1', 'hash-2', 'hash-3', 'hash-4'],
            generated_at: new Date(),
            expires_at: new Date(),
          },
        },
      });
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({
        valid: true,
        matchedCode: 'hash-1',
      });

      await expect(
        service.verifyAndConsumeBackupCode(user, 'plain-code', deviceInfo)
      ).resolves.toEqual(expect.objectContaining({ remainingCodes: 3 }));
      expect(notificationService.sendBackupCodeWarning).not.toHaveBeenCalled();
    });

    it('creates a methods default when consuming a code from legacy recovery state', async () => {
      const user = makeUser({
        recovery: {
          enabled: true,
          methods: undefined as unknown as RecoveryMethod[],
          backup_codes: {
            codes: ['hash-1'],
            generated_at: new Date(),
            expires_at: new Date(),
          },
        },
      });
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({
        valid: true,
        matchedCode: 'hash-1',
      });
      await service.verifyAndConsumeBackupCode(user, 'plain-code', deviceInfo);
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: expect.objectContaining({ methods: [] }),
      });
    });

    it('fails safely when valid verification has no consumable matched code', async () => {
      const user = makeUser({ recovery: undefined });
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifyUserBackupCode.mockResolvedValue({ valid: true });

      await expect(
        service.verifyAndConsumeBackupCode(user, 'plain-code', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'Failed to process backup code',
      });
      expect(userService.updateById).not.toHaveBeenCalled();
    });

    it('contains unexpected backup-code verification errors', async () => {
      const user = makeUser();
      const failure = new Error('verification unavailable');
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifyUserBackupCode.mockRejectedValue(failure);

      await expect(
        service.verifyAndConsumeBackupCode(user, 'code', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'An error occurred during verification',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'backup_code_verification_failed',
        userId: 'user-123',
      });
    });
  });

  describe('verifySecurityQuestions', () => {
    it('rejects verification while security questions are locked', async () => {
      const user = makeUser();
      recoveryUtils.checkSecurityQuestionsLockout.mockReturnValue({
        locked: true,
        minutesRemaining: 8,
      });

      await expect(
        service.verifySecurityQuestions(user, new Map(), deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'Too many failed attempts. Try again in 8 minutes.',
      });
      expect(recoveryUtils.verifySecurityQuestions).not.toHaveBeenCalled();
    });

    it.each([
      ['Answers did not match', 'Answers did not match'],
      [undefined, 'Security question verification failed'],
    ])(
      'persists and audits failed security answers (%s)',
      async (utilityError, expectedError) => {
        const user = makeUser();
        userService.findById.mockResolvedValue(user);
        recoveryUtils.verifySecurityQuestions.mockResolvedValue({
          valid: false,
          error: utilityError,
        });

        await expect(
          service.verifySecurityQuestions(user, new Map(), deviceInfo)
        ).resolves.toEqual({ success: false, error: expectedError });
        expect(
          recoveryUtils.recordFailedSecurityQuestionAttempt
        ).toHaveBeenCalledWith(user);
        expect(userService.updateById).toHaveBeenCalledWith('user-123', {
          recovery: user.recovery,
        });
        expect(activityService.failed).toHaveBeenCalled();
      }
    );

    it('clears lockout, records use, audits, and notifies after valid answers', async () => {
      const user = makeUser();
      const before = Date.now();
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifySecurityQuestions.mockResolvedValue({ valid: true });

      await expect(
        service.verifySecurityQuestions(
          user,
          new Map([['question-1', 'answer']]),
          deviceInfo
        )
      ).resolves.toEqual({
        success: true,
        userId: 'user-123',
        method: 'security_questions',
      });
      expect(recoveryUtils.clearSecurityQuestionsLockout).toHaveBeenCalledWith(
        user
      );
      expect(recoveryUtils.setLastRecoveredAt).toHaveBeenCalledWith(user);
      expect(
        user.recovery?.security_questions?.last_used_at?.getTime()
      ).toBeGreaterThanOrEqual(before);
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: user.recovery,
      });
      expect(activityService.success).toHaveBeenCalled();
      expect(notificationService.sendSecurityAlert).toHaveBeenCalled();
    });

    it('supports a valid utility result when question state was removed concurrently', async () => {
      const user = makeUser({
        recovery: { enabled: true, methods: ['security_questions'] },
      });
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifySecurityQuestions.mockResolvedValue({ valid: true });

      await expect(
        service.verifySecurityQuestions(user, new Map(), deviceInfo)
      ).resolves.toEqual(expect.objectContaining({ success: true }));
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: user.recovery,
      });
    });

    it('contains unexpected security-question verification errors', async () => {
      const user = makeUser();
      const failure = new Error('verification unavailable');
      recoveryUtils.verifySecurityQuestions.mockRejectedValue(failure);

      await expect(
        service.verifySecurityQuestions(user, new Map(), deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'An error occurred during verification',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'security_questions_verification_failed',
        userId: 'user-123',
      });
    });
  });

  describe('verifyAndConsumeSmsRecoveryCode', () => {
    it('rejects verification while recovery is locked', async () => {
      const user = makeUser();
      userService.findById.mockResolvedValue(user);
      recoveryUtils.checkRecoveryLockout.mockReturnValue({
        locked: true,
        minutesRemaining: 6,
      });

      await expect(
        service.verifyAndConsumeSmsRecoveryCode(user, '123456', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'Too many failed attempts. Try again in 6 minutes.',
      });
      expect(recoveryUtils.verifySmsCode).not.toHaveBeenCalled();
    });

    it.each([
      [
        { verification_expires: new Date() },
        'missing stored verification code',
      ],
      [{ verification_code: 'stored-hash' }, 'missing expiration'],
    ])('rejects a pending SMS state with %s', async (smsState, _label) => {
      const user = makeUser({
        recovery: {
          enabled: true,
          methods: ['sms'],
          sms: {
            phone_number: '+22997000000',
            verified: true,
            ...smsState,
          },
        },
      });
      userService.findById.mockResolvedValue(user);

      await expect(
        service.verifyAndConsumeSmsRecoveryCode(user, '123456', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'No SMS verification code pending. Please request a new code.',
      });
      expect(recoveryUtils.verifySmsCode).not.toHaveBeenCalled();
    });

    it.each([
      ['Code expired', 'Code expired'],
      [undefined, 'Invalid or expired code'],
    ])(
      'persists and audits failed SMS verification (%s)',
      async (utilityError, expectedError) => {
        const user = makeUser();
        userService.findById.mockResolvedValue(user);
        recoveryUtils.verifySmsCode.mockReturnValue({
          valid: false,
          error: utilityError,
        });

        await expect(
          service.verifyAndConsumeSmsRecoveryCode(user, '123456', deviceInfo)
        ).resolves.toEqual({ success: false, error: expectedError });
        expect(recoveryUtils.recordFailedRecoveryAttempt).toHaveBeenCalledWith(
          user
        );
        expect(userService.updateById).toHaveBeenCalledWith('user-123', {
          recovery: user.recovery,
        });
        expect(activityService.failed).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          user,
          expect.objectContaining({
            metadata: expect.objectContaining({ error: expectedError }),
          })
        );
      }
    );

    it('clears a valid pending SMS code, audits, and notifies', async () => {
      const user = makeUser();
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifySmsCode.mockReturnValue({ valid: true });

      await expect(
        service.verifyAndConsumeSmsRecoveryCode(user, '123456', deviceInfo)
      ).resolves.toEqual({
        success: true,
        userId: 'user-123',
        method: 'sms',
      });
      expect(recoveryUtils.verifySmsCode).toHaveBeenCalledWith(
        '123456',
        'stored-hash',
        new Date('2027-01-01T00:00:00.000Z')
      );
      expect(user.recovery?.sms?.verification_code).toBeUndefined();
      expect(user.recovery?.sms?.verification_expires).toBeUndefined();
      expect(recoveryUtils.clearRecoveryLockout).toHaveBeenCalledWith(user);
      expect(recoveryUtils.setLastRecoveredAt).toHaveBeenCalledWith(user);
      expect(userService.updateById).toHaveBeenCalledWith('user-123', {
        recovery: user.recovery,
      });
      expect(activityService.success).toHaveBeenCalled();
      expect(notificationService.sendSecurityAlert).toHaveBeenCalled();
    });

    it('contains unexpected SMS verification errors', async () => {
      const user = makeUser();
      const failure = new Error('verification unavailable');
      userService.findById.mockResolvedValue(user);
      recoveryUtils.verifySmsCode.mockImplementation(() => {
        throw failure;
      });

      await expect(
        service.verifyAndConsumeSmsRecoveryCode(user, '123456', deviceInfo)
      ).resolves.toEqual({
        success: false,
        error: 'An error occurred during verification',
      });
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'sms_code_verification_failed',
        userId: 'user-123',
      });
    });
  });

  it('does not persist recovery state without both a user id and recovery data', async () => {
    await (service as any).saveUserRecoveryState(makeUser({ _id: undefined }));
    await (service as any).saveUserRecoveryState(
      makeUser({ recovery: undefined })
    );
    expect(userService.updateById).not.toHaveBeenCalled();
  });

  describe('notifications', () => {
    it('sends a recovery security alert with the device context', async () => {
      const user = makeUser();
      await service.sendRecoveryNotification(user, 'sms', deviceInfo);
      expect(notificationService.sendSecurityAlert).toHaveBeenCalledWith(
        {
          email: 'alice@example.com',
          username: 'alice',
          locale: 'en',
        },
        'account_recovered',
        {
          method: 'sms',
          timestamp: expect.any(String),
          ip: '127.0.0.1',
          userAgent: 'vitest',
          location: 'Cotonou',
        }
      );
    });

    it('contains and logs recovery notification failures', async () => {
      const user = makeUser();
      const failure = new Error('notification failed');
      notificationService.sendSecurityAlert.mockRejectedValue(failure);
      await expect(
        service.sendRecoveryNotification(user, 'sms', deviceInfo)
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'send_recovery_notification_failed',
        userId: 'user-123',
        method: 'sms',
      });
    });

    it('sends backup-code warnings to the configured settings URL', async () => {
      const user = makeUser();
      await service.sendBackupCodeWarning(user, 2);
      expect(notificationService.sendBackupCodeWarning).toHaveBeenCalledWith(
        {
          email: 'alice@example.com',
          username: 'alice',
          locale: 'en',
        },
        2,
        'https://id.example.com/accounts/settings#recovery'
      );
    });

    it('contains and logs backup-code warning failures', async () => {
      const user = makeUser();
      const failure = new Error('notification failed');
      notificationService.sendBackupCodeWarning.mockRejectedValue(failure);
      await expect(
        service.sendBackupCodeWarning(user, 1)
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'send_backup_code_warning_failed',
        userId: 'user-123',
        remainingCodes: 1,
      });
    });
  });
});
