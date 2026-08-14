import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresqlTestDatabase } from '../../e2e/support/parako-instance.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const databaseEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'database.js'
);
const baselineMigration = '20260714000000_baseline';

function runDatabase(
  temporaryRoot: string,
  databaseUrl: string,
  ...args: string[]
) {
  return spawnSync(process.execPath, [databaseEntrypoint, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
      PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
      PARAKO_ROOT: repositoryRoot,
      STORAGE_ADAPTER: 'postgresql',
      STORAGE_MONGODB_URI: '',
      STORAGE_POSTGRESQL_URL: databaseUrl,
      STORAGE_SQLITE_PATH: '',
    },
  });
}

async function createExistingPostgresqlSchema(
  databaseUrl: string
): Promise<void> {
  const database = new Client({ connectionString: databaseUrl });
  const baselineSql = readFileSync(
    join(
      repositoryRoot,
      'prisma',
      'migrations',
      'postgresql',
      baselineMigration,
      'migration.sql'
    ),
    'utf8'
  );
  try {
    await database.connect();
    await database.query(baselineSql);
  } finally {
    await database.end();
  }
}

describe.sequential('compiled database CLI with PostgreSQL', () => {
  let baselineDatabaseUrl: string;
  let dropBaselineDatabase: (() => Promise<void>) | undefined;
  let dropMigratedDatabase: (() => Promise<void>) | undefined;
  let migratedDatabaseUrl: string;
  let temporaryRoot: string;

  beforeAll(async () => {
    if (!existsSync(databaseEntrypoint)) {
      throw new Error(
        'The compiled database CLI is missing. Run pnpm build before this integration suite.'
      );
    }

    const administrativeUrl =
      process.env.STORAGE_POSTGRESQL_URL ??
      process.env.PARAKO_E2E_POSTGRESQL_URL;
    if (!administrativeUrl) {
      throw new Error(
        'STORAGE_POSTGRESQL_URL or PARAKO_E2E_POSTGRESQL_URL is required'
      );
    }

    temporaryRoot = mkdtempSync(
      join(tmpdir(), 'parako-database-cli-postgresql-')
    );
    const migratedFixture =
      await createPostgresqlTestDatabase(administrativeUrl);
    migratedDatabaseUrl = migratedFixture.databaseUrl;
    dropMigratedDatabase = migratedFixture.drop;

    const baselineFixture =
      await createPostgresqlTestDatabase(administrativeUrl);
    baselineDatabaseUrl = baselineFixture.databaseUrl;
    dropBaselineDatabase = baselineFixture.drop;
    await createExistingPostgresqlSchema(baselineDatabaseUrl);
  }, 120_000);

  afterAll(async () => {
    await dropBaselineDatabase?.();
    await dropMigratedDatabase?.();
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('deploys PostgreSQL migrations idempotently and reports healthy status', async () => {
    const first = runDatabase(temporaryRoot, migratedDatabaseUrl, 'migrate');
    expect(first.status, first.stdout + first.stderr).toBe(0);

    const database = new Client({ connectionString: migratedDatabaseUrl });
    await database.connect();
    const firstCount = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL`
    );
    expect(Number(firstCount.rows[0]?.count)).toBeGreaterThan(0);

    const second = runDatabase(temporaryRoot, migratedDatabaseUrl, 'migrate');
    expect(second.status, second.stdout + second.stderr).toBe(0);
    const secondCount = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL`
    );
    expect(secondCount.rows[0]?.count).toBe(firstCount.rows[0]?.count);

    const status = runDatabase(temporaryRoot, migratedDatabaseUrl, 'status');
    expect(status.status, status.stdout + status.stderr).toBe(0);
    expect(status.stdout + status.stderr).toContain(
      'Database schema is up to date'
    );
    await database.end();
  }, 120_000); // Three real Prisma processes own this bounded lifecycle test.

  it('records the confirmed baseline against an existing PostgreSQL schema', async () => {
    const result = runDatabase(
      temporaryRoot,
      baselineDatabaseUrl,
      'baseline',
      '--confirm-existing-schema'
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
    const database = new Client({ connectionString: baselineDatabaseUrl });
    await database.connect();
    const migrations = await database.query<{
      finished_at: Date | null;
      migration_name: string;
      rolled_back_at: Date | null;
    }>(
      `SELECT migration_name, finished_at, rolled_back_at
         FROM "_prisma_migrations"`
    );
    await database.end();

    expect(migrations.rows).toEqual([
      expect.objectContaining({
        finished_at: expect.any(Date),
        migration_name: baselineMigration,
        rolled_back_at: null,
      }),
    ]);
  }, 60_000); // Schema push is fixture setup; this ceiling covers the real resolve process.

  it.each(['status', 'migrate'])(
    'returns a failing %s status without exposing PostgreSQL credentials',
    command => {
      // gitleaks:allow -- deterministic credential for an unreachable local test endpoint.
      const unavailableUrl =
        'postgresql://parako_cli:public-test-password@127.0.0.1:1/parako_cli';
      const result = runDatabase(temporaryRoot, unavailableUrl, command);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Database command failed:');
      expect(result.stdout + result.stderr).not.toContain(unavailableUrl);
      expect(result.stdout + result.stderr).not.toContain(
        'public-test-password'
      );
    },
    30_000
  );
});
