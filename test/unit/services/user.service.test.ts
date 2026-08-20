import 'reflect-metadata';
import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../../../src/services/user.service.js';
import { encryptValue } from '../../../src/utils/encryption.js';
import type { IUser } from '../../../src/types/user.js';
import type { IUserPersistenceRepository } from '../../../src/db/repositories/interfaces/user.repository.js';
import type { CustomIdentifierFieldConfig } from '../../../src/di/interfaces/user/user-custom-identifier-service.interface.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

vi.mock('../../../src/utils/encryption.js', () => ({
  encryptValue: vi.fn((value: string) => `encrypted:${value}`),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
  getLogger: () => null,
  flush: async () => {},
  shutdown: async () => {},
} as any;

const mockConfigManager = {
  subscribe: vi.fn(),
  getConfig: () => ({
    security: {
      authentication: {
        login: {
          password_policy: {
            min_length: 8,
            require_uppercase: true,
            require_lowercase: true,
            require_numbers: true,
            require_symbols: false,
            max_age_days: 90,
          },
        },
        custom_identifiers: {
          enabled: false,
          fields: [],
        },
        roles: {
          available: ['user', 'admin', 'superadmin'],
          default: 'user',
        },
      },
    },
  }),
} as any;

const mockMfaUtils = {
  validateTotpCodeFormat: vi.fn(),
  isTotpEnabled: vi.fn(),
  isTotpPendingSetup: vi.fn(),
  isEmailMfaPendingSetup: vi.fn(),
  getUserTotpSecret: vi.fn(),
  verifyTotpCode: vi.fn(),
  generateEmailOtp: vi.fn(),
  verifyEmailOtp: vi.fn(),
  getEnableMethodUpdate: vi.fn(),
  getDisableMethodUpdate: vi.fn(),
  getDisableAllMfaUpdate: vi.fn(),
  hasAnyMethodEnabled: vi.fn(),
} as any;

const mockPasswordUtils = {
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  rehashIfNeeded: vi.fn(),
  minIterations: 10000,
  minKeylen: 32,
} as any;

function makeMockRepo(): IUserPersistenceRepository {
  return {
    findById: vi.fn(),
    findOne: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findBySub: vi.fn(),
    findBySecondaryEmail: vi.fn(),
    findByRecoveryTokenHash: vi.fn(),
    findManyRaw: vi.fn(),
    updateMfa: vi.fn(),
    updateRecovery: vi.fn(),
    addWebAuthnCredential: vi.fn(),
    removeWebAuthnCredential: vi.fn(),
    addBackupCodes: vi.fn(),
    consumeBackupCode: vi.fn(),
    addSecurityQuestion: vi.fn(),
    updateRecoveryLockout: vi.fn(),
    setEmailOtp: vi.fn(),
    clearEmailOtp: vi.fn(),
    forcePasswordReset: vi.fn(),
    anonymize: vi.fn(),
  };
}

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: 'user-123',
    id: 'user-123',
    email: 'alice@example.com',
    username: 'alice',
    account_enabled: true,
    account_is_anonymized: false,
    roles: ['user'],
    ...overrides,
  } as unknown as IUser;
}

function makeService(userRepo: IUserPersistenceRepository): UserService {
  return new UserService(
    mockLogger,
    mockConfigManager,
    mockMfaUtils,
    mockPasswordUtils,
    userRepo as any
  );
}

function makeCustomIdentifierConfigManager(
  fields: CustomIdentifierFieldConfig[],
  enabled = true
) {
  return {
    subscribe: vi.fn(),
    getConfig: () => ({
      security: {
        authentication: {
          login: {
            password_policy: {
              min_length: 8,
              require_uppercase: true,
              require_lowercase: true,
              require_numbers: true,
              require_symbols: false,
              max_age_days: 90,
            },
          },
          custom_identifiers: {
            enabled,
            fields,
          },
        },
      },
    }),
  } as any;
}

function makeServiceWithCI(
  userRepo: IUserPersistenceRepository,
  fields: CustomIdentifierFieldConfig[],
  enabled = true
): UserService {
  return new UserService(
    mockLogger,
    makeCustomIdentifierConfigManager(fields, enabled),
    mockMfaUtils,
    mockPasswordUtils,
    userRepo as any
  );
}

function makeFieldConfig(
  overrides: Partial<CustomIdentifierFieldConfig> = {}
): CustomIdentifierFieldConfig {
  return {
    slot: 1,
    key: 'employee_id',
    name: 'Employee ID',
    hint_for_user: 'e.g. EMP-1234',
    validation_type: 'none',
    case_sensitive: false,
    required_for_registration: false,
    edit_policy: 'set_once',
    usable_for_login: true,
    ...overrides,
  };
}

