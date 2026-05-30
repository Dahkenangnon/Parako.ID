/**
 * TDD — PrismaUserRepository
 * Uses an isolated SQLite database (better-sqlite3 + Prisma adapter).
 * Schema is applied via `prisma db push` to a temp file before the suite.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaUserRepository } from '../../../../src/db/repositories/prisma/user.repository.js';
import type { CreateUserDto } from '../../../../src/db/repositories/interfaces/user.repository.js';

// ─── Test DB Setup ───────────────────────────────────────────────────────────

const TEST_DB = join(tmpdir(), `parako-user-prisma-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

let prisma: PrismaClient;
let repo: PrismaUserRepository;

beforeAll(async () => {
  execFileSync(
    PRISMA_BIN,
    ['db', 'push', '--config=prisma.config.ts', '--accept-data-loss'],
    {
      env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
      stdio: 'pipe',
      cwd: process.cwd(),
    }
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${TEST_DB}` });
  prisma = new PrismaClient({ adapter });
  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
  repo = new PrismaUserRepository(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

beforeEach(async () => {
  // Cascade deletes all related tables
  await prisma.user.deleteMany({});
});

// ─── Fixture ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<CreateUserDto> = {}): CreateUserDto {
  return {
    email: 'alice@example.com',
    username: 'alice',
    roles: ['user'],
    blocked_from: [],
    account_is_anonymized: false,
    register_with: 'email',
    phone_number_verified: false,
    email_verified: false,
    ...overrides,
  } as CreateUserDto;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PrismaUserRepository', () => {
  describe('create + findById', () => {
    it('creates a user and retrieves by id', async () => {
      const created = await repo.create(makeUser());
      expect(created.id).toBeTruthy();
      expect(created.email).toBe('alice@example.com');
      expect(created.roles).toEqual(['user']);

      const found = await repo.findById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('alice@example.com');
    });
  });

  describe('findByEmail', () => {
    it('returns user matching email', async () => {
      await repo.create(makeUser());
      const found = await repo.findByEmail('alice@example.com');
      expect(found).not.toBeNull();
      expect(found!.username).toBe('alice');
    });

    it('returns null when email not found', async () => {
      const found = await repo.findByEmail('nobody@example.com');
      expect(found).toBeNull();
    });
  });

  describe('findByUsername', () => {
    it('returns user matching username', async () => {
      await repo.create(makeUser());
      const found = await repo.findByUsername('alice');
      expect(found).not.toBeNull();
      expect(found!.email).toBe('alice@example.com');
    });
  });

  describe('findBySub', () => {
    it('returns user matching sub', async () => {
      await repo.create(makeUser({ sub: 'sub-abc-123' }));
      const found = await repo.findBySub('sub-abc-123');
      expect(found).not.toBeNull();
      expect(found!.email).toBe('alice@example.com');
    });
  });

  describe('update', () => {
    it('updates user fields', async () => {
      const created = await repo.create(makeUser());
      const updated = await repo.update(created.id!, { given_name: 'Alice' });
      expect(updated.given_name).toBe('Alice');
    });
  });

  describe('delete', () => {
    it('removes the user', async () => {
      const created = await repo.create(makeUser());
      await repo.delete(created.id!);
      const found = await repo.findById(created.id!);
      expect(found).toBeNull();
    });
  });

  describe('count', () => {
    it('returns correct count', async () => {
      await repo.create(makeUser({ email: 'a@x.com', username: 'aaa' }));
      await repo.create(makeUser({ email: 'b@x.com', username: 'bbb' }));
      expect(await repo.count()).toBe(2);
    });

    it('returns count with filter', async () => {
      await repo.create(
        makeUser({ email: 'a@x.com', username: 'aaa', email_verified: true })
      );
      await repo.create(
        makeUser({ email: 'b@x.com', username: 'bbb', email_verified: false })
      );
      expect(await repo.count({ email_verified: true })).toBe(1);
    });
  });

  describe('findMany (paginated)', () => {
    it('returns paginated results', async () => {
      await repo.create(makeUser({ email: 'a@x.com', username: 'aaa' }));
      await repo.create(makeUser({ email: 'b@x.com', username: 'bbb' }));
      const result = await repo.findMany({}, { page: 1, limit: 10 });
      expect(result.results.length).toBe(2);
      expect(result.totalResults).toBe(2);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('updateMfa', () => {
    it('creates mfa record and sets enabled', async () => {
      const user = await repo.create(makeUser());
      await repo.updateMfa(user.id!, {
        enabled: true,
        preferred_method: 'totp',
      });
      const found = await repo.findById(user.id!);
      expect(found!.mfa?.enabled).toBe(true);
      expect(found!.mfa?.preferred_method).toBe('totp');
    });
  });

  describe('setEmailOtp + clearEmailOtp', () => {
    it('sets and clears email OTP', async () => {
      const user = await repo.create(makeUser());
      const expires = new Date(Date.now() + 10 * 60 * 1000);
      await repo.setEmailOtp(user.id!, { hash: 'hash-xyz', expires });
      const withOtp = await repo.findById(user.id!);
      expect(withOtp!.mfa?.email_otp?.hash).toBe('hash-xyz');

      await repo.clearEmailOtp(user.id!);
      const cleared = await repo.findById(user.id!);
      expect(cleared!.mfa?.email_otp).toBeUndefined();
    });
  });

  describe('addBackupCodes + consumeBackupCode', () => {
    it('adds and consumes backup codes', async () => {
      const user = await repo.create(makeUser());
      await repo.addBackupCodes(user.id!, ['hash-1', 'hash-2', 'hash-3']);
      const consumed = await repo.consumeBackupCode(user.id!, 'hash-1');
      expect(consumed).toBe(true);

      // Consuming the same code again returns false
      const again = await repo.consumeBackupCode(user.id!, 'hash-1');
      expect(again).toBe(false);
    });
  });

  describe('addWebAuthnCredential + removeWebAuthnCredential', () => {
    it('adds and removes a credential', async () => {
      const user = await repo.create(makeUser());
      await repo.addWebAuthnCredential(user.id!, {
        credential_id: 'cred-id-1',
        publicKey: 'pub-key-1',
        counter: 0,
        device_type: 'platform',
        backed_up: false,
        transports: ['internal'],
      });
      const withCred = await repo.findById(user.id!);
      expect(withCred!.mfa?.methods?.webauthn?.credentials).toHaveLength(1);

      await repo.removeWebAuthnCredential(user.id!, 'cred-id-1');
      const noCred = await repo.findById(user.id!);
      expect(noCred!.mfa?.methods?.webauthn?.credentials ?? []).toHaveLength(0);
    });
  });

  describe('addSecurityQuestion', () => {
    it('adds a security question', async () => {
      const user = await repo.create(makeUser());
      await repo.addSecurityQuestion(user.id!, {
        id: 'sq-1',
        question_key: 'q_pet',
        answer_hash: 'hash-answer',
      });
      const found = await repo.findById(user.id!);
      expect(found!.recovery?.security_questions?.questions).toHaveLength(1);
      expect(
        found!.recovery!.security_questions!.questions[0].question_key
      ).toBe('q_pet');
    });
  });

  describe('forcePasswordReset', () => {
    it('sets password_force_reset to true', async () => {
      const user = await repo.create(makeUser());
      await repo.forcePasswordReset(user.id!);
      const found = await repo.findById(user.id!);
      expect(found!.password_force_reset).toBe(true);
    });
  });

  describe('anonymize', () => {
    it('anonymizes user personal data', async () => {
      const user = await repo.create(
        makeUser({ given_name: 'Alice', family_name: 'Smith' })
      );
      const anon = await repo.anonymize(user.id!);
      expect(anon.account_is_anonymized).toBe(true);
      expect(anon.email).not.toBe('alice@example.com');
      expect(anon.given_name).toBeUndefined();
    });
  });
});
