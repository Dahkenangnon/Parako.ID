import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IConfigManager } from '../../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import { DBKeyStore } from '../../../../src/oidc/key-store/db-key-store.js';
import { PrismaJwksKeyRepository } from '../../../../src/oidc/key-store/prisma-jwks-key.repository.js';

const TEST_DB = join(tmpdir(), `parako-jwks-prisma-${Date.now()}.db`);
const PRISMA_BIN = resolve(process.cwd(), 'node_modules', '.bin', 'prisma');

let prisma: PrismaClient;

beforeAll(() => {
  execFileSync(PRISMA_BIN, ['db', 'push', '--config=prisma.config.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${TEST_DB}` }),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe('PrismaJwksKeyRepository with DBKeyStore', () => {
  it('persists and reloads the initial encrypted JWKS keyset in SQLite', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      getLogger: vi.fn(),
      child: vi.fn(),
      flush: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as ILogger;
    const configManager = {
      getConfig: vi.fn().mockReturnValue({
        security: {
          secrets: { jwt_secret: 'sqlite-jwks-secret-that-is-long-enough' },
          key_store: {
            type: 'database',
            algorithms: ['ES256'],
            rotation_interval_days: 90,
            overlap_window_seconds: 7200,
          },
        },
      }),
      getConfigSection: vi.fn(),
      isLoaded: vi.fn().mockReturnValue(true),
    } as unknown as IConfigManager;

    await prisma.jwksKey.deleteMany();
    const store = new DBKeyStore(
      logger,
      configManager,
      new PrismaJwksKeyRepository(prisma)
    );

    await store.initialize();

    expect(await prisma.jwksKey.count()).toBe(1);
    const publicJwks = await store.getPublicJWKS();
    const privateJwks = await store.getJWKS();
    expect(publicJwks.keys).toHaveLength(1);
    expect(publicJwks.keys[0]).not.toHaveProperty('d');
    expect(privateJwks.keys[0]).toHaveProperty('d');

    const reloaded = new DBKeyStore(
      logger,
      configManager,
      new PrismaJwksKeyRepository(prisma)
    );
    await reloaded.initialize();
    expect(await prisma.jwksKey.count()).toBe(1);
  });
});
