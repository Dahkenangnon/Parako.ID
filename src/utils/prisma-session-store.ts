import { Store, type SessionData } from 'express-session';
import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_TENANT_ID,
  SYSTEM_TENANTS,
  tenantContext,
} from '../multi-tenancy/tenant-context.js';
import { tenantIdFromSessionId } from './session-id.js';
import { decodePersistedSession } from './session-persistence.js';

/** Minimal logger contract — kept narrow so the store stays portable. */
export interface PrismaSessionStoreLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Session store backed by Prisma (SQLite or PostgreSQL).
 *
 * The `Session` model must exist in the Prisma schema with fields:
 *   sid        String   @id
 *   data       String
 *   expires_at DateTime
 */
export class PrismaSessionStore extends Store {
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttl: number,
    private readonly logger?: PrismaSessionStoreLogger
  ) {
    super();
  }

  /** Periodically delete expired sessions (default: every 15 minutes). */
  startCleanup(intervalMs = 15 * 60 * 1000): void {
    this.cleanupInterval = setInterval(() => {
      this.deleteExpiredSessions().catch((err: unknown) => {
        this.logger?.warn('Prisma session-store cleanup sweep failed', {
          step: 'prisma-session-store-cleanup',
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    // Prevent timer from keeping the process alive during shutdown
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  private async deleteExpiredSessions(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      select: { slug: true },
    });
    const tenantIds = new Set([
      DEFAULT_TENANT_ID,
      ...SYSTEM_TENANTS,
      ...tenants.map(tenant => tenant.slug),
    ]);

    for (const tenantId of tenantIds) {
      await tenantContext.run(
        tenantId,
        async () =>
          await this.prisma.session.deleteMany({
            where: { expires_at: { lt: new Date() } },
          })
      );
    }
  }

  private runForSessionTenant<T>(
    sid: string,
    operation: (tenantId: string) => Promise<T>
  ): Promise<T> {
    const tenantId = tenantIdFromSessionId(sid);
    return tenantContext.run(tenantId, async () => await operation(tenantId));
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private resolveExpiresAt(session: SessionData): Date {
    const cookieExpires = (session as any)?.cookie?.expires;
    if (cookieExpires) {
      const expiresAt = new Date(cookieExpires);
      if (Number.isFinite(expiresAt.getTime())) {
        return expiresAt;
      }
    }
    return new Date(Date.now() + this.ttl * 1000);
  }

  get(
    sid: string,
    cb: (err: unknown, session?: SessionData | null) => void
  ): void {
    this.runForSessionTenant(sid, async tenantId => {
      const row = await this.prisma.session.findUnique({ where: { sid } });
      return { row, tenantId };
    })
      .then(({ row, tenantId }) => {
        if (!row || row.expires_at < new Date()) {
          return cb(null, null);
        }
        try {
          const session = decodePersistedSession(
            row.data,
            'prisma.application_session.data'
          ) as unknown as SessionData & { tenantId?: unknown };
          if (
            typeof session.tenantId === 'string' &&
            session.tenantId !== tenantId
          ) {
            return cb(null, null);
          }
          cb(null, session);
        } catch (e) {
          cb(e);
        }
      })
      .catch(cb);
  }

  set(sid: string, session: SessionData, cb: (err?: unknown) => void): void {
    const expires_at = this.resolveExpiresAt(session);
    const tenant_id = tenantIdFromSessionId(sid);
    let data: string;

    try {
      data = JSON.stringify(session);
    } catch (error) {
      cb(error);
      return;
    }

    const persistedData = { data, expires_at, tenant_id };
    this.runForSessionTenant(sid, async () => {
      // Prisma's PostgreSQL driver adapter may interpret upsert as concurrent
      // statements on one transaction client, which pg does not support and
      // which makes session persistence unreliable. Keep the operations
      // sequential. The retry handles two initial writes racing for one SID.
      const updated = await this.prisma.session.updateMany({
        where: { sid },
        data: persistedData,
      });
      if (updated.count > 0) return;

      try {
        await this.prisma.session.create({
          data: { sid, ...persistedData },
        });
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;

        const retried = await this.prisma.session.updateMany({
          where: { sid },
          data: persistedData,
        });
        if (retried.count === 0) throw error;
      }
    })
      .then(() => cb())
      .catch(cb);
  }

  destroy(sid: string, cb: (err?: unknown) => void): void {
    this.runForSessionTenant(sid, async () =>
      this.prisma.session.deleteMany({ where: { sid } })
    )
      .then(() => cb())
      .catch(cb);
  }

  touch(sid: string, session: SessionData, cb: (err?: unknown) => void): void {
    const expires_at = this.resolveExpiresAt(session);

    this.runForSessionTenant(sid, async () =>
      this.prisma.session.updateMany({
        where: { sid },
        data: { expires_at },
      })
    )
      .then(() => cb())
      .catch(cb);
  }
}
