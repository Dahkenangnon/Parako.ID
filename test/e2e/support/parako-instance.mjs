import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SUPPORT_DIR, '../../..');

// gitleaks:allow -- deterministic local E2E runtime secret.
const TEST_SECRET = '0123456789abcdef'.repeat(4);

/** @typedef {{ client_id: string, [key: string]: unknown }} OidcClientFixture */
/** @typedef {{ oidc?: { path?: string, [key: string]: unknown }, [key: string]: unknown }} ParakoConfigFixture */
/** @typedef {{ slug: string, display_name: string }} TenantFixture */
/** @typedef {{ tenantId: string, client: OidcClientFixture }} TenantClientFixture */
/** @typedef {{ tenantId: string, value: Record<string, unknown> }} TenantOverrideFixture */

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

/**
 * @param {{
 *   port: number,
 *   config?: ParakoConfigFixture,
 *   clients?: OidcClientFixture[],
 *   environment?: 'development' | 'production' | 'staging'
 * }} options
 */
export async function startParakoInstance({
  port,
  config,
  clients = [],
  environment = 'development',
}) {
  const runtimeRoot = await fs.mkdtemp(
    path.join(tmpdir(), `parako-profile-e2e-${port}-`)
  );
  const runtimeDirectory = path.join(runtimeRoot, 'runtime');
  const databasePath = path.join(runtimeRoot, 'parako-e2e.db');
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
  await applySqliteMigrations(databasePath);
  seedOidcClients(databasePath, clients);

  if (config) {
    await fs.writeFile(
      path.join(runtimeDirectory, 'parako.json'),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8'
    );
  }

  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [path.join(PROJECT_ROOT, 'dist/src/index.js')],
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
        COOKIE_SECRET_1: `cookie-one-${TEST_SECRET}`,
        COOKIE_SECRET_2: `cookie-two-${TEST_SECRET}`,
        HMAC_SECRET: `hmac-${TEST_SECRET}`,
        REDIS_HOST: '',
        PM2_INSTANCES: '1',
        PARAKO_ROOT: runtimeRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const output = [];
  const capture = chunk => {
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
    await fs.rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }

  let stopped = false;
  return {
    origin,
    issuer: `${origin}${config?.oidc?.path ?? '/oidc/v1'}`,
    databasePath,
    logs,
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
 * @param {{
 *   port: number,
 *   tenants: TenantFixture[],
 *   clients: TenantClientFixture[],
 *   overrides?: TenantOverrideFixture[],
 *   config?: ParakoConfigFixture
 * }} options
 */
export async function startMongoMultiTenantParakoInstance({
  port,
  tenants,
  clients,
  overrides = [],
  config,
}) {
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: `parako-mt-e2e-${port}` },
  });
  const databaseName = `parako-mt-e2e-${port}`;
  const mongoUri = mongo.getUri(databaseName);
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();

  try {
    const database = mongoClient.db(databaseName);
    const now = new Date();
    await database.collection('tenants').insertMany(
      tenants.map(tenant => ({
        slug: tenant.slug,
        display_name: tenant.display_name,
        status: 'active',
        created_at: now,
        updated_at: now,
      }))
    );
    await database.collection('Client').insertMany(
      clients.map(({ tenantId, client }) => ({
        _id: `${tenantId.length}:${tenantId}:${client.client_id}`,
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
  const deploymentOrigin = `http://parako.localhost:${port}`;
  const child = spawn(
    process.execPath,
    [path.join(PROJECT_ROOT, 'dist/src/index.js')],
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
        MULTI_TENANCY_ENABLED: 'true',
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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const output = [];
  const capture = chunk => {
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
  return {
    origin,
    logs,
    issuer(tenantId) {
      return `http://${tenantId}.parako.localhost:${port}${config?.oidc?.path ?? '/oidc/v1'}`;
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
      await mongo.stop();
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}
