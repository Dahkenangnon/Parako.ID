import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createUserModel } from '../../../../src/models/user.model.js';
import { MongooseUserRepository } from '../../../../src/db/repositories/mongoose/user.repository.js';

// ─── Minimal mocks ────────────────────────────────────────────────────────────

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
} as any;

const mockConfig = {
  security: {
    authentication: {
      roles: { available: ['user', 'admin'], default: 'user' },
    },
  },
};

const mockConfigManager = {
  getConfig: () => mockConfig,
  subscribe: () => () => {},
} as any;

const mockPasswordUtils = {} as any;

// ─── Shared state ─────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer | undefined;
let repo: MongooseUserRepository;
let mongoAvailable = true;

const makeUser = (overrides: Partial<Record<string, any>> = {}) => ({
  email: `test_${Date.now()}_${Math.random()}@example.com`,
  username: `user_${Date.now()}_${Math.random()}`,
  given_name: 'Test',
  family_name: 'User',
  name: 'Test User',
  nickname: 'tuser',
  middle_name: '',
  gender: 'M' as const,
  phone_number: '',
  profile: '',
  website: '',
  picture: '',
  locale: 'fr',
  country: 'bj',
  zoneinfo: 'Africa/Porto-Novo',
  city: '',
  address: '',
  street_address: '',
  region: '',
  postal_code: '',
  roles: ['user'],
  birthdate: new Date('1990-01-01'),
  phone_number_verified: false,
  email_verified: false,
  blocked_from: [],
  account_is_anonymized: false,
  register_with: 'email' as const,
  account_enabled: true,
  ...overrides,
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const UserModel = createUserModel(
      mockLogger,
      mockConfigManager,
      mockPasswordUtils
    );
    repo = new MongooseUserRepository(UserModel);
  } catch {
    mongoAvailable = false;
  }
}, 60_000);

afterAll(async () => {
  if (mongod) {
    await mongoose.disconnect();
    await mongod.stop();
  }
});