describe('UserService — IUserPersistenceRepository delegation', () => {
  let repo: IUserPersistenceRepository;
  let service: UserService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(encryptValue).mockImplementation(
      (value: string) => `encrypted:${value}`
    );
    repo = makeMockRepo();
    service = makeService(repo);
  });

  describe('findByEmail', () => {
    it('delegates to repo.findOne with account_enabled filter', async () => {
      const user = makeUser();
      vi.mocked(repo.findOne).mockResolvedValue(user);

      const result = await service.findByEmail('alice@example.com');

      expect(repo.findOne).toHaveBeenCalledWith({
        email: 'alice@example.com',
        account_enabled: true,
      });
      expect(result).toEqual(user);
    });

    it('returns undefined when no user found', async () => {
      vi.mocked(repo.findOne).mockResolvedValue(null);

      const result = await service.findByEmail('noone@example.com');

      expect(result).toBeUndefined();
    });
  });

  describe('findById (service method)', () => {
    it('delegates to repo.findById', async () => {
      const user = makeUser();
      vi.mocked(repo.findById).mockResolvedValue(user);

      const result = await service.findById('user-123');

      expect(repo.findById).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(user);
    });
  });

  describe('findByRecoveryToken', () => {
    it('hashes a trimmed token and delegates to the portable repository lookup', async () => {
      const user = makeUser();
      const tokenHash = crypto
        .createHash('sha256')
        .update('recovery-token')
        .digest('hex');
      const findByRecoveryTokenHash = vi.fn().mockResolvedValue(user);
      Object.assign(repo, { findByRecoveryTokenHash });

      const result = await service.findByRecoveryToken(' recovery-token ');

      expect(findByRecoveryTokenHash).toHaveBeenCalledWith(tokenHash);
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(user);
    });

    it('returns null without querying when token is blank', async () => {
      const result = await service.findByRecoveryToken('   ');

      expect(repo.findOne).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null and logs when the repository lookup fails', async () => {
      vi.mocked(repo.findByRecoveryTokenHash).mockRejectedValueOnce(
        new Error('lookup failed')
      );

      await expect(
        service.findByRecoveryToken('recovery-token')
      ).resolves.toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: 'find_user_by_recovery_token_failed',
          token: 'provided',
        })
      );
    });
  });

  describe('findByRecoveryEmail', () => {
    it('normalizes the address and delegates to the portable repository lookup', async () => {
      const user = makeUser({
        recovery: {
          enabled: true,
          methods: ['secondary_email'],
          secondary_email: {
            email: 'recovery@example.com',
            verified: true,
          },
        },
      });
      vi.mocked(repo.findBySecondaryEmail).mockResolvedValue(user);

      await expect(
        service.findByRecoveryEmail('Recovery@Example.COM')
      ).resolves.toEqual(user);
      expect(repo.findBySecondaryEmail).toHaveBeenCalledWith(
        'recovery@example.com'
      );
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it.each([
      null,
      makeUser({ account_enabled: false }),
      makeUser({
        recovery: {
          enabled: true,
          methods: ['secondary_email'],
          secondary_email: {
            email: 'recovery@example.com',
            verified: false,
          },
        },
      }),
    ])(
      'does not return an absent, disabled, or unverified recovery user %#',
      async user => {
        vi.mocked(repo.findBySecondaryEmail).mockResolvedValueOnce(user);

        await expect(
          service.findByRecoveryEmail('recovery@example.com')
        ).resolves.toBeUndefined();
      }
    );

    it('logs and propagates a repository failure', async () => {
      const error = new Error('lookup failed');
      vi.mocked(repo.findBySecondaryEmail).mockRejectedValueOnce(error);

      await expect(
        service.findByRecoveryEmail('recovery@example.com')
      ).rejects.toBe(error);
      expect(mockLogger.error).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          context: 'error_finding_user_by_recovery_email',
        })
      );
    });
  });

  describe('findOne (collection contract)', () => {
    it('delegates to repo.findById when filter is a string', async () => {
      const user = makeUser();
      vi.mocked(repo.findById).mockResolvedValue(user);

      const result = await service.findOne('user-123');

      expect(repo.findById).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(user);
    });

    it('delegates to repo.findOne when filter is an object', async () => {
      const user = makeUser();
      vi.mocked(repo.findOne).mockResolvedValue(user);

      const result = await service.findOne({
        email: 'alice@example.com',
      } as any);

      expect(repo.findOne).toHaveBeenCalledWith({ email: 'alice@example.com' });
      expect(result).toEqual(user);
    });
  });

  describe('countDocuments (collection contract)', () => {
    it('delegates to repo.count', async () => {
      vi.mocked(repo.count).mockResolvedValue(42);

      const result = await service.countDocuments({} as any);

      expect(repo.count).toHaveBeenCalledWith({});
      expect(result).toBe(42);
    });

    it('passes filter through to repo.count', async () => {
      vi.mocked(repo.count).mockResolvedValue(5);
      const filter = { account_enabled: true };

      await service.countDocuments(filter as any);

      expect(repo.count).toHaveBeenCalledWith(filter);
    });
  });

  describe('updateById (collection contract)', () => {
    it('delegates to repo.update', async () => {
      const updated = makeUser({ account_enabled: false });
      vi.mocked(repo.update).mockResolvedValue(updated);

      const result = await service.updateById('user-123', {
        account_enabled: false,
      } as any);

      expect(repo.update).toHaveBeenCalledWith('user-123', {
        account_enabled: false,
      });
      expect(result).toEqual(updated);
    });

    it.each(['User not found', 'Document not found: user-123'])(
      'normalizes a missing repository record from %s',
      async message => {
        vi.mocked(repo.update).mockRejectedValueOnce(new Error(message));

        await expect(
          service.updateById('user-123', { account_enabled: false })
        ).resolves.toBeNull();
      }
    );

    it('propagates non-not-found repository failures', async () => {
      const error = new Error('database unavailable');
      vi.mocked(repo.update).mockRejectedValueOnce(error);

      await expect(
        service.updateById('user-123', { account_enabled: false })
      ).rejects.toBe(error);
    });

    it('accepts configured roles before delegating to every repository adapter', async () => {
      const updated = makeUser({ roles: ['admin'] });
      vi.mocked(repo.update).mockResolvedValueOnce(updated);

      await expect(
        service.updateById('user-123', { roles: ['admin'] })
      ).resolves.toBe(updated);
      expect(repo.update).toHaveBeenCalledWith('user-123', {
        roles: ['admin'],
      });
    });

    it('rejects unavailable roles before delegating to a repository adapter', async () => {
      await expect(
        service.updateById('user-123', { roles: ['unconfigured-role'] })
      ).rejects.toThrow("Role 'unconfigured-role' is not available");
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('findWithPagination (collection contract)', () => {
    it('delegates to repo.findMany and reshapes result', async () => {
      const users = [makeUser()];
      vi.mocked(repo.findMany).mockResolvedValue({
        results: users,
        totalResults: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });

      const result = await service.findWithPagination({} as any, {
        page: 1,
        limit: 10,
      });

      expect(repo.findMany).toHaveBeenCalled();
      expect(result.results).toEqual(users);
      expect(result.totalResults).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('createOne (collection contract)', () => {
    it('delegates to repo.create', async () => {
      const newUser = makeUser();
      vi.mocked(repo.create).mockResolvedValue(newUser);

      const result = await service.createOne({
        email: 'bob@example.com',
      } as any);

      expect(repo.create).toHaveBeenCalledWith({ email: 'bob@example.com' });
      expect(result).toEqual(newUser);
    });

    it('creates every user in a batch and preserves result ordering', async () => {
      const alice = makeUser({ _id: 'alice', username: 'alice' });
      const bob = makeUser({ _id: 'bob', username: 'bob' });
      vi.mocked(repo.create)
        .mockResolvedValueOnce(alice)
        .mockResolvedValueOnce(bob);

      await expect(
        service.createMany([{ username: 'alice' }, { username: 'bob' }])
      ).resolves.toEqual([alice, bob]);
      expect(repo.create).toHaveBeenNthCalledWith(1, { username: 'alice' });
      expect(repo.create).toHaveBeenNthCalledWith(2, { username: 'bob' });
    });

    it('returns an empty batch without writing', async () => {
      await expect(service.createMany([])).resolves.toEqual([]);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('findMany (collection contract)', () => {
    it('delegates raw query options including an arbitrary skip', async () => {
      const users = [makeUser()];
      const findManyRaw = vi.fn().mockResolvedValue(users);
      Object.assign(repo, { findManyRaw });

      await expect(
        service.findMany(
          { account_enabled: true },
          { limit: 25, skip: 7, sort: { username: 'asc' } }
        )
      ).resolves.toEqual(users);
      expect(findManyRaw).toHaveBeenCalledWith(
        { account_enabled: true },
        { limit: 25, skip: 7, sort: { username: 'asc' } }
      );
      expect(repo.findMany).not.toHaveBeenCalled();
    });

    it('does not invent a limit for an unbounded raw query', async () => {
      const findManyRaw = vi.fn().mockResolvedValue([]);
      Object.assign(repo, { findManyRaw });

      await expect(service.findMany()).resolves.toEqual([]);
      expect(findManyRaw).toHaveBeenCalledWith({}, {});
    });
  });

  describe('deleteOne (collection contract)', () => {
    it('returns and deletes a user found by ID', async () => {
      const user = makeUser();
      vi.mocked(repo.findById).mockResolvedValueOnce(user);

      await expect(service.deleteOne('user-123')).resolves.toEqual(user);
      expect(repo.delete).toHaveBeenCalledWith('user-123');
    });

    it('returns null without deleting when an ID is absent', async () => {
      vi.mocked(repo.findById).mockResolvedValueOnce(null);

      await expect(service.deleteOne('missing')).resolves.toBeNull();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('returns and deletes a user found by filter', async () => {
      const user = makeUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);

      await expect(
        service.deleteOne({ email: 'alice@example.com' })
      ).resolves.toEqual(user);
      expect(repo.delete).toHaveBeenCalledWith('user-123');
    });

    it('returns null without deleting when a filter has no match', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(null);

      await expect(
        service.deleteOne({ email: 'missing@example.com' })
      ).resolves.toBeNull();
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('standard user lookups', () => {
    const cases = [
      {
        name: 'username',
        invoke: (service: UserService) => service.findByUsername('alice'),
        filter: { username: 'alice', account_enabled: true },
        context: 'error_finding_user_by_username',
      },
      {
        name: 'phone number',
        invoke: (service: UserService) => service.findByPhoneNumber('+22901'),
        filter: { phone_number: '+22901', account_enabled: true },
        context: 'error_finding_user_by_phone_number',
      },
      {
        name: 'email including disabled',
        invoke: (service: UserService) =>
          service.findByEmailIncludingDisabled('alice@example.com'),
        filter: { email: 'alice@example.com' },
        context: 'error_finding_user_by_email_including_disabled',
      },
      {
        name: 'username including disabled',
        invoke: (service: UserService) =>
          service.findByUsernameIncludingDisabled('alice'),
        filter: { username: 'alice' },
        context: 'error_finding_user_by_username_including_disabled',
      },
      {
        name: 'phone including disabled',
        invoke: (service: UserService) =>
          service.findByPhoneNumberIncludingDisabled('+22901'),
        filter: { phone_number: '+22901' },
        context: 'error_finding_user_by_phone_number_including_disabled',
      },
    ];

    it.each(cases)('returns a $name match', async ({ invoke, filter }) => {
      const user = makeUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);

      await expect(invoke(service)).resolves.toEqual(user);
      expect(repo.findOne).toHaveBeenCalledWith(filter);
    });

    it.each(cases)(
      'returns undefined for an absent $name',
      async ({ invoke }) => {
        vi.mocked(repo.findOne).mockResolvedValueOnce(null);
        await expect(invoke(service)).resolves.toBeUndefined();
      }
    );

    it.each(cases)(
      'logs and propagates a $name repository failure',
      async ({ invoke, context }) => {
        const error = new Error('lookup failed');
        vi.mocked(repo.findOne).mockRejectedValueOnce(error);

        await expect(invoke(service)).rejects.toBe(error);
        expect(mockLogger.error).toHaveBeenCalledWith(
          error,
          expect.objectContaining({ context })
        );
      }
    );

    it('returns undefined and propagates errors for ID lookups', async () => {
      vi.mocked(repo.findById).mockResolvedValueOnce(null);
      await expect(service.findById('missing')).resolves.toBeUndefined();

      const error = new Error('lookup failed');
      vi.mocked(repo.findById).mockRejectedValueOnce(error);
      await expect(service.findById('broken')).rejects.toBe(error);
      expect(mockLogger.error).toHaveBeenCalledWith(error, {
        context: 'error_finding_user_by_id',
        id: 'broken',
      });
    });

    it('logs and propagates an email lookup failure', async () => {
      const error = new Error('lookup failed');
      vi.mocked(repo.findOne).mockRejectedValueOnce(error);

      await expect(service.findByEmail('alice@example.com')).rejects.toBe(
        error
      );
      expect(mockLogger.error).toHaveBeenCalledWith(error, {
        context: 'error_finding_user_by_email',
        email: 'alice@example.com',
      });
    });
  });

  describe('uniqueness checks', () => {
    const cases = [
      {
        name: 'email',
        invoke: (service: UserService) => service.isEmailTaken('a@example.com'),
        filter: { email: 'a@example.com' },
        context: 'isEmailTaken',
      },
      {
        name: 'phone number',
        invoke: (service: UserService) => service.isPhoneNumberTaken('+22901'),
        filter: { phone_number: '+22901' },
        context: 'isPhoneNumberTaken',
      },
      {
        name: 'username',
        invoke: (service: UserService) => service.isUserNameTaken('alice'),
        filter: { username: 'alice' },
        context: 'isUserNameTaken',
      },
    ];

    it.each(cases)('reports a taken $name', async ({ invoke, filter }) => {
      vi.mocked(repo.count).mockResolvedValueOnce(1);
      await expect(invoke(service)).resolves.toBe(true);
      expect(repo.count).toHaveBeenCalledWith(filter);
    });

    it.each(cases)('reports an available $name', async ({ invoke }) => {
      vi.mocked(repo.count).mockResolvedValueOnce(0);
      await expect(invoke(service)).resolves.toBe(false);
    });

    it.each(cases)(
      'fails closed to available for a $name lookup error',
      async ({ invoke, context }) => {
        vi.mocked(repo.count).mockRejectedValueOnce(new Error('count failed'));
        await expect(invoke(service)).resolves.toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({ context })
        );
      }
    );
  });

  describe('updateUserLastLoginDate', () => {
    it('updates a user selected by username', async () => {
      const user = makeUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(repo.update).mockResolvedValueOnce(user);

      await expect(
        service.updateUserLastLoginDate('ignored-id', 'alice')
      ).resolves.toEqual(user);
      expect(repo.findOne).toHaveBeenCalledWith({ username: 'alice' });
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('user-123', {
        last_login: expect.any(Date),
      });
    });

    it('updates a user selected by ID when username is absent', async () => {
      const user = makeUser();
      vi.mocked(repo.findById).mockResolvedValueOnce(user);
      vi.mocked(repo.update).mockResolvedValueOnce(user);

      await expect(
        service.updateUserLastLoginDate('user-123', '')
      ).resolves.toEqual(user);
      expect(repo.findById).toHaveBeenCalledWith('user-123');
    });

    it.each([
      ['', '', 'Either user ID or username is required'],
      ['missing', '', 'User not found'],
    ])(
      'rejects invalid or missing lookup %#',
      async (id, username, message) => {
        vi.mocked(repo.findById).mockResolvedValueOnce(null);
        await expect(
          service.updateUserLastLoginDate(id, username)
        ).rejects.toThrow(message);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            context: 'error_updating_user_last_login_date',
          })
        );
      }
    );
  });
});

describe('UserService — Custom Identifiers', () => {
  let repo: IUserPersistenceRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
  });

  describe('getCustomIdentifierFields', () => {
    it('returns [] when feature is disabled', () => {
      const fields = [makeFieldConfig()];
      const service = makeServiceWithCI(repo, fields, /* enabled */ false);
      expect(service.getCustomIdentifierFields()).toEqual([]);
    });

    it('returns configured fields when enabled', () => {
      const fields = [
        makeFieldConfig({ slot: 1, key: 'employee_id' }),
        makeFieldConfig({ slot: 2, key: 'badge_id' }),
      ];
      const service = makeServiceWithCI(repo, fields);
      expect(service.getCustomIdentifierFields()).toEqual(fields);
    });
  });

  describe('getCustomIdentifierFieldByKey', () => {
    it('finds the field by key', () => {
      const fields = [
        makeFieldConfig({ slot: 1, key: 'employee_id' }),
        makeFieldConfig({ slot: 2, key: 'badge_id' }),
      ];
      const service = makeServiceWithCI(repo, fields);
      const found = service.getCustomIdentifierFieldByKey('badge_id');
      expect(found?.slot).toBe(2);
    });

    it('returns undefined for unknown key', () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      expect(service.getCustomIdentifierFieldByKey('nope')).toBeUndefined();
    });
  });

  describe('getCustomIdentifierFieldBySlot', () => {
    it('finds the field by slot', () => {
      const fields = [
        makeFieldConfig({ slot: 1, key: 'employee_id' }),
        makeFieldConfig({ slot: 3, key: 'student_id' }),
      ];
      const service = makeServiceWithCI(repo, fields);
      expect(service.getCustomIdentifierFieldBySlot(3)?.key).toBe('student_id');
    });

    it('returns undefined for an unconfigured slot', () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig({ slot: 1 })]);
      expect(service.getCustomIdentifierFieldBySlot(2)).toBeUndefined();
    });
  });

  describe('findByCustomIdentifier', () => {
    it('queries the slot-specific column', async () => {
      const service = makeServiceWithCI(repo, [
        makeFieldConfig({ slot: 2, key: 'badge_id', case_sensitive: true }),
      ]);
      const user = makeUser({ custom_identifier_2: 'BADGE-9' } as any);
      vi.mocked(repo.findOne).mockResolvedValue(user);

      const result = await service.findByCustomIdentifier(2, 'BADGE-9');

      expect(repo.findOne).toHaveBeenCalledWith({
        custom_identifier_2: 'BADGE-9',
        account_enabled: true,
      });
      expect(result).toEqual(user);
    });

    it('lowercases the value when the field is case-insensitive', async () => {
      const service = makeServiceWithCI(repo, [
        makeFieldConfig({ slot: 1, case_sensitive: false }),
      ]);
      vi.mocked(repo.findOne).mockResolvedValue(null);

      await service.findByCustomIdentifier(1, '  EMP-001  ');

      expect(repo.findOne).toHaveBeenCalledWith({
        custom_identifier_1: 'emp-001',
        account_enabled: true,
      });
    });

    it('preserves case when the field is case-sensitive', async () => {
      const service = makeServiceWithCI(repo, [
        makeFieldConfig({ slot: 1, case_sensitive: true }),
      ]);
      vi.mocked(repo.findOne).mockResolvedValue(null);

      await service.findByCustomIdentifier(1, '  EMP-001  ');

      expect(repo.findOne).toHaveBeenCalledWith({
        custom_identifier_1: 'EMP-001',
        account_enabled: true,
      });
    });

    it('returns undefined when no user is found', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      vi.mocked(repo.findOne).mockResolvedValue(null);
      const result = await service.findByCustomIdentifier(1, 'foo');
      expect(result).toBeUndefined();
    });

    it('rethrows repository errors after logging', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      vi.mocked(repo.findOne).mockRejectedValue(new Error('db down'));
      await expect(service.findByCustomIdentifier(1, 'foo')).rejects.toThrow(
        'db down'
      );
    });
  });

  describe('isCustomIdentifierAvailable', () => {
    it('returns true when count is 0', async () => {
      const service = makeServiceWithCI(repo, [
        makeFieldConfig({ slot: 1, case_sensitive: false }),
      ]);
      vi.mocked(repo.count).mockResolvedValue(0);

      const ok = await service.isCustomIdentifierAvailable(1, 'EMP-001');
      expect(ok).toBe(true);
      expect(repo.count).toHaveBeenCalledWith({
        custom_identifier_1: 'emp-001',
      });
    });

    it('returns false when count > 0', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      vi.mocked(repo.count).mockResolvedValue(1);
      expect(await service.isCustomIdentifierAvailable(1, 'foo')).toBe(false);
    });

    it.each([
      [null, true],
      [makeUser({ _id: 'user-self', id: 'user-self' }), true],
      [makeUser({ _id: 'user-other', id: 'user-other' }), false],
    ])(
      'compares an excluded user ID without database-specific operators %#',
      async (existing, expected) => {
        const service = makeServiceWithCI(repo, [
          makeFieldConfig({ slot: 3, case_sensitive: true }),
        ]);
        vi.mocked(repo.findOne).mockResolvedValueOnce(existing);

        await expect(
          service.isCustomIdentifierAvailable(3, 'X', 'user-self')
        ).resolves.toBe(expected);

        expect(repo.findOne).toHaveBeenCalledWith({
          custom_identifier_3: 'X',
        });
        expect(repo.count).not.toHaveBeenCalled();
      }
    );

    it('returns false (silent failure) when the repository throws', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      vi.mocked(repo.count).mockRejectedValue(new Error('boom'));
      expect(await service.isCustomIdentifierAvailable(1, 'foo')).toBe(false);
    });
  });

  describe('setCustomIdentifier', () => {
    it('updates the slot-specific column', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig({ slot: 2 })]);
      const updated = makeUser({ custom_identifier_2: 'X' } as any);
      vi.mocked(repo.update).mockResolvedValue(updated);

      const result = await service.setCustomIdentifier('user-1', 2, 'X');

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        custom_identifier_2: 'X',
      });
      expect(result).toEqual(updated);
    });

    it('throws when the user is not found', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      vi.mocked(repo.update).mockResolvedValue(null as never);
      await expect(
        service.setCustomIdentifier('missing', 1, 'X')
      ).rejects.toThrow('User not found');
    });
  });

  describe('removeCustomIdentifier', () => {
    it('clears the slot-specific column to null', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig({ slot: 3 })]);
      const updated = makeUser();
      vi.mocked(repo.update).mockResolvedValue(updated);

      await service.removeCustomIdentifier('user-1', 3);

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        custom_identifier_3: null,
      });
    });

    it('throws when the user is not found', async () => {
      const service = makeServiceWithCI(repo, [makeFieldConfig()]);
      vi.mocked(repo.update).mockResolvedValue(null as never);
      await expect(
        service.removeCustomIdentifier('missing', 1)
      ).rejects.toThrow('User not found');
    });
  });

  describe('getCustomIdentifier', () => {
    const service = (() => {
      const r = makeMockRepo();
      return makeServiceWithCI(r, [makeFieldConfig()]);
    })();

    it('returns the value from the matching slot column', () => {
      const user = makeUser({
        custom_identifier_1: 'A',
        custom_identifier_2: 'B',
        custom_identifier_3: 'C',
      } as any);

      expect(service.getCustomIdentifier(user, 1)).toBe('A');
      expect(service.getCustomIdentifier(user, 2)).toBe('B');
      expect(service.getCustomIdentifier(user, 3)).toBe('C');
    });

    it('returns undefined when the slot is unset', () => {
      const user = makeUser();
      expect(service.getCustomIdentifier(user, 1)).toBeUndefined();
    });
  });
});

