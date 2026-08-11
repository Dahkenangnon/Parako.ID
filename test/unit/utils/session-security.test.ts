import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MongoDBStore from 'connect-mongodb-session';
import { RedisStore } from 'connect-redis';
import { Redis } from 'ioredis';
import { UAParser } from 'ua-parser-js';

vi.mock('inversify', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
  unmanaged: () => () => undefined,
}));

vi.mock('connect-mongodb-session', () => ({
  default: vi.fn(() => vi.fn()),
}));

vi.mock('connect-redis', () => ({ RedisStore: vi.fn() }));
vi.mock('ioredis', () => ({ Redis: vi.fn() }));
vi.mock('ua-parser-js', () => ({ UAParser: vi.fn() }));

vi.mock('../../../src/utils/prisma-session-store.js', () => ({
  PrismaSessionStore: vi.fn(),
}));

vi.mock('../../../src/utils/connect-redis-client.js', () => ({
  createConnectRedisClientAdapter: vi.fn(),
}));

vi.mock('../../../src/utils/encryption.js', () => ({
  encryptValue: vi.fn((value: string) => `encrypted:${value}`),
  decryptValue: vi.fn((value: string) => value),
  isEncrypted: vi.fn(() => true),
}));

import {
  decryptValue,
  encryptValue,
  isEncrypted,
} from '../../../src/utils/encryption.js';
import { PrismaSessionStore } from '../../../src/utils/prisma-session-store.js';
import { createConnectRedisClientAdapter } from '../../../src/utils/connect-redis-client.js';
import {
  FlashManager,
  type FlashContainer,
  SessionManager,
  type SessionUserAccount,
} from '../../../src/utils/session.js';

function createManager(options: { encryptSessionData?: boolean } = {}) {
  const config = {
    deployment: {
      environment: 'production',
      url: 'https://parako.example',
      routes: {
        auth: '/auth',
        auth_routes: { login: '/login' },
      },
      cookies: {
        defaults: { path: '/' },
        types: {
          session: {
            name: 'application_session',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          },
        },
      },
    },
    security: {
      secrets: {
        cookie_secrets: ['test-secret-that-is-at-least-32-characters'],
      },
      authentication: {
        session: {
          cookie_name: 'application_session',
          same_site: 'lax',
          encrypt_session_data: options.encryptSessionData ?? false,
        },
      },
    },
    oidc: {
      path: '/oidc/v1',
      routes: {
        token: '/token',
        userinfo: '/userinfo',
        introspection: '/introspection',
        revocation: '/revocation',
        device_authorization: '/device_authorization',
      },
      token_ttl: { session: 1209600 },
    },
    oidc_storage: {
      oidc_adapter: {
        type: 'sqlite',
      },
    },
    features: {
      multi_tenancy: {
        enabled: false,
        extraction_priority: ['header', 'subdomain'],
        tenant_header: 'x-tenant-id',
      },
    },
  };

  const configManager = {
    getConfig: vi.fn(() => config),
    subscribe: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const userService = { findById: vi.fn() };

  const manager = new SessionManager(
    configManager as never,
    { views: { errors: { forbidden: 'errors/forbidden' } } } as never,
    logger as never,
    userService as never,
    null
  );

  return { config, configManager, manager, logger, userService };
}

function createApiResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    render: vi.fn(),
    redirect: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
}

describe('SessionManager configuration and initialization', () => {
  it('rejects a short production session secret', () => {
    const { config, logger, userService } = createManager();
    config.security.secrets.cookie_secrets = ['short'];

    expect(
      () =>
        new SessionManager(
          { getConfig: vi.fn(() => config), subscribe: vi.fn() } as never,
          { views: { errors: { forbidden: 'errors/forbidden' } } } as never,
          logger as never,
          userService as never,
          null
        )
    ).toThrow(
      'Session secret must be at least 32 characters in production mode'
    );
  });

  it('reports critical configuration changes through its subscription', () => {
    const { config, configManager, logger } = createManager();
    const subscriber = configManager.subscribe.mock.calls[0]?.[1] as (
      updatedConfig: unknown
    ) => void;
    const updatedConfig = structuredClone(config);
    updatedConfig.security.secrets.cookie_secrets = [
      'different-secret-that-is-at-least-32-characters',
    ];
    updatedConfig.oidc_storage.oidc_adapter.type = 'postgresql';
    Object.assign(updatedConfig.security.authentication.session, {
      idle_timeout_minutes: 15,
      absolute_timeout_hours: 12,
      max_concurrent_sessions: 3,
    });

    subscriber(updatedConfig);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Application restart required'),
      expect.objectContaining({
        changedSettings: [
          'security.secrets.cookie_secrets',
          'oidc_storage.oidc_adapter.type',
        ],
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Timeout settings will apply'),
      {
        idleTimeout: 15,
        absoluteTimeout: 12,
        maxConcurrentSessions: 3,
      }
    );
  });

  it('applies non-critical configuration notifications without requesting a restart', () => {
    const { config, configManager, logger } = createManager();
    const subscriber = configManager.subscribe.mock.calls[0]?.[1] as (
      updatedConfig: unknown
    ) => void;
    const updatedConfig = structuredClone(config);
    Object.assign(updatedConfig.security.authentication.session, {
      idle_timeout_minutes: 5,
      absolute_timeout_hours: 2,
      max_concurrent_sessions: 4,
    });

    subscriber(updatedConfig);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Timeout settings will apply'),
      {
        idleTimeout: 5,
        absoluteTimeout: 2,
        maxConcurrentSessions: 4,
      }
    );
  });

  it('treats a removed cookie-secret setting as a critical configuration change', () => {
    const { config, configManager, logger } = createManager();
    const subscriber = configManager.subscribe.mock.calls[0]?.[1] as (
      updatedConfig: unknown
    ) => void;
    const updatedConfig = structuredClone(config) as any;
    delete updatedConfig.security.secrets.cookie_secrets;

    subscriber(updatedConfig);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Application restart required'),
      expect.objectContaining({
        changedSettings: ['security.secrets.cookie_secrets'],
      })
    );
  });

  it('uses safe built-in session defaults when optional cookie settings are blank', () => {
    const { config, configManager, logger, userService } = createManager();
    config.security.secrets.cookie_secrets = [];
    (config.security.authentication.session as any).cookie_name = '';
    (config.security.authentication.session as any).same_site = '';
    config.deployment.cookies.types.session.name = '';
    (config.deployment.cookies.types.session as any).sameSite = '';
    config.oidc.token_ttl.session = 0;
    const explicitSecret = 'explicit-secret-that-is-at-least-32-characters';

    const manager = new SessionManager(
      configManager as never,
      { views: { errors: { forbidden: 'errors/forbidden' } } } as never,
      logger as never,
      userService as never,
      null,
      { secret: explicitSecret }
    );

    expect((manager as any).options).toMatchObject({
      secret: explicitSecret,
      name: 'application_session',
      collection: 'application_session',
      ttl: 1209600,
      cookie: {
        sameSite: 'lax',
        maxAge: 1209600000,
      },
    });
  });

  it('ignores configuration notifications after its initial snapshot is cleared', () => {
    const { config, configManager, logger, manager } = createManager();
    const subscriber = configManager.subscribe.mock.calls[0]?.[1] as (
      updatedConfig: unknown
    ) => void;
    (manager as any).initialSessionSettings = null;

    subscriber(config);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('generates distinct UUID session identifiers by default', () => {
    const { manager } = createManager();
    const generate = (manager as any).options
      .sessionIdGenerator as () => string;

    const first = generate();
    const second = generate();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(second).not.toBe(first);
  });

  it('prefixes multi-tenant session IDs from the configured request source', () => {
    const { config, manager } = createManager();
    config.features.multi_tenancy.enabled = true;

    const fromHeader = (manager as any).generateSessionId({
      headers: { 'x-tenant-id': 'tenant-a' },
      hostname: 'parako.example',
    });
    const fromSubdomain = (manager as any).generateSessionId({
      headers: {},
      hostname: 'tenant-b.parako.example',
    });

    expect(fromHeader).toMatch(/^tenant-a\.[0-9a-f-]{36}$/);
    expect(fromSubdomain).toMatch(/^tenant-b\.[0-9a-f-]{36}$/);
  });

  it('fails malformed multi-tenant session prefixes closed to default', () => {
    const { config, manager } = createManager();
    config.features.multi_tenancy.enabled = true;

    const sessionId = (manager as any).generateSessionId({
      headers: { 'x-tenant-id': 'INVALID' },
      hostname: 'parako.example',
    });

    expect(sessionId).toMatch(/^default\.[0-9a-f-]{36}$/);
  });

  it('uses default ownership when a multi-tenant session has no request', () => {
    const { config, manager } = createManager();
    config.features.multi_tenancy.enabled = true;

    const sessionId = (manager as any).generateSessionId();

    expect(sessionId).toMatch(/^default\.[0-9a-f-]{36}$/);
  });

  it('keeps generated session identifiers unprefixed in single-tenant mode', () => {
    const { manager } = createManager();

    const sessionId = (manager as any).generateSessionId({ headers: {} });

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses extraction defaults when optional multi-tenant settings are absent', () => {
    const { config, manager } = createManager();
    config.features.multi_tenancy.enabled = true;
    (config.features.multi_tenancy as any).extraction_priority = undefined;
    (config.features.multi_tenancy as any).tenant_header = undefined;

    const sessionId = (manager as any).generateSessionId({
      headers: { 'x-tenant-id': 'tenant-a' },
      hostname: 'tenant-b.parako.example',
    });

    expect(sessionId).toMatch(/^default\.[0-9a-f-]{36}$/);
  });

  it('uses the standard tenant header when no custom header is configured', () => {
    const { config, manager } = createManager();
    config.features.multi_tenancy.enabled = true;
    config.features.multi_tenancy.extraction_priority = ['header'];
    (config.features.multi_tenancy as any).tenant_header = undefined;

    const sessionId = (manager as any).generateSessionId({
      headers: { 'x-tenant-id': 'tenant-a' },
      hostname: 'parako.example',
    });

    expect(sessionId).toMatch(/^tenant-a\.[0-9a-f-]{36}$/);
  });

  it('uses default ownership when a configured subdomain source has no tenant label', () => {
    const { config, manager } = createManager();
    config.features.multi_tenancy.enabled = true;
    config.features.multi_tenancy.extraction_priority = ['subdomain'];

    const sessionId = (manager as any).generateSessionId({
      headers: {},
      hostname: 'parako.example',
    });

    expect(sessionId).toMatch(/^default\.[0-9a-f-]{36}$/);
  });

  it('initializes once with the effective Prisma adapter and exposes middleware', () => {
    const { manager, logger } = createManager();
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => 'postgresql'),
    } as never);
    const app = { use: vi.fn() };

    manager.initialize(app as never);
    const middleware = manager.getMiddleware();
    manager.initialize(app as never);

    expect(store.startCleanup).toHaveBeenCalledOnce();
    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.use).toHaveBeenNthCalledWith(1, middleware);
    expect(logger.info).toHaveBeenCalledWith(
      'Session middleware configured with postgresql store'
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Session manager already initialized'
    );
  });

  it('fails clearly before initialization and without a Prisma client', () => {
    const { manager } = createManager();

    expect(() => manager.getMiddleware()).toThrow(
      'Session middleware not initialized. Call initialize() first.'
    );
    expect(() => manager.initialize({ use: vi.fn() } as never)).toThrow(
      'Prisma client not available for session store'
    );
  });

  it('rejects a missing Express app before allocating a session store', () => {
    vi.clearAllMocks();
    const { manager } = createManager();
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };

    expect(() => manager.initialize(null as never)).toThrow(
      'Failed to initialize session middleware'
    );
    expect(PrismaSessionStore).not.toHaveBeenCalled();
    expect(store.startCleanup).not.toHaveBeenCalled();
  });

  it('fails clearly when middleware construction produces no middleware', () => {
    const { manager } = createManager();
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };
    (manager as any).setupMiddleware = vi.fn();

    expect(() => manager.initialize({ use: vi.fn() } as never)).toThrow(
      'Failed to initialize session middleware'
    );
  });

  it('warns when development sessions use non-secure cookies', () => {
    vi.clearAllMocks();
    const { config, manager, logger } = createManager();
    config.deployment.environment = 'development';
    config.deployment.cookies.types.session.secure = false;
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };

    manager.initialize({ use: vi.fn() } as never);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Session cookies are not secure'),
      { context: 'session_security_warning' }
    );
  });

  it('translates MongoDB configuration and handles store lifecycle events', () => {
    const { config, manager, logger } = createManager();
    Object.assign(config.oidc_storage.oidc_adapter, {
      type: 'mongodb',
      mongodb: { uri: 'mongodb://database.example/parako' },
    });
    Object.assign(config.security.authentication.session, {
      idle_timeout_minutes: 15,
    });
    const eventHandlers = new Map<string, (...args: any[]) => void>();
    const clientHandlers = new Map<string, (...args: any[]) => void>();
    const store = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        eventHandlers.set(event, handler);
      }),
      client: {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          clientHandlers.set(event, handler);
        }),
      },
    };
    const MongoStore = vi.fn(function MockMongoStore() {
      return store;
    });
    vi.mocked(MongoDBStore).mockReturnValue(MongoStore as never);
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => 'mongodb'),
    } as never);

    manager.initialize({ use: vi.fn() } as never);

    expect(MongoStore).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'mongodb://database.example/parako',
        collection: 'application_session',
        expires: 1209600,
        touchAfter: 900,
      })
    );
    eventHandlers.get('error')?.(new Error('store disconnected'));
    clientHandlers.get('reconnect')?.();
    expect(logger.warn).toHaveBeenCalledWith(
      'MongoDB session store disconnected. Attempting to reconnect...'
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Session store successfully reconnected'
    );
  });

  it('uses safe MongoDB defaults when optional session settings are absent', () => {
    vi.clearAllMocks();
    const { config, manager, logger } = createManager();
    Object.assign(config.oidc_storage.oidc_adapter, {
      type: 'mongodb',
      mongodb: { uri: 'mongodb://database.example/parako' },
    });
    (manager as any).options.collection = '';
    const store = { on: vi.fn() };
    const MongoStore = vi.fn(function MockMongoStore() {
      return store;
    });
    vi.mocked(MongoDBStore).mockReturnValue(MongoStore as never);
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => 'mongodb'),
    } as never);

    manager.initialize({ use: vi.fn() } as never);

    expect(MongoStore).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'sessions',
        touchAfter: 1800,
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'MongoDB session store configured with collection: sessions'
    );
  });

  it('translates Redis configuration and registers connection handlers', () => {
    const { config, manager, logger } = createManager();
    Object.assign(config.deployment, { redis_prefix: 'demo' });
    Object.assign(config.oidc_storage.oidc_adapter, {
      type: 'redis',
      redis: {
        host: 'redis.example',
        port: 6380,
        database: 2,
        password: 'secret',
      },
    });
    const redisHandlers = new Map<string, (...args: any[]) => void>();
    const redisClient = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        redisHandlers.set(event, handler);
      }),
    };
    const store = { on: vi.fn() };
    vi.mocked(Redis).mockImplementation(function MockRedis() {
      return redisClient;
    } as never);
    vi.mocked(createConnectRedisClientAdapter).mockReturnValue(
      'adapted-client' as never
    );
    vi.mocked(RedisStore).mockImplementation(function MockRedisStore() {
      return store;
    } as never);
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => 'redis'),
    } as never);

    manager.initialize({ use: vi.fn() } as never);

    expect(Redis).toHaveBeenCalledWith('redis://redis.example:6380/2', {
      password: 'secret',
    });
    expect(RedisStore).toHaveBeenCalledWith({
      client: 'adapted-client',
      prefix: 'demo:session:',
      ttl: 1209600,
    });
    redisHandlers.get('error')?.(new Error('connection failed'));
    redisHandlers.get('connect')?.();
    expect(logger.error).toHaveBeenCalledWith(
      'Redis session store connection error',
      { error: 'Error: connection failed' }
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Redis session store connected successfully'
    );
  });

  it('uses the built-in Redis namespace when no deployment prefix is configured', () => {
    vi.clearAllMocks();
    const { config, manager } = createManager();
    Object.assign(config.oidc_storage.oidc_adapter, {
      type: 'redis',
      redis: { host: 'redis.example', port: 6379, database: 0 },
    });
    const redisClient = { on: vi.fn() };
    vi.mocked(Redis).mockImplementation(function MockRedis() {
      return redisClient;
    } as never);
    vi.mocked(createConnectRedisClientAdapter).mockReturnValue(
      'adapted-client' as never
    );
    vi.mocked(RedisStore).mockImplementation(function MockRedisStore() {
      return { on: vi.fn() };
    } as never);
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => 'redis'),
    } as never);

    manager.initialize({ use: vi.fn() } as never);

    expect(RedisStore).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'parako:session:' })
    );
  });

  it('falls back to a one-day Prisma TTL when no normalized TTL is available', () => {
    vi.clearAllMocks();
    const { manager } = createManager();
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };
    (manager as any).options.ttl = undefined;

    (manager as any).setupPrismaStore();

    expect(PrismaSessionStore).toHaveBeenCalledWith(
      (manager as any).prismaClient,
      86400,
      expect.anything()
    );
  });

  it.each([
    {
      name: 'development MongoDB disconnection',
      environment: 'development',
      storeType: 'mongodb',
      message: 'store disconnected',
    },
    {
      name: 'production non-MongoDB disconnection',
      environment: 'production',
      storeType: 'sqlite',
      message: 'store disconnected',
    },
    {
      name: 'production MongoDB generic error',
      environment: 'production',
      storeType: 'mongodb',
      message: 'query failed',
    },
  ])('logs a $name without a MongoDB reconnect warning', scenario => {
    const { config, manager, logger } = createManager();
    config.deployment.environment = scenario.environment;
    (manager as any).options.storeType = scenario.storeType;
    let errorHandler: ((error: Error) => void) | undefined;
    const store = {
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === 'error') errorHandler = handler;
      }),
    };

    (manager as any).handleStoreErrors(store);
    errorHandler?.(new Error(scenario.message));

    expect(logger.error).toHaveBeenCalledWith('Session store error', {
      error: scenario.message,
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      'MongoDB session store disconnected. Attempting to reconnect...'
    );
  });

  it('ignores a session store that does not expose lifecycle events', () => {
    const { manager } = createManager();

    expect(() => (manager as any).handleStoreErrors({})).not.toThrow();
  });

  it.each([
    { type: 'mongodb', message: 'MongoDB URI is required' },
    { type: 'redis', message: 'Redis configuration is required' },
  ])('rejects incomplete $type store configuration', ({ type, message }) => {
    const { manager } = createManager();
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => type),
    } as never);

    expect(() => manager.initialize({ use: vi.fn() } as never)).toThrow(
      message
    );
  });

  it('rejects an unsupported effective session-store type', () => {
    const { manager } = createManager();
    manager.setOidcAdapterBridge({
      effectiveOidcAdapter: vi.fn(() => 'unsupported'),
    } as never);

    expect(() => manager.initialize({ use: vi.fn() } as never)).toThrow(
      'Unsupported session store type: unsupported'
    );
  });

  it('resolves its store type from configuration when no bridge is set', () => {
    const { config, manager } = createManager();

    expect((manager as any).resolveStoreType()).toBe('sqlite');
    config.oidc_storage.oidc_adapter.type = undefined as never;
    expect((manager as any).resolveStoreType()).toBe('mongodb');
  });

  it('uses MongoDB as the final setup fallback when no effective store type exists', () => {
    const { manager } = createManager();
    (manager as any).options.storeType = undefined;
    const setupMongoDBStore = vi
      .spyOn(manager as any, 'setupMongoDBStore')
      .mockImplementation(() => {
        (manager as any).store = { on: vi.fn() };
      });

    (manager as any).setupStore();

    expect(setupMongoDBStore).toHaveBeenCalledOnce();
    expect((manager as any).options.storeType).toBe('mongodb');
  });

  it('keeps Redis reconciliation and index helpers safe without a client', async () => {
    const { manager } = createManager();

    await expect(
      (manager as any).findRedisSessionIdsForAccount('user@example.com')
    ).resolves.toEqual([]);
    expect(() =>
      (manager as any).redisIndexAdd('user@example.com', 'session-id')
    ).not.toThrow();
    expect(() =>
      (manager as any).redisIndexRemove('user@example.com', 'session-id')
    ).not.toThrow();
    expect(() =>
      (manager as any).redisIndexReplace(
        'old@example.com',
        'new@example.com',
        'session-id'
      )
    ).not.toThrow();
  });

  it('uses the fallback TTL when adding a Redis session index entry', () => {
    const { manager } = createManager();
    const pipeline = {
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).options.ttl = 0;
    (manager as any).sessionPrefix = 'parako:session:';

    (manager as any).redisIndexAdd('user@example.com', 'session-id');

    expect(pipeline.expire).toHaveBeenCalledWith(
      'parako:session:user-sessions:user@example.com',
      86400
    );
  });

  it.each([
    {
      oldAccountId: '',
      newAccountId: 'new@example.com',
      expectedRemove: false,
      expectedAdd: true,
    },
    {
      oldAccountId: 'old@example.com',
      newAccountId: '',
      expectedRemove: true,
      expectedAdd: false,
    },
  ])(
    'moves a Redis index safely with an optional account side',
    ({ oldAccountId, newAccountId, expectedRemove, expectedAdd }) => {
      const { manager } = createManager();
      const pipeline = {
        srem: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
      (manager as any).options.ttl = 0;
      (manager as any).sessionPrefix = 'parako:session:';

      (manager as any).redisIndexReplace(
        oldAccountId,
        newAccountId,
        'session-id'
      );

      expect(pipeline.srem).toHaveBeenCalledTimes(expectedRemove ? 1 : 0);
      expect(pipeline.sadd).toHaveBeenCalledTimes(expectedAdd ? 1 : 0);
      expect(pipeline.expire).toHaveBeenCalledTimes(expectedAdd ? 1 : 0);
      if (expectedAdd) {
        expect(pipeline.expire).toHaveBeenCalledWith(
          'parako:session:user-sessions:new@example.com',
          86400
        );
      }
    }
  );
});

