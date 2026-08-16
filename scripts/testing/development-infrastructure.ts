import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';

import type { RedisDiagnosticConfig } from '../manage/shared/redis-config.ts';
import { Client } from 'pg';

import { checkRedisAvailability } from '../../src/jobs/redis.ts';

export interface DevelopmentInfrastructureAdapter {
  ensurePostgresql(options: {
    configuredUrl?: string;
    root: string;
  }): Promise<string>;
  ensureRedis(options: {
    config: RedisDiagnosticConfig;
    root: string;
  }): Promise<void>;
}

export interface DevelopmentInfrastructureOptions {
  adapter: DevelopmentInfrastructureAdapter;
  environment: NodeJS.ProcessEnv;
  root: string;
}

export interface DevelopmentInfrastructureResult {
  postgresqlUrl: string;
  redis: RedisDiagnosticConfig;
}

function optionalValue(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  description: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${description} must be an integer from ${minimum} to ${maximum}`
    );
  }
  return parsed;
}

function resolveTestRedisConfig(
  environment: NodeJS.ProcessEnv
): RedisDiagnosticConfig {
  const host = optionalValue(
    environment.PARAKO_E2E_REDIS_HOST ?? environment.REDIS_HOST
  );
  if (!host) {
    throw new Error(
      'REDIS_HOST or PARAKO_E2E_REDIS_HOST is required for development setup'
    );
  }

  return {
    host,
    port: parseInteger(
      environment.PARAKO_E2E_REDIS_PORT ?? environment.REDIS_PORT,
      6379,
      'Redis port',
      1,
      65_535
    ),
    database: parseInteger(
      environment.PARAKO_E2E_REDIS_DATABASE,
      15,
      'Redis test database',
      0
    ),
    password: optionalValue(
      environment.PARAKO_E2E_REDIS_PASSWORD ?? environment.REDIS_PASSWORD
    ),
  };
}

function appendMissingEnvironmentValues(
  path: string,
  existing: NodeJS.ProcessEnv,
  values: Record<string, string | undefined>
): void {
  const contents = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const additions = Object.entries(values).filter(
    ([name, value]) => value !== undefined && existing[name] === undefined
  );
  if (additions.length === 0) return;

  const separator = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
  const lines = additions.map(([name, value]) => `${name}=${value}`).join('\n');
  appendFileSync(
    path,
    `${separator}\n# Local test infrastructure\n${lines}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );
}

export async function ensureDevelopmentTestInfrastructure({
  adapter,
  environment,
  root,
}: DevelopmentInfrastructureOptions): Promise<DevelopmentInfrastructureResult> {
  const configuredUrl = optionalValue(environment.PARAKO_E2E_POSTGRESQL_URL);
  const postgresqlUrl = await adapter.ensurePostgresql({ configuredUrl, root });
  const redis = resolveTestRedisConfig(environment);
  await adapter.ensureRedis({ config: redis, root });

  appendMissingEnvironmentValues(resolve(root, 'runtime/.env'), environment, {
    PARAKO_E2E_POSTGRESQL_URL: postgresqlUrl,
    PARAKO_E2E_REDIS_HOST: redis.host,
    PARAKO_E2E_REDIS_PORT: String(redis.port),
    PARAKO_E2E_REDIS_DATABASE: String(redis.database ?? 15),
    PARAKO_E2E_REDIS_PASSWORD: redis.password,
  });

  return { postgresqlUrl, redis };
}

export interface DevelopmentInfrastructureCommandResult {
  status: number | null;
  stderr?: string;
  stdout?: string;
}

export interface DevelopmentInfrastructureSystem {
  createPostgresqlDatabase(url: string): Promise<void>;
  findCommand(name: string): string | undefined;
  isPortAvailable(host: string, port: number): Promise<boolean>;
  probePostgresql(url: string): Promise<void>;
  probeRedis(config: RedisDiagnosticConfig): Promise<void>;
  run(command: string, args: string[]): DevelopmentInfrastructureCommandResult;
}

interface LocalDevelopmentInfrastructureAdapterOptions {
  randomSecret?: () => string;
  system?: DevelopmentInfrastructureSystem;
}

interface ManagedPostgresqlMetadata {
  port: number;
  url: string;
}

const POSTGRESQL_DATABASE = 'parako_e2e';
const POSTGRESQL_PORT = 55_432;
const POSTGRESQL_USER = 'parako_e2e';

function findCommandOnPath(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching the remaining PATH entries.
    }
  }
  return undefined;
}

function runInfrastructureCommand(
  command: string,
  args: string[]
): DevelopmentInfrastructureCommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: result.status,
    stderr: result.error?.message ?? result.stderr?.trim(),
    stdout: result.stdout?.trim(),
  };
}

