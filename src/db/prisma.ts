import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import type { BootstrapConfig } from '../config/schemas/bootstrap-schema.js';
import { createTenantExtension } from './extensions/tenant.extension.js';

type PrismaClientModule = {
  PrismaClient: typeof PrismaClient;
  Prisma: { defineExtension: typeof Prisma.defineExtension };
};
let postgresqlClientModule: PrismaClientModule | undefined;

type SqliteAdapterFactory = Pick<
  PrismaBetterSqlite3,
  'adapterName' | 'connect' | 'connectToShadowDb' | 'provider'
>;
type SqliteAdapterConnection = Awaited<
  ReturnType<SqliteAdapterFactory['connect']>
>;

async function configureSqliteConnection(
  connect: () => Promise<SqliteAdapterConnection>,
  isProduction: boolean
): Promise<SqliteAdapterConnection> {
  const connection = await connect();
  const pragmas = [
    { sql: 'PRAGMA journal_mode = WAL', label: 'journal_mode=WAL' },
    { sql: 'PRAGMA foreign_keys = ON', label: 'foreign_keys=ON' },
    {
      sql: `PRAGMA synchronous = ${isProduction ? 'FULL' : 'NORMAL'}`,
      label: `synchronous=${isProduction ? 'FULL' : 'NORMAL'}`,
    },
    { sql: 'PRAGMA cache_size = -8000', label: 'cache_size=-8000' },
  ] as const;

  for (const { sql, label } of pragmas) {
    try {
      await connection.executeRaw({ sql, args: [], argTypes: [] });
    } catch (err: unknown) {
      // The structured logger is not available while the database adapter is
      // connecting, so ensure configuration failures still reach service logs.
      console.error(
        `[SQLite] Failed to set PRAGMA ${label}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return connection;
}

function configureSqliteAdapter(
  adapter: SqliteAdapterFactory,
  isProduction: boolean
): SqliteAdapterFactory {
  return {
    adapterName: adapter.adapterName,
    provider: adapter.provider,
    connect: () =>
      configureSqliteConnection(() => adapter.connect(), isProduction),
    connectToShadowDb: () =>
      configureSqliteConnection(
        () => adapter.connectToShadowDb(),
        isProduction
      ),
  };
}

export function findPostgresqlPrismaClient(
  start: string,
  fallbackStart?: string
): string {
  const visitedDirectories = new Set<string>();
  for (const startDirectory of fallbackStart
    ? [start, fallbackStart]
    : [start]) {
    let current = resolve(startDirectory);
    while (!visitedDirectories.has(current)) {
      visitedDirectories.add(current);
      const candidate = join(
        current,
        'prisma',
        'generated',
        'postgresql',
        'index.js'
      );
      if (existsSync(candidate)) return candidate;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  throw new Error(
    'Generated PostgreSQL Prisma client is missing. Run pnpm db:generate:pg or use a complete release artifact.'
  );
}

function loadPostgresqlPrismaClient(): PrismaClientModule {
  if (postgresqlClientModule) return postgresqlClientModule;
  const start = process.env.PARAKO_ROOT ?? process.cwd();
  // PARAKO_ROOT may intentionally contain runtime data only. The generated
  // client is a code artifact, so fall back to the installed module tree.
  const modulePath = findPostgresqlPrismaClient(
    start,
    dirname(fileURLToPath(import.meta.url))
  );
  postgresqlClientModule = createRequire(import.meta.url)(
    modulePath
  ) as PrismaClientModule;
  return postgresqlClientModule;
}

/** Resolve SQLite paths from the application root, not the launcher's cwd. */
export function resolveSqliteDatabasePath(
  configuredPath: string,
  root: string = process.env.PARAKO_ROOT ?? process.cwd()
): string {
  const pathWithoutScheme = configuredPath.startsWith('file:')
    ? configuredPath.slice('file:'.length)
    : configuredPath;
  return resolve(root, pathWithoutScheme);
}

/**
 * Create a PrismaClient backed by the adapter selected in BootstrapConfig.
 * SQLite → better-sqlite3 adapter  (default / dev / self-hosted, single-tenant only)
 * PostgreSQL → pg adapter           (production / cloud, supports multi-tenancy)
 *
 * When multi-tenancy is enabled (PostgreSQL only — SQLite is blocked by boot
 * guard), the tenant isolation extension is applied automatically. It injects
 * `tenant_id` on writes, filters reads, and executes `SET LOCAL app.tenant_id`
 * before each query for belt-and-suspenders with PostgreSQL RLS.
 */
export function createPrismaClient(config: BootstrapConfig): PrismaClient {
  const adapter = config.storage.adapter;

  if (adapter === 'sqlite') {
    // SQLite is always single-tenant (boot guard prevents multi-tenancy + SQLite).
    // No tenant extension applied — all data operates under DEFAULT_TENANT_ID.
    const dbPath = resolveSqliteDatabasePath(
      config.storage.sqlite?.path ?? './runtime/data/parako.db'
    );
    mkdirSync(dirname(dbPath), { recursive: true });
    const isProduction = process.env.NODE_ENV === 'production';
    const sqliteAdapter = configureSqliteAdapter(
      new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
      isProduction
    );

    // Prisma awaits adapter.connect() before issuing queries. Applying the
    // PRAGMAs inside that lifecycle prevents callers from opening a transaction
    // between individual PRAGMAs (SQLite rejects synchronous changes there).
    return new PrismaClient({ adapter: sqliteAdapter });
  }

  if (adapter === 'postgresql') {
    // Production defaults to strict TLS. Private, trusted networks may disable
    // transport TLS explicitly; certificate verification can be relaxed separately.
    const isProduction = process.env.NODE_ENV === 'production';
    const tlsEnabled = isProduction && process.env.PG_SSL_ENABLED !== 'false';
    const rejectUnauthorized =
      process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
    const pgAdapter = new PrismaPg({
      connectionString: config.storage.postgresql!.url,
      // Per-worker pool. Total connections = max × PM2 instances.
      // Adjust for your DB limits (e.g. max: 5 with 4 workers = 20).
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: tlsEnabled ? { rejectUnauthorized } : false,
    });
    const { PrismaClient: PostgresqlPrismaClient, Prisma: PostgresqlPrisma } =
      loadPostgresqlPrismaClient();
    const client = new PostgresqlPrismaClient({
      adapter: pgAdapter,
    }) as unknown as PrismaClient;

    // The extension auto-injects tenant_id on writes, filters reads, and
    // executes SET LOCAL app.tenant_id for PostgreSQL RLS (belt-and-suspenders).
    if (config.multiTenancy?.enabled) {
      return client.$extends(
        createTenantExtension(
          'postgresql',
          client,
          PostgresqlPrisma.defineExtension
        )
      ) as unknown as PrismaClient;
    }

    return client;
  }

  throw new Error(`Unknown Prisma adapter: ${adapter}`);
}

export async function checkDatabaseHealth(
  prisma: PrismaClient
): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
