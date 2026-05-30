/**
 * TDD — PrismaOidcStoreAdapter
 * Tests the Prisma-backed OIDC adapter against a real SQLite database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaOidcStoreAdapter } from '../../../../src/oidc/adapter/prisma/index.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { OIDCPayload } from '../../../../src/oidc/interfaces/interface.js';

const TEST_DB = join(tmpdir(), `parako-oidc-prisma-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

// Minimal no-op logger satisfying ILogger
const logger: ILogger = {
  getLogger: () => null as any,
  child: () => null as any,
  flush: async () => {},
  shutdown: async () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
};

let prisma: PrismaClient;

function makeAdapter(model: string) {
  return new PrismaOidcStoreAdapter(model, prisma, logger);
}

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
});

afterAll(async () => {
  await prisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

beforeEach(async () => {
  await prisma.oidcStore.deleteMany({});
});

describe('PrismaOidcStoreAdapter', () => {
  describe('upsert + find', () => {
    it('stores and retrieves a payload', async () => {
      const adapter = makeAdapter('AccessToken');
      const payload: OIDCPayload = { accountId: 'user-1', exp: 9999999999 };
      await adapter.upsert('tok-1', payload, 3600);

      const found = await adapter.find('tok-1');
      expect(found).toBeTruthy();
      expect(found!.accountId).toBe('user-1');
    });

    it('returns undefined for unknown id', async () => {
      const adapter = makeAdapter('AccessToken');
      const found = await adapter.find('no-such-id');
      expect(found).toBeUndefined();
    });

    it('upsert overwrites existing payload', async () => {
      const adapter = makeAdapter('Session');
      await adapter.upsert('sess-1', { accountId: 'a' }, 3600);
      await adapter.upsert('sess-1', { accountId: 'b' }, 3600);
      const found = await adapter.find('sess-1');
      expect(found!.accountId).toBe('b');
    });

    it('does not cross model boundaries', async () => {
      const at = makeAdapter('AccessToken');
      const rt = makeAdapter('RefreshToken');
      await at.upsert('shared-id', { accountId: 'at-user' }, 3600);
      // RefreshToken adapter should NOT see the AccessToken record
      const found = await rt.find('shared-id');
      expect(found).toBeUndefined();
    });
  });

  describe('findByUserCode', () => {
    it('finds DeviceCode by userCode', async () => {
      const adapter = makeAdapter('DeviceCode');
      await adapter.upsert('dc-1', { userCode: 'ABCD-1234' }, 600);
      const found = await adapter.findByUserCode('ABCD-1234');
      expect(found).toBeTruthy();
      expect(found!.userCode).toBe('ABCD-1234');
    });

    it('returns undefined for non-DeviceCode model', async () => {
      const adapter = makeAdapter('AccessToken');
      await adapter.upsert('tok-x', { userCode: 'ABCD-1234' }, 600);
      // findByUserCode on non-DeviceCode should return undefined
      const found = await adapter.findByUserCode('ABCD-1234');
      expect(found).toBeUndefined();
    });
  });

  describe('findByUid', () => {
    it('finds Session by uid', async () => {
      const adapter = makeAdapter('Session');
      await adapter.upsert('sess-2', { uid: 'session-uid-42' }, 3600);
      const found = await adapter.findByUid('session-uid-42');
      expect(found).toBeTruthy();
      expect(found!.uid).toBe('session-uid-42');
    });

    it('returns undefined for non-Session model', async () => {
      const adapter = makeAdapter('AccessToken');
      await adapter.upsert('tok-y', { uid: 'some-uid' }, 3600);
      const found = await adapter.findByUid('some-uid');
      expect(found).toBeUndefined();
    });
  });

  describe('consume', () => {
    it('marks a payload as consumed', async () => {
      const adapter = makeAdapter('AuthorizationCode');
      await adapter.upsert('code-1', { accountId: 'u1' }, 60);
      await adapter.consume('code-1');
      const found = await adapter.find('code-1');
      // consumed should be set as a Unix timestamp (seconds)
      expect(found!.consumed).toBeTruthy();
      expect(typeof found!.consumed).toBe('number');
    });
  });

  describe('destroy', () => {
    it('removes the record', async () => {
      const adapter = makeAdapter('AccessToken');
      await adapter.upsert('tok-del', { accountId: 'u1' }, 3600);
      await adapter.destroy('tok-del');
      const found = await adapter.find('tok-del');
      expect(found).toBeUndefined();
    });

    it('is a no-op for non-existent id', async () => {
      const adapter = makeAdapter('AccessToken');
      // Should not throw
      await expect(adapter.destroy('ghost')).resolves.toBeUndefined();
    });
  });

  describe('revokeByGrantId', () => {
    it('deletes all records for the model with the given grantId', async () => {
      const at = makeAdapter('AccessToken');
      const rt = makeAdapter('RefreshToken');

      await at.upsert('at-grant', { grantId: 'grant-abc' }, 3600);
      await rt.upsert('rt-grant', { grantId: 'grant-abc' }, 3600);
      // An unrelated AccessToken
      await at.upsert('at-other', { grantId: 'grant-xyz' }, 3600);

      // Revoke AccessToken for grant-abc — should NOT delete RefreshToken
      await at.revokeByGrantId('grant-abc');

      expect(await at.find('at-grant')).toBeUndefined();
      // RefreshToken with same grantId is untouched (different model)
      expect(await rt.find('rt-grant')).toBeTruthy();
      // Unrelated AccessToken untouched
      expect(await at.find('at-other')).toBeTruthy();
    });

    it('is a no-op for models without a grant_id (e.g. Grant model)', async () => {
      const grant = makeAdapter('Grant');
      // Grant records don't have a grant_id referencing themselves
      await grant.upsert('g-1', { accountId: 'u1' }, 3600);
      // Calling revokeByGrantId on Grant should not throw and should not delete the record
      await expect(grant.revokeByGrantId('g-1')).resolves.toBeUndefined();
      expect(await grant.find('g-1')).toBeTruthy();
    });
  });

  describe('expiry', () => {
    it('find returns undefined for an expired record', async () => {
      // Insert directly with a past expires_at
      await prisma.oidcStore.create({
        data: {
          id: 'expired-tok',
          model: 'AccessToken',
          payload: JSON.stringify({ accountId: 'x' }),
          expires_at: new Date(Date.now() - 5000),
        },
      });
      const adapter = makeAdapter('AccessToken');
      expect(await adapter.find('expired-tok')).toBeUndefined();
    });

    it('find returns the record when expires_at is null (no expiry)', async () => {
      const adapter = makeAdapter('Interaction');
      // upsert with no expiresIn → no expires_at
      await adapter.upsert('int-1', { accountId: 'u1' });
      expect(await adapter.find('int-1')).toBeTruthy();
    });

    it('findByUserCode returns undefined for expired DeviceCode', async () => {
      await prisma.oidcStore.create({
        data: {
          id: 'expired-dc',
          model: 'DeviceCode',
          payload: JSON.stringify({ userCode: 'XXXX-YYYY' }),
          user_code: 'XXXX-YYYY',
          expires_at: new Date(Date.now() - 5000),
        },
      });
      const adapter = makeAdapter('DeviceCode');
      expect(await adapter.findByUserCode('XXXX-YYYY')).toBeUndefined();
    });

    it('findByUid returns undefined for expired Session', async () => {
      await prisma.oidcStore.create({
        data: {
          id: 'expired-sess',
          model: 'Session',
          payload: JSON.stringify({ uid: 'dead-uid' }),
          uid: 'dead-uid',
          expires_at: new Date(Date.now() - 5000),
        },
      });
      const adapter = makeAdapter('Session');
      expect(await adapter.findByUid('dead-uid')).toBeUndefined();
    });
  });
});
