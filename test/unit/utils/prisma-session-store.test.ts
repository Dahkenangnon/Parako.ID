import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrismaSessionStore } from '../../../src/utils/prisma-session-store.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { PersistenceDecodingError } from '../../../src/db/persistence/json-decoder.js';

// Minimal Prisma session stub
function makeStubPrisma() {
  const store: Record<string, { sid: string; data: string; expires_at: Date }> =
    {};

  return {
    tenant: {
      findMany: vi.fn(async (): Promise<Array<{ slug: string }>> => []),
    },
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
      create: vi.fn(async ({ data }: any) => {
        store[data.sid] = { ...data };
        return store[data.sid];
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        delete store[where.sid];
        return { count: 1 };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (store[where.sid]) {
          store[where.sid] = { ...store[where.sid], ...data };
          return { count: 1 };
        }
        return { count: 0 };
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
    tenantContext.disableStrictMode();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('cleanup', () => {
    it('deletes expired sessions on schedule and stops cleanup idempotently', async () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      prisma.tenant.findMany.mockResolvedValueOnce([{ slug: 'tenant-a' }]);

      sessionStore.stopCleanup();
      sessionStore.startCleanup(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { expires_at: { lt: expect.any(Date) } },
      });
      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(3);

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
      const session = {
        user: 'alice',
        tenantId: 'tenant-a',
        cookie: {},
      } as any;

      await new Promise<void>((resolve, reject) => {
        sessionStore.set('tenant-a.sid-1', session, err =>
          err ? reject(err) : resolve()
        );
      });

      expect(prisma.session.upsert).not.toHaveBeenCalled();
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { sid: 'tenant-a.sid-1' },
        data: {
          data: expect.any(String),
          expires_at: expect.any(Date),
          tenant_id: 'tenant-a',
        },
      });
      const call = prisma.session.create.mock.calls[0][0];
      expect(JSON.parse(call.data.data)).toEqual(session);
      expect(call.data.tenant_id).toBe('tenant-a');
    });

    it('stores legacy sessions without a tenant as default-tenant sessions', async () => {
      await new Promise<void>((resolve, reject) => {
        sessionStore.set('sid-default', { cookie: {} } as any, err =>
          err ? reject(err) : resolve()
        );
      });

      const call = prisma.session.create.mock.calls[0][0];
      expect(call.data.tenant_id).toBe('default');
    });

    it('uses cookie.expires when available', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      const session = { cookie: { expires: future } } as any;

      await new Promise<void>((resolve, reject) => {
        sessionStore.set('sid-2', session, err =>
          err ? reject(err) : resolve()
        );
      });

      const call = prisma.session.create.mock.calls[0][0];
      expect(call.data.expires_at).toEqual(future);
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
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
      expect(prisma.session.create).not.toHaveBeenCalled();
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

      const call = prisma.session.create.mock.calls[0][0];
      expect(call.data.expires_at).toEqual(new Date(100_000 + TTL * 1000));
      now.mockRestore();
    });

    it('updates an existing session without opening an upsert transaction', async () => {
      prisma._store['sid-existing'] = {
        sid: 'sid-existing',
        data: JSON.stringify({ old: true }),
        expires_at: new Date(0),
      };

      await new Promise<void>((resolve, reject) => {
        sessionStore.set(
          'sid-existing',
          { fresh: true, cookie: {} } as any,
          err => (err ? reject(err) : resolve())
        );
      });

      expect(prisma.session.updateMany).toHaveBeenCalledOnce();
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.session.upsert).not.toHaveBeenCalled();
      expect(JSON.parse(prisma._store['sid-existing'].data)).toEqual({
        fresh: true,
        cookie: {},
      });
    });

    it('retries the update when a concurrent creator wins the insert race', async () => {
      prisma.session.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.session.create.mockRejectedValueOnce({ code: 'P2002' });

      await new Promise<void>((resolve, reject) => {
        sessionStore.set('sid-raced', { cookie: {} } as any, err =>
          err ? reject(err) : resolve()
        );
      });

      expect(prisma.session.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.session.create).toHaveBeenCalledOnce();
    });

    it('propagates the unique violation when the raced session still cannot be updated', async () => {
      const failure = { code: 'P2002' };
      prisma.session.updateMany.mockResolvedValue({ count: 0 });
      prisma.session.create.mockRejectedValueOnce(failure);

      await expect(
        new Promise<void>((resolve, reject) => {
          sessionStore.set('sid-lost-race', { cookie: {} } as any, err =>
            err ? reject(err) : resolve()
          );
        })
      ).rejects.toBe(failure);
      expect(prisma.session.updateMany).toHaveBeenCalledTimes(2);
    });

    it('propagates non-unique create failures', async () => {
      const failure = new Error('create failed');
      prisma.session.create.mockRejectedValueOnce(failure);

      await expect(
        new Promise<void>((resolve, reject) => {
          sessionStore.set('sid-create-failure', { cookie: {} } as any, err =>
            err ? reject(err) : resolve()
          );
        })
      ).rejects.toBe(failure);
    });
  });

  describe('get()', () => {
    it('establishes strict tenant context from the signed session ID', async () => {
      let queryTenant: string | undefined;
      tenantContext.enableStrictMode();
      prisma.session.findUnique.mockImplementationOnce(async () => {
        queryTenant = tenantContext.getTenantId();
        return null;
      });

      await new Promise((resolve, reject) => {
        sessionStore.get('tenant-a.random-session-id', (err, session) =>
          err ? reject(err) : resolve(session)
        );
      });

      expect(queryTenant).toBe('tenant-a');
    });

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

    it('returns null when stored session data belongs to another tenant', async () => {
      prisma.session.findUnique.mockResolvedValueOnce({
        sid: 'tenant-a.sid-mismatch',
        data: JSON.stringify({ tenantId: 'tenant-b', cookie: {} }),
        expires_at: new Date(Date.now() + 60_000),
      });

      const result = await new Promise((resolve, reject) => {
        sessionStore.get('tenant-a.sid-mismatch', (err, sess) =>
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
      ).rejects.toBeInstanceOf(PersistenceDecodingError);
    });

    it('rejects non-object session documents without exposing their values', async () => {
      prisma.session.findUnique.mockResolvedValueOnce({
        sid: 'sid-invalid-shape',
        data: '["private-marker"]',
        expires_at: new Date(Date.now() + 60_000),
      });

      try {
        await new Promise((resolve, reject) => {
          sessionStore.get('sid-invalid-shape', (err, sess) =>
            err ? reject(err) : resolve(sess)
          );
        });
        throw new Error('Expected persisted session decoding to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceDecodingError);
        expect(error).toMatchObject({
          context: 'prisma.application_session.data',
        });
        expect(String(error)).not.toContain('private-marker');
      }
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
    prisma.session.updateMany.mockRejectedValueOnce(setError);
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