describe('SessionManager CSRF protection', () => {
  let manager: SessionManager;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(encryptValue).mockImplementation(
      (value: string) => `encrypted:${value}`
    );
    vi.mocked(decryptValue).mockImplementation((value: string) => value);
    vi.mocked(isEncrypted).mockReturnValue(true);
    ({ manager } = createManager());
    next = vi.fn();
  });

  it('compares equal-length CSRF tokens in constant time', () => {
    const timingSafeEqual = vi.spyOn(crypto, 'timingSafeEqual');
    const request = {
      session: { csrfToken: 'valid-token' },
    } as unknown as Request;

    expect(manager.validateCsrfToken(request, 'valid-token')).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledOnce();
    expect(manager.validateCsrfToken(request, 'short')).toBe(false);

    timingSafeEqual.mockRestore();
  });

  it('rejects a malformed stored CSRF token without throwing', () => {
    const request = {
      session: { csrfToken: { attacker: true } },
    } as unknown as Request;

    expect(() =>
      manager.validateCsrfToken(request, 'valid-token')
    ).not.toThrow();
    expect(manager.validateCsrfToken(request, 'valid-token')).toBe(false);
  });

  it('generates and rotates 256-bit CSRF tokens in the session', () => {
    const { manager: tokenManager, logger } = createManager();
    const request = {
      session: { id: 'session-id' },
    } as unknown as Request;

    const initialToken = tokenManager.generateCsrfToken(request);
    const rotatedToken = tokenManager.rotateCsrfToken(request);

    expect(initialToken).toMatch(/^[a-f0-9]{64}$/);
    expect(rotatedToken).toMatch(/^[a-f0-9]{64}$/);
    expect(rotatedToken).not.toBe(initialToken);
    expect(request.session.csrfToken).toBe(rotatedToken);
    expect(logger.debug).toHaveBeenCalledWith(
      'CSRF token rotated after sensitive operation',
      { sessionId: 'session-id', hadOldToken: true }
    );
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows the safe %s method without a token',
    method => {
      const request = {
        method,
        path: '/account',
        headers: {},
      } as unknown as Request;

      manager.csrfProtection()(request, createApiResponse(), next);

      expect(next).toHaveBeenCalledOnce();
    }
  );

  it.each([
    { source: 'header', headers: { 'x-csrf-token': 'valid-token' } },
    { source: 'body', body: { _csrf: 'valid-token' } },
    { source: 'query', query: { _csrf: 'valid-token' } },
  ])('allows a valid token from the $source', ({ headers, body, query }) => {
    const request = {
      method: 'POST',
      path: '/account',
      headers: headers ?? {},
      body: body ?? {},
      query: query ?? {},
      session: { csrfToken: 'valid-token' },
    } as unknown as Request;

    manager.csrfProtection()(request, createApiResponse(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows a registered OIDC protocol endpoint without a CSRF token', () => {
    const request = {
      method: 'POST',
      path: '/oidc/v1/token',
      headers: {},
      body: {},
      query: {},
      session: {},
    } as unknown as Request;

    manager.csrfProtection()(request, createApiResponse(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    '/oidc/v1/token',
    '/oidc/v1/me',
    '/oidc/v1/token/introspection',
    '/oidc/v1/token/revocation',
    '/oidc/v1/device/auth',
  ])('allows the default OIDC protocol endpoint %s', path => {
    const { config, manager: defaultRouteManager } = createManager();
    config.oidc.routes = {} as typeof config.oidc.routes;
    const request = {
      method: 'POST',
      path,
      headers: {},
      body: {},
      query: {},
      session: {},
    } as unknown as Request;

    defaultRouteManager.csrfProtection()(request, createApiResponse(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows the profile upload route to perform its post-multipart CSRF check', () => {
    const request = {
      method: 'POST',
      path: '/accounts/update-profile',
      headers: {},
    } as unknown as Request;

    manager.csrfProtection()(request, createApiResponse(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows an API request with a non-empty Bearer credential', () => {
    const request = {
      method: 'POST',
      path: '/api/profile',
      headers: { authorization: 'Bearer access-token' },
      body: {},
      query: {},
      session: {},
    } as unknown as Request;

    manager.csrfProtection()(request, createApiResponse(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    { header: 'origin', value: 'https://parako.example' },
    {
      header: 'referer',
      value: 'https://parako.example/accounts/settings',
    },
  ])(
    'allows an API request with an exact same-origin $header',
    ({ header, value }) => {
      const request = {
        method: 'POST',
        path: '/api/profile',
        headers: { [header]: value },
        body: {},
        query: {},
        session: {},
      } as unknown as Request;

      manager.csrfProtection()(request, createApiResponse(), next);

      expect(next).toHaveBeenCalledOnce();
    }
  );

  it('rejects an API Origin that only starts with the configured origin', () => {
    const request = {
      method: 'POST',
      path: '/api/profile',
      originalUrl: '/api/profile',
      headers: { origin: 'https://parako.example.evil' },
      body: {},
      query: {},
      session: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const response = createApiResponse();

    manager.csrfProtection()(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Forbidden - invalid origin or missing Bearer token',
    });
  });

  it('rejects an empty Bearer credential on an API request', () => {
    const request = {
      method: 'POST',
      path: '/api/profile',
      originalUrl: '/api/profile',
      headers: { authorization: 'Bearer ' },
      body: {},
      query: {},
      session: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const response = createApiResponse();

    manager.csrfProtection()(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Forbidden - invalid origin or missing Bearer token',
    });
  });

  it('fails closed when the configured deployment URL is invalid', () => {
    const { config, logger } = createManager();
    config.deployment.url = 'not-a-url';
    const request = {
      method: 'POST',
      path: '/api/profile',
      originalUrl: '/api/profile',
      headers: { origin: 'https://parako.example' },
      body: {},
      query: {},
      session: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const response = createApiResponse();
    const invalidUrlManager = new SessionManager(
      { getConfig: vi.fn(() => config), subscribe: vi.fn() } as never,
      { views: { errors: { forbidden: 'errors/forbidden' } } } as never,
      logger as never,
      { findById: vi.fn() } as never,
      null
    );

    invalidUrlManager.csrfProtection()(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(logger.error).toHaveBeenCalledWith(
      'Invalid deployment URL for CSRF validation',
      { deploymentUrl: 'not-a-url' }
    );
  });

  it('fails closed for malformed API Origin and Referer headers', () => {
    const request = {
      method: 'POST',
      path: '/api/profile',
      originalUrl: '/api/profile',
      headers: { origin: 'not a url', referer: 'also not a url' },
      body: {},
      query: {},
      session: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const response = createApiResponse();

    expect(() =>
      manager.csrfProtection()(request, response, next)
    ).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Forbidden - invalid origin or missing Bearer token',
    });
  });

  it('renders the forbidden page for an invalid browser form token', () => {
    const request = {
      method: 'POST',
      path: '/auth/login',
      originalUrl: '/auth/login',
      headers: {},
      body: { _csrf: 'wrong-token' },
      query: {},
      session: { csrfToken: 'valid-token' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const response = createApiResponse();

    manager.csrfProtection()(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.render).toHaveBeenCalledWith('errors/forbidden', {
      title: 'Forbidden',
      message: 'CSRF token validation failed',
    });
  });

  it('records missing request and session tokens on browser CSRF failure', () => {
    const { manager: loggingManager, logger } = createManager();
    const request = {
      method: 'POST',
      path: '/auth/login',
      originalUrl: '/auth/login',
      headers: {},
      body: {},
      query: {},
      session: {},
      ip: '127.0.0.1',
    } as unknown as Request;

    loggingManager.csrfProtection()(request, createApiResponse(), next);

    expect(logger.warn).toHaveBeenCalledWith('CSRF validation failed', {
      ip: '127.0.0.1',
      url: '/auth/login',
      method: 'POST',
      providedToken: 'missing',
      sessionToken: 'missing',
    });
  });
});

describe('SessionManager session binding', () => {
  function boundRequest(overrides: Record<string, unknown> = {}): Request {
    return {
      headers: { 'user-agent': 'trusted-browser' },
      body: {
        _deviceInfo: JSON.stringify({ visitorId: 'trusted-device-id' }),
      },
      ip: '203.0.113.10',
      session: {
        id: 'session-id',
        isAuthenticated: true,
        csrfToken: 'csrf-token',
        ipAddress: '203.0.113.10',
        userAgent: 'trusted-browser',
        deviceId: 'trusted-device-id',
      },
      ...overrides,
    } as unknown as Request;
  }

  it('skips binding checks for an unauthenticated session', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_ip: true,
      bind_user_agent: true,
      bind_device: true,
    });
    const request = boundRequest({
      ip: '198.51.100.99',
      headers: { 'user-agent': 'different-browser' },
      session: { isAuthenticated: false },
    });

    expect(manager.validateSessionBinding(request)).toEqual({ valid: true });
  });

  it('rejects an authenticated session with a different IP address', () => {
    const { config, manager, logger } = createManager();
    Object.assign(config.security.authentication.session, { bind_ip: true });
    const request = boundRequest({ ip: '198.51.100.99' });

    expect(manager.validateSessionBinding(request)).toEqual({
      valid: false,
      reason: 'ip_mismatch',
    });
    expect(logger.warn).toHaveBeenCalledWith('Session IP mismatch detected', {
      storedIp: '203.0.113.10',
      currentIp: '198.51.100.99',
      sessionId: 'session-id',
    });
  });

  it('rejects an authenticated session with a different User-Agent', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_user_agent: true,
    });
    const request = boundRequest({
      headers: { 'user-agent': 'different-browser' },
    });

    expect(manager.validateSessionBinding(request)).toEqual({
      valid: false,
      reason: 'user_agent_mismatch',
    });
  });

  it('rejects an authenticated session with a different base64 device ID', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_device: true,
    });
    const request = boundRequest({
      body: {
        _deviceInfo: Buffer.from(
          JSON.stringify({ visitorId: 'different-device-id' })
        ).toString('base64'),
      },
    });

    expect(manager.validateSessionBinding(request)).toEqual({
      valid: false,
      reason: 'device_mismatch',
    });
  });

  it('accepts an authenticated session when every enabled binding matches', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_ip: true,
      bind_user_agent: true,
      bind_device: true,
    });

    expect(manager.validateSessionBinding(boundRequest())).toEqual({
      valid: true,
    });
  });

  it('accepts an authenticated session when binding configuration is absent', () => {
    const { config, manager } = createManager();
    delete (config.security.authentication as any).session;

    expect(manager.validateSessionBinding(boundRequest())).toEqual({
      valid: true,
    });
  });

  it('ignores a non-string device visitor ID without throwing', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_device: true,
    });
    const request = {
      headers: {},
      body: {
        _deviceInfo: JSON.stringify({ visitorId: { attacker: true } }),
      },
      session: {
        id: 'session-id',
        isAuthenticated: true,
        csrfToken: 'csrf-token',
        deviceId: 'trusted-device-id',
      },
    } as unknown as Request;

    expect(manager.validateSessionBinding(request)).toEqual({ valid: true });
  });

  it.each([
    { name: 'missing CSRF token', csrfToken: undefined, deviceInfo: '{}' },
    { name: 'non-string device data', csrfToken: 'token', deviceInfo: {} },
  ])('ignores device binding input with $name', ({ csrfToken, deviceInfo }) => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_device: true,
    });
    const request = {
      headers: {},
      body: { _deviceInfo: deviceInfo },
      session: {
        id: 'session-id',
        isAuthenticated: true,
        csrfToken,
        deviceId: 'trusted-device-id',
      },
    } as unknown as Request;

    expect(manager.validateSessionBinding(request)).toEqual({ valid: true });
  });

  it('ignores device data that is neither JSON nor valid base64 JSON', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_device: true,
    });
    const request = boundRequest({
      body: { _deviceInfo: 'not-json-or-base64-json' },
    });

    expect(manager.validateSessionBinding(request)).toEqual({ valid: true });
  });

  it('contains unexpected device-body access failures', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      bind_device: true,
    });
    const request = boundRequest();
    Object.defineProperty(request, 'body', {
      get: () => {
        throw new Error('body unavailable');
      },
    });

    expect(manager.validateSessionBinding(request)).toEqual({ valid: true });
  });

  it('continues middleware processing for a valid binding', async () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, { bind_ip: true });
    const next = vi.fn();

    await manager.sessionBindingValidator()(
      boundRequest(),
      createApiResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('destroys and redirects a session with an invalid binding', async () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, { bind_ip: true });
    const destroy = vi.fn((callback: (error?: unknown) => void) => callback());
    const request = boundRequest({
      ip: '198.51.100.99',
      session: {
        id: 'session-id',
        isAuthenticated: true,
        ipAddress: '203.0.113.10',
        destroy,
      },
    });
    const response = createApiResponse();
    const next = vi.fn();

    await manager.sessionBindingValidator()(request, response, next);

    expect(destroy).toHaveBeenCalledOnce();
    expect(request.session).toBeNull();
    expect(response.redirect).toHaveBeenCalledWith(
      '/auth/login?reason=session_invalid'
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects an invalid binding even when session destruction fails', async () => {
    const { config, manager, logger } = createManager();
    Object.assign(config.security.authentication.session, { bind_ip: true });
    const destroyError = new Error('session backend unavailable');
    vi.spyOn(manager, 'destroy').mockRejectedValue(destroyError);
    const request = boundRequest({
      ip: '198.51.100.99',
      session: {
        id: 'session-id',
        isAuthenticated: true,
        ipAddress: '203.0.113.10',
      },
    });
    const response = createApiResponse();
    const next = vi.fn();

    await manager.sessionBindingValidator()(request, response, next);

    expect(logger.error).toHaveBeenCalledWith(destroyError, {
      context: 'Failed to destroy invalid session',
    });
    expect(response.redirect).toHaveBeenCalledWith(
      '/auth/login?reason=session_invalid'
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('SessionManager session lifecycle', () => {
  it('stores application data while keeping transport metadata out of getAll', () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'session-id',
        cookie: { path: '/' },
        existing: 'value',
      },
    } as unknown as Request;

    manager.set(request, 'added', 42);

    expect(manager.get(request, 'added')).toBe(42);
    expect(manager.get(request, 'missing', 'fallback')).toBe('fallback');
    expect(manager.getAll(request)).toEqual({ existing: 'value', added: 42 });

    manager.remove(request, 'existing');
    expect(manager.getAll(request)).toEqual({ added: 42 });
  });

  it('fails writes without a session while reads remain safe', () => {
    const { manager } = createManager();
    const request = {} as Request;

    expect(() => manager.set(request, 'key', 'value')).toThrow(
      'Session not available'
    );
    expect(manager.get(request, 'key', 'fallback')).toBeUndefined();
    expect(manager.getAll(request)).toEqual({});
    expect(() => manager.remove(request, 'key')).not.toThrow();
    expect(() => manager.clear(request)).not.toThrow();
    expect(manager.exists(request)).toBe(false);
  });

  it('rejects regeneration and safely clears auth state without a session', async () => {
    const { manager } = createManager();
    const request = {} as Request;

    await expect(manager.regenerate(request)).rejects.toThrow(
      'Session not available'
    );
    expect(() => manager.clearAuthenticationData(request)).not.toThrow();
    await expect(manager.isAuthenticated(request)).resolves.toBe(false);
  });

  it('clears application data while preserving selected values and the cookie', () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'session-id',
        cookie: { path: '/' },
        csrfToken: 'csrf-token',
        transient: 'remove-me',
      },
    } as unknown as Request;

    manager.clear(request, ['csrfToken', 'missing']);

    expect(request.session).toEqual({
      cookie: { path: '/' },
      csrfToken: 'csrf-token',
    });
  });

  it('regenerates the identifier while preserving application data', async () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'old-session-id',
        cookie: { path: '/' },
        accountId: 'trusted-user',
        custom: 'preserved',
        regenerate: vi.fn(),
      },
    } as unknown as Request;
    vi.mocked(request.session.regenerate).mockImplementation(callback => {
      request.session = {
        id: 'new-session-id',
        cookie: { path: '/' },
      } as typeof request.session;
      callback(undefined);
      return request.session;
    });

    await expect(manager.regenerate(request)).resolves.toBeUndefined();
    expect(request.session).toMatchObject({
      id: 'new-session-id',
      accountId: 'trusted-user',
      custom: 'preserved',
    });
  });

  it('rejects regeneration when the session middleware creates no replacement session', async () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'old-session-id',
        custom: 'preserved',
        regenerate: vi.fn(),
      },
    } as unknown as Request;
    vi.mocked(request.session.regenerate).mockImplementation(callback => {
      request.session = undefined as unknown as typeof request.session;
      callback(undefined);
      return request.session;
    });

    await expect(manager.regenerate(request)).rejects.toThrow(
      'Session not available after regeneration'
    );
  });

  it('waits for the Redis index move before completing regeneration', async () => {
    const { manager } = createManager();
    let finishIndexMove!: (value: unknown[]) => void;
    const indexMove = new Promise<unknown[]>(resolve => {
      finishIndexMove = resolve;
    });
    const pipeline = {
      srem: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(() => indexMove),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      session: {
        id: 'old-session-id',
        accountId: 'trusted-user',
        regenerate: vi.fn(),
      },
    } as unknown as Request;
    vi.mocked(request.session.regenerate).mockImplementation(callback => {
      request.session = {
        id: 'new-session-id',
      } as typeof request.session;
      callback(undefined);
      return request.session;
    });

    let completed = false;
    const regeneration = manager.regenerate(request).then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(pipeline.srem).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      'old-session-id'
    );
    expect(pipeline.sadd).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      'new-session-id'
    );

    finishIndexMove([]);
    await expect(regeneration).resolves.toBeUndefined();
  });

  it('logs a Redis index move failure without failing regeneration', async () => {
    const { manager, logger } = createManager();
    const indexError = new Error('index unavailable');
    const pipeline = {
      srem: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(indexError),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      session: {
        id: 'old-session-id',
        accountId: 'trusted-user',
        regenerate: vi.fn(),
      },
    } as unknown as Request;
    vi.mocked(request.session.regenerate).mockImplementation(callback => {
      request.session = { id: 'new-session-id' } as typeof request.session;
      callback(undefined);
      return request.session;
    });

    await expect(manager.regenerate(request)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to update Redis session index (regenerate)',
      expect.objectContaining({
        accountId: 'trusted-user',
        oldSessionId: 'old-session-id',
        newSessionId: 'new-session-id',
        error: 'Error: index unavailable',
      })
    );
  });

  it('uses the fallback TTL while moving a regenerated Redis session index', async () => {
    const { manager } = createManager();
    const pipeline = {
      srem: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    (manager as any).options.ttl = 0;
    const request = {
      session: {
        id: 'old-session-id',
        accountId: 'trusted-user',
        regenerate: vi.fn(),
      },
    } as unknown as Request;
    vi.mocked(request.session.regenerate).mockImplementation(callback => {
      request.session = { id: 'new-session-id' } as typeof request.session;
      callback(undefined);
      return request.session;
    });

    await expect(manager.regenerate(request)).resolves.toBeUndefined();

    expect(pipeline.expire).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      86400
    );
  });

  it('propagates regeneration and destruction errors without clearing state', async () => {
    const { manager } = createManager();
    const regenerateError = new Error('regeneration failed');
    const destroyError = new Error('destroy failed');
    const request = {
      session: {
        id: 'session-id',
        cookie: { path: '/' },
        regenerate: vi.fn((callback: (error?: unknown) => void) =>
          callback(regenerateError)
        ),
        destroy: vi.fn((callback: (error?: unknown) => void) =>
          callback(destroyError)
        ),
      },
    } as unknown as Request;

    await expect(manager.regenerate(request)).rejects.toBe(regenerateError);
    await expect(manager.destroy(request)).rejects.toBe(destroyError);
    expect(request.session).not.toBeNull();
  });

  it('destroys an existing session and treats an absent session as idempotent', async () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'session-id',
        destroy: vi.fn((callback: (error?: unknown) => void) => callback()),
      },
    } as unknown as Request;

    await expect(manager.destroy(request)).resolves.toBeUndefined();
    expect(request.session).toBeNull();
    await expect(manager.destroy(request)).resolves.toBeUndefined();
  });

  it('removes authentication state without deleting unrelated session data', () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'session-id',
        isAuthenticated: true,
        authenticatedUsers: { active: {}, others: [] },
        accountId: 'trusted-user',
        authTime: 1,
        lastActivity: 2,
        deviceId: 'device-id',
        sessionRegenerated: true,
        oidc: {},
        interaction: {},
        addAccountIntent: true,
        currentActiveLoggedUser: {},
        csrfToken: 'preserved-token',
        custom: 'preserved-value',
      },
    } as unknown as Request;

    manager.clearAuthenticationData(request);

    expect(request.session).toEqual({
      id: 'session-id',
      csrfToken: 'preserved-token',
      custom: 'preserved-value',
    });
  });

  it('removes Redis index membership when authentication is cleared or destroyed', async () => {
    const { manager } = createManager();
    const srem = vi.fn().mockResolvedValue(1);
    (manager as any).redisClient = { srem };
    (manager as any).sessionPrefix = 'parako:session:';
    const clearedRequest = {
      session: {
        id: 'cleared-session-id',
        accountId: 'trusted-user',
      },
    } as unknown as Request;
    const destroyedRequest = {
      session: {
        id: 'destroyed-session-id',
        accountId: 'trusted-user',
        destroy: vi.fn((callback: (error?: unknown) => void) => callback()),
      },
    } as unknown as Request;

    manager.clearAuthenticationData(clearedRequest);
    await manager.destroy(destroyedRequest);

    expect(srem).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      'cleared-session-id'
    );
    expect(srem).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      'destroyed-session-id'
    );
  });

  it('clears local authentication state without an account index key', () => {
    const { manager } = createManager();
    const redisIndexRemove = vi.spyOn(manager as any, 'redisIndexRemove');
    (manager as any).redisClient = { srem: vi.fn() };
    const request = {
      session: {
        id: 'session-id',
        isAuthenticated: true,
        authenticatedUsers: { active: {}, others: [] },
      },
    } as unknown as Request;

    manager.clearAuthenticationData(request);

    expect(request.session.isAuthenticated).toBeUndefined();
    expect(request.session.authenticatedUsers).toBeUndefined();
    expect(redisIndexRemove).not.toHaveBeenCalled();
  });

  it('keeps authentication clearing non-fatal when Redis index removal rejects', async () => {
    const { manager, logger } = createManager();
    const indexError = new Error('index removal unavailable');
    (manager as any).redisClient = {
      srem: vi.fn().mockRejectedValue(indexError),
    };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      session: {
        id: 'session-id',
        accountId: 'trusted-user',
        isAuthenticated: true,
      },
    } as unknown as Request;

    expect(() => manager.clearAuthenticationData(request)).not.toThrow();
    expect(request.session.accountId).toBeUndefined();
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to update Redis session index (remove)',
        expect.objectContaining({
          accountId: 'trusted-user',
          sessionId: 'session-id',
          error: 'Error: index removal unavailable',
        })
      );
    });
  });

  it('keeps authentication clearing non-fatal when Redis index removal throws', () => {
    const { manager, logger } = createManager();
    (manager as any).redisClient = {
      srem: vi.fn(() => {
        throw new Error('synchronous removal failure');
      }),
    };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      session: {
        id: 'session-id',
        accountId: 'trusted-user',
        isAuthenticated: true,
      },
    } as unknown as Request;

    expect(() => manager.clearAuthenticationData(request)).not.toThrow();
    expect(request.session.accountId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to update Redis session index (remove)',
      expect.objectContaining({
        accountId: 'trusted-user',
        sessionId: 'session-id',
        error: 'Error: synchronous removal failure',
      })
    );
  });
});

