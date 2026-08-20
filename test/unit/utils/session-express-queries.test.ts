import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const { mockGetTenantId } = vi.hoisted(() => ({
  mockGetTenantId: vi.fn(),
}));

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
  unmanaged: () => () => undefined,
}));

// Mock connect-mongo
vi.mock('connect-mongo', () => {
  return {
    default: {
      create: vi.fn(() => ({ on: vi.fn() })),
    },
  };
});

// Mock connect-redis
vi.mock('connect-redis', () => ({
  RedisStore: vi.fn(),
}));

// Mock ioredis
vi.mock('ioredis', () => ({
  Redis: vi.fn(),
}));

// Mock ua-parser-js
vi.mock('ua-parser-js', () => ({
  UAParser: vi.fn(),
}));

// Mock encryption
vi.mock('../../../src/utils/encryption.js', () => ({
  encryptValue: vi.fn((v: string) => v),
  decryptValue: vi.fn((v: string) => v),
  isEncrypted: vi.fn(() => false),
}));

// Mock prisma session store
vi.mock('../../../src/utils/prisma-session-store.js', () => ({
  PrismaSessionStore: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
}));

// Mock tenant context
vi.mock('../../../src/multi-tenancy/tenant-context.js', () => ({
  DEFAULT_TENANT_ID: 'default',
  tenantContext: {
    getTenantId: mockGetTenantId,
  },
}));

import { SessionManager } from '../../../src/utils/session.js';

