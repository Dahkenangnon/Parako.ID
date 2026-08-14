import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Client as PostgresqlClient } from 'pg';

import {
  MongoFixtureStore,
  PostgresqlFixtureStore,
  SqliteFixtureStore,
} from './fixture-store.mjs';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SUPPORT_DIR, '../../..');

/** @param {string | undefined} backchannelCaptureUrl */
function parakoRuntimeArguments(backchannelCaptureUrl) {
  return [
    ...(backchannelCaptureUrl
      ? ['--import', path.join(SUPPORT_DIR, 'mock-oidc-outbound.mjs')]
      : []),
    path.join(PROJECT_ROOT, 'dist/src/index.js'),
  ];
}

// gitleaks:allow -- deterministic local E2E runtime secret.
const TEST_SECRET = '0123456789abcdef'.repeat(4);
export const TEST_COOKIE_SECRET = `cookie-one-${TEST_SECRET}`;

/**
 * Mirror the production Mongo OIDC adapter's physical ID rule. The default
 * single-tenant namespace preserves historical logical IDs; named tenants use
 * a length-prefixed namespace to prevent collisions.
 *
 * @param {string} tenantId
 * @param {string} logicalId
 */
export function mongoFixtureDocumentId(tenantId, logicalId) {
  return tenantId === 'default'
    ? logicalId
    : `${tenantId.length}:${tenantId}:${logicalId}`;
}

/** @typedef {{ client_id: string, [key: string]: unknown }} OidcClientFixture */
/** @typedef {{ oidc?: { path?: string, [key: string]: unknown }, [key: string]: unknown }} ParakoConfigFixture */
/** @typedef {{ slug: string, display_name: string, domain?: string, issuer_url?: string, status?: 'active' | 'suspended' | 'archived' }} TenantFixture */
/** @typedef {{ tenantId: string, client: OidcClientFixture }} TenantClientFixture */
/** @typedef {{ tenantId: string, value: Record<string, unknown> }} TenantOverrideFixture */
/** @typedef {{ path: string, contents: string | Uint8Array }} UploadFixture */

/**
 * Seed local-storage files inside a disposable runtime. Test fixtures must use
 * relative storage keys so a malformed test can never write outside the
 * runtime root.
 *
 * @param {string} runtimeDirectory
 * @param {UploadFixture[]} uploads
 */
async function seedUploadFixtures(runtimeDirectory, uploads) {
  const uploadsRoot = path.resolve(runtimeDirectory, 'uploads');

  for (const upload of uploads) {
    const destination = path.resolve(uploadsRoot, upload.path);
    const relativePath = path.relative(uploadsRoot, destination);
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Invalid E2E upload fixture path: ${upload.path}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, upload.contents);
  }
}

/** @param {string} databasePath */
export async function applySqliteMigrations(databasePath) {
  const migrationsRoot = path.join(PROJECT_ROOT, 'prisma/migrations/sqlite');
  const directories = (
    await fs.readdir(migrationsRoot, { withFileTypes: true })
  )
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const database = new Database(databasePath);

  try {
    for (const directory of directories) {
      const sql = await fs.readFile(
        path.join(migrationsRoot, directory, 'migration.sql'),
        'utf8'
      );
      database.exec(sql);
    }
  } finally {
    database.close();
  }
}

/**
 * @param {string} databasePath
 * @param {OidcClientFixture[]} clients
 */
export function seedOidcClients(databasePath, clients) {
  if (clients.length === 0) return;

  const database = new Database(databasePath);
  const createdAt = new Date().toISOString();
  const insertClient = database.prepare(
    `INSERT INTO oidc_store
       (id, model, payload, client_id, tenant_id, created_at)
     VALUES (?, 'Client', ?, ?, 'default', ?)`
  );

  try {
    const insertAll = database.transaction(() => {
      for (const client of clients) {
        insertClient.run(
          client.client_id,
          JSON.stringify({
            active: true,
            created_at: createdAt,
            updated_at: createdAt,
            ...client,
          }),
          client.client_id,
          createdAt
        );
      }
    });
    insertAll();
  } finally {
    database.close();
  }
}

