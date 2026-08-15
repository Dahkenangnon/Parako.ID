import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const databaseEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'database.js'
);

const COMPILED_DATABASE_TEST_TIMEOUT_MS = 120_000;

// Database provisioning crosses compiled CLI and adapter process boundaries;
// keep the timeout local to this file so unrelated integration tests stay strict.
vi.setConfig({ testTimeout: COMPILED_DATABASE_TEST_TIMEOUT_MS });

function runDatabase(
  temporaryRoot: string,
  environment: NodeJS.ProcessEnv,
  ...args: string[]
) {
  return spawnSync(process.execPath, [databaseEntrypoint, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
      PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
      PARAKO_ROOT: repositoryRoot,
      ...environment,
    },
  });
}

function sqliteEnvironment(databasePath: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: `file:${databasePath}`,
    STORAGE_ADAPTER: 'sqlite',
    STORAGE_MONGODB_URI: '',
    STORAGE_POSTGRESQL_URL: '',
    STORAGE_SQLITE_PATH: databasePath,
  };
}

describe.sequential('compiled database CLI with SQLite', () => {
  let temporaryRoot: string;

  beforeAll(() => {
    if (!existsSync(databaseEntrypoint)) {
      throw new Error(
        'The compiled database CLI is missing. Run pnpm build before this integration suite.'
      );
    }
    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-database-cli-sqlite-'));
  });

  afterAll(() => {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('deploys every SQLite migration idempotently through the compiled command', () => {
    const databasePath = join(temporaryRoot, 'migrate.db');
    const environment = sqliteEnvironment(databasePath);

    const first = runDatabase(temporaryRoot, environment, 'migrate');
    expect(first.status, first.stdout + first.stderr).toBe(0);

    const database = new Database(databasePath, { readonly: true });
    const firstCount = database
      .prepare(
        'SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL'
      )
      .pluck()
      .get() as number;
    database.close();
    expect(firstCount).toBeGreaterThan(0);

    const second = runDatabase(temporaryRoot, environment, 'migrate');
    expect(second.status, second.stdout + second.stderr).toBe(0);

    const reopened = new Database(databasePath, { readonly: true });
    const secondCount = reopened
      .prepare(
        'SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL'
      )
      .pluck()
      .get() as number;
    reopened.close();
    expect(secondCount).toBe(firstCount);
    expect(first.stdout + first.stderr).not.toContain('Prisma exited');
    expect(second.stdout + second.stderr).not.toContain('Prisma exited');
  }, 120_000);

  it('reports a migrated SQLite database as healthy', () => {
    const databasePath = join(temporaryRoot, 'status.db');
    const environment = sqliteEnvironment(databasePath);
    const migrated = runDatabase(temporaryRoot, environment, 'migrate');
    expect(migrated.status, migrated.stdout + migrated.stderr).toBe(0);

    const result = runDatabase(temporaryRoot, environment, 'status');

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain(
      'Database schema is up to date'
    );
  }, 120_000);

  it.each(['status', 'migrate'])(
    'returns a failing %s status when SQLite cannot open the configured database',
    command => {
      const directoryPath = join(temporaryRoot, `not-a-database-${command}`);
      mkdirSync(directoryPath);
      const result = runDatabase(
        temporaryRoot,
        sqliteEnvironment(directoryPath),
        command
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Database command failed:');
      expect(result.stderr).not.toContain('undefined');
      expect(result.stdout + result.stderr).not.toContain(directoryPath);
    },
    120_000 // Prisma CLI startup owns most of this bounded process duration.
  );

  it('rejects an unsupported adapter through the compiled boundary', () => {
    const result = runDatabase(
      temporaryRoot,
      {
        DATABASE_URL: '',
        STORAGE_ADAPTER: 'mysql',
        STORAGE_MONGODB_URI: '',
        STORAGE_POSTGRESQL_URL: '',
        STORAGE_SQLITE_PATH: '',
      },
      'status'
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Unsupported STORAGE_ADAPTER "mysql". Expected sqlite, postgresql, or mongodb.'
    );
  });

  it('refuses baseline without the explicit destructive confirmation', () => {
    const result = runDatabase(
      temporaryRoot,
      sqliteEnvironment(join(temporaryRoot, 'baseline.db')),
      'baseline'
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Refusing to baseline without --confirm-existing-schema'
    );
  });

  it('records the confirmed baseline against an existing SQLite schema', () => {
    const databasePath = join(temporaryRoot, 'existing-schema.db');
    const baselineMigration = '20260714000000_baseline';
    const baselineSql = readFileSync(
      join(
        repositoryRoot,
        'prisma',
        'migrations',
        'sqlite',
        baselineMigration,
        'migration.sql'
      ),
      'utf8'
    );
    const database = new Database(databasePath);
    database.exec(baselineSql);
    database.close();

    const result = runDatabase(
      temporaryRoot,
      sqliteEnvironment(databasePath),
      'baseline',
      '--confirm-existing-schema'
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
    const verified = new Database(databasePath, { readonly: true });
    const migration = verified
      .prepare(
        'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations'
      )
      .get() as {
      finished_at: string | null;
      migration_name: string;
      rolled_back_at: string | null;
    };
    verified.close();
    expect(migration).toMatchObject({
      migration_name: baselineMigration,
      rolled_back_at: null,
    });
    expect(migration.finished_at).not.toBeNull();
  }, 120_000);
});

describe.sequential('compiled database CLI with MongoDB', () => {
  let client: MongoClient;
  let mongodb: MongoMemoryServer;
  let mongodbUri: string;
  let temporaryRoot: string;

  beforeAll(async () => {
    if (!existsSync(databaseEntrypoint)) {
      throw new Error(
        'The compiled database CLI is missing. Run pnpm build before this integration suite.'
      );
    }

    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-database-cli-mongodb-'));
    mongodb = await MongoMemoryServer.create();
    mongodbUri = mongodb.getUri('parako_database_cli');
    client = new MongoClient(mongodbUri);
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await mongodb?.stop();
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await client.db().dropDatabase();
  });

  function environment(uri = mongodbUri): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: '',
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: uri,
      STORAGE_POSTGRESQL_URL: '',
      STORAGE_SQLITE_PATH: '',
    };
  }

  it('reports a reachable MongoDB database before its ledger exists', () => {
    const result = runDatabase(temporaryRoot, environment(), 'status');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'MongoDB is reachable; migration ledger is not initialized.'
    );
  });

  it('initializes the migration ledger idempotently and reports recorded migrations', async () => {
    const first = runDatabase(temporaryRoot, environment(), 'migrate');
    const second = runDatabase(temporaryRoot, environment(), 'migrate');

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toContain(
      'MongoDB migration ledger is ready; no migrations are pending.'
    );
    const indexes = await client
      .db()
      .collection('_parako_migrations')
      .indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { id: 1 }, unique: true }),
      ])
    );

    await client.db().collection('_parako_migrations').insertOne({
      id: '20260812000100_test',
      appliedAt: '2026-08-12T00:01:00.000Z',
    });
    const status = runDatabase(temporaryRoot, environment(), 'status');

    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain(
      'MongoDB is reachable; 1 application migration(s) recorded.'
    );
    expect(status.stdout).toContain(
      '20260812000100_test  2026-08-12T00:01:00.000Z'
    );
  }, 30_000); // Three compiled CLI processes must complete under full-suite coverage.

  it('rejects the Prisma baseline command without altering MongoDB', async () => {
    const result = runDatabase(
      temporaryRoot,
      environment(),
      'baseline',
      '--confirm-existing-schema'
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'MongoDB does not use the Prisma baseline command.'
    );
    await expect(
      client.db().collection('_parako_migrations').countDocuments()
    ).resolves.toBe(0);
  });

  it.each(['status', 'migrate'])(
    'fails the %s command safely when MongoDB is unavailable',
    command => {
      // gitleaks:allow -- deterministic credential for an unreachable local test endpoint.
      const unavailableUri =
        'mongodb://public_test_user:public-test-password@127.0.0.1:1/parako_database_cli';
      const result = runDatabase(
        temporaryRoot,
        environment(unavailableUri),
        command
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Database command failed:');
      expect(result.stderr).not.toContain(unavailableUri);
      expect(result.stderr).not.toContain('public-test-password');
    },
    20_000 // MongoDB server selection is intentionally bounded at ten seconds.
  );
});
