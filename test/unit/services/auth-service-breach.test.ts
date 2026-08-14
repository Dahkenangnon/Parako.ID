import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock password-breach utility
vi.mock('../../../src/utils/password-breach.js', () => ({
  checkPasswordBreach: vi.fn(),
  computeSha1PrefixSuffix: vi.fn(),
}));

vi.mock('../../../src/jobs/domains/background-tasks/queue.js', () => ({
  createBackgroundTaskQueue: vi.fn(),
}));

import { AuthService } from '../../../src/services/auth.service.js';
import { PhoneVerificationRequiredError } from '../../../src/errors/phone-verification-required.error.js';
import {
  checkPasswordBreach,
  computeSha1PrefixSuffix,
} from '../../../src/utils/password-breach.js';
import { createBackgroundTaskQueue } from '../../../src/jobs/domains/background-tasks/queue.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { IPasswordUtils } from '../../../src/di/interfaces/password-utils.interface.js';
import type { IMfaUtils } from '../../../src/di/interfaces/mfa-utils.interface.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { IUser } from '../../../src/types/user.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

const mockedCheckPasswordBreach = vi.mocked(checkPasswordBreach);
const mockedComputeSha1PrefixSuffix = vi.mocked(computeSha1PrefixSuffix);
const mockedCreateBackgroundTaskQueue = vi.mocked(createBackgroundTaskQueue);

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: 'user-123',
    account_enabled: true,
    account_is_anonymized: false,
    blocked_from: [],
    email_verified: false,
    gender: 'M',
    phone_number_verified: false,
    register_with: 'email',
    roles: ['user'],
    username: 'testuser',
    ...overrides,
  };
}

function createBreachConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    api_timeout_ms: 3000,
    check_on_registration: true,
    check_on_login: true,
    check_on_password_reset: true,
    check_on_password_change: true,
    min_breach_count: 1,
    ...overrides,
  };
}

function createMocks(
  breachConfig = createBreachConfig(),
  roleConfig = {
    available: ['user', 'admin', 'superadmin'],
    default: 'user',
  }
) {
  const logger: Partial<ILogger> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const userService: Partial<IUserService> = {
    validatePassword: vi.fn().mockReturnValue({ isValid: true, messages: [] }),
    isEmailTaken: vi.fn().mockResolvedValue(false),
    isPhoneNumberTaken: vi.fn().mockResolvedValue(false),
    createUserWithGeneratedUsername: vi.fn().mockResolvedValue(
      makeUser({
        _id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password: 'hashed',
      })
    ),
    findByEmail: vi.fn().mockResolvedValue(
      makeUser({
        _id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password: 'hashed',
        account_enabled: true,
      })
    ),
    findByUsername: vi.fn().mockResolvedValue(
      makeUser({
        _id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password: 'hashed',
        account_enabled: true,
      })
    ),
    findByPhoneNumber: vi.fn().mockResolvedValue(
      makeUser({
        _id: 'user-123',
        phone_number: '+2290100000000',
        username: 'testuser',
        password: 'hashed',
        account_enabled: true,
      })
    ),
    findByCustomIdentifier: vi.fn().mockResolvedValue(
      makeUser({
        _id: 'user-123',
        custom_identifier_1: 'employee-1',
        username: 'testuser',
        password: 'hashed',
        account_enabled: true,
      })
    ),
    findByRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(undefined),
    getCustomIdentifierFieldBySlot: vi.fn().mockReturnValue(undefined),
    findOne: vi.fn(),
    verifyPasswordWithRehash: vi.fn().mockResolvedValue({ valid: true }),
    verifyTotp: vi.fn().mockResolvedValue(true),
    setEmailOtp: vi.fn().mockResolvedValue(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
      })
    ),
    verifyEmailOtp: vi.fn().mockResolvedValue(true),
    updateById: vi
      .fn()
      .mockImplementation((_id, data) => Promise.resolve({ _id, ...data })),
    updateUserLastLoginDate: vi.fn().mockResolvedValue(undefined),
  };

  const passwordUtils: Partial<IPasswordUtils> = {
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  };

  const mfaUtils: Partial<IMfaUtils> = {
    validateTotpCodeFormat: vi.fn().mockReturnValue({
      valid: true,
      sanitized: '123456',
    }),
    generateEmailOtp: vi.fn().mockReturnValue({
      code: '123456',
      hash: 'otp-hash',
      expiresAt: new Date(Date.now() + 600_000),
    }),
    verifyEmailOtp: vi.fn().mockReturnValue({ valid: true }),
  };

  const config = {
    security: {
      authentication: {
        password_breach_detection: breachConfig,
        roles: roleConfig,
        signup: {
          require_email_verification: false,
          require_phone_verification: false,
        },
      },
    },
    oidc_storage: {
      oidc_adapter: {
        redis: {
          host: 'localhost',
          port: 6379,
        },
      },
    },
  };
  const configManager: Partial<IConfigManager> = {
    getConfig: vi.fn().mockReturnValue(config),
  };

  return {
    logger: logger as ILogger,
    userService: userService as IUserService,
    passwordUtils: passwordUtils as IPasswordUtils,
    mfaUtils: mfaUtils as IMfaUtils,
    configManager: configManager as IConfigManager,
    config,
  };
}

function createAuthService(mocks: ReturnType<typeof createMocks>) {
  return new AuthService(
    mocks.logger,
    mocks.userService,
    mocks.passwordUtils,
    mocks.mfaUtils,
    mocks.configManager
  );
}