function portIsAvailable(host: string, port: number): Promise<boolean> {
  return new Promise(resolveAvailability => {
    const server = createServer();
    server.once('error', () => resolveAvailability(false));
    server.listen({ exclusive: true, host, port }, () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

async function probePostgresql(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createPostgresqlDatabase(url: string): Promise<void> {
  const administratorUrl = new URL(url);
  administratorUrl.pathname = '/postgres';
  const client = new Client({ connectionString: administratorUrl.toString() });
  try {
    await client.connect();
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [POSTGRESQL_DATABASE]
    );
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${POSTGRESQL_DATABASE}"`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function probeRedis(config: RedisDiagnosticConfig): Promise<void> {
  const result = await checkRedisAvailability(config);
  if (!result.available) throw new Error(result.reason);
}

const defaultInfrastructureSystem: DevelopmentInfrastructureSystem = {
  createPostgresqlDatabase,
  findCommand: findCommandOnPath,
  isPortAvailable: portIsAvailable,
  probePostgresql,
  probeRedis,
  run: runInfrastructureCommand,
};

function requireCommand(
  system: DevelopmentInfrastructureSystem,
  name: string,
  help: string
): string {
  const command = system.findCommand(name);
  if (!command) throw new Error(`${name} is unavailable. ${help}`);
  return command;
}

function requireSuccessfulInfrastructureCommand(
  system: DevelopmentInfrastructureSystem,
  command: string,
  args: string[],
  description: string
): DevelopmentInfrastructureCommandResult {
  const result = system.run(command, args);
  if (result.status !== 0) {
    const detail = result.stderr ? `: ${result.stderr}` : '';
    throw new Error(`${description} failed${detail}`);
  }
  return result;
}

function managedPostgresqlPaths(root: string) {
  const data = resolve(root, 'runtime/data/test-postgresql');
  return {
    connection: join(data, 'connection.json'),
    data,
    log: resolve(root, 'runtime/logs/test-postgresql.log'),
    password: resolve(root, 'runtime/data/.test-postgresql-initial-password'),
  };
}

function readManagedPostgresqlMetadata(
  path: string
): ManagedPostgresqlMetadata | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(
      readFileSync(path, 'utf8')
    ) as ManagedPostgresqlMetadata;
    const url = new URL(value.url);
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== `/${POSTGRESQL_DATABASE}` ||
      !Number.isInteger(value.port)
    ) {
      throw new Error('invalid managed PostgreSQL metadata');
    }
    return value;
  } catch (error) {
    throw new Error(
      `Managed PostgreSQL metadata is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function resolvePostgresqlBinDirectory(
  system: DevelopmentInfrastructureSystem
): string {
  const pgConfig = requireCommand(
    system,
    'pg_config',
    'Install the PostgreSQL server development tools or set PARAKO_E2E_POSTGRESQL_URL.'
  );
  const result = requireSuccessfulInfrastructureCommand(
    system,
    pgConfig,
    ['--bindir'],
    'PostgreSQL binary discovery'
  );
  if (!result.stdout) {
    throw new Error('PostgreSQL binary discovery returned an empty directory');
  }
  return result.stdout;
}

function startManagedPostgresql(
  system: DevelopmentInfrastructureSystem,
  binDirectory: string,
  data: string,
  log: string,
  port: number
): void {
  const pgCtl = join(binDirectory, 'pg_ctl');
  if (system.run(pgCtl, ['status', '-D', data]).status === 0) return;
  const socketDirectory = data.replaceAll('"', '\\"');
  requireSuccessfulInfrastructureCommand(
    system,
    pgCtl,
    [
      'start',
      '-D',
      data,
      '-l',
      log,
      '-o',
      `-h 127.0.0.1 -p ${port} -k "${socketDirectory}"`,
      '-w',
      '-t',
      '30',
    ],
    'Managed PostgreSQL startup'
  );
}
async function findAvailablePort(
  system: DevelopmentInfrastructureSystem,
  host: string,
  preferredPort: number
): Promise<number> {
  for (let offset = 0; offset < 100; offset += 1) {
    const port = preferredPort + offset;
    if (await system.isPortAvailable(host, port)) return port;
  }
  throw new Error(
    `No available local port was found from ${preferredPort} through ${preferredPort + 99}. Configure external test infrastructure instead.`
  );
}

async function provisionManagedPostgresql(
  root: string,
  system: DevelopmentInfrastructureSystem,
  randomSecret: () => string
): Promise<string> {
  const paths = managedPostgresqlPaths(root);
  const existing = readManagedPostgresqlMetadata(paths.connection);
  const binDirectory = resolvePostgresqlBinDirectory(system);
  if (existing) {
    startManagedPostgresql(
      system,
      binDirectory,
      paths.data,
      paths.log,
      existing.port
    );
    await system.probePostgresql(existing.url);
    return existing.url;
  }

  const port = await findAvailablePort(system, '127.0.0.1', POSTGRESQL_PORT);

  mkdirSync(paths.data, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.log), { recursive: true });
  const password = randomSecret();
  writeFileSync(paths.password, `${password}\n`, { mode: 0o600, flag: 'wx' });
  try {
    requireSuccessfulInfrastructureCommand(
      system,
      join(binDirectory, 'initdb'),
      [
        '-D',
        paths.data,
        '--username',
        POSTGRESQL_USER,
        '--pwfile',
        paths.password,
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256',
        '--encoding=UTF8',
        '--no-locale',
      ],
      'Managed PostgreSQL initialization'
    );
  } finally {
    if (existsSync(paths.password)) unlinkSync(paths.password);
  }

  const url = new URL('postgresql://127.0.0.1');
  url.username = POSTGRESQL_USER;
  url.password = password;
  url.port = String(port);
  url.pathname = `/${POSTGRESQL_DATABASE}`;
  const metadata: ManagedPostgresqlMetadata = {
    port,
    url: url.toString(),
  };
  writeFileSync(paths.connection, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });

  startManagedPostgresql(system, binDirectory, paths.data, paths.log, port);
  await system.createPostgresqlDatabase(metadata.url);
  await system.probePostgresql(metadata.url);
  return metadata.url;
}

function quoteRedisConfiguration(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function isLocalRedisHost(host: string): boolean {
  return ['127.0.0.1', '::1', 'localhost'].includes(host.toLowerCase());
}

async function provisionManagedRedis(
  root: string,
  config: RedisDiagnosticConfig,
  system: DevelopmentInfrastructureSystem
): Promise<void> {
  try {
    await system.probeRedis(config);
    return;
  } catch (initialError) {
    if (!isLocalRedisHost(config.host)) {
      throw new Error(
        `Configured Redis is unreachable: ${initialError instanceof Error ? initialError.message : String(initialError)}`
      );
    }
  }

  if (!(await system.isPortAvailable('127.0.0.1', config.port))) {
    throw new Error(
      `Redis is unreachable and port ${config.port} is already in use. Start the configured Redis service or update runtime/.env.`
    );
  }
  const redisServer = requireCommand(
    system,
    'redis-server',
    'Install Redis or configure a reachable REDIS_HOST in runtime/.env.'
  );
  const data = resolve(root, 'runtime/data/test-redis');
  const log = resolve(root, 'runtime/logs/test-redis.log');
  const configuration = join(data, 'redis.conf');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(log), { recursive: true });
  const lines = [
    'bind 127.0.0.1',
    'protected-mode yes',
    `port ${config.port}`,
    'daemonize yes',
    'supervised no',
    `dir ${quoteRedisConfiguration(data)}`,
    `pidfile ${quoteRedisConfiguration(join(data, 'redis.pid'))}`,
    `logfile ${quoteRedisConfiguration(log)}`,
    'save ""',
    'appendonly no',
    `databases ${Math.max(16, (config.database ?? 0) + 1)}`,
  ];
  if (config.password) {
    lines.push(`requirepass ${quoteRedisConfiguration(config.password)}`);
  }
  writeFileSync(configuration, `${lines.join('\n')}\n`, { mode: 0o600 });
  requireSuccessfulInfrastructureCommand(
    system,
    redisServer,
    [configuration],
    'Managed Redis startup'
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await system.probeRedis(config);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error(
    `Managed Redis did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export function createLocalDevelopmentInfrastructureAdapter({
  randomSecret = () => randomBytes(32).toString('hex'),
  system = defaultInfrastructureSystem,
}: LocalDevelopmentInfrastructureAdapterOptions = {}): DevelopmentInfrastructureAdapter {
  return {
    async ensurePostgresql({ configuredUrl, root }) {
      if (configuredUrl) {
        try {
          await system.probePostgresql(configuredUrl);
          return configuredUrl;
        } catch (error) {
          const managed = readManagedPostgresqlMetadata(
            managedPostgresqlPaths(root).connection
          );
          if (managed?.url === configuredUrl) {
            return provisionManagedPostgresql(root, system, randomSecret);
          }
          throw new Error(
            `Configured PostgreSQL is unreachable: ${error instanceof Error ? error.message : String(error)}. Start it or update PARAKO_E2E_POSTGRESQL_URL.`
          );
        }
      }
      return provisionManagedPostgresql(root, system, randomSecret);
    },
    async ensureRedis({ config, root }) {
      await provisionManagedRedis(root, config, system);
    },
  };
}
