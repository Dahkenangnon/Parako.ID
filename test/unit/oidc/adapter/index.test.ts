import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  connectMongoDB: vi.fn(),
  connectRedis: vi.fn(),
  createMongoAdapterFactory: vi.fn(),
  createPrismaAdapterFactory: vi.fn(),
  createRedisAdapterFactory: vi.fn(),
}));

vi.mock('../../../../src/oidc/adapter/mongodb/index.js', () => ({
  connectMongoDB: adapterMocks.connectMongoDB,
  createMongoAdapterFactory: adapterMocks.createMongoAdapterFactory,
}));

vi.mock('../../../../src/oidc/adapter/redis/index.js', () => ({
  connectRedis: adapterMocks.connectRedis,
  createRedisAdapterFactory: adapterMocks.createRedisAdapterFactory,
}));

vi.mock('../../../../src/oidc/adapter/prisma/index.js', () => ({
  createPrismaAdapterFactory: adapterMocks.createPrismaAdapterFactory,
}));

vi.mock('../../../../src/oidc/adapter/mongodb/admin-service.js', () => ({
  MongodbOidcAdminService: class MongodbOidcAdminService {
    constructor(public readonly model: string) {}
  },
}));

vi.mock('../../../../src/oidc/adapter/redis/admin-service.js', () => ({
  RedisOidcAdminService: class RedisOidcAdminService {
    constructor(public readonly model: string) {}
  },
}));

vi.mock('../../../../src/oidc/adapter/prisma/admin-service.js', () => ({
  PrismaOidcAdminService: class PrismaOidcAdminService {
    constructor(
      public readonly prisma: unknown,
      public readonly model: string
    ) {}
  },
}));

import { OIDCAdapterBridge } from '../../../../src/oidc/adapter/index.js';
import { MongodbOidcAdminService } from '../../../../src/oidc/adapter/mongodb/admin-service.js';
import { PrismaOidcAdminService } from '../../../../src/oidc/adapter/prisma/admin-service.js';
import { RedisOidcAdminService } from '../../../../src/oidc/adapter/redis/admin-service.js';

function makeRuntimeConfig() {
  return {
    deployment: { redis_prefix: 'demo' },
    storage: {
      adapter: 'mongodb',
      mongodb: {
        uri: 'mongodb://main-user:main-secret@main-db/main',
        database: 'main',
      },
      sqlite: { path: '/srv/parako/runtime/parako.db' },
      postgresql: {
        url: 'postgresql://pg-user:pg-secret@postgres/parako',
      },
    },
    oidc_storage: {
      oidc_adapter: {
        type: 'mongodb',
        mongodb: {
          uri: 'mongodb://oidc-user:oidc-secret@mongo/oidc',
          database: 'oidc',
        },
        redis: {
          host: 'redis',
          port: 6379,
          database: 2,
          password: 'redis-secret',
        },
      },
    },
  };
}

function setupBridge(
  options: {
    adapterOverride?: string;
    mainAdapter?: string;
    prismaClient?: object | null;
    runtimeConfig?: ReturnType<typeof makeRuntimeConfig>;
  } = {}
) {
  const runtimeConfig = options.runtimeConfig ?? makeRuntimeConfig();
  const bootstrapValues: Record<string, unknown> = {
    'oidcStorage.adapter': options.adapterOverride,
    'storage.adapter': options.mainAdapter ?? 'mongodb',
  };
  let subscriber: ((config: unknown) => void | Promise<void>) | undefined;
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    flush: vi.fn(),
    getLogger: vi.fn(),
    info: vi.fn(),
    shutdown: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  };
  const configManager = {
    getConfig: vi.fn(() => runtimeConfig),
    subscribe: vi.fn(
      (_id: string, callback: (config: unknown) => void | Promise<void>) => {
        subscriber = callback;
      }
    ),
  };
  const bootstrapProvider = {
    getConfigValue: vi.fn((key: string, fallback: unknown) =>
      bootstrapValues[key] === undefined ? fallback : bootstrapValues[key]
    ),
  };
  const prismaClient =
    options.prismaClient === undefined
      ? { oidcStore: {} }
      : options.prismaClient;
  const bridge = new OIDCAdapterBridge(
    logger as any,
    configManager as any,
    bootstrapProvider as any,
    prismaClient as any
  );

  return {
    bootstrapProvider,
    bootstrapValues,
    bridge,
    configManager,
    logger,
    runtimeConfig,
    getSubscriber: () => subscriber,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  adapterMocks.connectMongoDB.mockResolvedValue({ databaseName: 'oidc' });
  adapterMocks.connectRedis.mockResolvedValue({ status: 'ready' });
  adapterMocks.createMongoAdapterFactory.mockReturnValue(vi.fn());
  adapterMocks.createRedisAdapterFactory.mockReturnValue(vi.fn());
  adapterMocks.createPrismaAdapterFactory.mockReturnValue(vi.fn());
});