describe('AuthService - breach detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateBackgroundTaskQueue.mockResolvedValue({
      add: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
    mockedComputeSha1PrefixSuffix.mockReturnValue({
      prefix: '5BAA6',
      suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8',
    });
  });

  describe('registerUser', () => {
    it('uses the configured default role for public self-registration', async () => {
      const mocks = createMocks(createBreachConfig(), {
        available: ['member', 'administrator'],
        default: 'member',
      });
      const service = createAuthService(mocks);

      await service.registerUser({
        email: 'new@example.com',
        password: 'safe-password',
      });

      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['member'],
          account_enabled: true,
        })
      );
    });

    it('does not accept management-only privilege fields during public self-registration', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      await service.registerUser({
        email: 'new@example.com',
        password: 'safe-password',
        username: 'chosen-admin-name',
        role: 'superadmin',
        account_enabled: false,
      } as never);

      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['user'],
          account_enabled: true,
        })
      );
      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({ username: 'chosen-admin-name' })
      );
    });

    it('throws when password is breached and enabled', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      mockedCheckPasswordBreach.mockResolvedValueOnce({
        breached: true,
        count: 500,
      });

      await expect(
        service.registerUser({
          email: 'new@example.com',
          password: 'breached-password',
          given_name: 'Test',
          family_name: 'User',
        })
      ).rejects.toThrow(/breached|compromised|data breach/i);
    });

    it('succeeds when breach detection is disabled', async () => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      const service = createAuthService(mocks);

      // checkPasswordBreach should not be called
      const result = await service.registerUser({
        email: 'new@example.com',
        password: 'safe-password',
        given_name: 'Test',
        family_name: 'User',
      });

      expect(mockedCheckPasswordBreach).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('succeeds when check_on_registration is disabled', async () => {
      const mocks = createMocks(
        createBreachConfig({ check_on_registration: false })
      );
      const service = createAuthService(mocks);

      const result = await service.registerUser({
        email: 'new@example.com',
        password: 'safe-password',
        given_name: 'Test',
        family_name: 'User',
      });

      expect(mockedCheckPasswordBreach).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('succeeds when API fails (graceful degradation)', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      // API returns not breached on failure (graceful)
      mockedCheckPasswordBreach.mockResolvedValueOnce({
        breached: false,
        count: 0,
      });

      const result = await service.registerUser({
        email: 'new@example.com',
        password: 'safe-password',
        given_name: 'Test',
        family_name: 'User',
      });

      expect(result).toBeDefined();
    });

    it('allows registration when the breach API throws', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);
      mockedCheckPasswordBreach.mockRejectedValueOnce(
        new Error('HIBP unavailable')
      );

      await expect(
        service.registerUser({
          email: 'new@example.com',
          password: 'safe-password',
        })
      ).resolves.toBeDefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Password breach check failed (allowing password)',
        expect.objectContaining({ error: 'HIBP unavailable' })
      );
    });

    it('allows a breach count below the configured rejection threshold', async () => {
      const mocks = createMocks(
        createBreachConfig({ min_breach_count: undefined })
      );
      const service = createAuthService(mocks);
      mockedCheckPasswordBreach.mockResolvedValueOnce({
        breached: true,
        count: 0,
      });

      await expect(
        service.registerUser({
          email: 'new@example.com',
          password: 'safe-password',
        })
      ).resolves.toBeDefined();
    });
  });

  describe('registerManagedUser', () => {
    it('honors normalized management-only fields through the trusted path', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      await service.registerManagedUser({
        email: 'managed@example.com',
        password: 'safe-password',
        username: 'managed-user',
        given_name: 'Managed',
        family_name: 'User',
        name: 'Managed Account',
        nickname: 'Manager',
        role: 'admin',
        account_enabled: false,
      });

      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'managed@example.com',
          password: 'hashed-password',
          username: 'managed-user',
          given_name: 'Managed',
          family_name: 'User',
          name: 'Managed Account',
          nickname: 'Manager',
          roles: ['admin'],
          account_enabled: false,
        })
      );
    });

    it('uses configured management defaults when optional fields are omitted', async () => {
      const mocks = createMocks(createBreachConfig(), {
        available: ['member', 'administrator'],
        default: 'member',
      });
      const service = createAuthService(mocks);

      await service.registerManagedUser({
        email: 'managed@example.com',
        password: 'safe-password',
      });

      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['member'],
          account_enabled: true,
        })
      );
    });

    it('rejects an unavailable role before hashing or persistence', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      await expect(
        service.registerManagedUser({
          email: 'managed@example.com',
          password: 'safe-password',
          role: 'unconfigured-role',
        })
      ).rejects.toThrow("Role 'unconfigured-role' is not available");
      expect(mocks.passwordUtils.hashPassword).not.toHaveBeenCalled();
      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).not.toHaveBeenCalled();
    });
    it.each(['platform_admin', 'platform_viewer'] as const)(
      'allows the built-in %s role only in the platform tenant',
      async role => {
        const mocks = createMocks();
        const service = createAuthService(mocks);

        await tenantContext.run('_platforms', () =>
          service.registerManagedUser({
            email: `${role}@example.com`,
            password: 'safe-password',
            role,
          })
        );

        expect(
          mocks.userService.createUserWithGeneratedUsername
        ).toHaveBeenCalledWith(expect.objectContaining({ roles: [role] }));
      }
    );

    it('does not make platform roles available to ordinary tenants', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      await expect(
        tenantContext.run('tenant-a', () =>
          service.registerManagedUser({
            email: 'platform-viewer@example.com',
            password: 'safe-password',
            role: 'platform_viewer',
          })
        )
      ).rejects.toThrow("Role 'platform_viewer' is not available");
    });
  });

  describe('resetPassword', () => {
    it('throws when new password is breached', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);
      const hashedToken = 'a'.repeat(64);

      (
        mocks.userService.findOne as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        _id: 'user-123',
        username: 'testuser',
        reset_password_token: hashedToken,
        reset_password_expires: new Date(Date.now() + 3600000),
      });

      mockedCheckPasswordBreach.mockResolvedValueOnce({
        breached: true,
        count: 100,
      });

      await expect(
        service.resetPassword('valid-token', 'breached-password')
      ).rejects.toThrow(/breached|compromised|data breach/i);
    });
  });

  describe('changePassword', () => {
    it('throws when new password is breached', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      mockedCheckPasswordBreach.mockResolvedValueOnce({
        breached: true,
        count: 100,
      });

      await expect(
        service.changePassword('testuser', 'current-pass', 'breached-password')
      ).rejects.toThrow(/breached|compromised|data breach/i);
    });
  });

  describe('performLogin (non-blocking breach check)', () => {
    it('dispatches queue job when enabled', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      mockedComputeSha1PrefixSuffix.mockReturnValueOnce({
        prefix: '5BAA6',
        suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8',
      });

      // Login should succeed regardless
      const result = await service.loginWithEmail(
        'test@example.com',
        'password'
      );

      expect(result).toBeDefined();
      // computeSha1PrefixSuffix should have been called for the background check
      expect(mockedComputeSha1PrefixSuffix).toHaveBeenCalledWith('password');
    });

    it('never fails login even when queue dispatch throws', async () => {
      const mocks = createMocks();
      const service = createAuthService(mocks);

      // Make computeSha1PrefixSuffix throw
      mockedComputeSha1PrefixSuffix.mockImplementationOnce(() => {
        throw new Error('SHA1 computation failed');
      });

      // Login should still succeed
      const result = await service.loginWithEmail(
        'test@example.com',
        'password'
      );

      expect(result).toBeDefined();
    });

    it('skips breach check when check_on_login is disabled', async () => {
      const mocks = createMocks(createBreachConfig({ check_on_login: false }));
      const service = createAuthService(mocks);

      await service.loginWithEmail('test@example.com', 'password');

      expect(mockedComputeSha1PrefixSuffix).not.toHaveBeenCalled();
    });

    it('handles an unavailable Redis queue without affecting login', async () => {
      const mocks = createMocks();
      mockedCreateBackgroundTaskQueue.mockResolvedValueOnce(null);
      const service = createAuthService(mocks);

      await expect(
        service.loginWithEmail('test@example.com', 'password')
      ).resolves.toBeDefined();
      await vi.waitFor(() => {
        expect(mocks.logger.debug).toHaveBeenCalledWith(
          'Skipping breach check enqueue: Redis not available'
        );
      });
    });

    it('adds the hashed password job and closes the queue', async () => {
      const add = vi.fn().mockResolvedValue({});
      const close = vi.fn().mockResolvedValue(undefined);
      const mocks = createMocks();
      vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(
        makeUser({
          _id: 'user-123',
          username: '',
          password: 'hashed',
          account_enabled: true,
        })
      );
      mockedCreateBackgroundTaskQueue.mockResolvedValueOnce({
        add,
        close,
      } as never);
      const service = createAuthService(mocks);

      await service.loginWithEmail('test@example.com', 'password');

      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(add).toHaveBeenCalledWith(
        'password-breach-check',
        expect.objectContaining({
          sha1Prefix: '5BAA6',
          email: '',
          username: '',
          userId: 'user-123',
        })
      );
    });

    it.each([
      [
        'queue creation',
        () =>
          mockedCreateBackgroundTaskQueue.mockRejectedValueOnce(
            new Error('queue failed')
          ),
      ],
      [
        'job creation',
        () =>
          mockedCreateBackgroundTaskQueue.mockResolvedValueOnce({
            add: vi.fn().mockRejectedValue(new Error('add failed')),
            close: vi.fn(),
          } as never),
      ],
    ])(
      'logs asynchronous %s failure without affecting login',
      async (_label, fail) => {
        const mocks = createMocks();
        fail();
        const service = createAuthService(mocks);

        await expect(
          service.loginWithEmail('test@example.com', 'password')
        ).resolves.toBeDefined();
        await vi.waitFor(() => {
          expect(mocks.logger.warn).toHaveBeenCalledWith(
            'Failed to enqueue login breach check',
            expect.objectContaining({ error: expect.stringMatching(/failed/) })
          );
        });
      }
    );
  });
});