describe('SessionManager authentication state', () => {
  it.each([
    { accountEnabled: true, expected: true },
    { accountEnabled: false, expected: false },
  ])(
    'returns $expected when the active account enabled flag is $accountEnabled',
    async ({ accountEnabled, expected }) => {
      const { manager, userService } = createManager();
      userService.findById.mockResolvedValue({
        id: 'user-id',
        account_enabled: accountEnabled,
      });
      const request = {
        session: {
          isAuthenticated: true,
          authenticatedUsers: {
            active: { id: 'user-id', username: 'trusted-user' },
            others: [],
          },
        },
      } as unknown as Request;

      await expect(manager.isAuthenticated(request)).resolves.toBe(expected);
      expect(userService.findById).toHaveBeenCalledWith('user-id');
    }
  );

  it('does not authenticate a session that only contains the boolean flag', async () => {
    const { manager } = createManager();
    const request = {
      session: { isAuthenticated: true },
    } as unknown as Request;

    await expect(manager.isAuthenticated(request)).resolves.toBe(false);
  });

  it('rejects malformed active-user state without querying the user repository', async () => {
    const { manager, userService } = createManager();
    const request = {
      session: {
        isAuthenticated: true,
        authenticatedUsers: {
          active: { username: 'missing-id' },
          others: [],
        },
      },
    } as unknown as Request;

    await expect(manager.isAuthenticated(request)).resolves.toBe(false);
    expect(userService.findById).not.toHaveBeenCalled();
  });

  it('fails closed and records context when the active user is absent from the tenant', async () => {
    const { manager, userService, logger } = createManager();
    userService.findById.mockResolvedValue(null);
    const request = {
      session: {
        isAuthenticated: true,
        authenticatedUsers: {
          active: { id: 'user-id', username: 'trusted-user' },
          others: [],
        },
      },
    } as unknown as Request;

    await expect(manager.isAuthenticated(request)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'session_user_not_found_in_tenant',
      expect.objectContaining({
        userId: 'user-id',
        username: 'trusted-user',
      })
    );
  });

  it('fails closed when the user repository cannot verify account status', async () => {
    const { manager, userService, logger } = createManager();
    userService.findById.mockRejectedValue(new Error('database unavailable'));
    const request = {
      session: {
        isAuthenticated: true,
        authenticatedUsers: {
          active: { id: 'user-id', username: 'trusted-user' },
          others: [],
        },
      },
    } as unknown as Request;

    await expect(manager.isAuthenticated(request)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to verify user account status',
      { userId: 'user-id', error: 'database unavailable' }
    );
  });

  it('fails closed with a stable message for a non-Error repository failure', async () => {
    const { manager, userService, logger } = createManager();
    userService.findById.mockRejectedValue('database unavailable');
    const request = {
      session: {
        isAuthenticated: true,
        authenticatedUsers: {
          active: { id: 'user-id', username: 'trusted-user' },
          others: [],
        },
      },
    } as unknown as Request;

    await expect(manager.isAuthenticated(request)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to verify user account status',
      { userId: 'user-id', error: 'Unknown error' }
    );
  });

  it('keeps server-derived authentication fields authoritative', () => {
    const { manager } = createManager();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const request = {
      headers: { 'user-agent': 'trusted-browser' },
      body: {},
      ip: '203.0.113.10',
      path: '/auth/login',
      session: { id: 'session-id' },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      currentActiveLoggedUser: {
        id: 'user-id',
        username: 'trusted-user',
      },
      isAuthenticated: false,
      accountId: 'spoofed-account',
      authTime: 1,
      lastActivity: 1,
      ipAddress: '198.51.100.99',
      userAgent: 'spoofed-browser',
      customValue: 'preserved',
    });

    expect(request.session).toMatchObject({
      isAuthenticated: true,
      accountId: 'trusted-user',
      authTime: 1_700_000_000_000,
      lastActivity: 1_700_000_000_000,
      ipAddress: '203.0.113.10',
      userAgent: 'trusted-browser',
      customValue: 'preserved',
      authenticatedUsers: {
        active: {
          id: 'user-id',
          username: 'trusted-user',
        },
        others: [],
      },
    });

    now.mockRestore();
  });

  it('indexes a newly authenticated Redis session with the configured TTL', () => {
    const { manager } = createManager();
    const pipeline = {
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: { id: 'session-id' },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      currentActiveLoggedUser: {
        id: 'user-id',
        username: 'trusted-user',
      },
    });

    expect(pipeline.sadd).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      'session-id'
    );
    expect(pipeline.expire).toHaveBeenCalledWith(
      'parako:session:user-sessions:trusted-user',
      expect.any(Number)
    );
    expect(pipeline.exec).toHaveBeenCalledOnce();
  });

  it('keeps authentication successful when Redis index addition rejects', async () => {
    const { manager, logger } = createManager();
    const indexError = new Error('index addition unavailable');
    const pipeline = {
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(indexError),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: { id: 'session-id' },
    } as unknown as Request;

    expect(() =>
      manager.setAuthenticated(request, {
        currentActiveLoggedUser: {
          id: 'user-id',
          username: 'trusted-user',
        },
      })
    ).not.toThrow();
    expect(request.session.isAuthenticated).toBe(true);
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to update Redis session index (add)',
        expect.objectContaining({
          accountId: 'trusted-user',
          sessionId: 'session-id',
          error: 'Error: index addition unavailable',
        })
      );
    });
  });

  it('keeps authentication successful when Redis index addition throws', () => {
    const { manager, logger } = createManager();
    (manager as any).redisClient = {
      multi: vi.fn(() => {
        throw new Error('synchronous addition failure');
      }),
    };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: { id: 'session-id' },
    } as unknown as Request;

    expect(() =>
      manager.setAuthenticated(request, {
        currentActiveLoggedUser: {
          id: 'user-id',
          username: 'trusted-user',
        },
      })
    ).not.toThrow();
    expect(request.session.isAuthenticated).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to update Redis session index (add)',
      expect.objectContaining({
        accountId: 'trusted-user',
        sessionId: 'session-id',
        error: 'Error: synchronous addition failure',
      })
    );
  });

  it('replaces prior account state when multi-account sessions are disabled', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication, {
      session_management: { multiple_accounts: { enabled: false } },
    });
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: {
        id: 'session-id',
        accountId: 'old-user',
        authenticatedUsers: {
          active: { id: 'old-id', username: 'old-user' },
          others: [{ id: 'other-id', username: 'other-user' }],
        },
      },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      currentActiveLoggedUser: {
        id: 'new-id',
        username: 'new-user',
      },
    });

    expect(request.session.accountId).toBe('new-user');
    expect(request.session.authenticatedUsers).toEqual({
      active: expect.objectContaining({ id: 'new-id', username: 'new-user' }),
      others: [],
    });
  });

  it('recovers legacy authenticated-account state with a missing others array', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication, {
      session_management: { multiple_accounts: { enabled: true } },
    });
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: {
        id: 'session-id',
        authenticatedUsers: {
          active: { id: 'old-id', username: 'old-user', last_used: 1 },
        },
      },
    } as unknown as Request;

    expect(() =>
      manager.setAuthenticated(request, {
        currentActiveLoggedUser: {
          id: 'new-id',
          username: 'new-user',
        },
      })
    ).not.toThrow();
    expect(request.session.authenticatedUsers).toMatchObject({
      active: { id: 'new-id', username: 'new-user' },
      others: [{ id: 'old-id', username: 'old-user' }],
    });
  });

  it('preserves the previous active account when reauthenticating a secondary account', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication, {
      session_management: { multiple_accounts: { enabled: true } },
    });
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: {
        id: 'session-id',
        authenticatedUsers: {
          active: { id: 'active-id', username: 'active-user', last_used: 100 },
          others: [
            { id: 'secondary-id', username: 'secondary-user', last_used: 50 },
          ],
        },
      },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      currentActiveLoggedUser: {
        id: 'secondary-id',
        username: 'secondary-user',
      },
    });

    expect(request.session.authenticatedUsers).toMatchObject({
      active: { id: 'secondary-id', username: 'secondary-user' },
      others: [{ id: 'active-id', username: 'active-user' }],
    });
  });

  it('refreshes the active account without duplicating it during reauthentication', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication, {
      session_management: { multiple_accounts: { enabled: true } },
    });
    const secondary = {
      id: 'secondary-id',
      username: 'secondary-user',
      last_used: 50,
    };
    const request = {
      headers: {},
      body: {},
      path: '/auth/login',
      session: {
        id: 'session-id',
        authenticatedUsers: {
          active: {
            id: 'active-id',
            username: 'active-user',
            email: 'old@example.test',
            last_used: 100,
          },
          others: [secondary],
        },
      },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      currentActiveLoggedUser: {
        id: 'active-id',
        username: 'active-user',
        email: 'new@example.test',
      },
    });

    expect(request.session.authenticatedUsers).toMatchObject({
      active: {
        id: 'active-id',
        username: 'active-user',
        email: 'new@example.test',
      },
      others: [secondary],
    });
  });

  it('ignores an invalid metadata creation source and classifies the request path', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      store_metadata: true,
    });
    vi.mocked(UAParser).mockImplementation(function MockParser() {
      return {
        getResult: () => ({
          browser: { name: 'Browser', version: '1' },
          os: { name: 'OS', version: '2' },
          device: {},
        }),
      };
    } as never);
    const request = {
      headers: { 'user-agent': 'test-agent' },
      body: {},
      path: '/api/session',
      ip: '203.0.113.10',
      session: { id: 'session-id' },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      createdFrom: 'untrusted-value',
    } as never);

    expect(request.session._metadata).toMatchObject({
      createdFrom: 'api',
      createdIp: '203.0.113.10',
      userAgent: 'test-agent',
      browser: { name: 'Browser', version: '1' },
      os: { name: 'OS', version: '2' },
      device: { type: 'desktop' },
    });
  });

  it.each([
    {
      name: 'keeps an explicit supported source',
      path: '/api/session',
      requestedSource: 'session-switch',
      expectedSource: 'session-switch',
    },
    {
      name: 'classifies a callback as social',
      path: '/oidc/callback',
      requestedSource: undefined,
      expectedSource: 'social',
    },
    {
      name: 'classifies an authentication route as login',
      path: '/auth/login',
      requestedSource: undefined,
      expectedSource: 'login',
    },
    {
      name: 'leaves an unrelated route unknown',
      path: '/sessions/current',
      requestedSource: undefined,
      expectedSource: 'unknown',
    },
  ])('$name', ({ path, requestedSource, expectedSource }) => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      store_metadata: true,
    });
    vi.mocked(UAParser).mockImplementation(function MockParser() {
      return {
        getResult: () => ({ browser: {}, os: {}, device: {} }),
      };
    } as never);
    const request = {
      headers: {},
      body: {},
      path,
      session: { id: 'session-id' },
    } as unknown as Request;

    manager.setAuthenticated(request, {
      createdFrom: requestedSource,
    });

    expect(request.session._metadata?.createdFrom).toBe(expectedSource);
  });
});

