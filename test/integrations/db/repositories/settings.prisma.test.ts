/**
 * TDD — PrismaSettingsRepository
 * Uses an isolated SQLite database (better-sqlite3 + Prisma adapter).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaSettingsRepository } from '../../../../src/db/repositories/prisma/settings.repository.js';
import { DEFAULT_FULL_CONFIG } from '../../../../src/config/constants.js';

// ─── Test DB Setup ───────────────────────────────────────────────────────────

const TEST_DB = join(tmpdir(), `parako-settings-prisma-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

let prisma: PrismaClient;
let repo: PrismaSettingsRepository;

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
  repo = new PrismaSettingsRepository(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

beforeEach(async () => {
  await prisma.settings.deleteMany({});
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PrismaSettingsRepository', () => {
  describe('save + findActive', () => {
    it('creates first version and marks it active', async () => {
      const saved = await repo.save('app', DEFAULT_FULL_CONFIG);
      expect(saved.key).toBe('app');
      expect(saved.is_active).toBe(true);
      expect(saved.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(saved._version).toBe(1);

      const active = await repo.findActive('app');
      expect(active).not.toBeNull();
      expect(active!.id).toBe(saved.id);
    });

    it('deactivates previous version on second save', async () => {
      const first = await repo.save('app', DEFAULT_FULL_CONFIG);
      const second = await repo.save('app', DEFAULT_FULL_CONFIG);

      expect(second.is_active).toBe(true);
      expect(second._version).toBe(2);

      const oldRow = await repo.findById(first.id!);
      expect(oldRow!.is_active).toBe(false);
    });
  });

  describe('findVersion', () => {
    it('finds a specific semver version', async () => {
      const saved = await repo.save('app', DEFAULT_FULL_CONFIG);
      const found = await repo.findVersion('app', saved.version);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(saved.id);
    });
  });

  describe('findHistory', () => {
    it('returns all versions newest first', async () => {
      await repo.save('app', DEFAULT_FULL_CONFIG);
      await repo.save('app', DEFAULT_FULL_CONFIG);
      await repo.save('app', DEFAULT_FULL_CONFIG);

      const history = await repo.findHistory('app');
      expect(history.length).toBe(3);
      // Newest (highest _version) first
      expect(history[0]._version).toBeGreaterThan(history[1]._version!);
    });
  });

  describe('getLatestVersion', () => {
    it('returns highest semver seen', async () => {
      await repo.save('app', DEFAULT_FULL_CONFIG);
      await repo.save('app', DEFAULT_FULL_CONFIG);
      const latest = await repo.getLatestVersion('app');
      expect(latest).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns null when no settings exist for key', async () => {
      const latest = await repo.getLatestVersion('nonexistent');
      expect(latest).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns settings by id', async () => {
      const saved = await repo.save('app', DEFAULT_FULL_CONFIG);
      const found = await repo.findById(saved.id!);
      expect(found).not.toBeNull();
      expect(found!.key).toBe('app');
    });
  });
});