function createMockDeps() {
  const configManager = {
    subscribe: vi.fn(),
    getConfig: vi.fn().mockReturnValue({
      deployment: {
        environment: 'development',
        redis_prefix: 'parako',
        cookies: {
          defaults: {
            secure: false,
            httpOnly: true,
            sameSite: 'lax',
          },
          types: {
            session: {
              name: 'application_session',
              sameSite: 'lax',
              secure: false,
              httpOnly: true,
            },
          },
        },
      },
      security: {
        secrets: {
          cookie_secrets: ['test-secret-that-is-32-chars-long'],
        },
        authentication: {
          session: {
            idle_timeout_minutes: 30,
            absolute_timeout_minutes: 1440,
            max_concurrent_sessions: 5,
            encrypt_session_data: false,
            cookie_name: 'application_session',
            same_site: 'lax',
          },
        },
      },
      oidc: {
        token_ttl: {
          session: 1209600,
        },
      },
      oidc_storage: {
        oidc_adapter: {
          type: 'mongodb',
          mongodb: { uri: 'mongodb://localhost/test' },
        },
      },
    }),
  };

  const viewResolver = {
    views: {
      auth: { login: 'auth/login' },
    },
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const userService = {
    findById: vi.fn(),
  };

  return { configManager, viewResolver, logger, userService };
}

function createSessionManager(deps: ReturnType<typeof createMockDeps>) {
  return new (SessionManager as any)(
    deps.configManager,
    deps.viewResolver,
    deps.logger,
    deps.userService,
    null, // prismaClient
    {
      secret: 'test-secret-that-is-32-chars-long',
      collection: 'application_session',
      storeType: 'mongodb',
    }
  );
}

describe('SessionManager - Express session queries', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let sessionManager: any;

  // Mock MongoDB collection
  let mockCollection: any;
  let mockCursor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantId.mockReturnValue('default');
    deps = createMockDeps();
    sessionManager = createSessionManager(deps);

    // Set up the oidcAdapterBridge to return 'mongodb'
    sessionManager.oidcAdapterBridge = {
      effectiveOidcAdapter: vi.fn().mockReturnValue('mongodb'),
    };

    // Set up mock MongoDB collection
    mockCursor = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };

    mockCollection = {
      find: vi.fn().mockReturnValue(mockCursor),
      countDocuments: vi.fn().mockResolvedValue(0),
    };

    // Mock mongoose.connection.db
    vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({
      db: {
        collection: vi.fn().mockReturnValue(mockCollection),
      },
    } as any);
  });

  describe('findAllExpressSessions()', () => {
    it('should return all authenticated sessions from MongoDB', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      const mockSessions = [
        {
          _id: 'sess-1',
          session: {
            accountId: 'user1',
            isAuthenticated: true,
            authTime: '2025-01-01T12:00:00Z',
          },
        },
        {
          _id: 'sess-2',
          session: {
            accountId: 'user2',
            isAuthenticated: true,
            authTime: '2025-01-01T11:00:00Z',
          },
        },
      ];
      mockCursor.toArray.mockResolvedValue(mockSessions);

      const result = await sessionManager.findAllExpressSessions();

      expect(mockCollection.find).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
        'session.tenantId': 'test-tenant',
      });
      expect(mockCursor.sort).toHaveBeenCalledWith({
        'session.authTime': -1,
      });
      expect(mockCursor.skip).toHaveBeenCalledWith(0);
      expect(mockCursor.limit).toHaveBeenCalledWith(20);
      expect(result).toEqual(mockSessions);
    });

    it('includes explicitly default and legacy untagged MongoDB sessions for the default tenant', async () => {
      await sessionManager.findAllExpressSessions();

      expect(mockCollection.find).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
        $or: [
          { 'session.tenantId': 'default' },
          { 'session.tenantId': { $exists: false } },
        ],
      });
    });

    it('should apply pagination options', async () => {
      mockCursor.toArray.mockResolvedValue([]);

      await sessionManager.findAllExpressSessions({
        limit: 10,
        offset: 20,
      });

      expect(mockCursor.skip).toHaveBeenCalledWith(20);
      expect(mockCursor.limit).toHaveBeenCalledWith(10);
    });

    it('treats MongoDB account search as a literal substring', async () => {
      mockCursor.toArray.mockResolvedValue([]);

      await sessionManager.findAllExpressSessions({ search: 'john+admin' });

      expect(mockCollection.find).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
        'session.accountId': { $regex: 'john\\+admin', $options: 'i' },
        $or: [
          { 'session.tenantId': 'default' },
          { 'session.tenantId': { $exists: false } },
        ],
      });
    });

    it('rejects when the MongoDB connection is unavailable', async () => {
      vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({
        db: null,
      } as any);

      await expect(sessionManager.findAllExpressSessions()).rejects.toThrow(
        'MongoDB session store is unavailable'
      );
      expect(deps.logger.error).toHaveBeenCalled();
    });

    it('propagates MongoDB query errors', async () => {
      const storageError = new Error('DB error');
      mockCursor.toArray.mockRejectedValue(storageError);

      await expect(sessionManager.findAllExpressSessions()).rejects.toBe(
        storageError
      );
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });

  describe('countAllExpressSessions()', () => {
    it('should count all authenticated sessions in MongoDB', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      mockCollection.countDocuments.mockResolvedValue(42);

      const result = await sessionManager.countAllExpressSessions();

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
        'session.tenantId': 'test-tenant',
      });
      expect(result).toBe(42);
    });

    it('counts only MongoDB sessions matching the literal account search', async () => {
      mockCollection.countDocuments.mockResolvedValue(2);

      const result = await sessionManager.countAllExpressSessions('alice+ops');

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
        'session.accountId': { $regex: 'alice\\+ops', $options: 'i' },
        $or: [
          { 'session.tenantId': 'default' },
          { 'session.tenantId': { $exists: false } },
        ],
      });
      expect(result).toBe(2);
    });

    it('rejects when the MongoDB connection is unavailable', async () => {
      vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({
        db: null,
      } as any);

      await expect(sessionManager.countAllExpressSessions()).rejects.toThrow(
        'MongoDB session store is unavailable'
      );
      expect(deps.logger.error).toHaveBeenCalled();
    });

    it('propagates MongoDB count errors', async () => {
      const storageError = new Error('DB error');
      mockCollection.countDocuments.mockRejectedValue(storageError);

      await expect(sessionManager.countAllExpressSessions()).rejects.toBe(
        storageError
      );
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });

  describe('Redis session-key scans', () => {
    it('ignores structurally invalid JSON session payloads', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const payloads: Record<string, string> = {
        'parako:session:null-id': 'null',
        'parako:session:string-id': '"session"',
        'parako:session:array-id': '[]',
        'parako:session:valid-id': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
        }),
      };
      sessionManager.redisClient = {
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key])),
      };

      await expect(sessionManager.findAllExpressSessions()).resolves.toEqual([
        {
          _id: 'valid-id',
          session: expect.objectContaining({
            accountId: 'user@example.com',
            isAuthenticated: true,
          }),
        },
      ]);
    });

    it('lists and counts only sessions owned by the active tenant', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const payloads: Record<string, string> = {
        'parako:session:owned-id': JSON.stringify({
          accountId: 'shared@example.com',
          isAuthenticated: true,
          tenantId: 'test-tenant',
        }),
        'parako:session:foreign-id': JSON.stringify({
          accountId: 'shared@example.com',
          isAuthenticated: true,
          tenantId: 'other-tenant',
        }),
        'parako:session:legacy-id': JSON.stringify({
          accountId: 'shared@example.com',
          isAuthenticated: true,
        }),
      };
      sessionManager.redisClient = {
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key])),
      };

      await expect(sessionManager.findAllExpressSessions()).resolves.toEqual([
        {
          _id: 'owned-id',
          session: expect.objectContaining({ tenantId: 'test-tenant' }),
        },
      ]);
      await expect(sessionManager.countAllExpressSessions()).resolves.toBe(1);
    });

    it('skips user-session index sets when listing and counting sessions', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const indexKey = 'parako:session:user-sessions:user@example.com';
      const sessionKey = 'parako:session:session-id';
      const missingKey = 'parako:session:missing-id';
      const anonymousKey = 'parako:session:anonymous-id';
      const redisClient = {
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            [indexKey, missingKey, anonymousKey, sessionKey],
          ]),
        get: vi.fn(async (key: string) => {
          if (key === indexKey) {
            throw new Error('WRONGTYPE Operation against a key holding a set');
          }
          if (key === missingKey) return null;
          if (key === anonymousKey) {
            return JSON.stringify({ isAuthenticated: false });
          }
          return JSON.stringify({
            accountId: 'user@example.com',
            isAuthenticated: true,
            authTime: '2026-08-01T10:00:00.000Z',
          });
        }),
      };
      sessionManager.redisClient = redisClient;

      await expect(sessionManager.findAllExpressSessions()).resolves.toEqual([
        {
          _id: 'session-id',
          session: expect.objectContaining({
            accountId: 'user@example.com',
            isAuthenticated: true,
          }),
        },
      ]);
      await expect(sessionManager.countAllExpressSessions()).resolves.toBe(1);
      expect(redisClient.get).not.toHaveBeenCalledWith(indexKey);
    });

    it('filters authenticated Redis sessions by account search', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const payloads: Record<string, string> = {
        'parako:session:alice-id': JSON.stringify({
          accountId: 'Alice@example.com',
          isAuthenticated: true,
          authTime: 200,
        }),
        'parako:session:bob-id': JSON.stringify({
          accountId: 'bob@example.com',
          isAuthenticated: true,
          authTime: 300,
        }),
        'parako:session:no-account-id': JSON.stringify({
          isAuthenticated: true,
          authTime: 400,
        }),
      };
      sessionManager.redisClient = {
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key])),
      };

      await expect(
        sessionManager.findAllExpressSessions({ search: 'alice' })
      ).resolves.toEqual([
        {
          _id: 'alice-id',
          session: expect.objectContaining({ accountId: 'Alice@example.com' }),
        },
      ]);
      await expect(
        sessionManager.countAllExpressSessions('alice')
      ).resolves.toBe(1);
    });

    it('sorts valid authentication times before malformed Redis values', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const payloads: Record<string, string | null> = {
        'parako:session:invalid-session': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: 'not-a-date',
        }),
        'parako:session:missing-time-session': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
        }),
        'parako:session:older-session': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: '2026-08-01T09:00:00.000Z',
        }),
        'parako:session:newer-session': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: '2026-08-01T10:00:00.000Z',
        }),
        'parako:session:anonymous-session': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: false,
        }),
        'parako:session:missing-session': null,
        'parako:session:corrupt-session': '{not-json',
      };
      sessionManager.redisClient = {
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
      };

      const sessions = await sessionManager.findAllExpressSessions();

      expect(sessions.map(({ _id }: { _id: string }) => _id)).toEqual([
        'newer-session',
        'older-session',
        'invalid-session',
        'missing-time-session',
      ]);
    });
  });

  describe.each(['sqlite', 'postgresql'])('%s session rows', adapterType => {
    it('lists and counts only sessions owned by the active tenant', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        adapterType
      );
      const rows = [
        {
          sid: 'owned-id',
          data: JSON.stringify({
            accountId: 'shared@example.com',
            isAuthenticated: true,
            tenantId: 'test-tenant',
          }),
        },
        {
          sid: 'foreign-id',
          data: JSON.stringify({
            accountId: 'shared@example.com',
            isAuthenticated: true,
            tenantId: 'other-tenant',
          }),
        },
        {
          sid: 'legacy-id',
          data: JSON.stringify({
            accountId: 'shared@example.com',
            isAuthenticated: true,
          }),
        },
      ];
      sessionManager.prismaClient = {
        session: { findMany: vi.fn().mockResolvedValue(rows) },
      };

      await expect(sessionManager.findAllExpressSessions()).resolves.toEqual([
        {
          _id: 'owned-id',
          session: expect.objectContaining({ tenantId: 'test-tenant' }),
        },
      ]);
      await expect(sessionManager.countAllExpressSessions()).resolves.toBe(1);
    });

    it('filters, searches, sorts, paginates, and counts authenticated sessions', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        adapterType
      );
      const rows = [
        {
          sid: 'older-session',
          data: JSON.stringify({
            accountId: 'alice@example.com',
            isAuthenticated: true,
            authTime: '2026-08-01T09:00:00.000Z',
          }),
        },
        {
          sid: 'newer-session',
          data: JSON.stringify({
            accountId: 'ALICE+new@example.com',
            isAuthenticated: true,
            authTime: '2026-08-01T10:00:00.000Z',
          }),
        },
        {
          sid: 'anonymous-session',
          data: JSON.stringify({
            accountId: 'alice-anonymous@example.com',
            isAuthenticated: false,
          }),
        },
        {
          sid: 'other-session',
          data: JSON.stringify({
            accountId: 'bob@example.com',
            isAuthenticated: true,
          }),
        },
        {
          sid: 'no-account-session',
          data: JSON.stringify({ isAuthenticated: true }),
        },
        { sid: 'corrupt-session', data: '{not-json' },
      ];
      sessionManager.prismaClient = {
        session: { findMany: vi.fn().mockResolvedValue(rows) },
      };

      await expect(
        sessionManager.findAllExpressSessions({
          search: 'alice',
          offset: 0,
          limit: 1,
        })
      ).resolves.toEqual([
        {
          _id: 'newer-session',
          session: expect.objectContaining({
            accountId: 'ALICE+new@example.com',
          }),
        },
      ]);
      await expect(
        sessionManager.countAllExpressSessions('alice')
      ).resolves.toBe(2);
    });
  });

  describe('enforceSessionLimit()', () => {
    beforeEach(() => {
      deps.configManager.getConfig().security.authentication.session.max_concurrent_sessions = 2;
    });

    it('does nothing when concurrent-session limits are disabled', async () => {
      deps.configManager.getConfig().security.authentication.session.max_concurrent_sessions = 0;

      await expect(
        sessionManager.enforceSessionLimit('user@example.com', 'current-id')
      ).resolves.toBe(0);
      expect(mockCollection.find).not.toHaveBeenCalled();
    });

    it('uses the standard MongoDB collection fallback consistently', async () => {
      sessionManager.options.collection = undefined;
      mockCursor.toArray.mockResolvedValue([]);
      mockCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });
      mockCollection.deleteMany = vi
        .fn()
        .mockResolvedValue({ deletedCount: 0 });
      const collection = (mongoose.connection as any).db.collection;

      await sessionManager.enforceSessionLimit('user@example.com');
      await sessionManager.findExpressSessionsForUser('user@example.com');
      await sessionManager.revokeExpressSession('session-id');
      await sessionManager.revokeAllSessionsForUser('user@example.com');
      await sessionManager.findAllExpressSessions();
      await sessionManager.countAllExpressSessions();

      expect(collection).toHaveBeenCalledTimes(6);
      expect(collection.mock.calls.map(([name]: [string]) => name)).toEqual(
        Array(6).fill('application_session')
      );
    });

    it('removes the oldest MongoDB session while excluding the current session', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      mockCursor.toArray.mockResolvedValue([
        { _id: 'oldest-id', session: { authTime: 100 } },
        { _id: 'newer-id', session: { authTime: 200 } },
      ]);
      mockCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });

      await expect(
        sessionManager.enforceSessionLimit('user@example.com', 'current-id')
      ).resolves.toBe(1);
      expect(mockCollection.find).toHaveBeenCalledWith({
        'session.accountId': 'user@example.com',
        'session.tenantId': 'test-tenant',
        _id: { $ne: 'current-id' },
      });
      expect(mockCursor.sort).toHaveBeenCalledWith({ 'session.authTime': 1 });
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({
        _id: 'oldest-id',
        'session.tenantId': 'test-tenant',
      });
    });

    it('does not remove a MongoDB session below the concurrent limit', async () => {
      mockCursor.toArray.mockResolvedValue([
        { _id: 'only-id', session: { authTime: 100 } },
      ]);
      mockCollection.deleteOne = vi.fn();

      await expect(
        sessionManager.enforceSessionLimit('user@example.com', 'current-id')
      ).resolves.toBe(0);
      expect(mockCollection.deleteOne).not.toHaveBeenCalled();
    });

    it('does not report MongoDB sessions that the backend did not delete', async () => {
      mockCursor.toArray.mockResolvedValue([
        { _id: null, session: { authTime: 50 } },
        { _id: 'undeleted-id', session: { authTime: 100 } },
        { _id: 'newer-id', session: { authTime: 200 } },
      ]);
      mockCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({
        _id: 'undeleted-id',
        $or: [
          { 'session.tenantId': 'default' },
          { 'session.tenantId': { $exists: false } },
        ],
      });
      expect(deps.logger.info).not.toHaveBeenCalledWith(
        'Removed sessions due to concurrent session limit',
        expect.anything()
      );
    });

    it('cleans stale Redis indexes and evicts the oldest valid session', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      const payloads: Record<string, string | null> = {
        'parako:session:oldest-id': JSON.stringify({
          accountId: 'user@example.com',
          authTime: 100,
        }),
        'parako:session:newer-id': JSON.stringify({
          accountId: 'user@example.com',
          authTime: 200,
        }),
        'parako:session:wrong-account': JSON.stringify({
          accountId: 'other@example.com',
          authTime: 50,
        }),
        'parako:session:stale-id': null,
        'parako:session:corrupt-id': '{not-json',
      };
      const redisClient = {
        smembers: vi
          .fn()
          .mockResolvedValue([
            'current-id',
            'oldest-id',
            'newer-id',
            'wrong-account',
            'stale-id',
            'corrupt-id',
          ]),
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
        srem: vi.fn().mockResolvedValue(2),
        multi: vi.fn(() => pipeline),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.enforceSessionLimit('user@example.com', 'current-id')
      ).resolves.toBe(1);
      expect(redisClient.srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com',
        'wrong-account',
        'stale-id',
        'corrupt-id'
      );
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:oldest-id');
      expect(pipeline.srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com',
        'oldest-id'
      );
    });

    it('treats an invalid Redis auth time as oldest during eviction', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      const redisClient = {
        smembers: vi.fn().mockResolvedValue(['recent-id', 'invalid-id']),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            ['parako:session:recent-id', 'parako:session:invalid-id'],
          ]),
        get: vi.fn((key: string) =>
          Promise.resolve(
            JSON.stringify({
              accountId: 'user@example.com',
              authTime: key.endsWith('invalid-id') ? 'not-a-date' : 200,
            })
          )
        ),
        srem: vi.fn().mockResolvedValue(0),
        multi: vi.fn(() => pipeline),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(1);

      expect(pipeline.del).toHaveBeenCalledWith('parako:session:invalid-id');
      expect(pipeline.del).not.toHaveBeenCalledWith('parako:session:recent-id');
    });

    it('enforces the Redis limit when the best-effort user index is missing', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      const payloads: Record<string, string> = {
        'parako:session:oldest-id': JSON.stringify({
          accountId: 'user@example.com',
          authTime: 100,
        }),
        'parako:session:newer-id': JSON.stringify({
          accountId: 'user@example.com',
          authTime: 200,
        }),
      };
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue([]),
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(1);
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:oldest-id');
      expect(pipeline.del).not.toHaveBeenCalledWith('parako:session:newer-id');
    });

    it('does not remove a Redis session below the concurrent limit', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const multi = vi.fn();
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['current-id', 'only-id']),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            ['parako:session:current-id', 'parako:session:only-id'],
          ]),
        get: vi.fn((key: string) =>
          Promise.resolve(
            JSON.stringify({
              accountId: 'user@example.com',
              authTime: key.endsWith('current-id') ? 200 : 100,
            })
          )
        ),
        multi,
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com', 'current-id')
      ).resolves.toBe(0);
      expect(multi).not.toHaveBeenCalled();
    });

    it('does not report a Redis session that the backend did not delete', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 0],
          [null, 1],
        ]),
      };
      const payloads: Record<string, string> = {
        'parako:session:oldest-id': JSON.stringify({
          accountId: 'user@example.com',
          authTime: 100,
        }),
        'parako:session:newer-id': JSON.stringify({
          accountId: 'user@example.com',
          authTime: 200,
        }),
      };
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['oldest-id', 'newer-id']),
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:oldest-id');
      expect(deps.logger.info).not.toHaveBeenCalledWith(
        'Removed sessions due to concurrent session limit',
        expect.anything()
      );
    });

    it('enforces the Redis limit only within the active tenant', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      const payloads: Record<string, string> = {
        'parako:session:owned-oldest': JSON.stringify({
          accountId: 'shared@example.com',
          authTime: 100,
          tenantId: 'test-tenant',
        }),
        'parako:session:owned-newest': JSON.stringify({
          accountId: 'shared@example.com',
          authTime: 200,
          tenantId: 'test-tenant',
        }),
        'parako:session:foreign-oldest': JSON.stringify({
          accountId: 'shared@example.com',
          authTime: 1,
          tenantId: 'other-tenant',
        }),
      };
      sessionManager.redisClient = {
        smembers: vi
          .fn()
          .mockResolvedValue([
            'owned-oldest',
            'owned-newest',
            'foreign-oldest',
          ]),
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key])),
        srem: vi.fn().mockResolvedValue(1),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.enforceSessionLimit('shared@example.com')
      ).resolves.toBe(1);
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:owned-oldest');
      expect(pipeline.del).not.toHaveBeenCalledWith(
        'parako:session:foreign-oldest'
      );
      expect(pipeline.srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:test-tenant:shared@example.com',
        'owned-oldest'
      );
    });

    it('does not evict a Redis session that changes tenant during enforcement', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      deps.configManager.getConfig().security.authentication.session.max_concurrent_sessions = 1;
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      let reads = 0;
      const multi = vi.fn();
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['changing-id']),
        scan: vi.fn().mockResolvedValue(['0', ['parako:session:changing-id']]),
        get: vi.fn(() => {
          reads += 1;
          return Promise.resolve(
            JSON.stringify({
              accountId: 'shared@example.com',
              authTime: 100,
              tenantId: reads === 1 ? 'test-tenant' : 'other-tenant',
            })
          );
        }),
        multi,
      };

      await expect(
        sessionManager.enforceSessionLimit('shared@example.com')
      ).resolves.toBe(0);
      expect(multi).not.toHaveBeenCalled();
    });

    it('ignores missing, failed, and malformed Redis eviction results', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi
          .fn()
          .mockResolvedValue([
            undefined,
            [null, 1],
            [new Error('delete failed'), 1],
            [null, 1],
            [null, '1'],
            [null, 1],
            [null, 0],
            [null, 1],
          ]),
      };
      const sessionIds = ['first', 'second', 'third', 'fourth', 'newest'];
      const payloads = Object.fromEntries(
        sessionIds.map((id, index) => [
          `parako:session:${id}`,
          JSON.stringify({
            accountId: 'user@example.com',
            authTime: index + 1,
          }),
        ])
      );
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(sessionIds),
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(pipeline.del).toHaveBeenCalledTimes(4);
      expect(deps.logger.info).not.toHaveBeenCalledWith(
        'Removed sessions due to concurrent session limit',
        expect.anything()
      );
    });

    it('contains a Redis payload becoming corrupt during enforcement', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      let reads = 0;
      const srem = vi.fn().mockResolvedValue(1);
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['changing-id']),
        scan: vi.fn().mockResolvedValue(['0', ['parako:session:changing-id']]),
        get: vi.fn(() => {
          reads += 1;
          return Promise.resolve(
            reads === 1
              ? JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 100,
                })
              : '{not-json'
          );
        }),
        srem,
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com',
        'changing-id'
      );
    });

    it('contains Redis cleanup failure when a session disappears during enforcement', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const reads = new Map<string, number>();
      const redisClient = {
        smembers: vi.fn().mockResolvedValue(['oldest-id', 'newer-id']),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            ['parako:session:oldest-id', 'parako:session:newer-id'],
          ]),
        get: vi.fn((key: string) => {
          const read = (reads.get(key) ?? 0) + 1;
          reads.set(key, read);
          if (key.endsWith('oldest-id') && read > 1) {
            return Promise.resolve(null);
          }
          return Promise.resolve(
            JSON.stringify({
              accountId: 'user@example.com',
              authTime: key.endsWith('oldest-id') ? 100 : 200,
            })
          );
        }),
        srem: vi.fn().mockRejectedValue('index unavailable'),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(redisClient.srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com',
        'oldest-id'
      );
      await vi.waitFor(() => {
        expect(deps.logger.warn).toHaveBeenCalledWith(
          'Redis session-index lazy cleanup failed (srem)',
          {
            step: 'redis-session-index-cleanup',
            key: 'parako:session:user-sessions:user@example.com',
            err: 'index unavailable',
          }
        );
      });
    });

    it('contains a synchronous Redis cleanup failure during enforcement', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      let reads = 0;
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['disappearing-id']),
        scan: vi
          .fn()
          .mockResolvedValue(['0', ['parako:session:disappearing-id']]),
        get: vi.fn(() => {
          reads += 1;
          return Promise.resolve(
            reads === 1
              ? JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 100,
                })
              : null
          );
        }),
        srem: vi.fn(() => {
          throw new Error('synchronous index failure');
        }),
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Redis session-index lazy cleanup failed (srem)',
        {
          step: 'redis-session-index-cleanup',
          key: 'parako:session:user-sessions:user@example.com',
          err: 'synchronous index failure',
        }
      );
      expect(deps.logger.error).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: 'Failed to enforce session limit' })
      );
    });

    it.each(['sqlite', 'postgresql'])(
      'evicts the oldest valid %s session row',
      async adapterType => {
        mockGetTenantId.mockReturnValue('test-tenant');
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
        sessionManager.prismaClient = {
          session: {
            findMany: vi.fn().mockResolvedValue([
              {
                sid: 'current-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 50,
                  tenantId: 'test-tenant',
                }),
              },
              {
                sid: 'oldest-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 100,
                  tenantId: 'test-tenant',
                }),
              },
              {
                sid: 'foreign-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 1,
                  tenantId: 'other-tenant',
                }),
              },
              { sid: 'corrupt-id', data: '{not-json' },
              {
                sid: 'newer-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 200,
                  tenantId: 'test-tenant',
                }),
              },
            ]),
            deleteMany,
          },
        };

        await expect(
          sessionManager.enforceSessionLimit('user@example.com', 'current-id')
        ).resolves.toBe(1);
        expect(deleteMany).toHaveBeenCalledWith({
          where: { sid: 'oldest-id' },
        });
        expect(deleteMany).not.toHaveBeenCalledWith({
          where: { sid: 'foreign-id' },
        });
      }
    );

    it('treats an invalid Prisma auth time as oldest during eviction', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'sqlite'
      );
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      sessionManager.prismaClient = {
        session: {
          findMany: vi.fn().mockResolvedValue([
            {
              sid: 'recent-id',
              data: JSON.stringify({
                accountId: 'user@example.com',
                authTime: 200,
              }),
            },
            {
              sid: 'invalid-id',
              data: JSON.stringify({
                accountId: 'user@example.com',
                authTime: 'not-a-date',
              }),
            },
          ]),
          deleteMany,
        },
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { sid: 'invalid-id' },
      });
      expect(deleteMany).not.toHaveBeenCalledWith({
        where: { sid: 'recent-id' },
      });
    });

    it.each(['sqlite', 'postgresql'])(
      'does not remove a %s session row below the concurrent limit',
      async adapterType => {
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        const deleteMany = vi.fn();
        sessionManager.prismaClient = {
          session: {
            findMany: vi.fn().mockResolvedValue([
              {
                sid: 'only-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  authTime: 100,
                }),
              },
            ]),
            deleteMany,
          },
        };

        await expect(
          sessionManager.enforceSessionLimit('user@example.com')
        ).resolves.toBe(0);
        expect(deleteMany).not.toHaveBeenCalled();
      }
    );

    it('does not report a Prisma session row the backend did not delete', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'sqlite'
      );
      const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
      sessionManager.prismaClient = {
        session: {
          findMany: vi.fn().mockResolvedValue([
            {
              sid: 'oldest-id',
              data: JSON.stringify({
                accountId: 'user@example.com',
                authTime: 100,
              }),
            },
            {
              sid: 'newer-id',
              data: JSON.stringify({
                accountId: 'user@example.com',
                authTime: 200,
              }),
            },
          ]),
          deleteMany,
        },
      };

      await expect(
        sessionManager.enforceSessionLimit('user@example.com')
      ).resolves.toBe(0);
      expect(deleteMany).toHaveBeenCalledWith({ where: { sid: 'oldest-id' } });
      expect(deps.logger.info).not.toHaveBeenCalledWith(
        'Removed sessions due to concurrent session limit',
        expect.anything()
      );
    });
  });

  describe('user-specific discovery and revocation', () => {
    it('discovers and revokes MongoDB sessions through indexed queries', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      const sessions = [
        {
          _id: 'session-id',
          session: {
            accountId: 'user@example.com',
            isAuthenticated: true,
            authTime: 200,
          },
        },
      ];
      mockCursor.toArray.mockResolvedValue(sessions);
      mockCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      mockCollection.deleteMany = vi
        .fn()
        .mockResolvedValue({ deletedCount: 2 });

      await expect(
        sessionManager.findExpressSessionsForUser('user@example.com')
      ).resolves.toEqual(sessions);
      await expect(
        sessionManager.revokeExpressSession('session-id')
      ).resolves.toBe(true);
      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(2);

      expect(mockCollection.find).toHaveBeenCalledWith({
        'session.accountId': 'user@example.com',
        'session.isAuthenticated': true,
        'session.tenantId': 'test-tenant',
      });
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({
        _id: 'session-id',
        'session.tenantId': 'test-tenant',
      });
      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        'session.accountId': 'user@example.com',
        'session.tenantId': 'test-tenant',
      });
    });

    it('finds authenticated Redis sessions and cleans stale index entries', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const payloads: Record<string, string | null> = {
        'parako:session:older-id': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: 100,
        }),
        'parako:session:newer-id': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: 200,
        }),
        'parako:session:anonymous-id': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: false,
        }),
        'parako:session:stale-id': null,
        'parako:session:corrupt-id': '{not-json',
      };
      const redisClient = {
        smembers: vi
          .fn()
          .mockResolvedValue([
            'older-id',
            'newer-id',
            'anonymous-id',
            'stale-id',
            'corrupt-id',
          ]),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            Object.keys(payloads).filter(key => payloads[key] !== null),
          ]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
        srem: vi.fn().mockResolvedValue(2),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.findExpressSessionsForUser('user@example.com')
      ).resolves.toEqual([
        {
          _id: 'newer-id',
          session: expect.objectContaining({ authTime: 200 }),
        },
        {
          _id: 'older-id',
          session: expect.objectContaining({ authTime: 100 }),
        },
      ]);
      expect(redisClient.srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com',
        'stale-id',
        'corrupt-id'
      );
    });

    it('contains a primitive Redis cleanup rejection during discovery', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const redisClient = {
        smembers: vi.fn().mockResolvedValue(['stale-id']),
        scan: vi.fn().mockResolvedValue(['0', []]),
        get: vi.fn(),
        srem: vi.fn().mockRejectedValue('index unavailable'),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.findExpressSessionsForUser('user@example.com')
      ).resolves.toEqual([]);
      await vi.waitFor(() => {
        expect(deps.logger.warn).toHaveBeenCalledWith(
          'Redis session-index lazy cleanup failed (srem)',
          {
            step: 'redis-session-index-cleanup',
            key: 'parako:session:user-sessions:user@example.com',
            err: 'index unavailable',
          }
        );
      });
    });

    it('finds a live Redis session when its best-effort user index is missing', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const payloads: Record<string, string> = {
        'parako:session:unindexed-id': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: 200,
          tenantId: 'test-tenant',
        }),
        'parako:session:other-id': JSON.stringify({
          accountId: 'user@example.com',
          isAuthenticated: true,
          authTime: 300,
          tenantId: 'other-tenant',
        }),
      };
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue([]),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            ['parako:session:unindexed-id', 'parako:session:other-id'],
          ]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key] ?? null)),
      };

      await expect(
        sessionManager.findExpressSessionsForUser('user@example.com')
      ).resolves.toEqual([
        {
          _id: 'unindexed-id',
          session: expect.objectContaining({
            accountId: 'user@example.com',
            isAuthenticated: true,
          }),
        },
      ]);
    });

    it('skips a Redis session that disappears after reconciliation', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      let reads = 0;
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['disappearing-id']),
        scan: vi
          .fn()
          .mockResolvedValue(['0', ['parako:session:disappearing-id']]),
        get: vi.fn(() => {
          reads += 1;
          return Promise.resolve(
            reads === 1
              ? JSON.stringify({
                  accountId: 'user@example.com',
                  isAuthenticated: true,
                })
              : null
          );
        }),
      };

      await expect(
        sessionManager.findExpressSessionsForUser('user@example.com')
      ).resolves.toEqual([]);
    });

    it.each(['sqlite', 'postgresql'])(
      'finds authenticated user sessions from %s rows',
      async adapterType => {
        mockGetTenantId.mockReturnValue('test-tenant');
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        sessionManager.prismaClient = {
          session: {
            findMany: vi.fn().mockResolvedValue([
              {
                sid: 'invalid-time-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  isAuthenticated: true,
                  authTime: 'not-a-date',
                  tenantId: 'test-tenant',
                }),
              },
              {
                sid: 'matching-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  isAuthenticated: true,
                  authTime: '2026-08-01T10:00:00.000Z',
                  tenantId: 'test-tenant',
                }),
              },
              {
                sid: 'foreign-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  isAuthenticated: true,
                  authTime: '2026-08-01T11:00:00.000Z',
                  tenantId: 'other-tenant',
                }),
              },
              {
                sid: 'legacy-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  isAuthenticated: true,
                }),
              },
              {
                sid: 'wrong-id',
                data: JSON.stringify({
                  accountId: 'other@example.com',
                  isAuthenticated: true,
                }),
              },
              { sid: 'corrupt-id', data: '{not-json' },
            ]),
          },
        };

        await expect(
          sessionManager.findExpressSessionsForUser('user@example.com')
        ).resolves.toEqual([
          {
            _id: 'matching-id',
            session: expect.objectContaining({
              accountId: 'user@example.com',
            }),
          },
          {
            _id: 'invalid-time-id',
            session: expect.objectContaining({
              accountId: 'user@example.com',
              authTime: 'not-a-date',
            }),
          },
        ]);
      }
    );

    it('revokes a Redis session and removes it from the user index', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const redisClient = {
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ accountId: 'user@example.com' })),
        del: vi.fn().mockResolvedValue(1),
        srem: vi.fn().mockResolvedValue(1),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.revokeExpressSession('session-id')
      ).resolves.toBe(true);
      expect(redisClient.del).toHaveBeenCalledWith('parako:session:session-id');
      expect(redisClient.srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com',
        'session-id'
      );
    });

    it('does not revoke a Redis session owned by another tenant', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const redisClient = {
        get: vi.fn().mockResolvedValue(
          JSON.stringify({
            accountId: 'shared@example.com',
            tenantId: 'other-tenant',
          })
        ),
        del: vi.fn(),
        srem: vi.fn(),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.revokeExpressSession('foreign-id')
      ).resolves.toBe(false);
      expect(redisClient.del).not.toHaveBeenCalled();
      expect(redisClient.srem).not.toHaveBeenCalled();
    });

    it('does not derive a Redis index key from malformed stored account data', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const redisClient = {
        get: vi.fn().mockResolvedValue(
          JSON.stringify({
            accountId: { attacker: true },
            isAuthenticated: true,
          })
        ),
        del: vi.fn().mockResolvedValue(1),
        srem: vi.fn().mockResolvedValue(1),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.revokeExpressSession('session-id')
      ).resolves.toBe(true);
      expect(redisClient.del).toHaveBeenCalledWith('parako:session:session-id');
      expect(redisClient.srem).not.toHaveBeenCalled();
    });

    it.each([
      { name: 'missing', storedSession: null },
      { name: 'corrupt', storedSession: '{not-json' },
    ])(
      'does not revoke a Redis session when its stored payload is $name',
      async ({ storedSession }) => {
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          'redis'
        );
        sessionManager.sessionPrefix = 'parako:session:';
        const redisClient = {
          get: vi.fn().mockResolvedValue(storedSession),
          del: vi.fn().mockResolvedValue(1),
          srem: vi.fn().mockResolvedValue(1),
        };
        sessionManager.redisClient = redisClient;

        await expect(
          sessionManager.revokeExpressSession('session-id')
        ).resolves.toBe(false);
        expect(redisClient.del).not.toHaveBeenCalled();
        expect(redisClient.srem).not.toHaveBeenCalled();
      }
    );

    it('returns false when Redis does not delete the requested session', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const redisClient = {
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ accountId: 'user@example.com' })),
        del: vi.fn().mockResolvedValue(0),
        srem: vi.fn().mockResolvedValue(1),
      };
      sessionManager.redisClient = redisClient;

      await expect(
        sessionManager.revokeExpressSession('session-id')
      ).resolves.toBe(false);
      expect(redisClient.srem).not.toHaveBeenCalled();
    });

    it('returns false when MongoDB does not delete the requested session', async () => {
      mockCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });

      await expect(
        sessionManager.revokeExpressSession('session-id')
      ).resolves.toBe(false);
    });

    it.each(['sqlite', 'postgresql'])(
      'revokes one %s session row',
      async adapterType => {
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        const storedData = JSON.stringify({ accountId: 'user@example.com' });
        const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
        sessionManager.prismaClient = {
          session: {
            findUnique: vi.fn().mockResolvedValue({
              sid: 'session-id',
              data: storedData,
            }),
            deleteMany,
          },
        };

        await expect(
          sessionManager.revokeExpressSession('session-id')
        ).resolves.toBe(true);
        expect(deleteMany).toHaveBeenCalledWith({
          where: { sid: 'session-id', data: storedData },
        });
      }
    );

    it.each(['sqlite', 'postgresql'])(
      'does not revoke a %s session row owned by another tenant',
      async adapterType => {
        mockGetTenantId.mockReturnValue('test-tenant');
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        const deleteMany = vi.fn();
        sessionManager.prismaClient = {
          session: {
            findUnique: vi.fn().mockResolvedValue({
              sid: 'foreign-id',
              data: JSON.stringify({ tenantId: 'other-tenant' }),
            }),
            deleteMany,
          },
        };

        await expect(
          sessionManager.revokeExpressSession('foreign-id')
        ).resolves.toBe(false);
        expect(deleteMany).not.toHaveBeenCalled();
      }
    );

    it.each(['sqlite', 'postgresql'])(
      'returns false when %s does not delete the requested session row',
      async adapterType => {
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        const storedData = JSON.stringify({ accountId: 'user@example.com' });
        const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
        sessionManager.prismaClient = {
          session: {
            findUnique: vi.fn().mockResolvedValue({
              sid: 'session-id',
              data: storedData,
            }),
            deleteMany,
          },
        };

        await expect(
          sessionManager.revokeExpressSession('session-id')
        ).resolves.toBe(false);
        expect(deleteMany).toHaveBeenCalledWith({
          where: { sid: 'session-id', data: storedData },
        });
      }
    );

    it.each([
      { name: 'missing', row: null },
      { name: 'corrupt', row: { sid: 'session-id', data: '{not-json' } },
    ])(
      'does not revoke a Prisma session when its stored row is $name',
      async ({ row }) => {
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          'sqlite'
        );
        const deleteMany = vi.fn();
        sessionManager.prismaClient = {
          session: {
            findUnique: vi.fn().mockResolvedValue(row),
            deleteMany,
          },
        };

        await expect(
          sessionManager.revokeExpressSession('session-id')
        ).resolves.toBe(false);
        expect(deleteMany).not.toHaveBeenCalled();
      }
    );

    it('revokes every indexed Redis session for a user', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
          [null, 1],
        ]),
      };
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['first-id', 'second-id']),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            ['parako:session:first-id', 'parako:session:second-id'],
          ]),
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ accountId: 'user@example.com' })),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(2);
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:first-id');
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:second-id');
      expect(pipeline.del).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com'
      );
      expect(pipeline.exec).toHaveBeenCalledOnce();
    });

    it('bulk-revokes Redis sessions only within the active tenant', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      const payloads: Record<string, string> = {
        'parako:session:owned-id': JSON.stringify({
          accountId: 'shared@example.com',
          tenantId: 'test-tenant',
        }),
        'parako:session:foreign-id': JSON.stringify({
          accountId: 'shared@example.com',
          tenantId: 'other-tenant',
        }),
      };
      const srem = vi.fn().mockResolvedValue(1);
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['owned-id', 'foreign-id']),
        scan: vi.fn().mockResolvedValue(['0', Object.keys(payloads)]),
        get: vi.fn((key: string) => Promise.resolve(payloads[key])),
        srem,
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('shared@example.com')
      ).resolves.toBe(1);
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:owned-id');
      expect(pipeline.del).not.toHaveBeenCalledWith(
        'parako:session:foreign-id'
      );
      expect(pipeline.del).toHaveBeenCalledWith(
        'parako:session:user-sessions:test-tenant:shared@example.com'
      );
      expect(srem).toHaveBeenCalledWith(
        'parako:session:user-sessions:test-tenant:shared@example.com',
        'foreign-id'
      );
    });

    it('does not bulk-revoke a Redis session that changes tenant after discovery', async () => {
      mockGetTenantId.mockReturnValue('test-tenant');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      let reads = 0;
      const multi = vi.fn();
      const del = vi.fn().mockResolvedValue(1);
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['changing-id']),
        scan: vi.fn().mockResolvedValue(['0', ['parako:session:changing-id']]),
        get: vi.fn(() => {
          reads += 1;
          return Promise.resolve(
            JSON.stringify({
              accountId: 'shared@example.com',
              tenantId: reads === 1 ? 'test-tenant' : 'other-tenant',
            })
          );
        }),
        multi,
        del,
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('shared@example.com')
      ).resolves.toBe(0);
      expect(multi).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledWith(
        'parako:session:user-sessions:test-tenant:shared@example.com'
      );
      expect(del).not.toHaveBeenCalledWith('parako:session:changing-id');
    });

    it('does not bulk-revoke a Redis session that disappears after discovery', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      let reads = 0;
      const multi = vi.fn();
      const del = vi.fn().mockResolvedValue(1);
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['disappearing-id']),
        scan: vi
          .fn()
          .mockResolvedValue(['0', ['parako:session:disappearing-id']]),
        get: vi.fn(() => {
          reads += 1;
          return Promise.resolve(
            reads === 1
              ? JSON.stringify({ accountId: 'user@example.com' })
              : null
          );
        }),
        multi,
        del,
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(0);
      expect(multi).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com'
      );
      expect(del).not.toHaveBeenCalledWith('parako:session:disappearing-id');
    });

    it('counts only Redis session keys actually deleted during bulk revocation', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['stale-id', 'active-id']),
        scan: vi.fn().mockResolvedValue(['0', ['parako:session:active-id']]),
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ accountId: 'user@example.com' })),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(1);
      expect(deps.logger.info).toHaveBeenCalledWith(
        'Revoked Express sessions for user',
        { userId: 'user@example.com', deletedCount: 1 }
      );
    });

    it('ignores missing, failed, and malformed Redis deletion results', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi
          .fn()
          .mockResolvedValue([
            undefined,
            [new Error('delete failed'), 1],
            [null, '1'],
            [null, 0],
            [null, 1],
          ]),
      };
      const sessionIds = [
        'missing-result',
        'failed-result',
        'invalid-result',
        'zero-result',
      ];
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(sessionIds),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            sessionIds.map(id => `parako:session:${id}`),
          ]),
        get: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ accountId: 'user@example.com' })),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(0);
    });

    it('revokes Redis sessions discovered when the user index is missing', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const pipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 0],
        ]),
      };
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue([]),
        scan: vi
          .fn()
          .mockResolvedValue([
            '0',
            [
              'parako:session:unindexed-id',
              'parako:session:user-sessions:user@example.com',
            ],
          ]),
        get: vi.fn().mockResolvedValue(
          JSON.stringify({
            accountId: 'user@example.com',
            isAuthenticated: true,
          })
        ),
        multi: vi.fn(() => pipeline),
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(1);
      expect(pipeline.del).toHaveBeenCalledWith('parako:session:unindexed-id');
    });

    it('cleans a stale cross-account Redis index without revoking the other session', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.sessionPrefix = 'parako:session:';
      const del = vi.fn().mockResolvedValue(1);
      sessionManager.redisClient = {
        smembers: vi.fn().mockResolvedValue(['other-user-session']),
        scan: vi
          .fn()
          .mockResolvedValue(['0', ['parako:session:other-user-session']]),
        get: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ accountId: 'other@example.com' })
          ),
        del,
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(0);
      expect(del).toHaveBeenCalledOnce();
      expect(del).toHaveBeenCalledWith(
        'parako:session:user-sessions:user@example.com'
      );
      expect(del).not.toHaveBeenCalledWith('parako:session:other-user-session');
    });

    it.each(['sqlite', 'postgresql'])(
      'revokes all matching %s session rows',
      async adapterType => {
        mockGetTenantId.mockReturnValue('test-tenant');
        sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
          adapterType
        );
        const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
        sessionManager.prismaClient = {
          session: {
            findMany: vi.fn().mockResolvedValue([
              {
                sid: 'first-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  tenantId: 'test-tenant',
                }),
              },
              { sid: 'corrupt-id', data: '{not-json' },
              {
                sid: 'second-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  tenantId: 'test-tenant',
                }),
              },
              {
                sid: 'foreign-id',
                data: JSON.stringify({
                  accountId: 'user@example.com',
                  tenantId: 'other-tenant',
                }),
              },
              {
                sid: 'legacy-id',
                data: JSON.stringify({ accountId: 'user@example.com' }),
              },
            ]),
            deleteMany,
          },
        };

        await expect(
          sessionManager.revokeAllSessionsForUser('user@example.com')
        ).resolves.toBe(2);
        expect(deleteMany).toHaveBeenCalledWith({
          where: { sid: { in: ['first-id', 'second-id'] } },
        });
      }
    );

    it('does not issue a Prisma delete when no session belongs to the user', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'sqlite'
      );
      const deleteMany = vi.fn();
      sessionManager.prismaClient = {
        session: {
          findMany: vi.fn().mockResolvedValue([
            {
              sid: 'other-id',
              data: JSON.stringify({ accountId: 'other@example.com' }),
            },
            { sid: 'corrupt-id', data: '{not-json' },
          ]),
          deleteMany,
        },
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(0);
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('returns zero when Prisma matches sessions but deletes no rows', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'sqlite'
      );
      const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
      sessionManager.prismaClient = {
        session: {
          findMany: vi.fn().mockResolvedValue([
            {
              sid: 'matching-id',
              data: JSON.stringify({ accountId: 'user@example.com' }),
            },
          ]),
          deleteMany,
        },
      };

      await expect(
        sessionManager.revokeAllSessionsForUser('user@example.com')
      ).resolves.toBe(0);
      expect(deleteMany).toHaveBeenCalledOnce();
    });

    it.each(['', '   '])(
      'treats the invalid identifier %j as a safe no-op',
      async invalidIdentifier => {
        await expect(
          sessionManager.enforceSessionLimit(invalidIdentifier)
        ).resolves.toBe(0);
        await expect(
          sessionManager.findExpressSessionsForUser(invalidIdentifier)
        ).resolves.toEqual([]);
        await expect(
          sessionManager.revokeExpressSession(invalidIdentifier)
        ).resolves.toBe(false);
        await expect(
          sessionManager.revokeAllSessionsForUser(invalidIdentifier)
        ).resolves.toBe(0);
        expect(mockCollection.find).not.toHaveBeenCalled();
      }
    );

    const expectEverySessionOperationToReject = async (
      expected: Error | RegExp
    ): Promise<void> => {
      const operations = [
        () => sessionManager.enforceSessionLimit('user@example.com'),
        () => sessionManager.revokeAllSessionsForUser('user@example.com'),
        () => sessionManager.findExpressSessionsForUser('user@example.com'),
        () => sessionManager.revokeExpressSession('session-id'),
        () => sessionManager.findAllExpressSessions(),
        () => sessionManager.countAllExpressSessions(),
      ];

      for (const operation of operations) {
        const assertion = expect(operation()).rejects;
        if (expected instanceof Error) {
          await assertion.toBe(expected);
        } else {
          await assertion.toThrow(expected);
        }
      }
    };

    it('rejects an unsupported effective adapter type', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'unsupported'
      );

      await expectEverySessionOperationToReject(
        /Unsupported session store type: unsupported/
      );
      expect(deps.logger.error).toHaveBeenCalledTimes(6);
    });

    it('rejects when the MongoDB session connection is unavailable', async () => {
      vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({
        db: undefined,
      } as any);

      await expectEverySessionOperationToReject(
        /MongoDB session store is unavailable/
      );
      expect(deps.logger.error).toHaveBeenCalledTimes(6);
    });

    it('rejects when the Redis session client is unavailable', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'redis'
      );
      sessionManager.redisClient = undefined;

      await expectEverySessionOperationToReject(
        /Redis session store is unavailable/
      );
      expect(deps.logger.error).toHaveBeenCalledTimes(6);
    });

    it('rejects when the Prisma session client is unavailable', async () => {
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'sqlite'
      );
      sessionManager.prismaClient = null;

      await expectEverySessionOperationToReject(
        /Prisma session store is unavailable/
      );
      expect(deps.logger.error).toHaveBeenCalledTimes(6);
    });

    it('propagates MongoDB failures from every session operation', async () => {
      const storageError = new Error('database unavailable');
      mockCollection.find.mockImplementation(() => {
        throw storageError;
      });
      mockCollection.deleteOne = vi.fn().mockRejectedValue(storageError);
      mockCollection.deleteMany = vi.fn().mockRejectedValue(storageError);
      mockCursor.toArray.mockRejectedValue(storageError);
      mockCollection.countDocuments.mockRejectedValue(storageError);

      await expectEverySessionOperationToReject(storageError);
      expect(deps.logger.error).toHaveBeenCalledTimes(6);
    });

    it('propagates Prisma failures from every session operation', async () => {
      const storageError = new Error('database unavailable');
      sessionManager.oidcAdapterBridge.effectiveOidcAdapter.mockReturnValue(
        'postgresql'
      );
      sessionManager.prismaClient = {
        session: {
          findMany: vi.fn().mockRejectedValue(storageError),
          findUnique: vi.fn().mockRejectedValue(storageError),
          deleteMany: vi.fn().mockRejectedValue(storageError),
        },
      };

      await expectEverySessionOperationToReject(storageError);
      expect(deps.logger.error).toHaveBeenCalledTimes(6);
    });
  });
});