describe('UserService — MFA behavior', () => {
  let repo: IUserPersistenceRepository;
  let service: UserService;
  const expires = new Date('2030-01-01T00:00:00.000Z');

  const mfaUser = (overrides: Partial<IUser> = {}) =>
    makeUser({
      mfa: {
        enabled: true,
        methods: {
          totp: {
            enabled: true,
            secret: 'decrypted-secret',
          },
        },
        email_otp: { hash: 'stored-hash', expires },
      },
      ...overrides,
    });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(encryptValue).mockImplementation(
      (value: string) => `encrypted:${value}`
    );
    repo = makeMockRepo();
    service = makeService(repo);
    vi.mocked(mockMfaUtils.validateTotpCodeFormat).mockReturnValue({
      valid: true,
      sanitized: '123456',
    });
  });

  describe('verifyTotp', () => {
    it('verifies a sanitized code for an enabled username', async () => {
      const user = mfaUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(mockMfaUtils.isTotpEnabled).mockReturnValueOnce(true);
      vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce(
        'decrypted-secret'
      );
      vi.mocked(mockMfaUtils.verifyTotpCode).mockReturnValueOnce({
        valid: true,
      });

      await expect(service.verifyTotp('alice', ' 123 456 ')).resolves.toBe(
        true
      );
      expect(mockMfaUtils.verifyTotpCode).toHaveBeenCalledWith(
        '123456',
        'decrypted-secret'
      );
    });

    it('falls back to an object-ID lookup when username lookup misses', async () => {
      const id = '507f1f77bcf86cd799439011';
      const user = mfaUser({ _id: id, id });
      vi.mocked(repo.findOne).mockResolvedValueOnce(null);
      vi.mocked(repo.findById).mockResolvedValueOnce(user);
      vi.mocked(mockMfaUtils.isTotpEnabled).mockReturnValueOnce(true);
      vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce('secret');
      vi.mocked(mockMfaUtils.verifyTotpCode).mockReturnValueOnce({
        valid: true,
      });

      await expect(service.verifyTotp(id, '123456')).resolves.toBe(true);
      expect(repo.findById).toHaveBeenCalledWith(id);
    });

    it('does not use an ID lookup for a non-object-ID identifier', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(null);

      await expect(service.verifyTotp('missing', '123456')).resolves.toBe(
        false
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('rejects a user whose TOTP method is disabled', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
      vi.mocked(mockMfaUtils.isTotpEnabled).mockReturnValueOnce(false);

      await expect(service.verifyTotp('alice', '123456')).resolves.toBe(false);
      expect(mockMfaUtils.getUserTotpSecret).not.toHaveBeenCalled();
    });

    it('rejects a user whose TOTP secret is missing', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
      vi.mocked(mockMfaUtils.isTotpEnabled).mockReturnValueOnce(true);
      vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce(undefined);

      await expect(service.verifyTotp('alice', '123456')).resolves.toBe(false);
    });

    it.each([
      [{ valid: false, error: 'bad code' }, true],
      [{ valid: false }, false],
    ])(
      'returns an invalid verifier result and conditionally logs %#',
      async (result, logs) => {
        vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
        vi.mocked(mockMfaUtils.isTotpEnabled).mockReturnValueOnce(true);
        vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce('secret');
        vi.mocked(mockMfaUtils.verifyTotpCode).mockReturnValueOnce(result);

        await expect(service.verifyTotp('alice', '123456')).resolves.toBe(
          false
        );
        expect(mockLogger.error).toHaveBeenCalledTimes(logs ? 1 : 0);
      }
    );

    it.each([
      [{ valid: false, error: 'Malformed code' }, 'Malformed code'],
      [{ valid: false }, 'Invalid TOTP code format'],
    ])(
      'normalizes TOTP format validation failures %#',
      async (validation, message) => {
        vi.mocked(mockMfaUtils.validateTotpCodeFormat).mockReturnValueOnce(
          validation
        );

        await expect(service.verifyTotp('alice', 'bad')).resolves.toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ message }),
          expect.objectContaining({ context: 'error_in_verifyTotp' })
        );
      }
    );
  });

  describe.each([
    {
      name: 'enableMfaTotp',
      invoke: (service: UserService, secret: string) =>
        service.enableMfaTotp('alice', secret),
      enabled: true,
      context: 'error_enabling_mfa_totp',
    },
    {
      name: 'initiateMfaTotpSetup',
      invoke: (service: UserService, secret: string) =>
        service.initiateMfaTotpSetup('alice', secret),
      enabled: false,
      context: 'error_initiating_mfa_totp_setup',
    },
  ])('$name', ({ invoke, enabled, context }) => {
    it('encrypts and persists a valid base32 secret', async () => {
      const user = makeUser();
      const updated = mfaUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(repo.findById).mockResolvedValueOnce(updated);

      await expect(invoke(service, 'JBSWY3DPEHPK3PXP')).resolves.toEqual(
        updated
      );
      expect(encryptValue).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
      expect(repo.updateMfa).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          'methods.totp': expect.objectContaining({
            enabled,
            secret: 'encrypted:JBSWY3DPEHPK3PXP',
          }),
        })
      );
    });

    it.each([[''], ['   '], [null as unknown as string]])(
      'rejects a missing secret %#',
      async secret => {
        await expect(invoke(service, secret)).rejects.toThrow(
          'TOTP secret is required'
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({ context })
        );
      }
    );

    it('rejects a missing user', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(null);
      await expect(invoke(service, 'JBSWY3DP')).rejects.toThrow(
        'User not found'
      );
    });

    it('rejects a non-base32 secret', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(makeUser());
      await expect(invoke(service, 'not-base32!')).rejects.toThrow(
        'Invalid TOTP secret format'
      );
    });

    it('rejects when the updated user cannot be reloaded', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(makeUser());
      vi.mocked(repo.findById).mockResolvedValueOnce(null);
      await expect(invoke(service, 'JBSWY3DP')).rejects.toThrow(
        'Failed to update user'
      );
    });
  });

  describe('verifyTotpSetupCode', () => {
    it('verifies a pending setup code', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
      vi.mocked(mockMfaUtils.isTotpPendingSetup).mockReturnValueOnce(true);
      vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce('secret');
      vi.mocked(mockMfaUtils.verifyTotpCode).mockReturnValueOnce({
        valid: true,
      });

      await expect(
        service.verifyTotpSetupCode('alice', '123456')
      ).resolves.toBe(true);
    });

    it.each([
      ['missing user', null, true, 'secret'],
      ['no pending setup', mfaUser(), false, 'secret'],
      ['missing secret', mfaUser(), true, undefined],
    ])('returns false for $0', async (_name, user, pending, secret) => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(mockMfaUtils.isTotpPendingSetup).mockReturnValueOnce(pending);
      vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce(secret);

      await expect(
        service.verifyTotpSetupCode('alice', '123456')
      ).resolves.toBe(false);
    });

    it.each([
      [{ valid: false, error: 'bad setup code' }, true],
      [{ valid: false }, false],
    ])(
      'returns an invalid setup result and conditionally logs %#',
      async (result, logs) => {
        vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
        vi.mocked(mockMfaUtils.isTotpPendingSetup).mockReturnValueOnce(true);
        vi.mocked(mockMfaUtils.getUserTotpSecret).mockReturnValueOnce('secret');
        vi.mocked(mockMfaUtils.verifyTotpCode).mockReturnValueOnce(result);

        await expect(
          service.verifyTotpSetupCode('alice', '123456')
        ).resolves.toBe(false);
        expect(mockLogger.error).toHaveBeenCalledTimes(logs ? 1 : 0);
      }
    );
  });

  describe('email MFA setup and verification', () => {
    it('enables email MFA and reloads the user', async () => {
      const updated = mfaUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(makeUser());
      vi.mocked(repo.findById).mockResolvedValueOnce(updated);

      await expect(service.enableMfaEmail('alice')).resolves.toEqual(updated);
      expect(repo.updateMfa).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          enabled: true,
          'methods.email': expect.objectContaining({
            enabled: true,
            verified_at: expect.any(Date),
          }),
        })
      );
    });

    it.each([
      ['missing user', null, null, 'User not found'],
      ['missing reload', makeUser(), null, 'Failed to update user'],
    ])(
      'rejects enableMfaEmail for $0',
      async (_name, user, updated, message) => {
        vi.mocked(repo.findOne).mockResolvedValueOnce(user);
        vi.mocked(repo.findById).mockResolvedValueOnce(updated);
        await expect(service.enableMfaEmail('alice')).rejects.toThrow(message);
      }
    );

    it('initiates setup with the default TTL and stores the OTP', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(makeUser());
      vi.mocked(mockMfaUtils.generateEmailOtp).mockReturnValueOnce({
        code: '123456',
        hash: 'otp-hash',
        expiresAt: expires,
      });

      await expect(service.initiateEmailMfaSetup('alice')).resolves.toEqual({
        code: '123456',
        expiresAt: expires,
      });
      expect(mockMfaUtils.generateEmailOtp).toHaveBeenCalledWith(600);
      expect(repo.setEmailOtp).toHaveBeenCalledWith('user-123', {
        hash: 'otp-hash',
        expires,
      });
    });

    it('rejects setup for a missing user', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(null);
      await expect(
        service.initiateEmailMfaSetup('missing', 60)
      ).rejects.toThrow('User not found');
    });

    it.each([[''], ['   '], [null as unknown as string]])(
      'rejects a missing setup verification code %#',
      async code => {
        await expect(
          service.verifyEmailMfaSetupCode('alice', code)
        ).resolves.toBe(false);
        expect(repo.findOne).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['missing user', null, true],
      ['not pending', mfaUser(), false],
    ])('rejects setup verification for $0', async (_name, user, pending) => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(mockMfaUtils.isEmailMfaPendingSetup).mockReturnValueOnce(
        pending
      );
      await expect(
        service.verifyEmailMfaSetupCode('alice', '123456')
      ).resolves.toBe(false);
    });

    it('rejects an invalid setup OTP', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
      vi.mocked(mockMfaUtils.isEmailMfaPendingSetup).mockReturnValueOnce(true);
      vi.mocked(mockMfaUtils.verifyEmailOtp).mockReturnValueOnce({
        valid: false,
        error: 'invalid',
      });

      await expect(
        service.verifyEmailMfaSetupCode('alice', ' 123456 ')
      ).resolves.toBe(false);
      expect(mockMfaUtils.verifyEmailOtp).toHaveBeenCalledWith(
        '123456',
        'stored-hash',
        expires
      );
    });

    it.each([
      [false, true],
      [true, false],
    ])(
      'requires successful OTP clearing after valid setup %#',
      async (clearFails, expected) => {
        vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
        vi.mocked(mockMfaUtils.isEmailMfaPendingSetup).mockReturnValueOnce(
          true
        );
        vi.mocked(mockMfaUtils.verifyEmailOtp).mockReturnValueOnce({
          valid: true,
        });
        if (clearFails) {
          vi.mocked(repo.clearEmailOtp).mockRejectedValueOnce(
            new Error('clear failed')
          );
        }

        await expect(
          service.verifyEmailMfaSetupCode('alice', '123456')
        ).resolves.toBe(expected);
      }
    );
  });

  describe('disableMfa', () => {
    it.each([
      ['totp', { enabled: true, 'methods.totp': { enabled: false } }],
      ['email', { enabled: true, 'methods.email': { enabled: false } }],
      ['webauthn', { enabled: true, 'methods.webauthn': { enabled: false } }],
    ] as const)(
      'disables only %s while preserving another enabled method',
      async (method, update) => {
        const user = mfaUser();
        vi.mocked(repo.findOne).mockResolvedValueOnce(user);
        vi.mocked(mockMfaUtils.hasAnyMethodEnabled).mockReturnValueOnce(true);
        vi.mocked(repo.findById).mockResolvedValueOnce(user);

        await expect(service.disableMfa('alice', method)).resolves.toEqual(
          user
        );
        expect(repo.updateMfa).toHaveBeenCalledWith('user-123', update);
      }
    );

    it('disables all methods when no method is selected', async () => {
      const user = mfaUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(repo.findById).mockResolvedValueOnce(user);

      await service.disableMfa('alice');
      expect(repo.updateMfa).toHaveBeenCalledWith('user-123', {
        enabled: false,
        'methods.totp': { enabled: false },
        'methods.email': { enabled: false },
        'methods.webauthn': { enabled: false },
      });
    });

    it.each([
      ['missing user', null, null, 'User not found'],
      ['missing reload', mfaUser(), null, 'Failed to update user'],
    ])('rejects for $0', async (_name, user, updated, message) => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(repo.findById).mockResolvedValueOnce(updated);
      await expect(service.disableMfa('alice', 'totp')).rejects.toThrow(
        message
      );
    });
  });

  describe('setEmailOtp and verifyEmailOtp', () => {
    it.each([[''], ['   '], [null as unknown as string]])(
      'rejects a missing OTP code %#',
      async code => {
        await expect(service.setEmailOtp('alice', code, 60)).rejects.toThrow(
          'OTP code is required'
        );
      }
    );

    it('rejects setting an OTP for a missing user', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(null);
      await expect(
        service.setEmailOtp('missing', '123456', 60)
      ).rejects.toThrow('User not found');
    });

    it('stores the generated OTP data when the supplied code matches', async () => {
      const user = mfaUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(mockMfaUtils.generateEmailOtp).mockReturnValueOnce({
        code: '123456',
        hash: 'generated-hash',
        expiresAt: expires,
      });
      vi.mocked(repo.findById).mockResolvedValueOnce(user);

      await expect(
        service.setEmailOtp('alice', ' 123456 ', 60)
      ).resolves.toEqual(user);
      expect(repo.setEmailOtp).toHaveBeenCalledWith('user-123', {
        hash: 'generated-hash',
        expires,
      });
    });

    it('hashes a caller-supplied OTP and computes its expiry', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2029-01-01T00:00:00.000Z'));
      const user = mfaUser();
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      vi.mocked(mockMfaUtils.generateEmailOtp).mockReturnValueOnce({
        code: '654321',
        hash: 'unused',
        expiresAt: expires,
      });
      vi.mocked(repo.findById).mockResolvedValueOnce(user);

      await service.setEmailOtp('alice', ' 123456 ', 60);
      expect(repo.setEmailOtp).toHaveBeenCalledWith('user-123', {
        hash: crypto.createHash('sha256').update('123456').digest('hex'),
        expires: new Date('2029-01-01T00:01:00.000Z'),
      });
      vi.useRealTimers();
    });

    it('rejects when an OTP update cannot be reloaded', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(makeUser());
      vi.mocked(mockMfaUtils.generateEmailOtp).mockReturnValueOnce({
        code: '123456',
        hash: 'hash',
        expiresAt: expires,
      });
      vi.mocked(repo.findById).mockResolvedValueOnce(null);
      await expect(service.setEmailOtp('alice', '123456', 60)).rejects.toThrow(
        'Failed to update user'
      );
    });

    it.each([[''], ['   '], [null as unknown as string]])(
      'returns false for a missing verification code %#',
      async code => {
        await expect(service.verifyEmailOtp('alice', code)).resolves.toBe(
          false
        );
      }
    );

    it.each([
      ['missing user', null],
      ['missing MFA', makeUser({ mfa: undefined })],
      ['missing OTP', makeUser({ mfa: { enabled: true, methods: {} } })],
    ])('returns false for $0', async (_name, user) => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(user);
      await expect(service.verifyEmailOtp('alice', '123456')).resolves.toBe(
        false
      );
    });

    it('returns false for an invalid OTP', async () => {
      vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
      vi.mocked(mockMfaUtils.verifyEmailOtp).mockReturnValueOnce({
        valid: false,
        error: 'invalid',
      });
      await expect(service.verifyEmailOtp('alice', ' 123456 ')).resolves.toBe(
        false
      );
    });

    it.each([
      [false, true],
      [true, false],
    ])(
      'requires successful OTP clearing after verification %#',
      async (clearFails, expected) => {
        vi.mocked(repo.findOne).mockResolvedValueOnce(mfaUser());
        vi.mocked(mockMfaUtils.verifyEmailOtp).mockReturnValueOnce({
          valid: true,
        });
        if (clearFails) {
          vi.mocked(repo.clearEmailOtp).mockRejectedValueOnce(
            new Error('clear failed')
          );
        }

        await expect(service.verifyEmailOtp('alice', '123456')).resolves.toBe(
          expected
        );
      }
    );

    it('normalizes lookup failures to false', async () => {
      vi.mocked(repo.findOne).mockRejectedValueOnce(new Error('lookup failed'));
      await expect(service.verifyEmailOtp('alice', '123456')).resolves.toBe(
        false
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'error_verifying_email_otp' })
      );
    });
  });
});