describe('OIDCAdapterBridge adapter resolution', () => {
  it('uses the explicit OIDC bootstrap override first', () => {
    const { bridge } = setupBridge({
      adapterOverride: 'redis',
      mainAdapter: 'sqlite',
    });
    expect(bridge.effectiveOidcAdapter()).toBe('redis');
  });

  it.each(['sqlite', 'postgresql'] as const)(
    'inherits non-MongoDB main adapter %s',
    mainAdapter => {
      const { bridge } = setupBridge({ mainAdapter });
      expect(bridge.effectiveOidcAdapter()).toBe(mainAdapter);
    }
  );

  it('uses the admin-managed OIDC adapter only with a MongoDB main store', () => {
    const runtimeConfig = makeRuntimeConfig();
    runtimeConfig.oidc_storage.oidc_adapter.type = 'redis';
    const { bridge } = setupBridge({ runtimeConfig });
    expect(bridge.effectiveOidcAdapter()).toBe('redis');
  });

  it('falls back to MongoDB when runtime config is absent or unavailable', () => {
    const withoutType = makeRuntimeConfig();
    withoutType.oidc_storage.oidc_adapter.type = undefined as never;
    expect(setupBridge({ runtimeConfig: withoutType }).bridge.adapterType).toBe(
      'mongodb'
    );

    const throwing = setupBridge();
    throwing.configManager.getConfig.mockImplementation(() => {
      throw new Error('configuration unavailable');
    });
    expect(throwing.bridge.adapterType).toBe('mongodb');
  });
});

describe('OIDCAdapterBridge initialization', () => {
  it('initializes MongoDB once and exposes all model services', async () => {
    const { bridge, logger, runtimeConfig } = setupBridge();

    await bridge.initialize();
    await bridge.initialize();

    expect(adapterMocks.connectMongoDB).toHaveBeenCalledOnce();
    expect(adapterMocks.connectMongoDB).toHaveBeenCalledWith({
      uri: runtimeConfig.oidc_storage.oidc_adapter.mongodb.uri,
      dbName: runtimeConfig.oidc_storage.oidc_adapter.mongodb.database,
    });
    expect(adapterMocks.createMongoAdapterFactory).toHaveBeenCalledOnce();
    expect(bridge.session).toBeInstanceOf(MongodbOidcAdminService);
    expect(bridge.grant).toBeInstanceOf(MongodbOidcAdminService);
    expect(bridge.client).toBeInstanceOf(MongodbOidcAdminService);
    expect(bridge.accessToken).toBeInstanceOf(MongodbOidcAdminService);
    expect(bridge.refreshToken).toBeInstanceOf(MongodbOidcAdminService);
    expect(bridge.interaction).toBeInstanceOf(MongodbOidcAdminService);
    expect(bridge.adapter).toBe(
      adapterMocks.createMongoAdapterFactory.mock.results[0].value
    );
    expect(bridge.isInitialized).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'MongoDB OIDC adapter initialized'
    );
  });

  it.each(['sqlite', 'postgresql'] as const)(
    'initializes %s through the Prisma adapter',
    async adapterType => {
      const prismaClient = { oidcStore: {} };
      const { bridge } = setupBridge({
        mainAdapter: adapterType,
        prismaClient,
      });

      await bridge.initialize();

      expect(adapterMocks.createPrismaAdapterFactory).toHaveBeenCalledWith(
        prismaClient,
        expect.any(Object)
      );
      expect(bridge.session).toBeInstanceOf(PrismaOidcAdminService);
      expect(bridge.interaction).toBeInstanceOf(PrismaOidcAdminService);
    }
  );

  it('fails securely when a SQL adapter has no Prisma client', async () => {
    const { bridge, logger } = setupBridge({
      mainAdapter: 'sqlite',
      prismaClient: null,
    });

    await expect(bridge.initialize()).rejects.toThrow(
      'PrismaClient is not available'
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'Failed to initialize OIDC adapter bridge',
      })
    );
    expect(bridge.isInitialized).toBe(false);
  });

  it.each([
    ['with password', 'redis://:redis-secret@redis:6379/2'],
    ['without password', 'redis://redis:6379/2'],
  ])('initializes Redis %s', async (_label, expectedUri) => {
    const runtimeConfig = makeRuntimeConfig();
    if (_label === 'without password') {
      runtimeConfig.oidc_storage.oidc_adapter.redis.password = '';
      runtimeConfig.deployment.redis_prefix = undefined as never;
    }
    const { bridge } = setupBridge({
      adapterOverride: 'redis',
      runtimeConfig,
    });

    await bridge.initialize();

    expect(adapterMocks.connectRedis).toHaveBeenCalledWith({
      uri: expectedUri,
    });
    expect(adapterMocks.createRedisAdapterFactory).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      _label === 'without password' ? 'parako' : 'demo'
    );
    expect(bridge.session).toBeInstanceOf(RedisOidcAdminService);
    expect(bridge.interaction).toBeInstanceOf(RedisOidcAdminService);
    if (_label === 'without password') {
      expect(bridge.getConnectionInfo()).toEqual(
        expect.objectContaining({
          config: expect.objectContaining({ password: '' }),
        })
      );
    }
  });
});

