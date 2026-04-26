/**
 * TDD — PrismaSocialIntegrationRepository
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaSocialIntegrationRepository } from '../../../../src/db/repositories/prisma/social-integration.repository.js';
import type { CreateSocialIntegrationDto } from '../../../../src/db/repositories/interfaces/social-integration.repository.js';

const TEST_DB = join(tmpdir(), `parako-social-prisma-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

let prisma: PrismaClient;
let repo: PrismaSocialIntegrationRepository;

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
  repo = new PrismaSocialIntegrationRepository(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

beforeEach(async () => {
  await prisma.socialIntegration.deleteMany({});
});

function makeIntegration(
  overrides: Partial<CreateSocialIntegrationDto> = {}
): CreateSocialIntegrationDto {
  return {
    user_id: 'user-abc',
    method: 'google',
    provider_sub: 'google-sub-123',
    provider_data: { sub: 'google-sub-123', email: 'alice@gmail.com' },
    is_active: true,
    ...overrides,
  };
}

describe('PrismaSocialIntegrationRepository', () => {
  describe('create + findById', () => {
    it('creates an integration and retrieves by id', async () => {
      const created = await repo.create(makeIntegration());
      expect(created.id).toBeTruthy();
      expect(created.method).toBe('google');

      const found = await repo.findById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.provider_sub).toBe('google-sub-123');
    });
  });

  describe('findByUserId', () => {
    it('returns paginated integrations for a user', async () => {
      await repo.create(
        makeIntegration({ user_id: 'u1', method: 'google', provider_sub: 'g1' })
      );
      await repo.create(
        makeIntegration({
          user_id: 'u1',
          method: 'github',
          provider_sub: 'gh1',
        })
      );
      await repo.create(
        makeIntegration({ user_id: 'u2', method: 'google', provider_sub: 'g2' })
      );
      const result = await repo.findByUserId('u1');
      expect(result.results.length).toBe(2);
    });
  });

  describe('findByUserAndProvider', () => {
    it('finds a specific provider for a user', async () => {
      await repo.create(
        makeIntegration({ user_id: 'u1', method: 'google', provider_sub: 'g1' })
      );
      const found = await repo.findByUserAndProvider('u1', 'google');
      expect(found).not.toBeNull();
      expect(found!.provider_sub).toBe('g1');
    });

    it('returns null when not found', async () => {
      const found = await repo.findByUserAndProvider('u1', 'github');
      expect(found).toBeNull();
    });
  });

  describe('findByProvider', () => {
    it('returns all integrations for a provider', async () => {
      await repo.create(
        makeIntegration({ user_id: 'u1', method: 'google', provider_sub: 'g1' })
      );
      await repo.create(
        makeIntegration({ user_id: 'u2', method: 'google', provider_sub: 'g2' })
      );
      await repo.create(
        makeIntegration({
          user_id: 'u3',
          method: 'github',
          provider_sub: 'gh1',
        })
      );
      const results = await repo.findByProvider('google');
      expect(results.length).toBe(2);
    });
  });

  describe('update', () => {
    it('updates integration fields', async () => {
      const created = await repo.create(makeIntegration());
      const updated = await repo.update(created.id!, { is_active: false });
      expect(updated.is_active).toBe(false);
    });
  });

  describe('deleteByUserId', () => {
    it('deletes all integrations for a user', async () => {
      await repo.create(makeIntegration({ user_id: 'u1', provider_sub: 'g1' }));
      await repo.create(
        makeIntegration({
          user_id: 'u1',
          method: 'github',
          provider_sub: 'gh1',
        })
      );
      await repo.create(makeIntegration({ user_id: 'u2', provider_sub: 'g2' }));

      const deleted = await repo.deleteByUserId('u1');
      expect(deleted).toBe(2);
      expect(await repo.count()).toBe(1);
    });
  });
});