describe('AuthService - one-time token consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persistently clears a password-reset token after successful use', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);
    const user = makeUser({
      _id: 'user-123',
      username: 'testuser',
      password: 'old-hash',
      account_enabled: true,
      reset_password_expires: new Date(Date.now() + 60_000),
    });

    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(user);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce({
      ...user,
      password: 'hashed-password',
    });

    await service.resetPassword('valid-token', 'new-safe-password');

    expect(mocks.userService.updateById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        reset_password_token: null,
        reset_password_expires: null,
      })
    );
  });

  it('persistently clears an email-verification token after successful use', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);
    const user = makeUser({
      _id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      email_verified: false,
      account_enabled: true,
      email_verification_expires: new Date(Date.now() + 60_000),
    });

    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(user);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce({
      ...user,
      email_verified: true,
    });

    await service.verifyEmail('verification-token');

    expect(mocks.userService.updateById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        email_verification_token: null,
        email_verification_expires: null,
      })
    );
  });

  it.each([
    ['password reset', 'reset_password_expires', 'resetPassword'],
    ['email verification', 'email_verification_expires', 'verifyEmail'],
  ])('rejects an expired %s token', async (_label, expiryField, method) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
        account_enabled: true,
        [expiryField]: new Date(Date.now() - 60_000),
      })
    );

    const action =
      method === 'resetPassword'
        ? service.resetPassword('expired-token', 'new-safe-password')
        : service.verifyEmail('expired-token');

    await expect(action).rejects.toThrow('Invalid or expired token');
    expect(mocks.userService.updateById).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'new-password', 'Token and new password are required'],
    ['token', '', 'Token and new password are required'],
  ])('validates password reset inputs', async (token, password, message) => {
    const service = createAuthService(
      createMocks(createBreachConfig({ enabled: false }))
    );

    await expect(service.resetPassword(token, password)).rejects.toThrow(
      message
    );
  });

  it('validates the replacement password before consuming a reset token', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.validatePassword).mockReturnValueOnce({
      isValid: false,
      messages: ['too weak'],
    });
    const service = createAuthService(mocks);

    await expect(service.resetPassword('token', 'weak')).rejects.toThrow(
      'Password validation failed: too weak'
    );
    expect(mocks.userService.findOne).not.toHaveBeenCalled();
  });
});