describe('UserService — profile and credentials', () => {
  let repo: IUserPersistenceRepository;
  let service: UserService;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  describe('updateProfile', () => {
    it('trims supported fields and preserves boolean UI preferences', async () => {
      const updated = makeUser({
        given_name: 'Alice',
        phone_number: '+229 01 23 45 67',
        sidebar_expanded: true,
      });
      vi.mocked(repo.update).mockResolvedValueOnce(updated);

      await expect(
        service.updateProfile('user-123', {
          given_name: ' Alice ',
          family_name: ' Example ',
          name: ' Alice Example ',
          phone_number: ' +229 01 23 45 67 ',
          picture: ' /avatar.png ',
          locale: ' fr ',
          country: ' BJ ',
          zoneinfo: ' Africa/Porto-Novo ',
          city: ' Cotonou ',
          address: ' Address ',
          street_address: ' Street ',
          region: ' Littoral ',
          postal_code: ' 01BP ',
          theme: 'dark',
          sidebar_expanded: true,
        })
      ).resolves.toBe(updated);

      expect(repo.update).toHaveBeenCalledWith('user-123', {
        given_name: 'Alice',
        family_name: 'Example',
        name: 'Alice Example',
        phone_number: '+229 01 23 45 67',
        picture: '/avatar.png',
        locale: 'fr',
        country: 'BJ',
        zoneinfo: 'Africa/Porto-Novo',
        city: 'Cotonou',
        address: 'Address',
        street_address: 'Street',
        region: 'Littoral',
        postal_code: '01BP',
        theme: 'dark',
        sidebar_expanded: true,
      });
    });

    it('ignores empty, non-string, and unsupported optional values', async () => {
      const updated = makeUser();
      vi.mocked(repo.update).mockResolvedValueOnce(updated);

      await service.updateProfile('user-123', {
        given_name: ' ',
        family_name: 42 as unknown as string,
        name: '',
        phone_number: '',
        picture: 42 as unknown as string,
        locale: ' ',
        theme: 'system' as 'light',
      });

      expect(repo.update).toHaveBeenCalledWith('user-123', {});
    });

    it('rejects an invalid phone number before persistence', async () => {
      await expect(
        service.updateProfile('user-123', { phone_number: '+229 ext. ABC' })
      ).rejects.toThrow('Invalid phone number format');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects when the repository cannot return an updated user', async () => {
      vi.mocked(repo.update).mockResolvedValueOnce(null as unknown as IUser);
      await expect(service.updateProfile('missing', {})).rejects.toThrow(
        'User not found'
      );
    });

    it('logs and rethrows persistence failures', async () => {
      const failure = new Error('write failed');
      vi.mocked(repo.update).mockRejectedValueOnce(failure);
      await expect(service.updateProfile('user-123', {})).rejects.toBe(failure);
      expect(mockLogger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ context: 'error_updating_user_profile' })
      );
    });
  });

  describe('profile-related updates', () => {
    it('updates notification preferences without reshaping values', async () => {
      const updated = makeUser();
      vi.mocked(repo.update).mockResolvedValueOnce(updated);
      const preferences = {
        preferred_channel: 'sms' as const,
        security_alerts: true,
        new_session_alerts: false,
        marketing: false,
      };

      await expect(
        service.updateNotificationPreferences('user-123', preferences)
      ).resolves.toBe(updated);
      expect(repo.update).toHaveBeenCalledWith('user-123', {
        notification_preferences: preferences,
      });
    });

    it('logs and rethrows notification persistence failures', async () => {
      const failure = new Error('write failed');
      vi.mocked(repo.update).mockRejectedValueOnce(failure);
      await expect(
        service.updateNotificationPreferences('user-123', {
          preferred_channel: 'email',
          security_alerts: true,
          new_session_alerts: true,
          marketing: false,
        })
      ).rejects.toBe(failure);
    });

    it('returns null for not-found assignment errors', async () => {
      vi.mocked(repo.update).mockRejectedValueOnce(
        new Error('Document not found: user-123')
      );
      await expect(
        service.updateWithAssignment('user-123', { locale: 'fr' })
      ).resolves.toBeNull();
    });

    it('rethrows unrelated assignment errors', async () => {
      const failure = new Error('connection failed');
      vi.mocked(repo.update).mockRejectedValueOnce(failure);
      await expect(service.updateWithAssignment('user-123', {})).rejects.toBe(
        failure
      );
    });

    it.each([[''], ['   '], [null as unknown as string]])(
      'rejects a missing avatar path %#',
      async avatarPath => {
        await expect(
          service.updateAvatar('user-123', avatarPath)
        ).rejects.toThrow('Avatar path is required');
      }
    );

    it('updates and trims an avatar path', async () => {
      const updated = makeUser({ picture: '/avatar.png' });
      vi.mocked(repo.update).mockResolvedValueOnce(updated);
      await expect(
        service.updateAvatar('user-123', ' /avatar.png ')
      ).resolves.toBe(updated);
      expect(repo.update).toHaveBeenCalledWith('user-123', {
        picture: '/avatar.png',
      });
    });

    it('removes an avatar and rethrows persistence failures', async () => {
      const updated = makeUser({ picture: '' });
      vi.mocked(repo.update).mockResolvedValueOnce(updated);
      await expect(service.removeAvatar('user-123')).resolves.toBe(updated);
      expect(repo.update).toHaveBeenCalledWith('user-123', { picture: '' });

      const failure = new Error('write failed');
      vi.mocked(repo.update).mockRejectedValueOnce(failure);
      await expect(service.removeAvatar('user-123')).rejects.toBe(failure);
    });
  });

  describe('password policy', () => {
    it('reports the configured policy', () => {
      expect(service.getPasswordPolicy()).toEqual({
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: false,
        maxAgeDays: 90,
      });
    });

    it.each([[''], [null as unknown as string], [42 as unknown as string]])(
      'rejects a missing or non-string password %#',
      password => {
        expect(service.validatePassword(password)).toEqual({
          isValid: false,
          messages: ['Password is required'],
        });
      }
    );

    it('accepts a compliant password', () => {
      expect(service.validatePassword('Correct-Horse9')).toEqual({
        isValid: true,
        messages: [],
      });
    });

    it('reports every applicable complexity failure', () => {
      const result = service.validatePassword('short');
      expect(result.isValid).toBe(false);
      expect(result.messages).toEqual(
        expect.arrayContaining([
          'Password must be at least 8 characters long',
          'Password must contain at least one uppercase letter',
          'Password must contain at least one number',
        ])
      );
    });

    it('rejects excessively long, repeated, numeric-sequential, and alphabetic-sequential passwords', () => {
      expect(
        service.validatePassword(`A9-${'x'.repeat(126)}`).messages
      ).toContain('Password must be no more than 128 characters long');
      expect(service.validatePassword('Goodaaa9').messages).toContain(
        'Password cannot contain repeated characters (e.g., "aaa")'
      );
      expect(service.validatePassword('Good123X').messages).toContain(
        'Password cannot contain sequential characters (e.g., "123", "abc")'
      );
      expect(service.validatePassword('AbcGood9').messages).toContain(
        'Password cannot contain sequential characters (e.g., "123", "abc")'
      );
    });

    it('enforces symbols when configured and permits disabled complexity rules', () => {
      const configManager = makeCustomIdentifierConfigManager([]);
      const config = configManager.getConfig();
      config.security.authentication.login.password_policy = {
        min_length: 4,
        require_uppercase: false,
        require_lowercase: false,
        require_numbers: false,
        require_symbols: true,
        max_age_days: 30,
      };
      configManager.getConfig = () => config;
      service = new UserService(
        mockLogger,
        configManager,
        mockMfaUtils,
        mockPasswordUtils,
        repo as any
      );

      expect(service.validatePassword('NoSymbol9').messages).toContain(
        'Password must contain at least one special character'
      );
      expect(service.validatePassword('----')).toEqual({
        isValid: false,
        messages: ['Password cannot contain repeated characters (e.g., "aaa")'],
      });
      expect(service.validatePassword('Ok-9')).toEqual({
        isValid: true,
        messages: [],
      });
    });
  });

  describe('changePassword', () => {
    it('rejects missing and policy-invalid new passwords', async () => {
      await expect(
        service.changePassword('user-123', { newPassword: '' })
      ).rejects.toThrow('New password is required');
      await expect(
        service.changePassword('user-123', { newPassword: 'weak' })
      ).rejects.toThrow('Password validation failed');
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('rejects a missing user', async () => {
      vi.mocked(repo.findById).mockResolvedValueOnce(null);
      await expect(
        service.changePassword('missing', { newPassword: 'Correct-Horse9' })
      ).rejects.toThrow('User not found');
    });

    it('requires and verifies the current password for password users', async () => {
      vi.mocked(repo.findById).mockResolvedValue(
        makeUser({ password: 'hash' })
      );

      await expect(
        service.changePassword('user-123', { newPassword: 'Correct-Horse9' })
      ).rejects.toThrow(
        'Current password is required to change existing password'
      );

      vi.mocked(mockPasswordUtils.verifyPassword).mockResolvedValueOnce({
        valid: false,
      });
      await expect(
        service.changePassword('user-123', {
          currentPassword: 'wrong',
          newPassword: 'Correct-Horse9',
        })
      ).rejects.toThrow('Current password is incorrect');
    });

    it('sets an initial password for passwordless users', async () => {
      const user = makeUser({ password: '' });
      const updated = makeUser({ password: 'new-hash' });
      vi.mocked(repo.findById).mockResolvedValueOnce(user);
      vi.mocked(mockPasswordUtils.hashPassword).mockResolvedValueOnce(
        'new-hash'
      );
      vi.mocked(repo.update).mockResolvedValueOnce(updated);

      await expect(
        service.changePassword('user-123', { newPassword: 'Correct-Horse9' })
      ).resolves.toBe(updated);
      expect(repo.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          password: 'new-hash',
          password_hash_algo: 'argon2id',
          password_force_reset: false,
          password_updated_at: expect.any(Date),
        })
      );
    });

    it('persists a rehashed current password before changing it', async () => {
      const user = makeUser({ password: 'old-hash' });
      const updated = makeUser({ password: 'final-hash' });
      vi.mocked(repo.findById).mockResolvedValueOnce(user);
      vi.mocked(mockPasswordUtils.verifyPassword).mockResolvedValueOnce({
        valid: true,
        needsUpgrade: true,
      });
      vi.mocked(mockPasswordUtils.rehashIfNeeded).mockResolvedValueOnce(
        'upgraded-hash'
      );
      vi.mocked(mockPasswordUtils.hashPassword).mockResolvedValueOnce(
        'final-hash'
      );
      vi.mocked(repo.update)
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(updated);

      await expect(
        service.changePassword('user-123', {
          currentPassword: 'current',
          newPassword: 'Correct-Horse9',
        })
      ).resolves.toBe(updated);
      expect(repo.update).toHaveBeenNthCalledWith(
        1,
        'user-123',
        expect.objectContaining({ password: 'upgraded-hash' })
      );
    });

    it('continues the password change if opportunistic rehash persistence fails', async () => {
      vi.mocked(repo.findById).mockResolvedValueOnce(
        makeUser({ password: 'old-hash' })
      );
      vi.mocked(mockPasswordUtils.verifyPassword).mockResolvedValueOnce({
        valid: true,
        needsUpgrade: true,
      });
      vi.mocked(mockPasswordUtils.rehashIfNeeded).mockResolvedValueOnce(
        'upgraded-hash'
      );
      vi.mocked(mockPasswordUtils.hashPassword).mockResolvedValueOnce(
        'new-hash'
      );
      vi.mocked(repo.update)
        .mockRejectedValueOnce(new Error('rehash write failed'))
        .mockResolvedValueOnce(makeUser({ password: 'new-hash' }));

      await expect(
        service.changePassword('user-123', {
          currentPassword: 'current',
          newPassword: 'Correct-Horse9',
        })
      ).resolves.toMatchObject({ password: 'new-hash' });
    });

    it('normalizes password hashing failures', async () => {
      vi.mocked(repo.findById).mockResolvedValueOnce(
        makeUser({ password: '' })
      );
      vi.mocked(mockPasswordUtils.hashPassword).mockRejectedValueOnce(
        new Error('argon failed')
      );
      await expect(
        service.changePassword('user-123', { newPassword: 'Correct-Horse9' })
      ).rejects.toThrow('Failed to hash password');
    });
  });

  describe('password verification helpers', () => {
    it('matches passwords and normalizes verifier failures to false', async () => {
      vi.mocked(mockPasswordUtils.verifyPassword)
        .mockResolvedValueOnce({ valid: true })
        .mockRejectedValueOnce(new Error('verify failed'));
      await expect(service.isPasswordMatch('plain', 'hash')).resolves.toBe(
        true
      );
      await expect(service.isPasswordMatch('plain', 'hash')).resolves.toBe(
        false
      );
    });

    it('returns invalid, valid, upgraded, and failure rehash results', async () => {
      vi.mocked(mockPasswordUtils.verifyPassword)
        .mockResolvedValueOnce({ valid: false })
        .mockResolvedValueOnce({ valid: true, needsUpgrade: false })
        .mockResolvedValueOnce({ valid: true, needsUpgrade: true })
        .mockResolvedValueOnce({ valid: true, needsUpgrade: true })
        .mockRejectedValueOnce(new Error('verify failed'));
      vi.mocked(mockPasswordUtils.rehashIfNeeded)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('new-hash');

      await expect(service.verifyPasswordWithRehash('p', 'h')).resolves.toEqual(
        {
          valid: false,
        }
      );
      await expect(service.verifyPasswordWithRehash('p', 'h')).resolves.toEqual(
        {
          valid: true,
        }
      );
      await expect(service.verifyPasswordWithRehash('p', 'h')).resolves.toEqual(
        {
          valid: true,
        }
      );
      await expect(service.verifyPasswordWithRehash('p', 'h')).resolves.toEqual(
        {
          valid: true,
          newHash: 'new-hash',
        }
      );
      await expect(service.verifyPasswordWithRehash('p', 'h')).resolves.toEqual(
        {
          valid: false,
        }
      );
    });
  });
});

