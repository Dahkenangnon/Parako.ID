import { Store, type SessionData } from 'express-session';
import type { PrismaClient } from '@prisma/client';

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
    private readonly ttl: number
  ) {
    super();
  }

  /** Periodically delete expired sessions (default: every 15 minutes). */
  startCleanup(intervalMs = 15 * 60 * 1000): void {
    this.cleanupInterval = setInterval(() => {
      this.prisma.session
        .deleteMany({ where: { expires_at: { lt: new Date() } } })
        .catch(() => {});
    }, intervalMs);
    // Prevent timer from keeping the process alive during shutdown
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  get(
    sid: string,
    cb: (err: unknown, session?: SessionData | null) => void
  ): void {
    this.prisma.session
      .findUnique({ where: { sid } })
      .then(row => {
        if (!row || row.expires_at < new Date()) {
          return cb(null, null);
        }
        try {
          cb(null, JSON.parse(row.data));
        } catch (e) {
          cb(e);
        }
      })
      .catch(cb);
  }

  set(sid: string, session: SessionData, cb: (err?: unknown) => void): void {
    const cookie = (session as any)?.cookie;
    const expires_at = cookie?.expires
      ? new Date(cookie.expires)
      : new Date(Date.now() + this.ttl * 1000);

    this.prisma.session
      .upsert({
        where: { sid },
        create: { sid, data: JSON.stringify(session), expires_at },
        update: { data: JSON.stringify(session), expires_at },
      })
      .then(() => cb())
      .catch(cb);
  }

  destroy(sid: string, cb: (err?: unknown) => void): void {
    this.prisma.session
      .deleteMany({ where: { sid } })
      .then(() => cb())
      .catch(cb);
  }

  touch(sid: string, session: SessionData, cb: (err?: unknown) => void): void {
    const cookie = (session as any)?.cookie;
    const expires_at = cookie?.expires
      ? new Date(cookie.expires)
      : new Date(Date.now() + this.ttl * 1000);

    this.prisma.session
      .updateMany({ where: { sid }, data: { expires_at } })
      .then(() => cb())
      .catch(cb);
  }
}