describe('AuthService - login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['person@example.com', true],
    [' Person@Example.COM ', true],
    ['missing-at.example.com', false],
    ['person@example', false],
    ['', false],
    [undefined, false],
  ])('validates email address %j as %s', (email, expected) => {
    const service = createAuthService(
      createMocks(createBreachConfig({ enabled: false }))
    );

    expect(service.isValidEmailAddress(email as string)).toBe(expected);
  });

  it('routes each identifier type to the matching user lookup', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await service.loginWithEmail('person@example.com', 'password');
    await service.loginWithUsername('person', 'password');
    await service.loginWithPhoneNumber('+2290100000000', 'password');
    await service.loginWithCustomIdentifier(1, ' Employee-1 ', 'password');

    expect(mocks.userService.findByEmail).toHaveBeenCalledWith(
      'person@example.com'
    );
    expect(mocks.userService.findByUsername).toHaveBeenCalledWith('person');
    expect(mocks.userService.findByPhoneNumber).toHaveBeenCalledWith(
      '+2290100000000'
    );
    expect(mocks.userService.findByCustomIdentifier).toHaveBeenCalledWith(
      1,
      'Employee-1'
    );
  });

  it('uses safe verification defaults when signup policy is omitted', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.configManager.getConfig).mockReturnValue({
      security: { authentication: {} },
    } as never);
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('person@example.com', 'password')
    ).resolves.toMatchObject({ _id: 'user-123' });
  });

  it('normalizes case-insensitive custom identifiers before lookup', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.getCustomIdentifierFieldBySlot).mockReturnValue(
      {
        slot: 1,
        enabled: true,
        label: 'Employee ID',
        case_sensitive: false,
      } as never
    );
    const service = createAuthService(mocks);

    await service.loginWithCustomIdentifier(1, ' Employee-1 ', 'password');

    expect(mocks.userService.findByCustomIdentifier).toHaveBeenCalledWith(
      1,
      'employee-1'
    );
  });

  it.each([
    ['email', '', 'password', 'email is required'],
    ['username', '   ', 'password', 'username is required'],
    ['email', 'person@example.com', '', 'Password is required'],
  ])(
    'rejects missing %s login input before lookup',
    async (kind, identifier, password, message) => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      const service = createAuthService(mocks);

      const action =
        kind === 'username'
          ? service.loginWithUsername(identifier, password)
          : service.loginWithEmail(identifier, password);

      await expect(action).rejects.toThrow(message);
      expect(mocks.userService.findByEmail).not.toHaveBeenCalled();
      expect(mocks.userService.findByUsername).not.toHaveBeenCalled();
    }
  );

  it('does not disclose whether an email account exists', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(undefined);
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('missing@example.com', 'password')
    ).rejects.toThrow('Invalid email or password');
  });

  it.each([
    [{ account_is_anonymized: true }, 'This account has been anonymized'],
    [{ account_enabled: false }, 'This account is disabled'],
    [{ blocked_from: ['login'] }, 'This account is blocked'],
  ])('rejects an ineligible account %#', async (overrides, message) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'person',
        password: 'hash',
        account_enabled: true,
        ...overrides,
      })
    );
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('person@example.com', 'password')
    ).rejects.toThrow(message);
    expect(mocks.userService.verifyPasswordWithRehash).not.toHaveBeenCalled();
  });

  it('rejects an unverified email account when signup requires verification', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    mocks.config.security.authentication.signup.require_email_verification = true;
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'person',
        email: 'person@example.com',
        email_verified: false,
        password: 'hash',
      })
    );
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('person@example.com', 'password')
    ).rejects.toThrow('Email verification is required');
    expect(mocks.userService.verifyPasswordWithRehash).not.toHaveBeenCalled();
  });

  it('rejects an account without a stored password hash', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'person',
        account_enabled: true,
      })
    );
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('person@example.com', 'password')
    ).rejects.toThrow('Invalid credentials');
  });

  it.each([
    { result: { valid: false } },
    { error: new Error('verifier unavailable') },
  ])('normalizes password verification failures %#', async scenario => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    if (scenario.error) {
      vi.mocked(
        mocks.userService.verifyPasswordWithRehash
      ).mockRejectedValueOnce(scenario.error);
    } else {
      vi.mocked(
        mocks.userService.verifyPasswordWithRehash
      ).mockResolvedValueOnce(scenario.result!);
    }
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('person@example.com', 'password')
    ).rejects.toThrow('Invalid credentials');
  });

  it('persists an upgraded password hash before completing login', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: true,
        newHash: 'argon2-hash',
      }
    );
    const service = createAuthService(mocks);

    const user = await service.loginWithEmail('person@example.com', 'password');

    expect(user._id).toBe('user-123');
    expect(mocks.userService.updateById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        password: 'argon2-hash',
        password_hash_algo: 'argon2id',
      })
    );
    expect(mocks.userService.updateUserLastLoginDate).toHaveBeenCalledWith(
      'user-123',
      'testuser'
    );
  });

  it('allows login when persisting an upgraded hash fails', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: true,
        newHash: 'argon2-hash',
      }
    );
    vi.mocked(mocks.userService.updateById).mockRejectedValueOnce(
      new Error('write unavailable')
    );
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('person@example.com', 'password')
    ).resolves.toMatchObject({ _id: 'user-123' });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to update upgraded password hash',
      expect.objectContaining({ error: 'write unavailable' })
    );
  });

  it('handles returning users that must reset their password', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
        password: 'hashed',
        account_enabled: true,
        last_login: new Date(),
        password_force_reset: true,
      })
    );
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('test@example.com', 'password')
    ).resolves.toMatchObject({ password_force_reset: true });
  });
});

describe('AuthService - registration and reset-token generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a password that fails the configured password policy', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.validatePassword).mockReturnValueOnce({
      isValid: false,
      messages: ['too short', 'missing number'],
    });
    const service = createAuthService(mocks);

    await expect(
      service.registerUser({
        email: 'new@example.com',
        password: 'weak',
      })
    ).rejects.toThrow('Password validation failed: too short, missing number');
    expect(mocks.passwordUtils.hashPassword).not.toHaveBeenCalled();
  });

  it('requires at least one configured contact channel by default', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(
      service.registerUser({ password: 'safe-password' })
    ).rejects.toThrow('Either email or phone number is required');
  });

  it.each([
    [
      'invalid email',
      { email: 'invalid', phone_number: undefined },
      'Invalid email format',
    ],
    [
      'invalid phone',
      { email: undefined, phone_number: 'not-a-phone' },
      'Invalid phone number format',
    ],
  ])('rejects %s registration input', async (_label, contact, message) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(
      service.registerUser({ ...contact, password: 'safe-password' })
    ).rejects.toThrow(message);
  });

  it.each([
    [
      'email',
      'isEmailTaken',
      { email: 'taken@example.com' },
      'Email is already registered',
    ],
    [
      'phone',
      'isPhoneNumberTaken',
      { phone_number: '+2290100000000' },
      'Phone number is already registered',
    ],
  ])('rejects a duplicate %s', async (_label, method, contact, message) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(
      mocks.userService[method as 'isEmailTaken' | 'isPhoneNumberTaken']
    ).mockResolvedValueOnce(true);
    const service = createAuthService(mocks);

    await expect(
      service.registerUser({ ...contact, password: 'safe-password' })
    ).rejects.toThrow(message);
  });

  it('creates a phone-only account with secure defaults', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await service.registerUser({
      phone_number: '+2290100000000',
      password: 'safe-password',
      custom_identifier_1: '',
      custom_identifier_2: 'external-2',
    });

    expect(
      mocks.userService.createUserWithGeneratedUsername
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        phone_number: '+2290100000000',
        register_with: 'phone_number',
        password: 'hashed-password',
        password_hash_algo: 'argon2id',
        roles: ['user'],
        account_enabled: true,
        custom_identifier_1: undefined,
        custom_identifier_2: 'external-2',
        custom_identifier_3: undefined,
      })
    );
  });

  it('allows contactless registration when explicitly configured', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.configManager.getConfig).mockReturnValue({
      security: {
        authentication: {
          signup: {
            contact_channels: { require_at_least_one: false },
          },
          password_breach_detection: { enabled: false },
          roles: {
            available: ['user', 'admin', 'superadmin'],
            default: 'user',
          },
        },
      },
    } as never);
    const service = createAuthService(mocks);

    await expect(
      service.registerUser({
        password: 'safe-password',
        register_with: 'custom_identifier_1',
        custom_identifier_1: 'employee-1',
      })
    ).resolves.toBeDefined();
  });

  it.each([
    [{ custom_identifier_1: 'employee-1' }, 'custom_identifier_1'],
    [{ custom_identifier_2: 'member-2' }, 'custom_identifier_2'],
    [{ custom_identifier_3: 'external-3' }, 'custom_identifier_3'],
    [{}, 'email'],
  ])(
    'infers the registration method from contactless identity data %#',
    async (identifiers, expectedMethod) => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      vi.mocked(mocks.configManager.getConfig).mockReturnValue({
        security: {
          authentication: {
            signup: {
              contact_channels: { require_at_least_one: false },
            },
            password_breach_detection: { enabled: false },
            roles: {
              available: ['user', 'admin', 'superadmin'],
              default: 'user',
            },
          },
        },
      } as never);
      const service = createAuthService(mocks);

      await service.registerUser({
        ...identifiers,
        password: 'safe-password',
      });

      expect(
        mocks.userService.createUserWithGeneratedUsername
      ).toHaveBeenCalledWith(
        expect.objectContaining({ register_with: expectedMethod })
      );
    }
  );

  it('generates and stores a hashed reset token for a primary email', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const user = makeUser({
      _id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      account_enabled: true,
    });
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(user);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(user);
    const service = createAuthService(mocks);

    const result = await service.generatePasswordResetToken('test@example.com');

    expect(result.user).toBe(user);
    expect(result.resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.userService.findByRecoveryEmail).not.toHaveBeenCalled();
    expect(mocks.userService.updateById).toHaveBeenCalledWith('user-123', {
      reset_password_token: expect.stringMatching(/^[a-f0-9]{64}$/),
      reset_password_expires: expect.any(Date),
    });
  });

  it('falls back to a verified recovery email', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const user = makeUser({
      _id: 'user-123',
      username: 'testuser',
      email: 'primary@example.com',
      account_enabled: true,
    });
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(undefined);
    vi.mocked(mocks.userService.findByRecoveryEmail).mockResolvedValueOnce(
      user
    );
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(user);
    const service = createAuthService(mocks);

    await expect(
      service.generatePasswordResetToken('recovery@example.com')
    ).resolves.toMatchObject({ user });
    expect(mocks.userService.findByRecoveryEmail).toHaveBeenCalledWith(
      'recovery@example.com'
    );
  });

  it.each([
    ['invalid', 'Invalid email format'],
    ['missing@example.com', 'If the email exists, a reset link has been sent'],
  ])('rejects reset-token request for %s', async (email, message) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(undefined);
    vi.mocked(mocks.userService.findByRecoveryEmail).mockResolvedValueOnce(
      undefined
    );
    const service = createAuthService(mocks);

    await expect(service.generatePasswordResetToken(email)).rejects.toThrow(
      message
    );
    expect(mocks.userService.updateById).not.toHaveBeenCalled();
  });
});