describe('SessionManager authenticated accounts', () => {
  const activeUser = {
    id: 'active-id',
    username: 'active-user',
    last_used: 100,
  };
  const otherUser = {
    id: 'other-id',
    username: 'other-user',
    last_used: 200,
  };

  function accountRequest(others: SessionUserAccount[] = [otherUser]): Request {
    return {
      session: {
        id: 'session-id',
        accountId: activeUser.username,
        authenticatedUsers: {
          active: { ...activeUser },
          others: others.map(user => ({ ...user })),
        },
      },
    } as unknown as Request;
  }

  it('updates only the active account and reports absent account state', () => {
    const { manager } = createManager();
    const request = accountRequest();

    expect(
      manager.updateActiveUserData(request, { zoneinfo: 'Africa/Porto-Novo' })
    ).toBe(true);
    expect(manager.getActiveUser(request)).toMatchObject({
      ...activeUser,
      zoneinfo: 'Africa/Porto-Novo',
    });
    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([otherUser]);
    expect(manager.updateActiveUserData({ session: {} } as Request, {})).toBe(
      false
    );
  });

  it('updates a valid active-user ID without changing the username index', () => {
    const { manager } = createManager();
    const redisIndexReplace = vi.spyOn(manager as any, 'redisIndexReplace');
    const request = accountRequest();

    expect(
      manager.updateActiveUserData(request, { id: 'replacement-user-id' })
    ).toBe(true);

    expect(manager.getActiveUser(request)).toMatchObject({
      id: 'replacement-user-id',
      username: activeUser.username,
    });
    expect(request.session.accountId).toBe(activeUser.username);
    expect(redisIndexReplace).not.toHaveBeenCalled();
  });

  it('keeps accountId and the Redis index consistent when username changes', () => {
    const { manager } = createManager();
    const pipeline = {
      srem: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    const request = accountRequest();

    expect(
      manager.updateActiveUserData(request, { username: 'renamed-user' })
    ).toBe(true);
    expect(manager.getActiveUser(request)?.username).toBe('renamed-user');
    expect(request.session.accountId).toBe('renamed-user');
    expect(pipeline.srem).toHaveBeenCalledWith(
      'parako:session:user-sessions:active-user',
      'session-id'
    );
    expect(pipeline.sadd).toHaveBeenCalledWith(
      'parako:session:user-sessions:renamed-user',
      'session-id'
    );
  });

  it('updates the active username when Redis indexing is not configured', () => {
    const { manager } = createManager();
    const request = accountRequest();

    expect(
      manager.updateActiveUserData(request, { username: 'renamed-user' })
    ).toBe(true);

    expect(manager.getActiveUser(request)?.username).toBe('renamed-user');
    expect(request.session.accountId).toBe('renamed-user');
  });

  it('ignores empty identity updates while applying active profile fields', () => {
    const { manager } = createManager();
    const redisIndexReplace = vi.spyOn(manager as any, 'redisIndexReplace');
    const request = accountRequest();

    expect(
      manager.updateActiveUserData(request, {
        id: '   ',
        username: '   ',
        zoneinfo: 'UTC',
      })
    ).toBe(true);
    expect(manager.getActiveUser(request)).toMatchObject({
      id: activeUser.id,
      username: activeUser.username,
      zoneinfo: 'UTC',
    });
    expect(request.session.accountId).toBe(activeUser.username);
    expect(redisIndexReplace).not.toHaveBeenCalled();
  });

  it('requires reauthentication before switching when configured', () => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, {
      require_reauth_on_switch: true,
    });
    const request = accountRequest();

    expect(manager.switchUser(request, otherUser.id)).toEqual({
      success: false,
      reason: 'reauth_required',
    });
    expect(request.session.pendingSwitchUserId).toBe(otherUser.id);
    expect(manager.getActiveUser(request)?.id).toBe(activeUser.id);
  });

  it('switches accounts atomically and updates the queryable account ID', () => {
    const { manager } = createManager();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(300);
    const request = accountRequest();

    expect(manager.switchUser(request, otherUser.username)).toEqual({
      success: true,
    });
    expect(request.session.accountId).toBe(otherUser.username);
    expect(manager.getAuthenticatedUsers(request)).toEqual({
      active: { ...otherUser, last_used: 300 },
      others: [{ ...activeUser, last_used: 300 }],
    });

    clock.mockRestore();
  });

  it('keeps a successful account switch non-fatal when Redis indexing throws', () => {
    const { manager, logger } = createManager();
    const request = accountRequest();
    (manager as any).sessionPrefix = 'parako:session:';
    (manager as any).redisClient = {
      multi: vi.fn(() => {
        throw new Error('pipeline unavailable');
      }),
    };

    expect(() => manager.switchUser(request, otherUser.id)).not.toThrow();
    expect(manager.getActiveUser(request)?.id).toBe(otherUser.id);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to update Redis session index (replace)',
      expect.objectContaining({
        oldAccountId: activeUser.username,
        newAccountId: otherUser.username,
        sessionId: 'session-id',
        error: 'Error: pipeline unavailable',
      })
    );
  });

  it('returns user_not_found without changing account state', () => {
    const { manager } = createManager();
    const request = accountRequest();
    const before = structuredClone(request.session.authenticatedUsers);

    expect(manager.switchUser(request, 'missing-user')).toEqual({
      success: false,
      reason: 'user_not_found',
    });
    expect(request.session.authenticatedUsers).toEqual(before);
    expect(
      manager.switchUser({ session: {} } as Request, 'missing-user')
    ).toEqual({ success: false, reason: 'user_not_found' });
  });

  it('rejects account switching safely when legacy state has no others array', () => {
    const { manager } = createManager();
    const request = {
      session: {
        authenticatedUsers: { active: { ...activeUser } },
      },
    } as unknown as Request;

    expect(() => manager.switchUser(request, otherUser.id)).not.toThrow();
    expect(manager.switchUser(request, otherUser.id)).toEqual({
      success: false,
      reason: 'user_not_found',
    });
  });

  it('rejects account switching when legacy state has no active account', () => {
    const { manager } = createManager();
    const request = {
      session: {
        authenticatedUsers: { others: [{ ...otherUser }] },
      },
    } as unknown as Request;

    expect(manager.switchUser(request, otherUser.id)).toEqual({
      success: false,
      reason: 'user_not_found',
    });
  });

  it('adds the first account and rejects additions when multi-account is disabled', () => {
    const { config, manager } = createManager();
    const emptyRequest = {
      session: { id: 'session-id' },
    } as unknown as Request;

    expect(
      manager.addAuthenticatedUser(emptyRequest, { ...activeUser })
    ).toEqual({
      success: true,
    });
    expect(manager.getAuthenticatedUsers(emptyRequest)).toEqual({
      active: activeUser,
      others: [],
    });
    expect(emptyRequest.session.accountId).toBe(activeUser.username);

    Object.assign(config.security.authentication, {
      session_management: { multiple_accounts: { enabled: false } },
    });
    expect(
      manager.addAuthenticatedUser(emptyRequest, { ...otherUser })
    ).toEqual({
      success: false,
      reason: 'multi_account_disabled',
    });
  });

  it('keeps Redis account indexes current when adding or promoting an account', () => {
    const createPipeline = () => ({
      srem: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    });
    const first = createManager().manager;
    const firstPipeline = createPipeline();
    (first as any).redisClient = { multi: vi.fn(() => firstPipeline) };
    (first as any).sessionPrefix = 'parako:session:';
    const firstRequest = {
      session: { id: 'first-session' },
    } as unknown as Request;

    expect(first.addAuthenticatedUser(firstRequest, { ...activeUser })).toEqual(
      {
        success: true,
      }
    );
    expect(firstPipeline.sadd).toHaveBeenCalledWith(
      'parako:session:user-sessions:active-user',
      'first-session'
    );

    const promoted = createManager().manager;
    const promotedPipeline = createPipeline();
    (promoted as any).redisClient = { multi: vi.fn(() => promotedPipeline) };
    (promoted as any).sessionPrefix = 'parako:session:';
    const promotedRequest = accountRequest([]);

    expect(
      promoted.addAuthenticatedUser(promotedRequest, { ...otherUser }, true)
    ).toEqual({ success: true });
    expect(promotedPipeline.srem).toHaveBeenCalledWith(
      'parako:session:user-sessions:active-user',
      'session-id'
    );
    expect(promotedPipeline.sadd).toHaveBeenCalledWith(
      'parako:session:user-sessions:other-user',
      'session-id'
    );
  });

  it('enforces duplicate and maximum-account constraints', () => {
    const { config, manager, logger } = createManager();
    Object.assign(config.security.authentication.session, {
      max_accounts_per_session: 2,
    });
    const request = accountRequest();

    expect(manager.addAuthenticatedUser(request, { ...activeUser })).toEqual({
      success: false,
      reason: 'already_exists',
    });
    expect(
      manager.addAuthenticatedUser(request, {
        id: 'third-id',
        username: 'third-user',
      })
    ).toEqual({ success: false, reason: 'max_limit_reached' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Max accounts per session limit reached',
      expect.objectContaining({ currentCount: 2, maxAccountsPerSession: 2 })
    );
  });

  it('adds a secondary account or promotes it to active', () => {
    const { manager } = createManager();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(300);
    const secondaryRequest = accountRequest([]);
    const promotedRequest = accountRequest([]);

    expect(
      manager.addAuthenticatedUser(secondaryRequest, { ...otherUser })
    ).toEqual({
      success: true,
    });
    expect(manager.getAuthenticatedUsers(secondaryRequest)?.others).toEqual([
      { ...otherUser, last_used: 300 },
    ]);

    expect(
      manager.addAuthenticatedUser(promotedRequest, { ...otherUser }, true)
    ).toEqual({ success: true });
    expect(manager.getAuthenticatedUsers(promotedRequest)).toEqual({
      active: { ...otherUser, last_used: 300 },
      others: [{ ...activeUser, last_used: 300 }],
    });
    expect(promotedRequest.session.accountId).toBe(otherUser.username);

    clock.mockRestore();
  });

  it('copies an added account instead of mutating or retaining the caller object', () => {
    const { manager } = createManager();
    const request = accountRequest();
    const account = {
      id: 'new-id',
      username: 'new-user',
      email: 'original@example.com',
    };

    expect(manager.addAuthenticatedUser(request, account)).toEqual({
      success: true,
    });
    expect(account).toEqual({
      id: 'new-id',
      username: 'new-user',
      email: 'original@example.com',
    });

    account.email = 'changed@example.com';
    expect(
      manager
        .getAuthenticatedUsers(request)
        ?.others.find(user => user.id === account.id)?.email
    ).toBe('original@example.com');
  });

  it('normalizes a missing legacy others array before adding an account', () => {
    const { manager } = createManager();
    const request = {
      session: {
        id: 'session-id',
        authenticatedUsers: { active: { ...activeUser } },
      },
    } as unknown as Request;

    expect(manager.addAuthenticatedUser(request, { ...otherUser })).toEqual({
      success: true,
    });
    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([
      expect.objectContaining({
        id: otherUser.id,
        username: otherUser.username,
      }),
    ]);
  });

  it('removes a secondary account and revokes its OIDC grants', async () => {
    const { manager } = createManager();
    const revokeAllGrantsForAccount = vi.fn().mockResolvedValue(undefined);
    manager.setOidcAdapterBridge({
      grant: { revokeAllGrantsForAccount },
    } as never);
    const request = accountRequest();

    await expect(
      manager.removeAuthenticatedUser(request, otherUser.id)
    ).resolves.toBe(true);
    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([]);
    expect(revokeAllGrantsForAccount).toHaveBeenCalledWith(otherUser.username);
  });

  it('removes an account when the grant adapter has no revocation capability', async () => {
    const { manager } = createManager();
    manager.setOidcAdapterBridge({ grant: {} } as never);
    const request = accountRequest();

    await expect(
      manager.removeAuthenticatedUser(request, otherUser.id)
    ).resolves.toBe(true);

    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([]);
  });

  it('promotes the most recently used account when removing the active account', async () => {
    const { manager } = createManager();
    const oldest = { id: 'old-id', username: 'old-user', last_used: 50 };
    const request = accountRequest([oldest, otherUser]);

    await expect(
      manager.removeAuthenticatedUser(request, activeUser.username)
    ).resolves.toBe(true);
    expect(manager.getActiveUser(request)).toEqual(otherUser);
    expect(request.session.accountId).toBe(otherUser.username);
    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([oldest]);
  });

  it('treats a missing last-used value as oldest when promoting an account', async () => {
    const { manager } = createManager();
    const neverUsed = { id: 'new-id', username: 'new-user' };
    const recentlyUsed = {
      id: 'recent-id',
      username: 'recent-user',
      last_used: 10,
    };
    const request = accountRequest([neverUsed, recentlyUsed]);

    await expect(
      manager.removeAuthenticatedUser(request, activeUser.id)
    ).resolves.toBe(true);

    expect(manager.getActiveUser(request)).toEqual(recentlyUsed);
    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([neverUsed]);
  });

  it('promotes a used account when the comparison peer has no last-used value', async () => {
    const { manager } = createManager();
    const recentlyUsed = {
      id: 'recent-id',
      username: 'recent-user',
      last_used: 10,
    };
    const neverUsed = { id: 'new-id', username: 'new-user' };
    const request = accountRequest([recentlyUsed, neverUsed]);

    await expect(
      manager.removeAuthenticatedUser(request, activeUser.id)
    ).resolves.toBe(true);

    expect(manager.getActiveUser(request)).toEqual(recentlyUsed);
    expect(manager.getAuthenticatedUsers(request)?.others).toEqual([neverUsed]);
  });

  it('keeps active-account removal successful when grant revocation fails', async () => {
    const { manager, logger } = createManager();
    const pipeline = {
      srem: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    (manager as any).redisClient = { multi: vi.fn(() => pipeline) };
    (manager as any).sessionPrefix = 'parako:session:';
    const revocationError = new Error('grant store unavailable');
    manager.setOidcAdapterBridge({
      grant: {
        revokeAllGrantsForAccount: vi.fn().mockRejectedValue(revocationError),
      },
    } as never);
    const request = accountRequest();

    await expect(
      manager.removeAuthenticatedUser(request, activeUser.id)
    ).resolves.toBe(true);
    expect(manager.getActiveUser(request)).toEqual(otherUser);
    expect(pipeline.srem).toHaveBeenCalledWith(
      'parako:session:user-sessions:active-user',
      'session-id'
    );
    expect(pipeline.sadd).toHaveBeenCalledWith(
      'parako:session:user-sessions:other-user',
      'session-id'
    );
    expect(logger.error).toHaveBeenCalledWith(revocationError, {
      context: 'Failed to revoke OIDC grants on account removal',
      userId: activeUser.id,
      username: activeUser.username,
    });
  });

  it('does not remove a missing account or the only active account', async () => {
    const { manager } = createManager();
    const onlyActive = accountRequest([]);

    await expect(
      manager.removeAuthenticatedUser(onlyActive, activeUser.id)
    ).resolves.toBe(false);
    await expect(
      manager.removeAuthenticatedUser(accountRequest(), 'missing-user')
    ).resolves.toBe(false);
    await expect(
      manager.removeAuthenticatedUser(
        { session: {} } as Request,
        'missing-user'
      )
    ).resolves.toBe(false);
  });

  it('rejects removal safely when legacy account state has no others array', async () => {
    const { manager } = createManager();
    const request = {
      session: {
        authenticatedUsers: { active: { ...activeUser } },
      },
    } as unknown as Request;

    await expect(
      manager.removeAuthenticatedUser(request, activeUser.id)
    ).resolves.toBe(false);
  });
});