describe('UserService — statistics, creation, and lifecycle', () => {
  let repo: IUserPersistenceRepository;
  let service: UserService;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  describe('statistics', () => {
    it('uses portable filters for each user category', async () => {
      vi.mocked(repo.count)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(4);

      await expect(service.countTotalUsers()).resolves.toBe(10);
      await expect(service.countActiveUsers()).resolves.toBe(7);
      await expect(service.countDisabledUsers()).resolves.toBe(2);
      await expect(service.countAnonymizedUsers()).resolves.toBe(1);
      await expect(service.countAdminUsers()).resolves.toBe(3);
      await expect(service.countRecentUsers(14)).resolves.toBe(4);

      expect(repo.count).toHaveBeenNthCalledWith(1, {});
      expect(repo.count).toHaveBeenNthCalledWith(2, {
        account_enabled: true,
        account_is_anonymized: false,
      });
      expect(repo.count).toHaveBeenNthCalledWith(3, {
        account_enabled: false,
      });
      expect(repo.count).toHaveBeenNthCalledWith(4, {
        account_is_anonymized: true,
      });
      expect(repo.count).toHaveBeenNthCalledWith(5, {
        roles: { $in: ['admin', 'superadmin'] },
      });
      expect(repo.count).toHaveBeenNthCalledWith(6, {
        created_at: { $gte: expect.any(Date) },
      });
    });

    it.each([
      ['total', (value: UserService) => value.countTotalUsers()],
      ['active', (value: UserService) => value.countActiveUsers()],
      ['disabled', (value: UserService) => value.countDisabledUsers()],
      ['anonymized', (value: UserService) => value.countAnonymizedUsers()],
      ['admin', (value: UserService) => value.countAdminUsers()],
      ['recent', (value: UserService) => value.countRecentUsers()],
    ])('normalizes a $0 count failure to zero', async (_name, count) => {
      vi.mocked(repo.count).mockRejectedValueOnce(new Error('count failed'));
      await expect(count(service)).resolves.toBe(0);
    });

    it('returns all user statistics', async () => {
      vi.mocked(repo.count)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(4);
      await expect(service.getUserStatistics()).resolves.toEqual({
        totalUsers: 10,
        activeUsers: 7,
        disabledUsers: 2,
        anonymizedUsers: 1,
        adminUsers: 3,
        recentUsers: 4,
      });
    });

    it('normalizes an unexpected aggregate statistics failure', async () => {
      vi.spyOn(service, 'countTotalUsers').mockRejectedValueOnce(
        new Error('unexpected')
      );
      await expect(service.getUserStatistics()).resolves.toEqual({
        totalUsers: 0,
        activeUsers: 0,
        disabledUsers: 0,
        anonymizedUsers: 0,
        adminUsers: 0,
        recentUsers: 0,
      });
    });
  });

  describe('generated usernames and user creation', () => {
    it('returns the first available UUID', async () => {
      const uuid = '11111111-1111-4111-8111-111111111111';
      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid);
      vi.mocked(repo.count).mockResolvedValueOnce(0);
      await expect(service.generateUniqueUsername()).resolves.toBe(uuid);
      expect(repo.count).toHaveBeenCalledWith({ username: uuid });
    });

    it('retries UUID generation after a collision', async () => {
      const first = '11111111-1111-4111-8111-111111111111';
      const second = '22222222-2222-4222-8222-222222222222';
      vi.spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      vi.mocked(repo.count).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      await expect(service.generateUniqueUsername()).resolves.toBe(second);
    });

    it('falls back to a fresh UUID if availability lookup fails', async () => {
      const first = '11111111-1111-4111-8111-111111111111';
      const fallback = '22222222-2222-4222-8222-222222222222';
      vi.spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(fallback);
      vi.mocked(repo.count).mockRejectedValueOnce(new Error('count failed'));
      await expect(service.generateUniqueUsername()).resolves.toBe(fallback);
    });

    it.each([
      [
        'email registration defaults',
        { email: 'alice@example.com' },
        {
          register_with: 'email',
          email_verified: false,
          phone_number_verified: false,
          account_enabled: true,
          roles: ['user'],
          auth_provider: 'local',
        },
      ],
      [
        'phone registration preserves explicit values',
        {
          phone_number: '+2290100000000',
          email_verified: true,
          phone_number_verified: true,
          account_enabled: false,
          roles: ['admin'],
          auth_provider: 'ldap',
        },
        {
          register_with: 'phone_number',
          email_verified: true,
          phone_number_verified: true,
          account_enabled: false,
          roles: ['admin'],
          auth_provider: 'ldap',
        },
      ],
      [
        'custom registration preserves its explicit source',
        {
          custom_identifier_1: 'employee-42',
          register_with: 'custom_identifier_1',
        },
        {
          register_with: 'custom_identifier_1',
          email_verified: false,
          phone_number_verified: false,
          account_enabled: true,
          roles: ['user'],
          auth_provider: 'local',
        },
      ],
    ])('creates a user with $0', async (_name, input, expected) => {
      const created = makeUser(input as Partial<IUser>);
      vi.spyOn(service, 'generateUniqueUsername').mockResolvedValueOnce(
        'generated-id'
      );
      vi.mocked(repo.create).mockResolvedValueOnce(created);

      await expect(
        service.createUserWithGeneratedUsername(input as Partial<IUser>)
      ).resolves.toBe(created);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...input,
          ...expected,
          username: 'generated-id',
        })
      );
    });

    it('preserves an explicitly supplied trusted username', async () => {
      const created = makeUser({ username: 'managed-user' });
      const generateUsername = vi.spyOn(service, 'generateUniqueUsername');
      vi.mocked(repo.create).mockResolvedValueOnce(created);

      await expect(
        service.createUserWithGeneratedUsername({
          email: 'managed@example.com',
          username: 'managed-user',
        })
      ).resolves.toBe(created);
      expect(generateUsername).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'managed-user' })
      );
    });

    it('rejects unavailable roles before creating through a repository adapter', async () => {
      await expect(
        service.createUserWithGeneratedUsername({
          email: 'managed@example.com',
          roles: ['unconfigured-role'],
        })
      ).rejects.toThrow("Role 'unconfigured-role' is not available");
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each(['platform_admin', 'platform_viewer'] as const)(
      'persists the built-in %s role in the platform tenant',
      async role => {
        const created = makeUser({ roles: [role] });
        vi.mocked(repo.create).mockResolvedValueOnce(created);

        await expect(
          tenantContext.run('_platforms', () =>
            service.createUserWithGeneratedUsername({
              email: `${role}@example.com`,
              roles: [role],
            })
          )
        ).resolves.toBe(created);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ roles: [role] })
        );
      }
    );

    it('rejects platform roles outside the platform tenant', async () => {
      await expect(
        tenantContext.run('tenant-a', () =>
          service.createUserWithGeneratedUsername({
            email: 'platform-admin@example.com',
            roles: ['platform_admin'],
          })
        )
      ).rejects.toThrow("Role 'platform_admin' is not available");
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each([
      ['email', { email: 1 }, 'Email is already registered'],
      [
        'custom identifier',
        { custom_identifier_2: 1 },
        'This identifier is already taken',
      ],
      ['username', { username: 1 }, 'Username is already taken'],
      [
        'unknown key',
        undefined,
        'An account with these details already exists',
      ],
    ])(
      'translates Mongo duplicate conflicts for $0',
      async (_name, keyPattern, message) => {
        const error = Object.assign(new Error('E11000 sensitive details'), {
          code: 11000,
          keyPattern,
        });
        vi.mocked(repo.create).mockRejectedValueOnce(error);
        await expect(
          service.createUserWithGeneratedUsername({
            email: 'alice@example.com',
          })
        ).rejects.toThrow(message);
      }
    );

    it.each([
      [['email'], 'Email is already registered'],
      [['custom_identifier_1'], 'This identifier is already taken'],
      [['username'], 'Username is already taken'],
      [undefined, 'An account with these details already exists'],
    ])(
      'translates Prisma duplicate conflicts for target %j',
      async (target, message) => {
        const error = Object.assign(new Error('P2002 sensitive details'), {
          code: 'P2002',
          meta: { target },
        });
        vi.mocked(repo.create).mockRejectedValueOnce(error);
        await expect(
          service.createUserWithGeneratedUsername({
            email: 'alice@example.com',
          })
        ).rejects.toThrow(message);
      }
    );

    it('translates Prisma 7 driver-adapter email conflicts', async () => {
      const error = Object.assign(new Error('P2002 sensitive details'), {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: { fields: ['email'] },
            },
          },
        },
      });
      vi.mocked(repo.create).mockRejectedValueOnce(error);

      await expect(
        service.createUserWithGeneratedUsername({
          email: 'alice@example.com',
        })
      ).rejects.toThrow('Email is already registered');
    });

    it('translates Prisma 7 PostgreSQL constraint-index conflicts', async () => {
      const error = Object.assign(new Error('P2002 sensitive details'), {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: { index: 'users_tenant_id_email_key' },
            },
          },
        },
      });
      vi.mocked(repo.create).mockRejectedValueOnce(error);

      await expect(
        service.createUserWithGeneratedUsername({
          email: 'alice@example.com',
        })
      ).rejects.toThrow('Email is already registered');
    });

    it('infers the conflicting field when Prisma 7 PostgreSQL omits constraint metadata', async () => {
      const error = Object.assign(new Error('P2002 sensitive details'), {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: undefined,
            },
          },
        },
      });
      vi.mocked(repo.create).mockRejectedValueOnce(error);
      vi.mocked(repo.count).mockImplementation(async filter =>
        filter && 'email' in filter ? 1 : 0
      );

      await expect(
        service.createUserWithGeneratedUsername({
          email: 'alice@example.com',
        })
      ).rejects.toThrow('Email is already registered');
      expect(repo.count).toHaveBeenCalledWith({ email: 'alice@example.com' });
    });

    it('continues duplicate-field inference when a repository probe fails', async () => {
      const error = Object.assign(new Error('P2002 sensitive details'), {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: undefined,
            },
          },
        },
      });
      vi.mocked(repo.create).mockRejectedValueOnce(error);
      vi.mocked(repo.count).mockImplementation(async filter => {
        if (filter && 'email' in filter) throw new Error('probe failed');
        return filter && 'username' in filter ? 1 : 0;
      });

      await expect(
        service.createUserWithGeneratedUsername({
          email: 'alice@example.com',
          username: 'alice',
        })
      ).rejects.toThrow('Username is already taken');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unable to identify duplicate user field',
        { field: 'email' }
      );
      expect(repo.count).toHaveBeenCalledWith({ username: 'alice' });
    });

    it('rethrows unrelated creation errors', async () => {
      const failure = new Error('connection failed');
      vi.mocked(repo.create).mockRejectedValueOnce(failure);
      await expect(service.createUserWithGeneratedUsername({})).rejects.toBe(
        failure
      );
    });
  });

  describe('lifecycle', () => {
    it.each([
      [
        'soft deletes',
        (value: UserService) => value.softDelete('user-123'),
        { account_is_anonymized: true, last_login: expect.any(Date) },
      ],
      [
        'restores',
        (value: UserService) => value.restore('user-123'),
        { account_is_anonymized: false, last_login: expect.any(Date) },
      ],
      [
        'activates',
        (value: UserService) => value.activate('user-123'),
        { account_enabled: true },
      ],
      [
        'deactivates',
        (value: UserService) => value.deactivate('user-123'),
        { account_enabled: false },
      ],
    ])('$0 through the repository', async (_name, operation, expected) => {
      const updated = makeUser();
      vi.mocked(repo.update).mockResolvedValueOnce(updated);
      await expect(operation(service)).resolves.toBe(updated);
      expect(repo.update).toHaveBeenCalledWith('user-123', expected);
    });

    it.each([
      ['softDelete', (value: UserService) => value.softDelete('user-123')],
      ['restore', (value: UserService) => value.restore('user-123')],
      ['activate', (value: UserService) => value.activate('user-123')],
      ['deactivate', (value: UserService) => value.deactivate('user-123')],
    ])('logs and rethrows $0 failures', async (_name, operation) => {
      const failure = new Error('write failed');
      vi.mocked(repo.update).mockRejectedValueOnce(failure);
      await expect(operation(service)).rejects.toBe(failure);
    });

    it('delegates irreversible anonymization without retaining source PII', async () => {
      const anonymized = makeUser({
        email: 'anon@deleted.invalid',
        account_is_anonymized: true,
        account_enabled: false,
      });
      vi.mocked(repo.anonymize).mockResolvedValueOnce(anonymized);

      await expect(service.anonymize('user-123')).resolves.toBe(anonymized);
      expect(repo.anonymize).toHaveBeenCalledWith('user-123');
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('logs and rethrows anonymization failures', async () => {
      const failure = new Error('anonymize failed');
      vi.mocked(repo.anonymize).mockRejectedValueOnce(failure);
      await expect(service.anonymize('user-123')).rejects.toBe(failure);
    });
  });
});

