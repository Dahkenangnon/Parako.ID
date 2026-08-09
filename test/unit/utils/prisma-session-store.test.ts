import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrismaSessionStore } from '../../../src/utils/prisma-session-store.js';

// Minimal Prisma session stub
function makeStubPrisma() {
  const store: Record<string, { sid: string; data: string; expires_at: Date }> =
    {};

  return {
    session: {
      findUnique: vi.fn(async ({ where }: any) =>
        store[where.sid] ? { ...store[where.sid] } : null
      ),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        if (store[where.sid]) {
          store[where.sid] = { ...store[where.sid], ...update };
        } else {
          store[where.sid] = { ...create };
        }
        return store[where.sid];
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        delete store[where.sid];
        return { count: 1 };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (store[where.sid]) {
          store[where.sid] = { ...store[where.sid], ...data };
        }
        return { count: 1 };
      }),
    },
    _store: store,
  };
}

describe('PrismaSessionStore', () => {
  let prisma: ReturnType<typeof makeStubPrisma>;
  let sessionStore: PrismaSessionStore;
  const TTL = 86400;

  beforeEach(() => {
    prisma = makeStubPrisma();
    sessionStore = new PrismaSessionStore(prisma as any, TTL);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('cleanup', () => {
    it('deletes expired sessions on schedule and stops cleanup idempotently', async () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      sessionStore.stopCleanup();
      sessionStore.startCleanup(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { expires_at: { lt: expect.any(Date) } },
      });

      sessionStore.stopCleanup();
      sessionStore.stopCleanup();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect((sessionStore as any).cleanupInterval).toBeNull();
    });

    it.each([
      [new Error('database unavailable'), 'database unavailable'],
      ['database unavailable', 'database unavailable'],
    ])(
      'logs cleanup failures without rejecting the timer callback',
      async (failure, message) => {
        vi.useFakeTimers();
        const logger = { warn: vi.fn() };
        prisma.session.deleteMany.mockRejectedValue(failure);
        const store = new PrismaSessionStore(prisma as any, TTL, logger as any);

        store.startCleanup(100);
        await vi.advanceTimersByTimeAsync(100);

        expect(logger.warn).toHaveBeenCalledWith(
          'Prisma session-store cleanup sweep failed',
          {
            step: 'prisma-session-store-cleanup',
            err: message,
          }
        );
        store.stopCleanup();
      }
    );

    it('tolerates cleanup failures when no logger is configured', async () => {
      vi.useFakeTimers();
      prisma.session.deleteMany.mockRejectedValue(
        new Error('database unavailable')
      );

      sessionStore.startCleanup(100);
      await vi.advanceTimersByTimeAsync(100);
      sessionStore.stopCleanup();
    });

    it('supports timer implementations without unref', () => {
      const timer = {} as NodeJS.Timeout;
      const setIntervalSpy = vi
        .spyOn(global, 'setInterval')
        .mockReturnValue(timer);
      const clearIntervalSpy = vi
        .spyOn(global, 'clearInterval')
        .mockImplementation(() => undefined);

      sessionStore.startCleanup(250);
      sessionStore.stopCleanup();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 250);
      expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    });
  });

  describe('set()', () => {
    it('stores a new session', async () => {
      const session = { user: 'alice', cookie: {} } as any;

      await new Promise<void>((resolve, reject) => {
        sessionStore.set('sid-1', session, err =>
          err ? reject(err) : resolve()
        );
      });

      expect(prisma.session.upsert).toHaveBeenCalledOnce();
      const call = prisma.session.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ sid: 'sid-1' });
      expect(JSON.parse(call.create.data)).toEqual(session);
    });

    it('uses cookie.expires when available', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      const session = { cookie: { expires: future } } as any;

      await new Promise<void>((resolve, reject) => {
        sessionStore.set('sid-2', session, err =>
          err ? reject(err) : resolve()
        );
      });

      const call = prisma.session.upsert.mock.calls[0][0];
      expect(call.create.expires_at).toEqual(future);
    });

    it('reports unserializable session data through the callback', async () => {
      const session: Record<string, unknown> = { cookie: {} };
      session.circular = session;
      const callback = vi.fn();

      expect(() =>
        sessionStore.set('sid-circular', session as any, callback)
      ).not.toThrow();

      expect(callback).toHaveBeenCalledWith(expect.any(TypeError));
      expect(prisma.session.upsert).not.toHaveBeenCalled();
    });

    it('falls back to the configured TTL for an invalid cookie expiration', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);

      await new Promise<void>((resolve, reject) => {
        sessionStore.set(
          'sid-invalid-expiry',
          { cookie: { expires: 'not-a-date' } } as any,
          err => (err ? reject(err) : resolve())
        );
      });

      const call = prisma.session.upsert.mock.calls[0][0];
      expect(call.create.expires_at).toEqual(new Date(100_000 + TTL * 1000));
      now.mockRestore();
    });
  });

  describe('get()', () => {
    it('retrieves a stored session', async () => {
      const session = { user: 'bob', cookie: {} } as any;
      await new Promise<void>((resolve, reject) => {
        sessionStore.set('sid-3', session, err =>
          err ? reject(err) : resolve()
        );
      });

      const retrieved = await new Promise((resolve, reject) => {
        sessionStore.get('sid-3', (err, sess) =>
          err ? reject(err) : resolve(sess)
        );
      });

      expect(retrieved).toEqual(session);
    });

    it('returns null for unknown session', async () => {
      const result = await new Promise((resolve, reject) => {
        sessionStore.get('nonexistent', (err, sess) =>
          err ? reject(err) : resolve(sess)
        );
      });

      expect(result).toBeNull();
    });

    it('returns null for expired session', async () => {
      // Manually put an expired session into the stub store
      prisma.session.findUnique.mockResolvedValueOnce({
        sid: 'sid-exp',
        data: JSON.stringify({ user: 'expired' }),
        expires_at: new Date(Date.now() - 1000), // past
      });

      const result = await new Promise((resolve, reject) => {
        sessionStore.get('sid-exp', (err, sess) =>
          err ? reject(err) : resolve(sess)
        );
      });

      expect(result).toBeNull();
    });

    it('reports corrupted stored session data through the callback', async () => {
      prisma.session.findUnique.mockResolvedValueOnce({
        sid: 'sid-corrupt',
        data: '{not-json',
        expires_at: new Date(Date.now() + 60_000),
      });

      await expect(
        new Promise((resolve, reject) => {
          sessionStore.get('sid-corrupt', (err, sess) =>
            err ? reject(err) : resolve(sess)
          );
        })
      ).rejects.toBeInstanceOf(SyntaxError);
    });
  });

  it('propagates Prisma operation failures through store callbacks', async () => {
    const getError = new Error('get failed');
    prisma.session.findUnique.mockRejectedValueOnce(getError);
    await expect(
      new Promise((resolve, reject) => {
        sessionStore.get('sid', (err, sess) =>
          err ? reject(err) : resolve(sess)
        );
      })
    ).rejects.toBe(getError);

    const setError = new Error('set failed');
    prisma.session.upsert.mockRejectedValueOnce(setError);
    await expect(
      new Promise<void>((resolve, reject) => {
        sessionStore.set('sid', { cookie: {} } as any, err =>
          err ? reject(err) : resolve()
        );
      })
    ).rejects.toBe(setError);

    const destroyError = new Error('destroy failed');
    prisma.session.deleteMany.mockRejectedValueOnce(destroyError);
    await expect(
      new Promise<void>((resolve, reject) => {
        sessionStore.destroy('sid', err => (err ? reject(err) : resolve()));
      })
    ).rejects.toBe(destroyError);

    const touchError = new Error('touch failed');
    prisma.session.updateMany.mockRejectedValueOnce(touchError);
    await expect(
      new Promise<void>((resolve, reject) => {
        sessionStore.touch('sid', { cookie: {} } as any, err =>
          err ? reject(err) : resolve()
        );
      })
    ).rejects.toBe(touchError);
  });

  describe('destroy()', () => {
    it('removes the session', async () => {
      await new Promise<void>((resolve, reject) => {
        sessionStore.destroy('sid-del', err => (err ? reject(err) : resolve()));
      });

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { sid: 'sid-del' },
      });
    });
  });

  describe('touch()', () => {
    it('updates expires_at without changing data', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      const session = { cookie: { expires: future } } as any;

      await new Promise<void>((resolve, reject) => {
        sessionStore.touch('sid-t', session, err =>
          err ? reject(err) : resolve()
        );
      });

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { sid: 'sid-t' },
        data: { expires_at: future },
      });
    });

    it('falls back to the configured TTL for an invalid cookie expiration', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);

      await new Promise<void>((resolve, reject) => {
        sessionStore.touch(
          'sid-invalid-expiry',
          { cookie: { expires: 'not-a-date' } } as any,
          err => (err ? reject(err) : resolve())
        );
      });

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { sid: 'sid-invalid-expiry' },
        data: { expires_at: new Date(100_000 + TTL * 1000) },
      });
      now.mockRestore();
    });
  });
});
