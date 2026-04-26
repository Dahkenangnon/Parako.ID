/**
 * TDD — PrismaActivityRepository
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaActivityRepository } from '../../../../src/db/repositories/prisma/activity.repository.js';
import type { CreateActivityDto } from '../../../../src/db/repositories/interfaces/activity.repository.js';

const TEST_DB = join(tmpdir(), `parako-activity-prisma-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

let prisma: PrismaClient;
let repo: PrismaActivityRepository;

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
  repo = new PrismaActivityRepository(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

beforeEach(async () => {
  await prisma.activity.deleteMany({});
});

function makeActivity(
  overrides: Partial<CreateActivityDto> = {}
): CreateActivityDto {
  return {
    type: 'login',
    description: 'User logged in',
    status: 'success',
    ip_address: '127.0.0.1',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('PrismaActivityRepository', () => {
  describe('create + findById', () => {
    it('creates an activity and retrieves by id', async () => {
      const created = await repo.create(makeActivity());
      expect(created.id).toBeTruthy();
      expect(created.type).toBe('login');
      expect(created.status).toBe('success');

      const found = await repo.findById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.description).toBe('User logged in');
    });
  });

  describe('create with actor', () => {
    it('stores and retrieves actor information', async () => {
      const created = await repo.create(
        makeActivity({
          actor: {
            actor_type: 'user',
            user_id: 'user-1' as any,
            username: 'alice',
            email: 'alice@x.com',
          },
        })
      );
      const found = await repo.findById(created.id!);
      expect(found!.actor?.actor_type).toBe('user');
      expect(found!.actor?.username).toBe('alice');
    });
  });

  describe('findMany (paginated)', () => {
    it('returns paginated results', async () => {
      await repo.create(makeActivity({ type: 'login' }));
      await repo.create(makeActivity({ type: 'logout' }));
      const result = await repo.findMany({}, { page: 1, limit: 10 });
      expect(result.results.length).toBe(2);
      expect(result.totalResults).toBe(2);
    });
  });

  describe('findByUser', () => {
    it('returns activities for a specific user', async () => {
      await repo.create(
        makeActivity({ actor: { actor_type: 'user', user_id: 'u1' as any } })
      );
      await repo.create(
        makeActivity({ actor: { actor_type: 'user', user_id: 'u2' as any } })
      );
      const result = await repo.findByUser('u1');
      expect(result.results.length).toBe(1);
    });
  });

  describe('count', () => {
    it('returns correct count', async () => {
      await repo.create(makeActivity());
      await repo.create(makeActivity());
      expect(await repo.count()).toBe(2);
    });
  });

  describe('deleteOlderThan', () => {
    it('deletes activities older than a date', async () => {
      const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10); // 10 days ago
      await prisma.activity.create({
        data: {
          id: 'old-1',
          type: 'login',
          description: 'old',
          status: 'info',
          timestamp: past,
          created_at: past,
        },
      });
      await repo.create(makeActivity()); // recent

      const deleted = await repo.deleteOlderThan(
        new Date(Date.now() - 1000 * 60 * 60)
      ); // older than 1h
      expect(deleted).toBe(1);
      expect(await repo.count()).toBe(1);
    });
  });
});
