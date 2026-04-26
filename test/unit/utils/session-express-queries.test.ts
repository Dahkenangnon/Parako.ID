import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
  unmanaged: () => () => undefined,
}));

// Mock connect-mongodb-session
vi.mock('connect-mongodb-session', () => {
  return {
    default: vi.fn(() => {
      return vi.fn().mockImplementation(() => ({
        on: vi.fn(),
      }));
    }),
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
  tenantContext: {
    getTenantId: vi.fn().mockReturnValue('test-tenant'),
  },
}));

import { SessionManager } from '../../../src/utils/session.js';

// ── Test Helpers ──

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

// ── Tests for findAllExpressSessions and countAllExpressSessions ──

describe('SessionManager - Express session queries', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let sessionManager: any;

  // Mock MongoDB collection
  let mockCollection: any;
  let mockCursor: any;

  beforeEach(() => {
    vi.clearAllMocks();
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
      });
      expect(mockCursor.sort).toHaveBeenCalledWith({
        'session.authTime': -1,
      });
      expect(mockCursor.skip).toHaveBeenCalledWith(0);
      expect(mockCursor.limit).toHaveBeenCalledWith(20);
      expect(result).toEqual(mockSessions);
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

    it('should apply search filter on accountId', async () => {
      mockCursor.toArray.mockResolvedValue([]);

      await sessionManager.findAllExpressSessions({ search: 'john' });

      expect(mockCollection.find).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
        $or: [
          {
            'session.accountId': { $regex: 'john', $options: 'i' },
          },
        ],
      });
    });

    it('should return empty array when MongoDB connection is not available', async () => {
      vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({
        db: null,
      } as any);

      const result = await sessionManager.findAllExpressSessions();

      expect(result).toEqual([]);
      expect(deps.logger.warn).toHaveBeenCalled();
    });

    it('should return empty array on error', async () => {
      mockCursor.toArray.mockRejectedValue(new Error('DB error'));

      const result = await sessionManager.findAllExpressSessions();

      expect(result).toEqual([]);
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });

  describe('countAllExpressSessions()', () => {
    it('should count all authenticated sessions in MongoDB', async () => {
      mockCollection.countDocuments.mockResolvedValue(42);

      const result = await sessionManager.countAllExpressSessions();

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({
        'session.isAuthenticated': true,
      });
      expect(result).toBe(42);
    });

    it('should return 0 when MongoDB connection is not available', async () => {
      vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({
        db: null,
      } as any);

      const result = await sessionManager.countAllExpressSessions();

      expect(result).toBe(0);
    });

    it('should return 0 on error', async () => {
      mockCollection.countDocuments.mockRejectedValue(new Error('DB error'));

      const result = await sessionManager.countAllExpressSessions();

      expect(result).toBe(0);
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });
});
