import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { BootstrapConfig } from '../config/schemas/bootstrap-schema.js';
import { createTenantExtension } from './extensions/tenant.extension.js';

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
    const dbPath = config.storage.sqlite?.path ?? './data/parako.db';
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqliteAdapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
    const client = new PrismaClient({ adapter: sqliteAdapter });
    const isProduction = process.env.NODE_ENV === 'production';

    // Set SQLite performance/correctness pragmas — log failures instead of
    // silently swallowing them so misconfigurations surface during startup.
    const pragmas: Array<[ReturnType<typeof client.$executeRaw>, string]> = [
      [client.$executeRaw`PRAGMA journal_mode = WAL`, 'journal_mode=WAL'],
      [client.$executeRaw`PRAGMA foreign_keys = ON`, 'foreign_keys=ON'],
      [
        // FULL in production: guarantees durability at slight write cost.
        // NORMAL in dev: faster writes, acceptable risk for local data.
        isProduction
          ? client.$executeRaw`PRAGMA synchronous = FULL`
          : client.$executeRaw`PRAGMA synchronous = NORMAL`,
        `synchronous=${isProduction ? 'FULL' : 'NORMAL'}`,
      ],
      [client.$executeRaw`PRAGMA cache_size = -8000`, 'cache_size=-8000'],
    ];

    // Await PRAGMAs sequentially so failures are surfaced
    // during startup rather than silently swallowed.
    void (async () => {
      for (const [promise, label] of pragmas) {
        try {
          await promise;
        } catch (err: unknown) {
          // console.error here (not the structured logger): this runs at
          // module load before the DI container has bound the logger, so
          // PRAGMA failures fall back to stderr so they still surface in
          // PM2/systemd journals.
          console.error(
            `[SQLite] Failed to set PRAGMA ${label}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    })();

    return client;
  }

  if (adapter === 'postgresql') {
    // Default to strict SSL in production (rejectUnauthorized: true).
    // Opt out via PG_SSL_REJECT_UNAUTHORIZED=false for self-signed certs.
    const isProduction = process.env.NODE_ENV === 'production';
    const rejectUnauthorized =
      process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
    const pool = new Pool({
      connectionString: config.storage.postgresql!.url,
      // Per-worker pool. Total connections = max × PM2 instances.
      // Adjust for your DB limits (e.g. max: 5 with 4 workers = 20).
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: isProduction ? { rejectUnauthorized } : false,
    });
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });

    // The extension auto-injects tenant_id on writes, filters reads, and
    // executes SET LOCAL app.tenant_id for PostgreSQL RLS (belt-and-suspenders).
    if (config.multiTenancy?.enabled) {
      return client.$extends(
        createTenantExtension('postgresql', client)
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