describe('UserService — residual defensive branches', () => {
  let repo: IUserPersistenceRepository;
  let service: UserService;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
    vi.mocked(mockMfaUtils.validateTotpCodeFormat).mockReturnValue({
      valid: true,
      sanitized: '123456',
    });
  });

  it.each([
    ['updateById', (value: UserService) => value.updateById('user-123', {})],
    [
      'updateWithAssignment',
      (value: UserService) => value.updateWithAssignment('user-123', {}),
    ],
  ])('rethrows a malformed repository error from $0', async (_name, invoke) => {
    const malformed = { message: null };
    vi.mocked(repo.update).mockRejectedValueOnce(malformed);
    await expect(invoke(service)).rejects.toBe(malformed);
  });

  it('uses the canonical id when an excluded custom-identifier user lacks _id', async () => {
    vi.mocked(repo.findOne).mockResolvedValueOnce(
      makeUser({ _id: undefined, id: 'user-123' })
    );
    await expect(
      service.isCustomIdentifierAvailable(1, 'EMP-1', 'user-123')
    ).resolves.toBe(true);
  });

  it('returns false when an object-id TOTP fallback has no matching user', async () => {
    vi.mocked(repo.findOne).mockResolvedValueOnce(null);
    vi.mocked(repo.findById).mockResolvedValueOnce(null);
    await expect(
      service.verifyTotp('507f1f77bcf86cd799439011', '123456')
    ).resolves.toBe(false);
  });

  it.each([
    [
      'TOTP setup',
      (value: UserService) => value.verifyTotpSetupCode('alice', '123456'),
    ],
    [
      'email MFA setup',
      (value: UserService) => value.verifyEmailMfaSetupCode('alice', '123456'),
    ],
  ])('normalizes a $0 lookup failure to false', async (_name, invoke) => {
    vi.mocked(repo.findOne).mockRejectedValueOnce(new Error('lookup failed'));
    await expect(invoke(service)).resolves.toBe(false);
  });

  it('verifies an explicit current password for a passwordless record without rehashing', async () => {
    vi.mocked(repo.findById).mockResolvedValueOnce(
      makeUser({ password: undefined })
    );
    vi.mocked(mockPasswordUtils.verifyPassword).mockResolvedValueOnce({
      valid: true,
      needsUpgrade: false,
    });
    vi.mocked(mockPasswordUtils.hashPassword).mockResolvedValueOnce('new-hash');
    vi.mocked(repo.update).mockResolvedValueOnce(
      makeUser({ password: 'new-hash' })
    );

    await expect(
      service.changePassword('user-123', {
        currentPassword: 'current',
        newPassword: 'Correct-Horse9',
      })
    ).resolves.toMatchObject({ password: 'new-hash' });
    expect(mockPasswordUtils.verifyPassword).toHaveBeenCalledWith(
      'current',
      ''
    );
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('reports a missing lowercase character', () => {
    expect(service.validatePassword('UPPERCASE9').messages).toContain(
      'Password must contain at least one lowercase letter'
    );
  });

  it('returns no custom identifier fields when enabled configuration omits them', () => {
    service = makeServiceWithCI(
      repo,
      undefined as unknown as CustomIdentifierFieldConfig[]
    );
    expect(service.getCustomIdentifierFields()).toEqual([]);
  });

  it('accepts a string Prisma duplicate target', async () => {
    const error = Object.assign(new Error('P2002 sensitive details'), {
      code: 'P2002',
      meta: { target: 'email' },
    });
    vi.mocked(repo.create).mockRejectedValueOnce(error);
    await expect(
      service.createUserWithGeneratedUsername({ email: 'alice@example.com' })
    ).rejects.toThrow('Email is already registered');
  });
});
