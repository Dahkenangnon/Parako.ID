import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  });
});