describe('AuthService - password changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['', 'current', 'next'],
    ['testuser', '', 'next'],
    ['testuser', 'current', ''],
  ])('requires all self-service password inputs', async (...args) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(service.changePassword(...args)).rejects.toThrow(
      'Username, current password, and new password are required'
    );
  });

  it('validates the replacement password before finding the user', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.validatePassword).mockReturnValueOnce({
      isValid: false,
      messages: ['too weak'],
    });
    const service = createAuthService(mocks);

    await expect(
      service.changePassword('testuser', 'current', 'weak')
    ).rejects.toThrow('Password validation failed: too weak');
    expect(mocks.userService.findByUsername).not.toHaveBeenCalled();
  });

  it('rejects a missing user and an incorrect current password', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(
      undefined
    );
    await expect(
      service.changePassword('missing', 'current', 'new-password')
    ).rejects.toThrow('User not found');

    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
        password: 'old-hash',
        account_enabled: true,
      })
    );
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: false,
      }
    );
    await expect(
      service.changePassword('testuser', 'wrong', 'new-password')
    ).rejects.toThrow('Current password is incorrect');
  });

  it('treats a missing stored password hash as an invalid current password', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'passwordless-user',
        account_enabled: true,
      })
    );
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: false,
      }
    );
    const service = createAuthService(mocks);

    await expect(
      service.changePassword('passwordless-user', 'current', 'new-password')
    ).rejects.toThrow('Current password is incorrect');
    expect(mocks.userService.verifyPasswordWithRehash).toHaveBeenCalledWith(
      'current',
      ''
    );
  });

  it('stores the replacement password without a redundant rehash update', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: true,
      }
    );
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
        password: 'hashed-password',
      })
    );
    const service = createAuthService(mocks);

    await expect(
      service.changePassword('testuser', 'current', 'new-password')
    ).resolves.toMatchObject({ password: 'hashed-password' });
    expect(mocks.userService.updateById).toHaveBeenCalledTimes(1);
    expect(mocks.userService.updateById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        password: 'hashed-password',
        password_force_reset: false,
      })
    );
  });

  it('upgrades the current hash and then stores the replacement password', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: true,
        newHash: 'upgraded-current-hash',
      }
    );
    vi.mocked(mocks.userService.updateById)
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(
        makeUser({
          _id: 'user-123',
          username: 'testuser',
          password: 'hashed-password',
        })
      );
    const service = createAuthService(mocks);

    const result = await service.changePassword(
      'testuser',
      'current',
      'new-password',
      true
    );

    expect(result.password).toBe('hashed-password');
    expect(mocks.userService.updateById).toHaveBeenNthCalledWith(
      1,
      'user-123',
      expect.objectContaining({ password: 'upgraded-current-hash' })
    );
    expect(mocks.userService.updateById).toHaveBeenNthCalledWith(
      2,
      'user-123',
      expect.objectContaining({
        password: 'hashed-password',
        password_force_reset: false,
      })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Request to logout other devices on password change',
      { username: 'testuser' }
    );
  });

  it('continues a password change when persisting the upgraded current hash fails', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.verifyPasswordWithRehash).mockResolvedValueOnce(
      {
        valid: true,
        newHash: 'upgraded-current-hash',
      }
    );
    vi.mocked(mocks.userService.updateById)
      .mockRejectedValueOnce(new Error('upgrade write failed'))
      .mockResolvedValueOnce(
        makeUser({
          _id: 'user-123',
          username: 'testuser',
          password: 'hashed-password',
        })
      );
    const service = createAuthService(mocks);

    await expect(
      service.changePassword('testuser', 'current', 'new-password')
    ).resolves.toMatchObject({ password: 'hashed-password' });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to update upgraded current password hash',
      expect.objectContaining({ error: 'upgrade write failed' })
    );
  });

  it.each([
    ['', 'target', 'new-password'],
    ['admin', '', 'new-password'],
    ['admin', 'target', ''],
  ])('requires all admin password-change inputs', async (...args) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(service.adminChangeUserPassword(...args)).rejects.toThrow(
      'Admin username, target user ID, and new password are required'
    );
  });

  it.each([
    [undefined, 'Admin user not found'],
    [
      makeUser({ _id: 'admin-1', username: 'viewer', roles: ['user'] }),
      'Insufficient permissions',
    ],
  ])('rejects unauthorized admin identity %#', async (admin, message) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(admin);
    const service = createAuthService(mocks);

    await expect(
      service.adminChangeUserPassword('admin', 'target', 'new-password')
    ).rejects.toThrow(message);
    expect(mocks.userService.findById).not.toHaveBeenCalled();
  });

  it('rejects a missing admin password-change target', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(
      makeUser({
        _id: 'admin-1',
        username: 'admin',
        roles: ['admin'],
      })
    );
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(undefined);
    const service = createAuthService(mocks);

    await expect(
      service.adminChangeUserPassword('admin', 'missing', 'new-password')
    ).rejects.toThrow('Target user not found');
  });

  it('changes a target password with reset and notification options', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const admin = makeUser({
      _id: 'admin-1',
      username: 'admin',
      roles: ['superadmin'],
    });
    const target = makeUser({
      _id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
    });
    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(admin);
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(target);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(target);
    const service = createAuthService(mocks);

    await service.adminChangeUserPassword('admin', 'user-123', 'new-password', {
      requireReset: true,
      sendEmail: true,
    });

    expect(mocks.userService.updateById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        password: 'hashed-password',
        password_force_reset: true,
      })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Should send password change email notification',
      expect.objectContaining({ targetEmail: 'test@example.com' })
    );
  });

  it('uses safe admin defaults without forcing reset or email notification', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(
      makeUser({
        _id: 'admin-1',
        username: 'admin',
        roles: ['admin'],
      })
    );
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
      })
    );
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
      })
    );
    const service = createAuthService(mocks);

    await service.adminChangeUserPassword('admin', 'user-123', 'new-password');

    const update = vi.mocked(mocks.userService.updateById).mock.calls[0]?.[1];
    expect(update).not.toHaveProperty('password_force_reset');
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      'Should send password change email notification',
      expect.anything()
    );
  });

  it('validates an admin replacement password before authorization lookup', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.validatePassword).mockReturnValueOnce({
      isValid: false,
      messages: ['too weak'],
    });
    const service = createAuthService(mocks);

    await expect(
      service.adminChangeUserPassword('admin', 'user-123', 'weak')
    ).rejects.toThrow('Password validation failed: too weak');
    expect(mocks.userService.findByUsername).not.toHaveBeenCalled();
  });

  it('changes a password for an already-authorized machine client without treating it as a user', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const target = makeUser({
      _id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
    });
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(target);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(target);
    const service = createAuthService(mocks);

    await service.changeUserPasswordByAuthorizedClient(
      'management-client',
      'user-123',
      'new-password'
    );

    expect(mocks.userService.findByUsername).not.toHaveBeenCalled();
    expect(mocks.userService.findById).toHaveBeenCalledWith('user-123');
    expect(mocks.userService.updateById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        password: 'hashed-password',
        password_hash_algo: 'argon2id',
      })
    );
  });

  it('logs and propagates an authorized machine-client password-change failure', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findById).mockRejectedValueOnce(
      new Error('repository unavailable')
    );
    const service = createAuthService(mocks);

    await expect(
      service.changeUserPasswordByAuthorizedClient(
        'management-client',
        'user-123',
        'new-password'
      )
    ).rejects.toThrow('repository unavailable');
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error performing authorized client password change',
      {
        error: 'repository unavailable',
        actorClientId: 'management-client',
        targetUserId: 'user-123',
      }
    );
  });
});

