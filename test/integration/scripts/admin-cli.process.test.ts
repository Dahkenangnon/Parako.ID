import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
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
const adminEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'admin.js'
);
const prismaEntrypoint = join(
  repositoryRoot,
  'node_modules',
  'prisma',
  'build',
  'index.js'
);

const COMPILED_ADMIN_TEST_TIMEOUT_MS = 60_000;

// Compiled process startup is slower than in-process integration work,
// especially when the complete suite runs under coverage instrumentation.
vi.setConfig({ testTimeout: COMPILED_ADMIN_TEST_TIMEOUT_MS });

function runAdminBootstrap(
  temporaryRoot: string,
  email: string,
  environment: NodeJS.ProcessEnv,
  expiresMinutes = 10
) {
  return spawnSync(
    process.execPath,
    [
      adminEntrypoint,
      'bootstrap',
      '--email',
      email,
      '--expires-minutes',
      String(expiresMinutes),
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DEPLOYMENT_SERVER_PORT: '9007',
        DEPLOYMENT_URL: 'https://id.example.test',
        PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
        PARAKO_ROOT: repositoryRoot,
        ...environment,
      },
    }
  );
}

function runSqliteAdminBootstrap(
  databasePath: string,
  temporaryRoot: string,
  email: string,
  expiresMinutes = 10,
  environment: NodeJS.ProcessEnv = {}
) {
  return runAdminBootstrap(
    temporaryRoot,
    email,
    {
      DATABASE_URL: `file:${databasePath}`,
      STORAGE_ADAPTER: 'sqlite',
      STORAGE_SQLITE_PATH: databasePath,
      ...environment,
    },
    expiresMinutes
  );
}