describe('OIDCAdapterBridge public guards and monitoring', () => {
  it.each([
    'adapter',
    'session',
    'grant',
    'client',
    'accessToken',
    'refreshToken',
    'interaction',
  ] as const)('guards %s before initialization', property => {
    const { bridge } = setupBridge();
    expect(() => bridge[property]).toThrow('not initialized');
  });

  it.each([
    ['adapter', '_adapterFactory', 'OIDC adapter bridge not initialized'],
    ['session', '_session', 'Session service not initialized'],
    ['grant', '_grant', 'Grant service not initialized'],
    ['client', '_client', 'Client service not initialized'],
    ['accessToken', '_accessToken', 'AccessToken service not initialized'],
    ['refreshToken', '_refreshToken', 'RefreshToken service not initialized'],
    ['interaction', '_interaction', 'Interaction service not initialized'],
  ] as const)(
    'guards missing initialized %s dependency',
    (property, internalProperty, message) => {
      const { bridge } = setupBridge();
      (bridge as any)._isInitialized = true;
      (bridge as any)[internalProperty] = null;
      expect(() => bridge[property]).toThrow(message);
    }
  );

  it('reports an uninitialized bridge without reading runtime config', () => {
    const { bridge, configManager } = setupBridge();
    expect(bridge.getConnectionInfo()).toEqual({
      type: 'none',
      status: 'not_initialized',
      config: null,
    });
    expect(configManager.getConfig).not.toHaveBeenCalled();
  });

  it('redacts MongoDB credentials in connection information', async () => {
    const { bridge } = setupBridge();
    await bridge.initialize();
    expect(bridge.getConnectionInfo()).toEqual({
      type: 'mongodb',
      status: 'connected',
      config: {
        uri: 'mongodb://***:***@mongo/oidc',
        database: 'oidc',
      },
    });
  });

  it('redacts Redis passwords in connection information', async () => {
    const { bridge } = setupBridge({ adapterOverride: 'redis' });
    await bridge.initialize();
    expect(bridge.getConnectionInfo()).toEqual({
      type: 'redis',
      status: 'connected',
      config: {
        host: 'redis',
        port: 6379,
        database: 2,
        password: '***',
      },
    });
  });

  it.each([
    ['sqlite', { path: '/srv/parako/runtime/parako.db' }],
    ['postgresql', { url: 'postgresql://***:***@postgres/parako' }],
  ] as const)('reports the effective %s connection', async (type, config) => {
    const { bridge } = setupBridge({ mainAdapter: type });
    await bridge.initialize();
    expect(bridge.getConnectionInfo()).toEqual({
      type,
      status: 'connected',
      config,
    });
  });

  it('reports an absent optional PostgreSQL config without throwing', async () => {
    const runtimeConfig = makeRuntimeConfig();
    runtimeConfig.storage.postgresql = undefined as never;
    const { bridge } = setupBridge({
      mainAdapter: 'postgresql',
      runtimeConfig,
    });
    await bridge.initialize();

    expect(bridge.getConnectionInfo()).toEqual({
      type: 'postgresql',
      status: 'connected',
      config: undefined,
    });
  });
});

describe('OIDCAdapterBridge configuration reinitialization', () => {
  it('rebuilds the bridge when the subscribed storage config changes', async () => {
    const setup = setupBridge({ adapterOverride: 'redis' });
    await setup.bridge.initialize();
    setup.bootstrapValues['oidcStorage.adapter'] = 'mongodb';

    setup.getSubscriber()?.(setup.runtimeConfig);

    await vi.waitFor(() => {
      expect(adapterMocks.connectMongoDB).toHaveBeenCalledOnce();
      expect(setup.logger.info).toHaveBeenCalledWith(
        'OIDC adapter reinitialized successfully'
      );
    });
    expect(setup.bridge.session).toBeInstanceOf(MongodbOidcAdminService);
  });

  it('logs subscribed reinitialization failures without rejecting callers', async () => {
    const setup = setupBridge({ adapterOverride: 'redis' });
    await setup.bridge.initialize();
    setup.bootstrapValues['oidcStorage.adapter'] = 'mongodb';
    adapterMocks.connectMongoDB.mockRejectedValueOnce(
      new Error('mongo unavailable')
    );

    expect(() => setup.getSubscriber()?.(setup.runtimeConfig)).not.toThrow();

    await vi.waitFor(() => {
      expect(setup.logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: 'Failed to reinitialize OIDC adapter',
        })
      );
    });
    expect(setup.bridge.isInitialized).toBe(false);
  });
});