describe('AuthService - portable email OTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a generated OTP through the repository-backed user MFA API', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const expiresAt = new Date(Date.now() + 600_000);
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
      })
    );
    vi.mocked(mocks.mfaUtils.generateEmailOtp).mockReturnValueOnce({
      code: '123456',
      hash: 'otp-hash',
      expiresAt,
    });
    const service = createAuthService(mocks);

    await expect(service.generateEmailOtp('user-123')).resolves.toEqual({
      code: '123456',
      expiresAt,
    });
    expect(mocks.userService.setEmailOtp).toHaveBeenCalledWith(
      'testuser',
      '123456',
      600
    );
    expect(mocks.userService.updateById).not.toHaveBeenCalled();
  });

  it('rejects OTP generation for a missing user', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(undefined);
    const service = createAuthService(mocks);

    await expect(service.generateEmailOtp('missing')).rejects.toThrow(
      'User not found'
    );
    expect(mocks.mfaUtils.generateEmailOtp).not.toHaveBeenCalled();
  });

  it('verifies and clears OTP through the repository-backed user MFA API', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
      })
    );
    const service = createAuthService(mocks);

    await expect(service.verifyEmailOtp('user-123', '123456')).resolves.toBe(
      true
    );
    expect(mocks.userService.verifyEmailOtp).toHaveBeenCalledWith(
      'testuser',
      '123456'
    );
    expect(mocks.userService.updateById).not.toHaveBeenCalled();
  });

  it('returns false when the OTP user is missing or verification fails', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(undefined);
    await expect(service.verifyEmailOtp('missing', '123456')).resolves.toBe(
      false
    );

    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(
      makeUser({
        _id: 'user-123',
        username: 'testuser',
      })
    );
    vi.mocked(mocks.userService.verifyEmailOtp).mockResolvedValueOnce(false);
    await expect(service.verifyEmailOtp('user-123', 'bad-code')).resolves.toBe(
      false
    );
  });

  it('normalizes OTP verification exceptions to false', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findById).mockRejectedValueOnce(
      new Error('lookup failed')
    );
    const service = createAuthService(mocks);

    await expect(service.verifyEmailOtp('user-123', '123456')).resolves.toBe(
      false
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'verifyEmailOtp error',
      expect.objectContaining({ error: 'lookup failed' })
    );
  });
});

describe('AuthService - email verification and authorization helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['', 'User ID is required'],
    ['missing', 'User not found'],
  ])(
    'rejects verification-token generation for %s',
    async (userId, message) => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      vi.mocked(mocks.userService.findById).mockResolvedValueOnce(undefined);
      const service = createAuthService(mocks);

      await expect(
        service.generateEmailVerificationToken(userId)
      ).rejects.toThrow(message);
    }
  );

  it.each([
    [makeUser({ email_verified: true }), 'Email is already verified'],
    [
      makeUser({ email_verified: false }),
      'User has no email address to verify',
    ],
  ])('rejects an ineligible verification target %#', async (user, message) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(user);
    const service = createAuthService(mocks);

    await expect(
      service.generateEmailVerificationToken('user-123')
    ).rejects.toThrow(message);
  });

  it('generates and stores a hashed email verification token', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const user = makeUser({
      _id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      email_verified: false,
    });
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(user);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(user);
    const service = createAuthService(mocks);

    const result = await service.generateEmailVerificationToken('user-123');

    expect(result.verificationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.userService.updateById).toHaveBeenCalledWith('user-123', {
      email_verification_token: expect.stringMatching(/^[a-f0-9]{64}$/),
      email_verification_expires: expect.any(Date),
    });
  });

  it('requires a verification token and rejects a missing token record', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(service.verifyEmail('')).rejects.toThrow(
      'Verification token is required'
    );

    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(null);
    await expect(service.verifyEmail('unknown-token')).rejects.toThrow(
      'Invalid or expired token'
    );
  });

  it.each([
    [{ roles: ['admin'] }, true],
    [{ roles: ['superadmin'] }, true],
    [{ roles: ['user'] }, false],
    [{}, false],
  ])('identifies admin roles %#', (user, expected) => {
    const service = createAuthService(
      createMocks(createBreachConfig({ enabled: false }))
    );

    expect(service.isAdmin(user as never)).toBe(expected);
  });

  it.each([
    [{ roles: ['auditor'] }, 'auditor', true],
    [{ roles: ['user'] }, 'admin', false],
    [{}, 'user', false],
  ])('checks a user role %#', (user, role, expected) => {
    const service = createAuthService(
      createMocks(createBreachConfig({ enabled: false }))
    );

    expect(service.hasRole(user as never, role)).toBe(expected);
  });
});

