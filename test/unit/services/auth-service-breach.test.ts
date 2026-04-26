import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock password-breach utility
vi.mock('../../../src/utils/password-breach.js', () => ({
  checkPasswordBreach: vi.fn(),
  computeSha1PrefixSuffix: vi.fn(),
}));

// Mock BullMQ Queue
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { AuthService } from '../../../src/services/auth.service.js';
import {
  checkPasswordBreach,
  computeSha1PrefixSuffix,
} from '../../../src/utils/password-breach.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { IUserService } from '../../../src/di/interfaces/user-service.interface.js';
import type { IPasswordUtils } from '../../../src/di/interfaces/password-utils.interface.js';
import type { IMfaUtils } from '../../../src/di/interfaces/mfa-utils.interface.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';

const mockedCheckPasswordBreach = vi.mocked(checkPasswordBreach);
const mockedComputeSha1PrefixSuffix = vi.mocked(computeSha1PrefixSuffix);

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

function createMocks(breachConfig = createBreachConfig()) {
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
    createUserWithGeneratedUsername: vi.fn().mockResolvedValue({
      _id: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      password: 'hashed',
    }),
    findByEmail: vi.fn().mockResolvedValue({
      _id: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      password: 'hashed',
      account_enabled: true,
    }),
    findByUsername: vi.fn().mockResolvedValue({
      _id: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      password: 'hashed',
      account_enabled: true,
    }),
    findOne: vi.fn(),
    verifyPasswordWithRehash: vi
      .fn()
      .mockResolvedValue({ valid: true, newHash: null }),
    updateById: vi
      .fn()
      .mockImplementation((_id, data) => Promise.resolve({ _id, ...data })),
    updateUserLastLoginDate: vi.fn().mockResolvedValue(undefined),
  };

  const passwordUtils: Partial<IPasswordUtils> = {
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  };

  const mfaUtils: Partial<IMfaUtils> = {};

  const configManager: Partial<IConfigManager> = {
    getConfig: vi.fn().mockReturnValue({
      security: {
        authentication: {
          password_breach_detection: breachConfig,
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
    }),
  };

  return {
    logger: logger as ILogger,
    userService: userService as IUserService,
    passwordUtils: passwordUtils as IPasswordUtils,
    mfaUtils: mfaUtils as IMfaUtils,
    configManager: configManager as IConfigManager,
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
    mockedComputeSha1PrefixSuffix.mockReturnValue({
      prefix: '5BAA6',
      suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8',
    });
  });

  describe('registerUser', () => {
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
  });
});