describe('SessionManager session lifetime', () => {
  it('tracks first and subsequent session activity without resetting creation time', () => {
    const { manager } = createManager();
    const now = vi.spyOn(Date, 'now');
    const request = { session: {} } as Request;
    const next = vi.fn();

    now.mockReturnValue(100);
    manager.activityTracker()(request, createApiResponse(), next);
    expect(request.session).toMatchObject({ lastActivity: 100, created: 100 });

    now.mockReturnValue(200);
    manager.activityTracker()(request, createApiResponse(), next);
    expect(request.session).toMatchObject({ lastActivity: 200, created: 100 });

    manager.activityTracker()({} as Request, createApiResponse(), next);
    expect(next).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it.each([new Date(Number.NaN), Number.NaN])(
    'returns zero for an invalid cookie expiration value',
    expires => {
      const { manager } = createManager();
      const request = {
        session: { cookie: { expires } },
      } as unknown as Request;

      expect(manager.getTTL(request)).toBe(0);
    }
  );

  it('reports the configured TTL when the cookie has no explicit expiration', () => {
    const { manager } = createManager();

    expect(manager.getTTL({} as Request)).toBe(0);
    expect(manager.getTTL({ session: {} } as unknown as Request)).toBe(0);
    expect(
      manager.getTTL({
        session: { cookie: {} },
      } as unknown as Request)
    ).toBe(1209600);
  });

  it('reports zero when neither the cookie nor normalized options provide a TTL', () => {
    const { manager } = createManager();
    (manager as any).options.ttl = 0;

    expect(
      manager.getTTL({ session: { cookie: {} } } as unknown as Request)
    ).toBe(0);
  });

  it.each([
    { label: 'numeric', expires: 106_999, expected: 6 },
    { label: 'Date', expires: new Date(107_999), expected: 7 },
    { label: 'expired', expires: 99_999, expected: 0 },
    { label: 'unsupported', expires: '107999', expected: 0 },
  ])(
    'calculates a safe TTL for a $label expiration',
    ({ expires, expected }) => {
      const { manager } = createManager();
      const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
      const request = {
        session: { cookie: { expires } },
      } as unknown as Request;

      expect(manager.getTTL(request)).toBe(expected);
      now.mockRestore();
    }
  );

  it.each([
    {
      middleware: 'idleTimeoutMiddleware' as const,
      config: { idle_timeout_minutes: 30 },
      timestampKey: 'lastActivity',
      withinLimit: 29 * 60 * 1000,
      beyondLimit: 31 * 60 * 1000,
      reason: 'idle_timeout',
    },
    {
      middleware: 'absoluteTimeoutMiddleware' as const,
      config: { absolute_timeout_hours: 24 },
      timestampKey: 'authTime',
      withinLimit: 23 * 60 * 60 * 1000,
      beyondLimit: 25 * 60 * 60 * 1000,
      reason: 'session_expired',
    },
  ])('continues when $middleware is within its limit', async scenario => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, scenario.config);
    const now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const request = {
      session: {
        isAuthenticated: true,
        [scenario.timestampKey]: now - scenario.withinLimit,
      },
    } as unknown as Request;
    const next = vi.fn();

    await manager[scenario.middleware]()(request, createApiResponse(), next);

    expect(next).toHaveBeenCalledOnce();
    clock.mockRestore();
  });

  it.each([
    {
      middleware: 'idleTimeoutMiddleware' as const,
      configKey: 'idle_timeout_minutes',
    },
    {
      middleware: 'absoluteTimeoutMiddleware' as const,
      configKey: 'absolute_timeout_hours',
    },
  ])(
    'skips $middleware for unauthenticated sessions and disabled limits',
    async scenario => {
      const { config, manager } = createManager();
      const next = vi.fn();

      await manager[scenario.middleware]()(
        { session: {} } as Request,
        createApiResponse(),
        next
      );
      Object.assign(config.security.authentication.session, {
        [scenario.configKey]: 0,
      });
      await manager[scenario.middleware]()(
        { session: { isAuthenticated: true } } as unknown as Request,
        createApiResponse(),
        next
      );

      expect(next).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    {
      middleware: 'idleTimeoutMiddleware' as const,
      config: { idle_timeout_minutes: 30 },
      timestampKey: 'lastActivity',
      beyondLimit: 31 * 60 * 1000,
      reason: 'idle_timeout',
    },
    {
      middleware: 'absoluteTimeoutMiddleware' as const,
      config: { absolute_timeout_hours: 24 },
      timestampKey: 'authTime',
      beyondLimit: 25 * 60 * 60 * 1000,
      reason: 'session_expired',
    },
  ])('destroys and redirects when $middleware expires', async scenario => {
    const { config, manager } = createManager();
    Object.assign(config.security.authentication.session, scenario.config);
    const now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const destroy = vi.fn((callback: (error?: unknown) => void) => callback());
    const request = {
      session: {
        id: 'session-id',
        isAuthenticated: true,
        [scenario.timestampKey]: now - scenario.beyondLimit,
        authenticatedUsers: {
          active: { id: 'user-id', username: 'trusted-user' },
          others: [],
        },
        destroy,
      },
    } as unknown as Request;
    const response = createApiResponse();
    const next = vi.fn();

    await manager[scenario.middleware]()(request, response, next);

    expect(destroy).toHaveBeenCalledOnce();
    expect(request.session).toBeNull();
    expect(response.redirect).toHaveBeenCalledWith(
      `/auth/login?reason=${scenario.reason}`
    );
    expect(next).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it.each([
    {
      middleware: 'idleTimeoutMiddleware' as const,
      config: { idle_timeout_minutes: 1 },
      timestampKey: 'lastActivity',
      errorContext: 'Failed to destroy idle session',
      reason: 'idle_timeout',
    },
    {
      middleware: 'absoluteTimeoutMiddleware' as const,
      config: { absolute_timeout_hours: 1 },
      timestampKey: 'authTime',
      errorContext: 'Failed to destroy expired session',
      reason: 'session_expired',
    },
  ])(
    'still redirects when $middleware cannot destroy the expired session',
    async scenario => {
      const { config, manager, logger } = createManager();
      Object.assign(config.security.authentication.session, scenario.config);
      const destroyError = new Error('store unavailable');
      const request = {
        session: {
          id: 'session-id',
          isAuthenticated: true,
          [scenario.timestampKey]: 0,
          destroy: vi.fn((callback: (error?: unknown) => void) =>
            callback(destroyError)
          ),
        },
      } as unknown as Request;
      const response = createApiResponse();

      await manager[scenario.middleware]()(request, response, vi.fn());

      expect(logger.error).toHaveBeenCalledWith(destroyError, {
        context: scenario.errorContext,
      });
      expect(response.redirect).toHaveBeenCalledWith(
        `/auth/login?reason=${scenario.reason}`
      );
    }
  );
});

describe('FlashManager', () => {
  it('rejects construction when the request has no session', () => {
    expect(
      () =>
        new FlashManager(
          {} as Request,
          { exists: vi.fn(() => false) } as never,
          { debug: vi.fn() } as never,
          { getConfig: vi.fn() } as never
        )
    ).toThrow('Session not available');
  });

  it('uses its configuration dependency without requiring a concrete SessionManager', () => {
    const request = { session: {} } as Request;
    const state: { flash?: FlashContainer } = {};
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn((_request: Request, key: string) =>
        key === 'flash' ? state.flash : undefined
      ),
      set: vi.fn((_request: Request, key: string, value: FlashContainer) => {
        if (key === 'flash') state.flash = value;
      }),
    };
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const configManager = {
      getConfig: vi.fn(() => ({
        security: {
          authentication: {
            session: {
              max_flash_messages_per_type: 1,
              max_flash_messages_total: 10,
            },
          },
        },
      })),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      logger as never,
      configManager as never
    );

    flash.success('first').success('second');

    expect(flash.peek().success).toEqual([
      expect.objectContaining({ message: 'second' }),
    ]);
  });

  it('normalizes a legacy partial flash container without losing valid messages', () => {
    const request = { session: {} } as Request;
    const existingMessage = {
      type: 'success' as const,
      message: 'preserved',
      dismissible: true,
    };
    const state: { flash?: Partial<FlashContainer> } = {
      flash: { success: [existingMessage] },
    };
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => state.flash),
      set: vi.fn((_request: Request, _key: string, value: FlashContainer) => {
        state.flash = value;
      }),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      { debug: vi.fn() } as never,
      { getConfig: vi.fn(() => ({})) } as never
    );

    expect(() => flash.error('new error')).not.toThrow();
    expect(flash.peek()).toEqual({
      success: [existingMessage],
      error: [expect.objectContaining({ message: 'new error' })],
      info: [],
      warning: [],
    });
  });

  it('fails safely if flash state disappears after construction', () => {
    const request = { session: {} } as Request;
    const state: { flash?: FlashContainer } = {};
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => state.flash),
      set: vi.fn((_request: Request, _key: string, value: FlashContainer) => {
        state.flash = value;
      }),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      { debug: vi.fn() } as never,
      { getConfig: vi.fn(() => ({})) } as never
    );
    state.flash = undefined;

    expect(flash.success('ignored')).toBe(flash);
    expect(flash.peek()).toEqual({
      success: [],
      error: [],
      info: [],
      warning: [],
    });
    expect(flash.all()).toEqual({
      success: [],
      error: [],
      info: [],
      warning: [],
    });
  });

  it('evicts only the replaced type when total and per-type limits coincide', () => {
    const request = { session: {} } as Request;
    const state: { flash?: FlashContainer } = {
      flash: {
        success: [
          { type: 'success', message: 'old success', dismissible: true },
        ],
        error: [{ type: 'error', message: 'keep error', dismissible: true }],
        info: [],
        warning: [],
      },
    };
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn((_request: Request, key: string) =>
        key === 'flash' ? state.flash : undefined
      ),
      set: vi.fn((_request: Request, key: string, value: FlashContainer) => {
        if (key === 'flash') state.flash = value;
      }),
    };
    const configManager = {
      getConfig: vi.fn(() => ({
        security: {
          authentication: {
            session: {
              max_flash_messages_per_type: 1,
              max_flash_messages_total: 2,
            },
          },
        },
      })),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      { debug: vi.fn() } as never,
      configManager as never
    );

    flash.success('new success');

    expect(flash.peek()).toEqual({
      success: [
        expect.objectContaining({ type: 'success', message: 'new success' }),
      ],
      error: [
        expect.objectContaining({ type: 'error', message: 'keep error' }),
      ],
      info: [],
      warning: [],
    });
  });

  it('supports every message type and consumes messages exactly once', () => {
    const request = { session: {} } as Request;
    const state: { flash?: FlashContainer } = {};
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn((_request: Request, key: string) =>
        key === 'flash' ? state.flash : undefined
      ),
      set: vi.fn((_request: Request, key: string, value: FlashContainer) => {
        if (key === 'flash') state.flash = value;
      }),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      { debug: vi.fn() } as never,
      { getConfig: vi.fn(() => ({})) } as never
    );

    expect(
      flash
        .success('saved', 'Success', { dismissible: false, timeout: 1000 })
        .error('failed')
        .info('notice')
        .warning('careful')
    ).toBe(flash);

    expect(flash.all()).toEqual({
      success: [
        {
          type: 'success',
          message: 'saved',
          title: 'Success',
          dismissible: false,
          timeout: 1000,
        },
      ],
      error: [expect.objectContaining({ type: 'error', message: 'failed' })],
      info: [expect.objectContaining({ type: 'info', message: 'notice' })],
      warning: [
        expect.objectContaining({ type: 'warning', message: 'careful' }),
      ],
    });
    expect(flash.peek()).toEqual({
      success: [],
      error: [],
      info: [],
      warning: [],
    });
    expect(flash.clear()).toBe(flash);
  });

  it('evicts one message from the fullest type at the global limit', () => {
    const request = { session: {} } as Request;
    const state: { flash?: FlashContainer } = {
      flash: {
        success: [
          { type: 'success', message: 'oldest', dismissible: true },
          { type: 'success', message: 'newer', dismissible: true },
        ],
        error: [{ type: 'error', message: 'keep', dismissible: true }],
        info: [],
        warning: [],
      },
    };
    const logger = { debug: vi.fn() };
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => state.flash),
      set: vi.fn((_request: Request, _key: string, value: FlashContainer) => {
        state.flash = value;
      }),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      logger as never,
      {
        getConfig: vi.fn(() => ({
          security: {
            authentication: {
              session: {
                max_flash_messages_per_type: 10,
                max_flash_messages_total: 3,
              },
            },
          },
        })),
      } as never
    );

    flash.info('added');

    expect(flash.peek().success.map(message => message.message)).toEqual([
      'newer',
    ]);
    expect(logger.debug).toHaveBeenCalledWith(
      'Flash message removed (total limit reached)',
      { type: 'success', maxTotal: 3 }
    );
  });

  it('selects a later message type when it is the fullest at the global limit', () => {
    const request = { session: {} } as Request;
    const state: { flash?: FlashContainer } = {
      flash: {
        success: [{ type: 'success', message: 'keep', dismissible: true }],
        error: [],
        info: [],
        warning: [
          { type: 'warning', message: 'oldest warning', dismissible: true },
          { type: 'warning', message: 'newer warning', dismissible: true },
        ],
      },
    };
    const logger = { debug: vi.fn() };
    const sessionManager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => state.flash),
      set: vi.fn((_request: Request, _key: string, value: FlashContainer) => {
        state.flash = value;
      }),
    };
    const flash = new FlashManager(
      request,
      sessionManager as never,
      logger as never,
      {
        getConfig: vi.fn(() => ({
          security: {
            authentication: {
              session: {
                max_flash_messages_per_type: 10,
                max_flash_messages_total: 3,
              },
            },
          },
        })),
      } as never
    );

    flash.info('added');

    expect(flash.peek().warning.map(message => message.message)).toEqual([
      'newer warning',
    ]);
    expect(logger.debug).toHaveBeenCalledWith(
      'Flash message removed (total limit reached)',
      { type: 'warning', maxTotal: 3 }
    );
  });
});