describe('AuthService - phone verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['', undefined, 'User ID is required'],
    ['missing', undefined, 'User not found'],
    [
      'user-123',
      makeUser({ phone_number: '+14155552671', phone_number_verified: true }),
      'Phone is already verified',
    ],
    [
      'user-123',
      makeUser({ phone_number_verified: false }),
      'User has no phone number to verify',
    ],
  ])(
    'rejects an ineligible phone challenge target %#',
    async (userId, user, message) => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      vi.mocked(mocks.userService.findById).mockResolvedValueOnce(user);
      const service = createAuthService(mocks);

      await expect(
        service.generatePhoneVerificationChallenge(userId)
      ).rejects.toThrow(message);
    }
  );

  it('stores only hashes for a one-time phone verification challenge', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const user = makeUser({
      phone_number: '+14155552671',
      phone_number_verified: false,
    });
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(user);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(user);
    const service = createAuthService(mocks);

    const challenge =
      await service.generatePhoneVerificationChallenge('user-123');

    expect(challenge.verificationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.code).toMatch(/^\d{6}$/);
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mocks.userService.updateById).toHaveBeenCalledWith('user-123', {
      phone_verification_token: expect.stringMatching(/^[a-f0-9]{64}$/),
      phone_verification_code: expect.stringMatching(/^[a-f0-9]{64}$/),
      phone_verification_expires: challenge.expiresAt,
    });
    const persisted = vi.mocked(mocks.userService.updateById).mock.calls[0]![1];
    expect(persisted.phone_verification_token).not.toBe(
      challenge.verificationToken
    );
    expect(persisted.phone_verification_code).not.toBe(challenge.code);
  });

  it('restores the original challenge when a replacement cannot be delivered', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const originalExpiry = new Date(Date.now() + 60_000);
    const pendingUser = makeUser({
      phone_number: '+14155552671',
      phone_number_verified: false,
      phone_verification_token: 'original-token-hash',
      phone_verification_code: 'original-code-hash',
      phone_verification_expires: originalExpiry,
    });
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(pendingUser);
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(pendingUser);
    vi.mocked(mocks.userService.updateById).mockResolvedValue(pendingUser);
    const service = createAuthService(mocks);
    const deliver = vi.fn().mockResolvedValue(false);

    await expect(
      service.renewPhoneVerificationChallenge('original-token', deliver)
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PhoneVerificationDeliveryError',
        verificationToken: 'original-token',
      })
    );

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.stringMatching(/^\d{6}$/),
        verificationToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(mocks.userService.updateById).toHaveBeenLastCalledWith('user-123', {
      phone_verification_token: 'original-token-hash',
      phone_verification_code: 'original-code-hash',
      phone_verification_expires: originalExpiry,
    });
  });

  it.each([
    ['', null],
    ['unknown-token', null],
    [
      'verified-token',
      makeUser({
        phone_number: '+14155552671',
        phone_number_verified: true,
      }),
    ],
  ])('rejects an invalid phone challenge renewal %#', async (token, user) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(user);
    const service = createAuthService(mocks);

    await expect(
      service.renewPhoneVerificationChallenge(token)
    ).rejects.toThrow(
      token ? 'Invalid verification token' : 'Verification token is required'
    );
  });

  it('renews a phone challenge without delivery using portable user identity', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const pendingUser = makeUser({
      _id: undefined,
      id: 'portable-user',
      phone_number: '+14155552671',
      phone_number_verified: false,
      phone_verification_token: undefined,
      phone_verification_code: undefined,
      phone_verification_expires: undefined,
    });
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(pendingUser);
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(pendingUser);
    const service = createAuthService(mocks);

    await expect(
      service.renewPhoneVerificationChallenge('original-token')
    ).resolves.toMatchObject({ user: pendingUser });
    expect(mocks.userService.findById).toHaveBeenCalledWith('portable-user');
    expect(mocks.userService.updateById).toHaveBeenCalledOnce();
  });

  it('keeps a successfully delivered replacement phone challenge', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const pendingUser = makeUser({
      phone_number: '+14155552671',
      phone_number_verified: false,
    });
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(pendingUser);
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(pendingUser);
    const service = createAuthService(mocks);
    const deliver = vi.fn().mockResolvedValue(true);

    await expect(
      service.renewPhoneVerificationChallenge('original-token', deliver)
    ).resolves.toEqual(expect.objectContaining({ user: pendingUser }));
    expect(deliver).toHaveBeenCalledOnce();
    expect(mocks.userService.updateById).toHaveBeenCalledOnce();
  });

  it.each([
    [new Error('SMS unavailable'), 'SMS unavailable'],
    ['SMS unavailable', 'SMS unavailable'],
  ])(
    'preserves delivery failure details when challenge rotation is compensated %#',
    async (deliveryError, expectedMessage) => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      const pendingUser = makeUser({
        phone_number: '+14155552671',
        phone_number_verified: false,
      });
      vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(pendingUser);
      vi.mocked(mocks.userService.findById).mockResolvedValueOnce(pendingUser);
      const service = createAuthService(mocks);

      await expect(
        service.renewPhoneVerificationChallenge(
          'original-token',
          vi.fn().mockRejectedValue(deliveryError)
        )
      ).rejects.toMatchObject({
        name: 'PhoneVerificationDeliveryError',
        cause: expect.objectContaining({ message: expectedMessage }),
      });
      expect(mocks.userService.updateById).toHaveBeenCalledTimes(2);
    }
  );

  it.each([new Error('rollback unavailable'), 'rollback unavailable'])(
    'propagates and logs challenge rollback failure %#',
    async rollbackError => {
      const mocks = createMocks(createBreachConfig({ enabled: false }));
      const pendingUser = makeUser({
        phone_number: '+14155552671',
        phone_number_verified: false,
      });
      vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(pendingUser);
      vi.mocked(mocks.userService.findById).mockResolvedValueOnce(pendingUser);
      vi.mocked(mocks.userService.updateById)
        .mockResolvedValueOnce(pendingUser)
        .mockRejectedValueOnce(rollbackError);
      const service = createAuthService(mocks);

      await expect(
        service.renewPhoneVerificationChallenge(
          'original-token',
          vi.fn().mockResolvedValue(false)
        )
      ).rejects.toBe(rollbackError);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to restore phone verification challenge',
        {
          userId: 'user-123',
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        }
      );
    }
  );

  it('consumes a matching phone verification challenge exactly once', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);
    const generated = await (async () => {
      const user = makeUser({
        phone_number: '+14155552671',
        phone_number_verified: false,
      });
      vi.mocked(mocks.userService.findById).mockResolvedValueOnce(user);
      vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(user);
      return service.generatePhoneVerificationChallenge('user-123');
    })();
    const challenge = await generated;
    const persisted = vi.mocked(mocks.userService.updateById).mock.calls[0]![1];
    const pendingUser = makeUser({
      phone_number: '+14155552671',
      phone_number_verified: false,
      phone_verification_token: persisted.phone_verification_token,
      phone_verification_code: persisted.phone_verification_code,
      phone_verification_expires: challenge.expiresAt,
    });
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(pendingUser);
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(
      makeUser({ phone_number: '+14155552671', phone_number_verified: true })
    );

    await expect(
      service.verifyPhone(challenge.verificationToken, challenge.code)
    ).resolves.toEqual(
      expect.objectContaining({ phone_number_verified: true })
    );
    expect(mocks.userService.updateById).toHaveBeenLastCalledWith('user-123', {
      phone_number_verified: true,
      phone_verification_token: null,
      phone_verification_code: null,
      phone_verification_expires: null,
    });
  });

  it('rejects a phone verification when the persisted user disappears', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);
    const user = makeUser({
      phone_number: '+14155552671',
      phone_number_verified: false,
    });
    vi.mocked(mocks.userService.findById).mockResolvedValueOnce(user);
    const challenge =
      await service.generatePhoneVerificationChallenge('user-123');
    const persisted = vi.mocked(mocks.userService.updateById).mock.calls[0]![1];
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(
      makeUser({
        phone_number: '+14155552671',
        phone_verification_token: persisted.phone_verification_token,
        phone_verification_code: persisted.phone_verification_code,
        phone_verification_expires: challenge.expiresAt,
      })
    );
    vi.mocked(mocks.userService.updateById).mockResolvedValueOnce(null);

    await expect(
      service.verifyPhone(challenge.verificationToken, challenge.code)
    ).rejects.toThrow('User not found');
  });

  it.each([
    ['wrong-code', new Date(Date.now() + 60_000)],
    ['123456', new Date(Date.now() - 1)],
  ])('rejects invalid or expired phone proof %#', async (code, expiresAt) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);
    vi.mocked(mocks.userService.findOne).mockResolvedValueOnce(
      makeUser({
        phone_number: '+14155552671',
        phone_verification_code:
          '8d969eef6ecad3c29a3a629280e686cff8caed6a' +
          'ff8caed6a9a629280e686cff',
        phone_verification_expires: expiresAt,
      })
    );

    await expect(service.verifyPhone('challenge-token', code)).rejects.toThrow(
      'Invalid or expired verification code'
    );
    expect(mocks.userService.updateById).not.toHaveBeenCalled();
  });

  it('requires phone verification only after the submitted password is valid', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    mocks.config.security.authentication.signup.require_phone_verification = true;
    vi.mocked(mocks.userService.findByEmail).mockResolvedValueOnce(
      makeUser({
        email: 'test@example.com',
        phone_number: '+14155552671',
        phone_number_verified: false,
        password: 'hashed-password',
      })
    );
    const service = createAuthService(mocks);

    await expect(
      service.loginWithEmail('test@example.com', 'valid-password')
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PhoneVerificationRequiredError',
        userId: 'user-123',
        phoneNumber: '+14155552671',
      })
    );
    expect(mocks.userService.verifyPasswordWithRehash).toHaveBeenCalled();
    await expect(
      Promise.reject(
        new PhoneVerificationRequiredError('user-123', '+14155552671')
      )
    ).rejects.toBeInstanceOf(PhoneVerificationRequiredError);
  });
});