beforeEach(async ctx => {
  if (!mongoAvailable) {
    ctx.skip();
    return;
  }
  await mongoose.connection.collection('users').deleteMany({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MongooseUserRepository', () => {
  describe('create + findById', () => {
    it('creates a user and retrieves by id', async () => {
      const created = await repo.create(makeUser());
      expect(created.id).toBeTruthy();
      const found = await repo.findById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.email).toBe(created.email);
    });
  });

  describe('findByEmail', () => {
    it('returns user matching email', async () => {
      const u = await repo.create(makeUser({ email: 'find@email.com' }));
      const found = await repo.findByEmail('find@email.com');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(u.id);
    });

    it('returns null when email not found', async () => {
      const result = await repo.findByEmail('notexist@example.com');
      expect(result).toBeNull();
    });
  });

  describe('findByUsername', () => {
    it('returns user matching username', async () => {
      await repo.create(makeUser({ username: 'uniqueuser' }));
      const found = await repo.findByUsername('uniqueuser');
      expect(found).not.toBeNull();
      expect(found!.username).toBe('uniqueuser');
    });
  });

  describe('findBySub', () => {
    it('returns user matching sub', async () => {
      await repo.create(makeUser({ sub: 'sub-abc-123' }));
      const found = await repo.findBySub('sub-abc-123');
      expect(found).not.toBeNull();
      expect(found!.sub).toBe('sub-abc-123');
    });
  });

  describe('findBySecondaryEmail', () => {
    it('returns user matching secondary email', async () => {
      await repo.create(
        makeUser({
          recovery: {
            enabled: true,
            methods: ['secondary_email'],
            secondary_email: {
              email: 'secondary@example.com',
              verified: true,
            },
          },
        })
      );
      const found = await repo.findBySecondaryEmail('secondary@example.com');
      expect(found).not.toBeNull();
    });
  });

  describe('update', () => {
    it('updates user fields', async () => {
      const u = await repo.create(makeUser());
      const updated = await repo.update(u.id!, { given_name: 'Updated' });
      expect(updated.given_name).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('removes user', async () => {
      const u = await repo.create(makeUser());
      await repo.delete(u.id!);
      const found = await repo.findById(u.id!);
      expect(found).toBeNull();
    });
  });

  describe('count', () => {
    it('returns correct count', async () => {
      await repo.create(makeUser());
      await repo.create(makeUser());
      const n = await repo.count();
      expect(n).toBe(2);
    });

    it('returns count with filter', async () => {
      await repo.create(makeUser({ account_enabled: true }));
      await repo.create(makeUser({ account_enabled: false }));
      const n = await repo.count({ account_enabled: true });
      expect(n).toBe(1);
    });
  });

  describe('findMany (paginated)', () => {
    it('returns paginated results', async () => {
      await repo.create(makeUser());
      await repo.create(makeUser());
      const result = await repo.findMany({}, { page: 1, limit: 10 });
      expect(result.results.length).toBe(2);
      expect(result.totalResults).toBe(2);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('updateMfa', () => {
    it('sets mfa.enabled', async () => {
      const u = await repo.create(makeUser());
      await repo.updateMfa(u.id!, { enabled: true });
      const found = await repo.findById(u.id!);
      expect(found!.mfa?.enabled).toBe(true);
    });
  });

  describe('setEmailOtp + clearEmailOtp', () => {
    it('sets and clears email OTP', async () => {
      const u = await repo.create(makeUser());
      await repo.setEmailOtp(u.id!, {
        hash: 'hash123',
        expires: new Date(Date.now() + 60000),
      });
      const withOtp = await repo.findById(u.id!);
      expect(withOtp!.mfa?.email_otp?.hash).toBe('hash123');

      await repo.clearEmailOtp(u.id!);
      const cleared = await repo.findById(u.id!);
      expect(cleared!.mfa?.email_otp).toBeFalsy();
    });
  });

  describe('addBackupCodes + consumeBackupCode', () => {
    it('adds and consumes backup codes', async () => {
      const u = await repo.create(makeUser());
      await repo.addBackupCodes(u.id!, ['code1', 'code2']);
      const found = await repo.findById(u.id!);
      expect(found!.recovery?.backup_codes?.codes).toContain('code1');

      const consumed = await repo.consumeBackupCode(u.id!, 'code1');
      expect(consumed).toBe(true);

      // Consuming again should return false
      const again = await repo.consumeBackupCode(u.id!, 'code1');
      expect(again).toBe(false);
    });
  });

  describe('addWebAuthnCredential + removeWebAuthnCredential', () => {
    it('adds and removes a credential', async () => {
      const u = await repo.create(makeUser());
      const cred = {
        credential_id: 'cred-id-abc',
        publicKey: 'pubkey',
        counter: 0,
        device_type: 'platform',
        backed_up: false,
        transports: ['internal'],
      };
      await repo.addWebAuthnCredential(u.id!, cred);
      const withCred = await repo.findById(u.id!);
      expect(withCred!.mfa?.methods?.webauthn?.credentials).toHaveLength(1);

      await repo.removeWebAuthnCredential(u.id!, 'cred-id-abc');
      const noCred = await repo.findById(u.id!);
      expect(noCred!.mfa?.methods?.webauthn?.credentials ?? []).toHaveLength(0);
    });
  });

  describe('addSecurityQuestion', () => {
    it('adds a security question', async () => {
      const u = await repo.create(makeUser());
      await repo.addSecurityQuestion(u.id!, {
        id: 'sq1',
        question_key: 'q1',
        answer_hash: 'hash-of-answer',
      });
      const found = await repo.findById(u.id!);
      expect(found!.recovery?.security_questions?.questions).toHaveLength(1);
    });
  });

  describe('forcePasswordReset', () => {
    it('sets password_force_reset to true', async () => {
      const u = await repo.create(makeUser());
      await repo.forcePasswordReset(u.id!);
      const found = await repo.findById(u.id!);
      expect(found!.password_force_reset).toBe(true);
    });
  });

  describe('anonymize', () => {
    it('anonymizes user personal data', async () => {
      const u = await repo.create(
        makeUser({ email: 'real@email.com', given_name: 'Real' })
      );
      const anon = await repo.anonymize(u.id!);
      expect(anon.email).not.toBe('real@email.com');
      expect(anon.account_is_anonymized).toBe(true);
    });
  });
});