describe.sequential('compiled administrator CLI with SQLite', () => {
  let databasePath: string;
  let temporaryRoot: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!existsSync(adminEntrypoint)) {
      throw new Error(
        'The compiled administrator CLI is missing. Run pnpm build before this integration suite.'
      );
    }

    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-admin-cli-sqlite-'));
    databasePath = join(temporaryRoot, 'parako.db');
    execFileSync(
      process.execPath,
      [prismaEntrypoint, 'db', 'push', '--config=prisma.config.ts'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          DATABASE_URL: `file:${databasePath}`,
          PARAKO_ENV_FILE: join(temporaryRoot, 'missing.env'),
          PARAKO_ROOT: repositoryRoot,
        },
        stdio: 'pipe',
      }
    );

    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${databasePath}` }),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({});
  });

  it('issues a single-use activation and persists only its hash', async () => {
    const startedAt = Date.now();
    const result = runSqliteAdminBootstrap(
      databasePath,
      temporaryRoot,
      'Admin@Example.test'
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const activationUrl = result.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    expect(activationUrl).toBeDefined();

    const token = new URL(activationUrl!).searchParams.get('token');
    expect(token).toMatch(/^[a-f0-9]{64}$/u);

    const administrator = await prisma.user.findUnique({
      where: { email: 'admin@example.test' },
    });
    expect(administrator).toMatchObject({
      account_enabled: true,
      email: 'admin@example.test',
      email_verified: true,
      password: null,
      roles: JSON.stringify(['admin']),
      tenant_id: 'default',
    });
    expect(administrator?.reset_password_token).toBe(
      createHash('sha256').update(token!).digest('hex')
    );
    expect(administrator?.reset_password_token).not.toBe(token);
    expect(
      administrator?.reset_password_expires?.getTime()
    ).toBeGreaterThanOrEqual(startedAt + 10 * 60_000);
    expect(
      administrator?.reset_password_expires?.getTime()
    ).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    expect(result.stdout).not.toContain(databasePath);
  }, 60_000); // Compiled process startup can exceed the shared budget under full-suite load.

  it('reissues the sole pending activation without creating another administrator', async () => {
    const firstResult = runSqliteAdminBootstrap(
      databasePath,
      temporaryRoot,
      'admin@example.test'
    );
    expect(firstResult.status, firstResult.stderr).toBe(0);
    const firstUrl = firstResult.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    const firstToken = new URL(firstUrl!).searchParams.get('token')!;
    const firstAdministrator = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@example.test' },
    });

    const secondResult = runSqliteAdminBootstrap(
      databasePath,
      temporaryRoot,
      'ADMIN@example.test'
    );
    expect(secondResult.status, secondResult.stderr).toBe(0);
    const secondUrl = secondResult.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    const secondToken = new URL(secondUrl!).searchParams.get('token')!;

    const administrators = await prisma.user.findMany();
    expect(administrators).toHaveLength(1);
    expect(administrators[0]?.id).toBe(firstAdministrator.id);
    expect(administrators[0]?.reset_password_token).toBe(
      createHash('sha256').update(secondToken).digest('hex')
    );
    expect(secondToken).not.toBe(firstToken);
    expect(administrators[0]?.reset_password_token).not.toBe(
      createHash('sha256').update(firstToken).digest('hex')
    );
  }, 60_000); // Two compiled CLI processes must complete under full-suite load.

  it('refuses to replace an activated administrator without leaking database details', async () => {
    await prisma.user.create({
      data: {
        account_enabled: true,
        email: 'active-admin@example.test',
        password: 'argon2id-test-hash',
        roles: JSON.stringify(['admin']),
        username: 'active-admin',
      },
    });

    const result = runSqliteAdminBootstrap(
      databasePath,
      temporaryRoot,
      'replacement@example.test'
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Administrator bootstrap failed: An activated administrator already exists.'
    );
    expect(result.stderr).not.toContain(databasePath);
    expect(result.stderr).not.toContain('argon2id-test-hash');
    await expect(prisma.user.count()).resolves.toBe(1);
  });

  it('fails closed before persistence when the deployment origin is missing', async () => {
    const result = runSqliteAdminBootstrap(
      databasePath,
      temporaryRoot,
      'admin@example.test',
      10,
      { DEPLOYMENT_URL: '' }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Administrator bootstrap failed: DEPLOYMENT_URL must be configured with HTTPS and be a valid URL.'
    );
    expect(result.stderr).not.toContain(databasePath);
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it('returns a failing status without exposing the SQLite location when the database is invalid', () => {
    const invalidDatabasePath = join(temporaryRoot, 'invalid.db');
    writeFileSync(invalidDatabasePath, 'not a SQLite database', {
      mode: 0o600,
    });

    const result = runSqliteAdminBootstrap(
      invalidDatabasePath,
      temporaryRoot,
      'admin@example.test'
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Administrator bootstrap failed:');
    expect(result.stderr).not.toContain(invalidDatabasePath);
    expect(result.stderr).not.toContain('https://id.example.test/auth');
  });
});

describe.sequential('compiled administrator CLI with MongoDB', () => {
  let client: MongoClient;
  let mongodb: MongoMemoryServer;
  let mongodbUri: string;
  let temporaryRoot: string;

  beforeAll(async () => {
    if (!existsSync(adminEntrypoint)) {
      throw new Error(
        'The compiled administrator CLI is missing. Run pnpm build before this integration suite.'
      );
    }

    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-admin-cli-mongodb-'));
    mongodb = await MongoMemoryServer.create();
    mongodbUri = mongodb.getUri('parako_admin_cli');
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
    await client.db().collection('users').deleteMany({});
  });

  it('issues a single-use activation through a real MongoDB process boundary', async () => {
    const result = runAdminBootstrap(temporaryRoot, 'Admin@Example.test', {
      DATABASE_URL: '',
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: mongodbUri,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const activationUrl = result.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    const token = new URL(activationUrl!).searchParams.get('token')!;

    const administrator = await client
      .db()
      .collection('users')
      .findOne({ email: 'admin@example.test' });
    expect(administrator).toMatchObject({
      account_enabled: true,
      email: 'admin@example.test',
      email_verified: true,
      roles: ['admin'],
      tenant_id: 'default',
    });
    expect(administrator?.reset_password_token).toBe(
      createHash('sha256').update(token).digest('hex')
    );
    expect(administrator?.reset_password_token).not.toBe(token);
    expect(result.stdout).not.toContain(mongodbUri);
  });

  it('reissues the matching pending MongoDB activation without inserting a duplicate', async () => {
    const firstResult = runAdminBootstrap(temporaryRoot, 'admin@example.test', {
      DATABASE_URL: '',
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: mongodbUri,
    });
    expect(firstResult.status, firstResult.stderr).toBe(0);
    const firstAdministrator = await client
      .db()
      .collection('users')
      .findOne({ email: 'admin@example.test' });

    const secondResult = runAdminBootstrap(
      temporaryRoot,
      'ADMIN@example.test',
      {
        DATABASE_URL: '',
        STORAGE_ADAPTER: 'mongodb',
        STORAGE_MONGODB_URI: mongodbUri,
      }
    );
    expect(secondResult.status, secondResult.stderr).toBe(0);
    const secondUrl = secondResult.stdout
      .split('\n')
      .find(line => line.startsWith('https://'));
    const secondToken = new URL(secondUrl!).searchParams.get('token')!;

    const administrators = await client
      .db()
      .collection('users')
      .find({})
      .toArray();
    expect(administrators).toHaveLength(1);
    expect(administrators[0]?._id).toEqual(firstAdministrator?._id);
    expect(administrators[0]?.reset_password_token).toBe(
      createHash('sha256').update(secondToken).digest('hex')
    );
  });

  it('refuses the single-tenant bootstrap command in multi-tenant mode', async () => {
    const result = runAdminBootstrap(temporaryRoot, 'admin@example.test', {
      DATABASE_URL: '',
      MULTI_TENANCY_ENABLED: 'true',
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: mongodbUri,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Administrator bootstrap failed: The administrator activation CLI supports only single-tenant deployments.'
    );
    expect(result.stderr).toContain('PARAKO_BOOTSTRAP_ADMIN_EMAIL');
    expect(result.stderr).not.toContain(mongodbUri);
    await expect(
      client.db().collection('users').countDocuments()
    ).resolves.toBe(0);
  });

  it('returns a failing status without exposing configuration when MongoDB is unavailable', () => {
    const unavailableUri = 'mongodb://127.0.0.1:1/parako_admin_cli';
    const result = runAdminBootstrap(temporaryRoot, 'admin@example.test', {
      DATABASE_URL: '',
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: unavailableUri,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Administrator bootstrap failed:');
    expect(result.stderr).not.toContain(unavailableUri);
    expect(result.stderr).not.toContain('https://id.example.test/auth');
  }, 20_000); // Server selection deliberately waits up to ten seconds; allow bounded process overhead.
});