describe('AuthService - TOTP and username lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['', '123456'],
    ['testuser', ''],
  ])('rejects missing TOTP input', async (identifier, code) => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(service.verifyTotp(identifier, code)).resolves.toBe(false);
    expect(mocks.mfaUtils.validateTotpCodeFormat).not.toHaveBeenCalled();
  });

  it('rejects an invalid TOTP format and delegates a sanitized valid code', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    vi.mocked(mocks.mfaUtils.validateTotpCodeFormat).mockReturnValueOnce({
      valid: false,
      error: 'six digits required',
    });
    await expect(service.verifyTotp('testuser', 'bad')).resolves.toBe(false);

    vi.mocked(mocks.mfaUtils.validateTotpCodeFormat).mockReturnValueOnce({
      valid: true,
      sanitized: '123456',
    });
    await expect(service.verifyTotp('testuser', ' 123456 ')).resolves.toBe(
      true
    );
    expect(mocks.userService.verifyTotp).toHaveBeenCalledWith(
      'testuser',
      '123456'
    );
  });

  it('normalizes TOTP verification exceptions to false', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.verifyTotp).mockRejectedValueOnce(
      new Error('TOTP store failed')
    );
    const service = createAuthService(mocks);

    await expect(service.verifyTotp('testuser', '123456')).resolves.toBe(false);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'verifyTotp error',
      expect.objectContaining({ error: 'TOTP store failed' })
    );
  });

  it('finds a user by username and returns null when absent', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(service.findUserByUsername('testuser')).resolves.toMatchObject(
      {
        _id: 'user-123',
      }
    );
    vi.mocked(mocks.userService.findByUsername).mockResolvedValueOnce(
      undefined
    );
    await expect(service.findUserByUsername('missing')).resolves.toBeNull();
  });

  it.each(['', '   '])('rejects an empty username lookup', async username => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    const service = createAuthService(mocks);

    await expect(service.findUserByUsername(username)).rejects.toThrow(
      'Username is required'
    );
  });

  it('propagates username lookup failures after logging', async () => {
    const mocks = createMocks(createBreachConfig({ enabled: false }));
    vi.mocked(mocks.userService.findByUsername).mockRejectedValueOnce(
      new Error('directory failed')
    );
    const service = createAuthService(mocks);

    await expect(service.findUserByUsername('testuser')).rejects.toThrow(
      'directory failed'
    );
  });
});