/** @param {string} databaseUrl */
export async function applyPostgresqlMigrations(databaseUrl) {
  const migrationsRoot = path.join(
    PROJECT_ROOT,
    'prisma/migrations/postgresql'
  );
  const directories = (
    await fs.readdir(migrationsRoot, { withFileTypes: true })
  )
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const client = new PostgresqlClient({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const directory of directories) {
      const sql = await fs.readFile(
        path.join(migrationsRoot, directory, 'migration.sql'),
        'utf8'
      );
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

/**
 * Create a uniquely named child database from an administrative PostgreSQL URL.
 * The generated name contains only lowercase ASCII letters, digits, and
 * underscores, so quoting it cannot introduce SQL syntax.
 *
 * @param {string} administrativeUrl
 */
export async function createPostgresqlTestDatabase(administrativeUrl) {
  const databaseName = `parako_e2e_${randomUUID().replaceAll('-', '')}`;
  const admin = new PostgresqlClient({ connectionString: administrativeUrl });
  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }

  const childUrl = new URL(administrativeUrl);
  childUrl.pathname = `/${databaseName}`;
  const databaseUrl = childUrl.toString();
  let dropped = false;

  return {
    databaseUrl,
    async drop() {
      if (dropped) return;
      dropped = true;
      const cleanup = new PostgresqlClient({
        connectionString: administrativeUrl,
      });
      await cleanup.connect();
      try {
        await cleanup.query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [databaseName]
        );
        await cleanup.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/**
 * @param {string} databaseUrl
 * @param {TenantFixture[]} tenants
 * @param {TenantClientFixture[]} clients
 */
export async function seedPostgresqlFixtures(databaseUrl, tenants, clients) {
  if (tenants.length === 0 && clients.length === 0) return;
  const database = new PostgresqlClient({ connectionString: databaseUrl });
  await database.connect();

  try {
    for (const tenant of tenants) {
      await database.query(
        `INSERT INTO tenants
           (id, slug, display_name, domain, issuer_url, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [
          randomUUID(),
          tenant.slug,
          tenant.display_name,
          tenant.domain ?? null,
          tenant.issuer_url ?? null,
          tenant.status ?? 'active',
        ]
      );
    }
    for (const { tenantId, client } of clients) {
      const payload = {
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...client,
      };
      await database.query('BEGIN');
      try {
        // PostgreSQL tenant tables use forced RLS. Seeding must exercise the
        // same tenant context boundary as application queries.
        await database.query("SELECT set_config('app.tenant_id', $1, true)", [
          tenantId,
        ]);
        await database.query(
          `INSERT INTO oidc_store
             (id, model, payload, client_id, tenant_id, created_at)
           VALUES ($1, 'Client', $2, $3, $4, NOW())`,
          [
            client.client_id,
            JSON.stringify(payload),
            client.client_id,
            tenantId,
          ]
        );
        await database.query('COMMIT');
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await database.end();
  }
}

/**
 * @param {string} url
 * @param {import('node:child_process').ChildProcess} child
 * @param {() => string} logs
 */
export async function waitForReady(url, child, logs) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Parako exited before readiness with code ${child.exitCode}\n${logs()}`
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}\n${logs()}`);
}

async function signalChild(child, signal = 'SIGTERM') {
  if (child.exitCode !== null) return child.exitCode;
  child.kill(signal);
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ]);
  return child.exitCode;
}

/**
 * @param {{
 *   port: number,
 *   config?: ParakoConfigFixture,
 *   clients?: OidcClientFixture[],
 *   uploads?: UploadFixture[],
 *   backchannelCaptureUrl?: string,
 *   deploymentUrl?: string,
 *   environment?: 'development' | 'production' | 'staging'
 * }} options
 */
export async function startParakoInstance({
  port,
  config,
  clients = [],
  uploads = [],
  backchannelCaptureUrl,
  deploymentUrl,
  environment = 'development',
}) {
  const runtimeRoot = await fs.mkdtemp(
    path.join(tmpdir(), `parako-profile-e2e-${port}-`)
  );
  const runtimeDirectory = path.join(runtimeRoot, 'runtime');
  const databasePath = path.join(runtimeRoot, 'parako-e2e.db');
  await fs.mkdir(runtimeDirectory, { recursive: true });
  await seedUploadFixtures(runtimeDirectory, uploads);
  for (const directory of ['dist', 'public']) {
    await fs.symlink(
      path.join(PROJECT_ROOT, directory),
      path.join(runtimeRoot, directory),
      'dir'
    );
  }
  await fs.symlink(
    path.join(PROJECT_ROOT, 'package.json'),
    path.join(runtimeRoot, 'package.json'),
    'file'
  );
  await fs.symlink(
    path.join(PROJECT_ROOT, 'runtime/locales'),
    path.join(runtimeDirectory, 'locales'),
    'dir'
  );
  await applySqliteMigrations(databasePath);
  seedOidcClients(databasePath, clients);

  if (config) {
    await fs.writeFile(
      path.join(runtimeDirectory, 'parako.json'),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8'
    );
  }

  const runtimeOrigin = `http://127.0.0.1:${port}`;
  const origin = deploymentUrl ?? runtimeOrigin;
  const child = spawn(
    process.execPath,
    parakoRuntimeArguments(backchannelCaptureUrl),
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        NODE_ENV: environment,
        DEPLOYMENT_ENVIRONMENT: environment,
        DEPLOYMENT_SERVER_PORT: String(port),
        DEPLOYMENT_URL: origin,
        STORAGE_ADAPTER: 'sqlite',
        STORAGE_SQLITE_PATH: databasePath,
        OIDC_STORAGE_ADAPTER: 'sqlite',
        FILE_STORAGE_PROVIDER: 'local',
        MULTI_TENANCY_ENABLED: 'false',
        USE_FILE_CONFIG: config ? 'true' : 'false',
        ENCRYPTION_KEY: TEST_SECRET,
        JWT_SECRET: `jwt-${TEST_SECRET}`,
        COOKIE_SECRET_1: TEST_COOKIE_SECRET,
        COOKIE_SECRET_2: `cookie-two-${TEST_SECRET}`,
        HMAC_SECRET: `hmac-${TEST_SECRET}`,
        REDIS_HOST: '',
        PM2_INSTANCES: '1',
        PARAKO_ROOT: runtimeRoot,
        ...(backchannelCaptureUrl
          ? { PARAKO_E2E_BACKCHANNEL_CAPTURE_URL: backchannelCaptureUrl }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const output = [];
  const capture = chunk => {
    if (process.env.PARAKO_E2E_STREAM_RUNTIME_LOGS === 'true') {
      process.stderr.write(chunk);
    }
    output.push(String(chunk));
    if (output.length > 400) output.splice(0, output.length - 400);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const logs = () => output.join('');

  try {
    await waitForReady(`${runtimeOrigin}/readyz`, child, logs);
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }

  let stopped = false;
  return {
    origin,
    issuer: `${origin}${config?.oidc?.path ?? '/oidc/v1'}`,
    databasePath,
    fixtureStore: new SqliteFixtureStore(databasePath),
    logs,
    shutdown: () => signalChild(child),
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          once(child, 'exit'),
          new Promise(resolve => setTimeout(resolve, 10_000)),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Start a disposable PostgreSQL-backed Parako process. The supplied URL must
 * identify an administrative database whose role may create and drop a child
 * database. CI can provide a PostgreSQL service URL; local runs may point at a
 * temporary container without coupling product packaging to Docker.
 *
 * @param {{
 *   port: number,
 *   postgresqlUrl: string,
 *   multiTenancy: boolean,
 *   tenants?: TenantFixture[],
 *   clients?: TenantClientFixture[],
 *   config?: ParakoConfigFixture,
 *   backchannelCaptureUrl?: string,
 *   deploymentUrl?: string
 * }} options
 */
export async function startPostgresqlParakoInstance({
  port,
  postgresqlUrl,
  multiTenancy,
  tenants = [],
  clients = [],
  config,
  backchannelCaptureUrl,
  deploymentUrl,
}) {
  const testDatabase = await createPostgresqlTestDatabase(postgresqlUrl);
  let runtimeRoot;

  try {
    await applyPostgresqlMigrations(testDatabase.databaseUrl);
    await seedPostgresqlFixtures(testDatabase.databaseUrl, tenants, clients);

    runtimeRoot = await fs.mkdtemp(
      path.join(tmpdir(), `parako-pg-${multiTenancy ? 'mt' : 'st'}-${port}-`)
    );
    const runtimeDirectory = path.join(runtimeRoot, 'runtime');
    await fs.mkdir(runtimeDirectory, { recursive: true });
    for (const directory of ['dist', 'public', 'prisma']) {
      await fs.symlink(
        path.join(PROJECT_ROOT, directory),
        path.join(runtimeRoot, directory),
        'dir'
      );
    }
    await fs.symlink(
      path.join(PROJECT_ROOT, 'package.json'),
      path.join(runtimeRoot, 'package.json'),
      'file'
    );
    await fs.symlink(
      path.join(PROJECT_ROOT, 'runtime/locales'),
      path.join(runtimeDirectory, 'locales'),
      'dir'
    );
    if (config) {
      await fs.writeFile(
        path.join(runtimeDirectory, 'parako.json'),
        `${JSON.stringify(config, null, 2)}\n`,
        'utf8'
      );
    }

    const origin = `http://127.0.0.1:${port}`;
    const deploymentOrigin =
      deploymentUrl ??
      (multiTenancy ? `http://parako.localhost:${port}` : origin);
    const child = spawn(
      process.execPath,
      parakoRuntimeArguments(backchannelCaptureUrl),
      {
        cwd: runtimeRoot,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DEPLOYMENT_ENVIRONMENT: 'development',
          DEPLOYMENT_SERVER_PORT: String(port),
          DEPLOYMENT_URL: deploymentOrigin,
          STORAGE_ADAPTER: 'postgresql',
          STORAGE_POSTGRESQL_URL: testDatabase.databaseUrl,
          DATABASE_URL: testDatabase.databaseUrl,
          OIDC_STORAGE_ADAPTER: 'postgresql',
          FILE_STORAGE_PROVIDER: 'local',
          MULTI_TENANCY_ENABLED: String(multiTenancy),
          MULTI_TENANCY_EXTRACTION_PRIORITY: 'header,subdomain',
          MULTI_TENANCY_TENANT_HEADER: 'x-tenant-id',
          USE_FILE_CONFIG: config ? 'true' : 'false',
          ENCRYPTION_KEY: TEST_SECRET,
          JWT_SECRET: `jwt-${TEST_SECRET}`,
          COOKIE_SECRET_1: `cookie-one-${TEST_SECRET}`,
          COOKIE_SECRET_2: `cookie-two-${TEST_SECRET}`,
          HMAC_SECRET: `hmac-${TEST_SECRET}`,
          REDIS_HOST: '',
          PM2_INSTANCES: '1',
          PARAKO_ROOT: runtimeRoot,
          ...(backchannelCaptureUrl
            ? { PARAKO_E2E_BACKCHANNEL_CAPTURE_URL: backchannelCaptureUrl }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const output = [];
    const capture = chunk => {
      if (process.env.PARAKO_E2E_STREAM_RUNTIME_LOGS === 'true') {
        process.stderr.write(chunk);
      }
      output.push(String(chunk));
      if (output.length > 400) output.splice(0, output.length - 400);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const logs = () => output.join('');

    try {
      await waitForReady(`${origin}/readyz`, child, logs);
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGTERM');
      throw error;
    }

    let stopped = false;
    return {
      origin: deploymentOrigin,
      databaseUrl: testDatabase.databaseUrl,
      logs,
      shutdown: () => signalChild(child),
      stopDatabase: () => testDatabase.drop(),
      fixtureStore(tenantId = 'default') {
        return new PostgresqlFixtureStore(testDatabase.databaseUrl, tenantId);
      },
      issuer(tenantId) {
        const issuerUrl = new URL(deploymentOrigin);
        if (multiTenancy) {
          issuerUrl.hostname = `${tenantId}.${issuerUrl.hostname}`;
        }
        const issuerOrigin = issuerUrl.origin;
        return `${issuerOrigin}${config?.oidc?.path ?? '/oidc/v1'}`;
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        if (child.exitCode === null) {
          child.kill('SIGTERM');
          await Promise.race([
            once(child, 'exit'),
            new Promise(resolve => setTimeout(resolve, 10_000)),
          ]);
          if (child.exitCode === null) child.kill('SIGKILL');
        }
        await fs.rm(runtimeRoot, { recursive: true, force: true });
        await testDatabase.drop();
      },
    };
  } catch (error) {
    if (runtimeRoot) {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
    await testDatabase.drop();
    throw error;
  }
}

/**
 * @param {{
 *   port: number,
 *   multiTenancy: boolean,
 *   tenants?: TenantFixture[],
 *   clients?: TenantClientFixture[],
 *   overrides?: TenantOverrideFixture[],
 *   config?: ParakoConfigFixture,
 *   backchannelCaptureUrl?: string,
 *   deploymentUrl?: string
 * }} options
 */
async function startMongoParakoInstance({
  port,
  multiTenancy,
  tenants = [],
  clients = [],
  overrides = [],
  config,
  backchannelCaptureUrl,
  deploymentUrl,
}) {
  const mongo = await MongoMemoryServer.create({
    instance: {
      dbName: `parako-${multiTenancy ? 'mt' : 'st'}-e2e-${port}`,
    },
  });
  const databaseName = `parako-${multiTenancy ? 'mt' : 'st'}-e2e-${port}`;
  const mongoUri = mongo.getUri(databaseName);
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();

  try {
    const database = mongoClient.db(databaseName);
    const now = new Date();
    if (tenants.length > 0) {
      await database.collection('tenants').insertMany(
        tenants.map(tenant => ({
          slug: tenant.slug,
          display_name: tenant.display_name,
          ...(tenant.domain ? { domain: tenant.domain } : {}),
          ...(tenant.issuer_url ? { issuer_url: tenant.issuer_url } : {}),
          status: tenant.status ?? 'active',
          created_at: now,
          updated_at: now,
        }))
      );
    }
    if (clients.length > 0) {
      await database.collection('Client').insertMany(
        clients.map(({ tenantId, client }) => ({
          _id: mongoFixtureDocumentId(tenantId, client.client_id),
          logical_id: client.client_id,
          tenant_id: tenantId,
          payload: {
            active: true,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            ...client,
          },
        }))
      );
    }
    if (overrides.length > 0) {
      await database.collection('tenantsettingsoverrides').insertMany(
        overrides.map(({ tenantId, value }) => ({
          ...value,
          tenant_id: tenantId,
          key: 'parako_config',
          version: '1.0.0',
          _version: 0,
          is_active: true,
          created_at: now,
          updated_at: now,
        }))
      );
    }
  } finally {
    await mongoClient.close();
  }

  const runtimeRoot = await fs.mkdtemp(
    path.join(tmpdir(), `parako-mt-e2e-${port}-`)
  );
  const runtimeDirectory = path.join(runtimeRoot, 'runtime');
  await fs.mkdir(runtimeDirectory, { recursive: true });
  for (const directory of ['dist', 'public']) {
    await fs.symlink(
      path.join(PROJECT_ROOT, directory),
      path.join(runtimeRoot, directory),
      'dir'
    );
  }
  await fs.symlink(
    path.join(PROJECT_ROOT, 'package.json'),
    path.join(runtimeRoot, 'package.json'),
    'file'
  );
  await fs.symlink(
    path.join(PROJECT_ROOT, 'runtime/locales'),
    path.join(runtimeDirectory, 'locales'),
    'dir'
  );
  if (config) {
    await fs.writeFile(
      path.join(runtimeDirectory, 'parako.json'),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8'
    );
  }

  const origin = `http://127.0.0.1:${port}`;
  const deploymentOrigin =
    deploymentUrl ??
    (multiTenancy ? `http://parako.localhost:${port}` : origin);
  const child = spawn(
    process.execPath,
    parakoRuntimeArguments(backchannelCaptureUrl),
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DEPLOYMENT_ENVIRONMENT: 'development',
        DEPLOYMENT_SERVER_PORT: String(port),
        DEPLOYMENT_URL: deploymentOrigin,
        STORAGE_ADAPTER: 'mongodb',
        STORAGE_MONGODB_URI: mongoUri,
        OIDC_STORAGE_ADAPTER: 'mongodb',
        FILE_STORAGE_PROVIDER: 'local',
        MULTI_TENANCY_ENABLED: String(multiTenancy),
        MULTI_TENANCY_EXTRACTION_PRIORITY: 'header,subdomain',
        MULTI_TENANCY_TENANT_HEADER: 'x-tenant-id',
        USE_FILE_CONFIG: config ? 'true' : 'false',
        ENCRYPTION_KEY: TEST_SECRET,
        JWT_SECRET: `jwt-${TEST_SECRET}`,
        COOKIE_SECRET_1: `cookie-one-${TEST_SECRET}`,
        COOKIE_SECRET_2: `cookie-two-${TEST_SECRET}`,
        HMAC_SECRET: `hmac-${TEST_SECRET}`,
        REDIS_HOST: '',
        PM2_INSTANCES: '1',
        PARAKO_ROOT: runtimeRoot,
        ...(backchannelCaptureUrl
          ? { PARAKO_E2E_BACKCHANNEL_CAPTURE_URL: backchannelCaptureUrl }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const output = [];
  const capture = chunk => {
    if (process.env.PARAKO_E2E_STREAM_RUNTIME_LOGS === 'true') {
      process.stderr.write(chunk);
    }
    output.push(String(chunk));
    if (output.length > 400) output.splice(0, output.length - 400);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const logs = () => output.join('');

  try {
    await waitForReady(`${origin}/readyz`, child, logs);
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGTERM');
    await mongo.stop();
    await fs.rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }

  let stopped = false;
  let databaseStopped = false;
  const fixtureClient = new MongoClient(mongoUri);
  await fixtureClient.connect();
  const stopDatabase = async () => {
    if (databaseStopped) return;
    databaseStopped = true;
    await mongo.stop();
  };
  return {
    origin: deploymentOrigin,
    logs,
    shutdown: () => signalChild(child),
    fixtureStore(tenantId = 'default') {
      return new MongoFixtureStore(fixtureClient.db(databaseName), tenantId);
    },
    stopDatabase,
    issuer(tenantId) {
      const issuerUrl = new URL(deploymentOrigin);
      if (multiTenancy) {
        issuerUrl.hostname = `${tenantId}.${issuerUrl.hostname}`;
      }
      const issuerOrigin = issuerUrl.origin;
      return `${issuerOrigin}${config?.oidc?.path ?? '/oidc/v1'}`;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          once(child, 'exit'),
          new Promise(resolve => setTimeout(resolve, 10_000)),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      await fixtureClient.close();
      await stopDatabase();
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

/** Start a disposable single-tenant MongoDB-backed Parako process. */
export async function startMongoSingleTenantParakoInstance(options) {
  const instance = await startMongoParakoInstance({
    ...options,
    multiTenancy: false,
  });
  const { issuer, ...runtime } = instance;
  return { ...runtime, issuer: issuer() };
}

/** Start a disposable multi-tenant MongoDB-backed Parako process. */
export async function startMongoMultiTenantParakoInstance(options) {
  return await startMongoParakoInstance({
    ...options,
    multiTenancy: true,
  });
}