describe('SessionManager flash middleware and authorization helpers', () => {
  function requestWithFlash(): Request {
    return {
      session: {
        flash: {
          success: [{ type: 'success', message: 'saved', dismissible: true }],
          error: [],
          info: [],
          warning: [],
        },
      },
    } as unknown as Request;
  }

  it('exposes flash messages and consumes them when rendering HTML', () => {
    const { manager } = createManager();
    const request = requestWithFlash();
    const originalRender = vi.fn();
    const response = {
      locals: {},
      render: originalRender,
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    manager.flashMiddleware()(request, response, next);
    response.render('account', { title: 'Account' });

    expect(response.locals.flash.success).toHaveLength(1);
    expect(originalRender).toHaveBeenCalledWith('account', {
      title: 'Account',
      flash: expect.objectContaining({
        success: [expect.objectContaining({ message: 'saved' })],
      }),
    });
    expect(request.session.flash.success).toEqual([]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('adds flash messages when rendering without a view-options object', () => {
    const { manager } = createManager();
    const request = requestWithFlash();
    const originalRender = vi.fn();
    const response = {
      locals: {},
      render: originalRender,
      json: vi.fn(),
    } as unknown as Response;

    manager.flashMiddleware()(request, response, vi.fn());
    response.render('account');

    expect(originalRender).toHaveBeenCalledWith('account', {
      flash: expect.objectContaining({
        success: [expect.objectContaining({ message: 'saved' })],
      }),
    });
  });

  it('clears undisplayed flash messages before sending JSON', () => {
    const { manager } = createManager();
    const request = requestWithFlash();
    const originalJson = vi.fn();
    const response = {
      locals: {},
      render: vi.fn(),
      json: originalJson,
    } as unknown as Response;
    originalJson.mockReturnValue(response);
    const next = vi.fn();

    manager.flashMiddleware()(request, response, next);
    expect(response.json({ ok: true })).toBe(response);

    expect(originalJson).toHaveBeenCalledWith({ ok: true });
    expect(request.session.flash.success).toEqual([]);
  });

  it('reads active-user properties, roles, and admin status safely', () => {
    const { manager } = createManager();
    const request = {
      session: {
        authenticatedUsers: {
          active: {
            id: 'user-id',
            username: 'trusted-user',
            roles: ['editor', 'auditor'],
            is_admin: true,
          },
          others: [],
        },
      },
    } as unknown as Request;

    expect(manager.getUserProperty(request, 'username')).toBe('trusted-user');
    expect(manager.hasRole(request, 'editor')).toBe(true);
    expect(manager.hasRole(request, 'owner')).toBe(false);
    expect(manager.isAdmin(request)).toBe(true);
    expect(manager.hasRole({ session: {} } as Request, 'editor')).toBe(false);
    expect(manager.isAdmin({ session: {} } as Request)).toBe(false);
  });
});

describe('SessionManager encrypted session storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(encryptValue).mockImplementation(
      (value: string) => `encrypted:${value}`
    );
    vi.mocked(decryptValue).mockImplementation((value: string) => value);
    vi.mocked(isEncrypted).mockReturnValue(true);
  });

  it('encrypts sensitive fields without mutating the caller session', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const innerStore = {
      set: vi.fn(),
    };
    const sessionData = {
      accountId: 'queryable-account',
      csrfToken: 'sensitive-token',
      authenticatedUsers: {
        active: { id: 'user-id', username: 'user@example.com' },
        others: [],
      },
      cookie: { maxAge: 60_000 },
    };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    (manager as any).store.set('session-id', sessionData, vi.fn());

    expect(innerStore.set).toHaveBeenCalledOnce();
    const persisted = innerStore.set.mock.calls[0]?.[1];
    expect(persisted).toMatchObject({
      _encrypted: true,
      accountId: 'queryable-account',
      cookie: { maxAge: 60_000 },
      _enc_csrfToken: 'encrypted:"sensitive-token"',
      _enc_authenticatedUsers:
        'encrypted:{"active":{"id":"user-id","username":"user@example.com"},"others":[]}',
    });
    expect(persisted).not.toHaveProperty('csrfToken');
    expect(persisted).not.toHaveProperty('authenticatedUsers');
    expect(sessionData).toHaveProperty('csrfToken', 'sensitive-token');
    expect(sessionData).toHaveProperty('authenticatedUsers');
  });

  it('decrypts valid encrypted fields and removes storage metadata', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const innerStore = {
      get: vi.fn(
        (
          _sessionId: string,
          callback: (error: unknown, value: unknown) => void
        ) => {
          callback(null, {
            _encrypted: true,
            accountId: 'queryable-account',
            _enc_csrfToken: '"sensitive-token"',
          });
        }
      ),
    };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();

    (manager as any).store.get('session-id', callback);

    expect(callback).toHaveBeenCalledWith(null, {
      accountId: 'queryable-account',
      csrfToken: 'sensitive-token',
    });
  });

  it('does not persist plaintext when encryption fails', () => {
    const { manager, logger } = createManager({ encryptSessionData: true });
    const innerStore = {
      set: vi.fn(),
    };
    const encryptionError = new Error('encryption unavailable');
    vi.mocked(encryptValue).mockImplementation(() => {
      throw encryptionError;
    });

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();

    (manager as any).store.set(
      'session-id',
      { csrfToken: 'sensitive-token' },
      callback
    );

    expect(innerStore.set).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(encryptionError);
    expect(logger.error).toHaveBeenCalledWith(encryptionError, {
      context: 'Failed to encrypt session data',
      sessionId: 'session-id',
    });
  });

  it('does not persist plaintext when encryption fails during touch', () => {
    const { manager, logger } = createManager({ encryptSessionData: true });
    const innerStore = {
      touch: vi.fn(),
    };
    const encryptionError = new Error('encryption unavailable');
    vi.mocked(encryptValue).mockImplementation(() => {
      throw encryptionError;
    });

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();

    (manager as any).store.touch(
      'session-id',
      { csrfToken: 'sensitive-token' },
      callback
    );

    expect(innerStore.touch).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(encryptionError);
    expect(logger.error).toHaveBeenCalledWith(encryptionError, {
      context: 'Failed to encrypt session data during touch',
      sessionId: 'session-id',
    });
  });

  it('throws an encryption failure when touch is called without a callback', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const encryptionError = new Error('encryption unavailable');
    vi.mocked(encryptValue).mockImplementation(() => {
      throw encryptionError;
    });
    const innerStore = { touch: vi.fn() };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();

    expect(() =>
      (manager as any).store.touch('session-id', {
        csrfToken: 'sensitive-token',
      })
    ).toThrow(encryptionError);
    expect(innerStore.touch).not.toHaveBeenCalled();
  });

  it('rejects a session when an encrypted field cannot be decrypted', () => {
    const { manager, logger } = createManager({ encryptSessionData: true });
    const innerStore = {
      get: vi.fn(
        (
          _sessionId: string,
          callback: (error: unknown, value: unknown) => void
        ) => {
          callback(null, {
            _encrypted: true,
            _enc_csrfToken: 'encrypted:corrupt',
          });
        }
      ),
    };
    const decryptionError = new Error('authentication tag mismatch');
    vi.mocked(decryptValue).mockImplementation(() => {
      throw decryptionError;
    });

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();

    (manager as any).store.get('session-id', callback);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(decryptionError);
    expect(logger.error).toHaveBeenCalledWith(decryptionError, {
      context: 'Failed to decrypt session data',
      sessionId: 'session-id',
    });
  });

  it('rejects malformed encrypted field envelopes', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const innerStore = {
      get: vi.fn(
        (
          _sessionId: string,
          callback: (error: unknown, value: unknown) => void
        ) => {
          callback(null, {
            _encrypted: true,
            _enc_csrfToken: 'not-an-encrypted-value',
          });
        }
      ),
    };
    vi.mocked(isEncrypted).mockReturnValue(false);

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();

    (manager as any).store.get('session-id', callback);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]?.[0]).toEqual(
      new Error('Invalid encrypted session field: csrfToken')
    );
    expect(callback.mock.calls[0]).toHaveLength(1);
  });

  it('rejects sensitive plaintext fields in a record marked encrypted', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const innerStore = {
      get: vi.fn(
        (
          _sessionId: string,
          callback: (error: unknown, value: unknown) => void
        ) => {
          callback(null, {
            _encrypted: true,
            csrfToken: 'plaintext-sensitive-token',
          });
        }
      ),
    };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();

    (manager as any).store.get('session-id', callback);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]?.[0]).toEqual(
      new Error('Sensitive field is not encrypted: csrfToken')
    );
    expect(callback.mock.calls[0]).toHaveLength(1);
  });

  it('passes backend errors, absent sessions, and legacy plaintext sessions through', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const storeError = new Error('store unavailable');
    const innerStore = {
      get: vi
        .fn()
        .mockImplementationOnce(
          (_sessionId: string, callback: (error: unknown) => void) =>
            callback(storeError)
        )
        .mockImplementationOnce(
          (
            _sessionId: string,
            callback: (error: unknown, value: unknown) => void
          ) => callback(null, null)
        )
        .mockImplementationOnce(
          (
            _sessionId: string,
            callback: (error: unknown, value: unknown) => void
          ) => callback(null, { accountId: 'legacy-user' })
        ),
    };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const errorCallback = vi.fn();
    const absentCallback = vi.fn();
    const legacyCallback = vi.fn();

    (manager as any).store.get('error-id', errorCallback);
    (manager as any).store.get('absent-id', absentCallback);
    (manager as any).store.get('legacy-id', legacyCallback);

    expect(errorCallback).toHaveBeenCalledWith(storeError, undefined);
    expect(absentCallback).toHaveBeenCalledWith(null, null);
    expect(legacyCallback).toHaveBeenCalledWith(null, {
      accountId: 'legacy-user',
    });
  });

  it('throws an encryption failure when set is called without a callback', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const encryptionError = new Error('encryption unavailable');
    vi.mocked(encryptValue).mockImplementation(() => {
      throw encryptionError;
    });
    const innerStore = { set: vi.fn() };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();

    expect(() =>
      (manager as any).store.set('session-id', {
        csrfToken: 'sensitive-token',
      })
    ).toThrow(encryptionError);
    expect(innerStore.set).not.toHaveBeenCalled();
  });

  it('delegates destroy and encrypts successful touch payloads', () => {
    const { manager } = createManager({ encryptSessionData: true });
    const innerStore = {
      destroy: vi.fn(),
      touch: vi.fn(),
    };

    (manager as any).store = innerStore;
    (manager as any).applyEncryptionWrapper();
    const destroyCallback = vi.fn();
    const touchCallback = vi.fn();
    (manager as any).store.destroy('session-id', destroyCallback);
    (manager as any).store.touch(
      'session-id',
      { csrfToken: 'sensitive-token' },
      touchCallback
    );

    expect(innerStore.destroy).toHaveBeenCalledWith(
      'session-id',
      destroyCallback
    );
    expect(innerStore.touch).toHaveBeenCalledWith(
      'session-id',
      expect.objectContaining({
        _encrypted: true,
        _enc_csrfToken: 'encrypted:"sensitive-token"',
      }),
      touchCallback
    );
  });

  it('completes touch when the wrapped store does not implement it', () => {
    const { manager } = createManager({ encryptSessionData: true });

    (manager as any).store = {};
    (manager as any).applyEncryptionWrapper();
    const callback = vi.fn();
    (manager as any).store.touch('session-id', {}, callback);

    expect(callback).toHaveBeenCalledWith();
  });

  it('treats callback-free touch as a no-op when the store does not implement it', () => {
    const { manager } = createManager({ encryptSessionData: true });

    (manager as any).store = {};
    (manager as any).applyEncryptionWrapper();

    expect(() => (manager as any).store.touch('session-id', {})).not.toThrow();
  });
});

