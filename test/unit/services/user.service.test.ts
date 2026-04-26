/**
 * TDD — UserService uses IUserRepository for data access
 *
 * These tests verify that UserService delegates data operations
 * to IUserRepository instead of using Mongoose models directly.
 *
 * RED: UserService extends BaseService (Mongoose), no repo injection.
 * GREEN: After migrating to IUserRepository.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../../../src/services/user.service.js';
import type { IUser } from '../../../src/types/user.js';
import type { IUserRepository } from '../../../src/db/repositories/interfaces/user.repository.js';
import type { CustomIdentifierFieldConfig } from '../../../src/di/interfaces/user/user-custom-identifier-service.interface.js';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

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
      },
    },
  }),
} as any;

const mockMfaUtils = {
  validateTotpCodeFormat: vi.fn(),
  isTotpEnabled: vi.fn(),
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

// ── Mock IUserRepository (DB layer) ──────────────────────────────────────────

function makeMockRepo(): IUserRepository {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeService(userRepo: IUserRepository): UserService {
  return new UserService(
    mockLogger,
    mockConfigManager,
    mockMfaUtils,
    mockPasswordUtils,
    userRepo as any
  );
}

// ── Custom-identifier mock factory ────────────────────────────────────────────
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
  userRepo: IUserRepository,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UserService — IUserRepository delegation', () => {
  let repo: IUserRepository;
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  // ── findByEmail ─────────────────────────────────────────────────────────────

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

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById (service method)', () => {
    it('delegates to repo.findById', async () => {
      const user = makeUser();
      vi.mocked(repo.findById).mockResolvedValue(user);

      const result = await service.findById('user-123');

      expect(repo.findById).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(user);
    });
  });

  // ── findOne (IBaseService) ──────────────────────────────────────────────────

  describe('findOne (IBaseService contract)', () => {
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

  // ── countDocuments (IBaseService) ──────────────────────────────────────────

  describe('countDocuments (IBaseService contract)', () => {
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

  // ── updateById (IBaseService) ───────────────────────────────────────────────

  describe('updateById (IBaseService contract)', () => {
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
  });

  // ── findWithPagination (IBaseService) ──────────────────────────────────────

  describe('findWithPagination (IBaseService contract)', () => {
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

  // ── createOne (IBaseService) ────────────────────────────────────────────────

  describe('createOne (IBaseService contract)', () => {
    it('delegates to repo.create', async () => {
      const newUser = makeUser();
      vi.mocked(repo.create).mockResolvedValue(newUser);

      const result = await service.createOne({
        email: 'bob@example.com',
      } as any);

      expect(repo.create).toHaveBeenCalledWith({ email: 'bob@example.com' });
      expect(result).toEqual(newUser);
    });
  });
});

// ── Custom identifier slot-aware methods ─────────────────────────────────────

describe('UserService — Custom Identifiers', () => {
  let repo: IUserRepository;

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

    it('honours excludeUserId via $ne', async () => {
      const service = makeServiceWithCI(repo, [
        makeFieldConfig({ slot: 3, case_sensitive: true }),
      ]);
      vi.mocked(repo.count).mockResolvedValue(0);

      await service.isCustomIdentifierAvailable(3, 'X', 'user-self');

      expect(repo.count).toHaveBeenCalledWith({
        custom_identifier_3: 'X',
        _id: { $ne: 'user-self' },
      });
    });

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
      vi.mocked(repo.update).mockResolvedValue(null);
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
      vi.mocked(repo.update).mockResolvedValue(null);
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