describe('SessionManager session-store circuit breaker', () => {
  it('leaves an absent session store unchanged', () => {
    const { manager, logger } = createManager();
    (manager as any).store = undefined;

    (manager as any).applyCircuitBreakerWrapper();

    expect((manager as any).store).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalledWith(
      'Session store circuit breaker enabled'
    );
  });

  it('records a backend set failure when the caller omits the callback', () => {
    const { manager } = createManager();
    const storeError = new Error('set failed');
    const innerStore = {
      set: vi.fn(
        (
          _sessionId: string,
          _session: unknown,
          callback: (error?: unknown) => void
        ) => callback(storeError)
      ),
    };

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;

    expect(() => store.set('session-id', {})).not.toThrow();
    expect(store.getCircuitState()).toMatchObject({ failures: 1 });
  });

  it('records a synchronous backend set failure before propagating it', () => {
    const { manager } = createManager();
    const storeError = new Error('synchronous set failure');
    const innerStore = {
      set: vi.fn(() => {
        throw storeError;
      }),
    };

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;

    expect(() => store.set('session-id', {})).toThrow(storeError);
    expect(store.getCircuitState()).toMatchObject({ failures: 1 });
  });

  it('records a synchronous backend destroy failure before propagating it', () => {
    const { manager } = createManager();
    const storeError = new Error('synchronous destroy failure');
    const innerStore = {
      destroy: vi.fn(() => {
        throw storeError;
      }),
    };

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;

    expect(() => store.destroy('session-id')).toThrow(storeError);
    expect(store.getCircuitState()).toMatchObject({ failures: 1 });
  });

  it('records a synchronous backend touch failure before propagating it', () => {
    const { manager } = createManager();
    const storeError = new Error('synchronous touch failure');
    const innerStore = {
      touch: vi.fn(() => {
        throw storeError;
      }),
    };

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;

    expect(() => store.touch('session-id', {})).toThrow(storeError);
    expect(store.getCircuitState()).toMatchObject({ failures: 1 });
  });

  it.each(['set', 'destroy', 'touch'] as const)(
    'does not count caller callback exceptions as backend %s failures',
    operation => {
      const { manager } = createManager();
      const callerError = new Error('caller callback failed');
      const innerStore = {
        set: vi.fn(
          (
            _sessionId: string,
            _session: unknown,
            callback: (error?: unknown) => void
          ) => callback()
        ),
        destroy: vi.fn(
          (_sessionId: string, callback: (error?: unknown) => void) =>
            callback()
        ),
        touch: vi.fn(
          (
            _sessionId: string,
            _session: unknown,
            callback: (error?: unknown) => void
          ) => callback()
        ),
      };

      (manager as any).store = innerStore;
      (manager as any).applyCircuitBreakerWrapper();
      const store = (manager as any).store;
      const callback = vi.fn(() => {
        throw callerError;
      });

      expect(() => {
        if (operation === 'set') {
          store.set('session-id', {}, callback);
        } else if (operation === 'destroy') {
          store.destroy('session-id', callback);
        } else {
          store.touch('session-id', {}, callback);
        }
      }).toThrow(callerError);
      expect(store.getCircuitState()).toMatchObject({ failures: 0 });
    }
  );

  it.each(['set', 'destroy', 'touch'] as const)(
    'supports callback-free successful backend %s calls',
    operation => {
      const { manager } = createManager();
      const innerStore = {
        set: vi.fn(
          (
            _sessionId: string,
            _session: unknown,
            callback: (error?: unknown) => void
          ) => callback()
        ),
        destroy: vi.fn(
          (_sessionId: string, callback: (error?: unknown) => void) =>
            callback()
        ),
        touch: vi.fn(
          (
            _sessionId: string,
            _session: unknown,
            callback: (error?: unknown) => void
          ) => callback()
        ),
      };

      (manager as any).store = innerStore;
      (manager as any).applyCircuitBreakerWrapper();
      const store = (manager as any).store;

      expect(() => {
        if (operation === 'set') {
          store.set('session-id', {});
        } else if (operation === 'destroy') {
          store.destroy('session-id');
        } else {
          store.touch('session-id', {});
        }
      }).not.toThrow();
      expect(store.getCircuitState()).toMatchObject({ failures: 0 });
    }
  );

  it.each(['destroy', 'touch'] as const)(
    'records callback-free backend %s failures',
    operation => {
      const { manager } = createManager();
      const storeError = new Error(`${operation} failed`);
      const innerStore = {
        destroy: vi.fn(
          (_sessionId: string, callback: (error?: unknown) => void) =>
            callback(storeError)
        ),
        touch: vi.fn(
          (
            _sessionId: string,
            _session: unknown,
            callback: (error?: unknown) => void
          ) => callback(storeError)
        ),
      };

      (manager as any).store = innerStore;
      (manager as any).applyCircuitBreakerWrapper();
      const store = (manager as any).store;

      expect(() => {
        if (operation === 'destroy') {
          store.destroy('session-id');
        } else {
          store.touch('session-id', {});
        }
      }).not.toThrow();
      expect(store.getCircuitState()).toMatchObject({ failures: 1 });
    }
  );

  it.each(['set', 'destroy', 'touch'] as const)(
    'rejects callback-free backend %s calls while the circuit is open',
    operation => {
      const { manager } = createManager();
      const storeError = new Error('store unavailable');
      const innerStore = {
        get: vi.fn(
          (
            _sessionId: string,
            callback: (error: unknown, value?: unknown) => void
          ) => callback(storeError)
        ),
        set: vi.fn(),
        destroy: vi.fn(),
        touch: vi.fn(),
      };

      (manager as any).store = innerStore;
      (manager as any).applyCircuitBreakerWrapper();
      const store = (manager as any).store;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        store.get(`session-${attempt}`, vi.fn());
      }
      expect(store.getCircuitState()).toMatchObject({
        state: 'open',
        failures: 5,
      });

      expect(() => {
        if (operation === 'set') {
          store.set('blocked-session', {});
        } else if (operation === 'destroy') {
          store.destroy('blocked-session');
        } else {
          store.touch('blocked-session', {});
        }
      }).not.toThrow();
      expect(innerStore[operation]).not.toHaveBeenCalled();
    }
  );

  it('treats callback-free touch as a no-op when the backend has no touch method', () => {
    const { manager } = createManager();

    (manager as any).store = {};
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;

    expect(() => store.touch('session-id', {})).not.toThrow();
    expect(store.getCircuitState()).toMatchObject({
      state: 'closed',
      failures: 0,
    });
  });

  it('records and propagates backend touch failures', () => {
    const { manager } = createManager();
    const storeError = new Error('store unavailable');
    const innerStore = {
      touch: vi.fn(
        (
          _sessionId: string,
          _session: unknown,
          callback: (error?: unknown) => void
        ) => callback(storeError)
      ),
    };

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const callback = vi.fn();

    (manager as any).store.touch('session-id', {}, callback);

    expect(callback).toHaveBeenCalledWith(storeError);
    expect((manager as any).store.getCircuitState()).toMatchObject({
      state: 'closed',
      failures: 1,
    });
  });

  it('opens after consecutive failures and closes after three recovery probes', () => {
    const { manager, logger } = createManager();
    const storeError = new Error('store unavailable');
    let backendHealthy = false;
    const innerStore = {
      get: vi.fn(
        (
          _sessionId: string,
          callback: (error: unknown, value?: unknown) => void
        ) =>
          backendHealthy
            ? callback(null, { accountId: 'trusted-user' })
            : callback(storeError)
      ),
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const callback = vi.fn();
      store.get(`failed-${attempt}`, callback);
      expect(callback).toHaveBeenCalledWith(storeError, undefined);
    }

    expect(store.getCircuitState()).toEqual({
      state: 'open',
      failures: 5,
      lastFailure: 1_000,
    });
    const blockedCallback = vi.fn();
    store.get('blocked', blockedCallback);
    expect(innerStore.get).toHaveBeenCalledTimes(5);
    expect(blockedCallback.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });

    backendHealthy = true;
    now.mockReturnValue(31_000);
    for (let probe = 0; probe < 3; probe += 1) {
      const callback = vi.fn();
      store.get(`probe-${probe}`, callback);
      expect(callback).toHaveBeenCalledWith(null, {
        accountId: 'trusted-user',
      });
    }

    expect(store.getCircuitState()).toMatchObject({
      state: 'closed',
      failures: 0,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Circuit breaker transitioning to half-open'
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Circuit breaker closed - store recovered'
    );

    now.mockRestore();
  });

  it('reopens immediately when a half-open recovery probe fails', () => {
    const { manager, logger } = createManager();
    const storeError = new Error('store unavailable');
    const innerStore = {
      destroy: vi.fn(
        (_sessionId: string, callback: (error?: unknown) => void) =>
          callback(storeError)
      ),
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      store.destroy(`failed-${attempt}`, vi.fn());
    }

    now.mockReturnValue(31_000);
    const callback = vi.fn();
    store.destroy('failed-probe', callback);

    expect(callback).toHaveBeenCalledWith(storeError);
    expect(store.getCircuitState()).toMatchObject({
      state: 'open',
      failures: 6,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Circuit breaker re-opened after failure in half-open state'
    );

    now.mockRestore();
  });

  it('supports successful set, destroy, and stores without touch', () => {
    const { manager } = createManager();
    const innerStore = {
      set: vi.fn(
        (
          _sessionId: string,
          _session: unknown,
          callback: (error?: unknown) => void
        ) => callback()
      ),
      destroy: vi.fn(
        (_sessionId: string, callback: (error?: unknown) => void) => callback()
      ),
    };

    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const store = (manager as any).store;
    const setCallback = vi.fn();
    const destroyCallback = vi.fn();
    const touchCallback = vi.fn();

    store.set('session-id', {}, setCallback);
    store.destroy('session-id', destroyCallback);
    store.touch('session-id', {}, touchCallback);

    expect(setCallback).toHaveBeenCalledWith();
    expect(destroyCallback).toHaveBeenCalledWith();
    expect(touchCallback).toHaveBeenCalledWith();
    expect(store.getCircuitState()).toMatchObject({
      state: 'closed',
      failures: 0,
    });
  });

  it('records successful backend touches', () => {
    const { manager } = createManager();
    const innerStore = {
      touch: vi.fn(
        (
          _sessionId: string,
          _session: unknown,
          callback: (error?: unknown) => void
        ) => callback()
      ),
    };
    (manager as any).store = innerStore;
    (manager as any).applyCircuitBreakerWrapper();
    const callback = vi.fn();

    (manager as any).store.touch('session-id', {}, callback);

    expect(callback).toHaveBeenCalledWith();
    expect((manager as any).store.getCircuitState()).toMatchObject({
      state: 'closed',
      failures: 0,
    });
  });

  it.each(['set', 'destroy', 'touch'] as const)(
    'blocks backend %s calls while the circuit is open',
    operation => {
      const { manager } = createManager();
      const storeError = new Error('store unavailable');
      const innerStore = {
        get: vi.fn(
          (
            _sessionId: string,
            callback: (error: unknown, value?: unknown) => void
          ) => callback(storeError)
        ),
        set: vi.fn(),
        destroy: vi.fn(),
        touch: vi.fn(),
      };
      (manager as any).store = innerStore;
      (manager as any).applyCircuitBreakerWrapper();
      const store = (manager as any).store;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        store.get(`failed-${attempt}`, vi.fn());
      }
      const callback = vi.fn();

      if (operation === 'set') {
        store.set('blocked', {}, callback);
      } else if (operation === 'destroy') {
        store.destroy('blocked', callback);
      } else {
        store.touch('blocked', {}, callback);
      }

      expect(innerStore[operation]).not.toHaveBeenCalled();
      expect(callback.mock.calls[0]?.[0]).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
    }
  );

  it.each(['set', 'destroy'] as const)(
    'records and propagates backend %s failures',
    operation => {
      const { manager } = createManager();
      const storeError = new Error(`${operation} failed`);
      const innerStore = {
        set: vi.fn(
          (
            _sessionId: string,
            _session: unknown,
            callback: (error?: unknown) => void
          ) => callback(storeError)
        ),
        destroy: vi.fn(
          (_sessionId: string, callback: (error?: unknown) => void) =>
            callback(storeError)
        ),
      };

      (manager as any).store = innerStore;
      (manager as any).applyCircuitBreakerWrapper();
      const store = (manager as any).store;
      const callback = vi.fn();

      if (operation === 'set') {
        store.set('session-id', {}, callback);
      } else {
        store.destroy('session-id', callback);
      }

      expect(callback).toHaveBeenCalledWith(storeError);
      expect(store.getCircuitState()).toMatchObject({ failures: 1 });
    }
  );
});

describe('SessionManager redirect persistence', () => {
  it('redirects immediately when a request has no persistable session', () => {
    const { manager } = createManager();
    const redirectBarrier = (
      manager as any
    ).redirectAfterSessionSaveMiddleware();
    const request = {} as Request;
    const response = createApiResponse();
    const originalRedirect = vi.mocked(response.redirect);
    const next = vi.fn();

    redirectBarrier(request, response, next);
    response.redirect('/auth/login');

    expect(originalRedirect).toHaveBeenCalledWith('/auth/login');
    expect(next).toHaveBeenCalledOnce();
  });

  it('persists session changes before exposing redirect headers', () => {
    const { manager } = createManager();
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };
    const app = { use: vi.fn() };
    manager.initialize(app as never);
    const redirectBarrier = app.use.mock.calls[1]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;
    let saved: ((error?: unknown) => void) | undefined;
    const request = {
      session: {
        save: vi.fn((callback: (error?: unknown) => void) => {
          saved = callback;
        }),
      },
    } as unknown as Request;
    const response = createApiResponse();
    const originalRedirect = vi.mocked(response.redirect);
    const next = vi.fn();

    redirectBarrier(request, response, next);
    response.redirect('/auth/login');

    expect(request.session.save).toHaveBeenCalledOnce();
    expect(originalRedirect).not.toHaveBeenCalled();

    saved?.();

    expect(originalRedirect).toHaveBeenCalledOnce();
    expect(originalRedirect).toHaveBeenCalledWith('/auth/login');
    expect(next).toHaveBeenCalledOnce();
  });

  it('reports redirect session-persistence failures without sending headers', () => {
    const { manager } = createManager();
    const store = { startCleanup: vi.fn(), on: vi.fn() };
    vi.mocked(PrismaSessionStore).mockImplementation(function MockStore() {
      return store;
    } as never);
    (manager as any).prismaClient = { session: {} };
    const app = { use: vi.fn() };
    manager.initialize(app as never);
    const redirectBarrier = app.use.mock.calls[1]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;
    const persistenceError = new Error('session store unavailable');
    const request = {
      session: {
        save: vi.fn((callback: (error?: unknown) => void) => {
          callback(persistenceError);
        }),
      },
    } as unknown as Request;
    const response = createApiResponse();
    const originalRedirect = vi.mocked(response.redirect);
    const next = vi.fn();

    redirectBarrier(request, response, next);
    response.redirect('/auth/login');

    expect(originalRedirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenNthCalledWith(1);
    expect(next).toHaveBeenNthCalledWith(2, persistenceError);
  });
});
