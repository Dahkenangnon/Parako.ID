import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyComputedDefaults: vi.fn(),
  buildRedisKey: vi.fn(),
  buildRedisKeyForTenant: vi.fn(),
  getDefaultFullConfig: vi.fn(),
  getTenantIdSafe: vi.fn(),
  tenantRun: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: () => 'manager-origin' }));
vi.mock('../../../src/config/computed-fields.js', () => ({
  applyComputedDefaults: mocks.applyComputedDefaults,
}));
vi.mock('../../../src/config/constants.js', () => ({
  getDefaultFullConfig: mocks.getDefaultFullConfig,
}));
vi.mock('../../../src/multi-tenancy/redis-key.js', () => ({
  buildRedisKey: mocks.buildRedisKey,
  buildRedisKeyForTenant: mocks.buildRedisKeyForTenant,
}));
vi.mock('../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    getTenantIdSafe: mocks.getTenantIdSafe,
    run: mocks.tenantRun,
  },
}));

import { ConfigManager } from '../../../src/config/index.js';
import { ConfigurationVersionConflictError } from '../../../src/errors/configuration-version-conflict.error.js';

function createPersistedConfig(overrides: Record<string, unknown> = {}) {
  return {
    application: { title: 'Persisted', description: 'Stored config' },
    branding: { companyName: 'Parako' },
    deployment: {
      url: 'https://persisted.example.test',
      server: { trust_proxy_hops: 1 },
      redis_prefix: 'persisted-prefix',
    },
    security: { enabled: true },
    features: {
      multi_tenancy: {
        enabled: false,
        extraction_priority: ['header'],
        tenant_header: 'x-stored-tenant',
        provider_pool: {
          max_size: 10,
          idle_ttl_ms: 120_000,
          cleanup_interval_ms: 30_000,
        },
      },
    },
    oidc: { path: '/oidc/v1' },
    integrations: { urls: {} },
    notifications: { channels: {} },
    ...overrides,
  };
}

function createBootstrapConfig(overrides: Record<string, unknown> = {}) {
  return {
    deployment: {
      environment: 'production',
      url: 'https://bootstrap.example.test',
      server: { port: 9007 },
    },
    storage: {
      adapter: 'sqlite',
      sqlite: { path: './runtime/data/parako.db' },
    },
    multiTenancy: {
      enabled: true,
      extraction_priority: ['subdomain', 'header'],
      tenant_header: 'x-bootstrap-tenant',
      provider_pool: {
        max_size: 50,
        idle_ttl_ms: 1_800_000,
        cleanup_interval_ms: 60_000,
      },
    },
    ...overrides,
  };
}

function createManager() {
  const bootstrapProvider = {
    clearCache: vi.fn(),
    loadConfiguration: vi.fn(),
  };
  const dbProvider = {
    cleanup: vi.fn(),
    clearCache: vi.fn(),
    flushInitial: vi.fn(),
    isAvailable: vi.fn(),
    loadConfiguration: vi.fn(),
    reloadConfiguration: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    updateConfig: vi.fn(),
  };
  const fileProvider = {
    cleanup: vi.fn(),
    clearCache: vi.fn(),
    isAvailable: vi.fn(),
    loadConfiguration: vi.fn(),
    reloadConfiguration: vi.fn(),
  };
  const settingsService = {};
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const tenantOverrideService = {
    loadOverrides: vi.fn(),
  };
  const manager = new ConfigManager(
    bootstrapProvider as never,
    dbProvider as never,
    fileProvider as never,
    settingsService as never,
    logger as never,
    tenantOverrideService as never
  );

  return {
    bootstrapProvider,
    dbProvider,
    fileProvider,
    logger,
    manager,
    tenantOverrideService,
  };
}

describe('ConfigManager core behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    vi.stubEnv('USE_FILE_CONFIG', 'false');
    mocks.applyComputedDefaults.mockReset().mockImplementation(value => value);
    mocks.buildRedisKey.mockReset().mockReturnValue('tenant:config:key');
    mocks.buildRedisKeyForTenant
      .mockReset()
      .mockReturnValue('tenant-a:config:key');
    mocks.getDefaultFullConfig
      .mockReset()
      .mockReturnValue(createPersistedConfig());
    mocks.getTenantIdSafe.mockReset().mockReturnValue(undefined);
    mocks.tenantRun.mockReset().mockImplementation((_tenantId, fn) => fn());
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('loads database config once and lets bootstrap infrastructure win', async () => {
    const persisted = createPersistedConfig();
    const bootstrap = createBootstrapConfig();
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(persisted);

    const first = await manager.load();
    const second = await manager.load();

    expect(first).toBe(second);
    expect(first.deployment).toMatchObject({
      url: 'https://bootstrap.example.test',
      environment: 'production',
      server: { port: 9007, trust_proxy_hops: 1 },
    });
    expect(first.storage).toEqual(bootstrap.storage);
    expect(first.features.multi_tenancy).toEqual(bootstrap.multiTenancy);
    expect(first._metadata).toMatchObject({
      configProvider: 'database',
      isBootstrapMerged: true,
      loadedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(dbProvider.loadConfiguration).toHaveBeenCalledOnce();
    expect(mocks.applyComputedDefaults).toHaveBeenCalledOnce();
    expect(manager.isLoaded()).toBe(true);
    expect(manager.getPlatformConfig()).toBe(first);
  });

  it('computes Redis OIDC storage entirely from bootstrap values', async () => {
    const bootstrap = createBootstrapConfig({
      oidcStorage: { adapter: 'redis' },
      redis: {
        host: 'redis.internal',
        port: 6380,
        password: 'secret',
        database: 5,
      },
    });
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());

    const config = await manager.load();

    expect(config.oidc_storage).toEqual({
      oidc_adapter: {
        type: 'redis',
        mongodb: {
          uri: 'mongodb://localhost:27017',
          database: 'parako-id-dev',
        },
        redis: {
          host: 'redis.internal',
          port: 6380,
          password: 'secret',
          database: 5,
        },
      },
    });
  });

  it('uses the fallback MongoDB database when the URI has no database path', async () => {
    const bootstrap = createBootstrapConfig({
      storage: {
        adapter: 'mongodb',
        mongodb: { uri: 'mongodb://mongo.internal:27017' },
      },
    });
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());

    const config = await manager.load();

    expect(config.oidc_storage.oidc_adapter.mongodb.database).toBe(
      'parako-id-dev'
    );
  });

  it('extracts and decodes a MongoDB database path without query options', async () => {
    const bootstrap = createBootstrapConfig({
      storage: {
        adapter: 'mongodb',
        mongodb: {
          uri: 'mongodb://mongo.internal:27017/parako%20tenant?replicaSet=rs0',
        },
      },
    });
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());

    const config = await manager.load();

    expect(config.oidc_storage.oidc_adapter.mongodb.database).toBe(
      'parako tenant'
    );
  });

  it('uses the fallback MongoDB database for malformed programmatic input', async () => {
    const bootstrap = createBootstrapConfig({
      storage: {
        adapter: 'mongodb',
        mongodb: { uri: 'not a mongodb uri' },
      },
    });
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());

    const config = await manager.load();

    expect(config.oidc_storage.oidc_adapter.mongodb).toEqual({
      uri: 'not a mongodb uri',
      database: 'parako-id-dev',
    });
  });

  it('loads file config only in development when explicitly enabled', async () => {
    vi.stubEnv('USE_FILE_CONFIG', 'true');
    const bootstrap = createBootstrapConfig({
      deployment: { environment: 'development', server: { port: 9007 } },
    });
    const fileConfig = createPersistedConfig({
      application: { title: 'From file' },
    });
    const { bootstrapProvider, dbProvider, fileProvider, manager } =
      createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    fileProvider.isAvailable.mockResolvedValue(true);
    fileProvider.loadConfiguration.mockResolvedValue(fileConfig);

    const config = await manager.load();

    expect(config.application).toEqual({ title: 'From file' });
    expect(config._metadata.configProvider).toBe('file');
    expect(dbProvider.isAvailable).not.toHaveBeenCalled();
    expect(manager.isUsingFileConfig()).toBe(true);
  });

  it('falls back to complete defaults when file config is unavailable', async () => {
    vi.stubEnv('USE_FILE_CONFIG', 'true');
    const bootstrap = createBootstrapConfig({
      deployment: { environment: 'development', server: { port: 9007 } },
    });
    const defaults = createPersistedConfig({
      application: { title: 'Default full config' },
    });
    mocks.getDefaultFullConfig.mockReturnValue(defaults);
    const { bootstrapProvider, fileProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    fileProvider.isAvailable.mockResolvedValue(false);

    const config = await manager.load();

    expect(config.application).toEqual({ title: 'Default full config' });
    expect(config._metadata.configProvider).toBe('bootstrap');
  });

  it('falls back to complete defaults when database config is unavailable', async () => {
    const bootstrap = createBootstrapConfig();
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(false);

    const config = await manager.load();

    expect(config.application.title).toBe('Persisted');
    expect(config._metadata.configProvider).toBe('bootstrap');
  });

  it.each([new Error('bootstrap failed'), 'bootstrap failed'])(
    'normalizes load failures: %s',
    async failure => {
      const { bootstrapProvider, manager } = createManager();
      bootstrapProvider.loadConfiguration.mockRejectedValue(failure);

      await expect(manager.load()).rejects.toThrow(
        'Failed to load configuration: bootstrap failed'
      );
      expect(manager.isLoaded()).toBe(false);
    }
  );

  it('requires load before configuration access', () => {
    const { manager } = createManager();

    expect(() => manager.getConfig()).toThrow(
      'Configuration not loaded. Call load() first.'
    );
    expect(() => manager.getPlatformConfig()).toThrow(
      'Configuration not loaded. Call load() first.'
    );
    expect(() => manager.getConfigSection('application')).toThrow(
      'Configuration not loaded. Call load() first.'
    );
    expect(manager.isUsingFileConfig()).toBe(false);
  });

  it('caches sections, expires them after 60 seconds, and reports metrics', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();

    expect(manager.getSectionCacheMetrics()).toMatchObject({
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      hitRate: '0.00%',
      cachedSections: 0,
    });
    expect(manager.getConfigSection('application')).toEqual({
      title: 'Persisted',
      description: 'Stored config',
    });
    expect(manager.getConfigSection('application')).toEqual({
      title: 'Persisted',
      description: 'Stored config',
    });
    vi.advanceTimersByTime(60_000);
    manager.getConfigSection('application');
    manager.getConfigSection('deployment');

    expect(manager.getSectionCacheMetrics()).toMatchObject({
      cacheHits: 1,
      cacheMisses: 3,
      totalRequests: 4,
      hitRate: '25.00%',
      cachedSections: 2,
      mostAccessedSections: [
        { section: 'application', count: 3 },
        { section: 'deployment', count: 1 },
      ],
    });
  });

  it('reads only own configuration paths and checks feature flags', async () => {
    const inherited = Object.create({ inherited: true });
    inherited.own = false;
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(
      createPersistedConfig({
        features: { custom: inherited, enabled_flag: true },
      })
    );
    await manager.load();

    expect(manager.getConfigValue('features.custom.own')).toBe(false);
    expect(
      manager.getConfigValue('features.custom.inherited', 'fallback')
    ).toBe('fallback');
    expect(manager.getConfigValue('features.missing', 'fallback')).toBe(
      'fallback'
    );
    expect(
      manager.getConfigValue('features.custom.own.value', 'fallback')
    ).toBe('fallback');
    expect(manager.isFeatureEnabled('enabled_flag')).toBe(true);
    expect(manager.isFeatureEnabled('missing')).toBe(false);
  });

  it('exposes bootstrap config and clears every cache on reset', async () => {
    const bootstrap = createBootstrapConfig();
    const { bootstrapProvider, dbProvider, fileProvider, manager } =
      createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(bootstrap);
    dbProvider.isAvailable.mockResolvedValue(false);
    await manager.load();

    await expect(manager.getBootstrapConfig()).resolves.toBe(bootstrap);
    manager.getConfigSection('application');
    manager.clearCache();

    expect(bootstrapProvider.clearCache).toHaveBeenCalledOnce();
    expect(dbProvider.clearCache).toHaveBeenCalledOnce();
    expect(fileProvider.clearCache).toHaveBeenCalledOnce();
    expect(manager.isLoaded()).toBe(false);
  });

  it('subscribes to database changes during construction', () => {
    const { dbProvider } = createManager();

    expect(dbProvider.subscribe).toHaveBeenCalledOnce();
    expect(dbProvider.subscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  it('ignores database changes before initialization and while using file config', async () => {
    const first = createManager();
    const beforeLoadHandler = first.dbProvider.subscribe.mock.calls[0][0];
    await beforeLoadHandler(createPersistedConfig());
    expect(first.bootstrapProvider.loadConfiguration).not.toHaveBeenCalled();

    vi.stubEnv('USE_FILE_CONFIG', 'true');
    const second = createManager();
    second.bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
      })
    );
    second.fileProvider.isAvailable.mockResolvedValue(true);
    second.fileProvider.loadConfiguration.mockResolvedValue(
      createPersistedConfig()
    );
    await second.manager.load();
    const fileModeHandler = second.dbProvider.subscribe.mock.calls[0][0];
    await fileModeHandler(
      createPersistedConfig({ application: { title: 'Ignored' } })
    );

    expect(second.manager.getConfig().application.title).toBe('Persisted');
    expect(second.bootstrapProvider.loadConfiguration).toHaveBeenCalledOnce();
  });

  it.each([
    [null, new Error('reload failed'), 'reload failed'],
    [null, undefined, 'Unknown error'],
  ] as const)(
    'keeps the cached config when a database change cannot be loaded',
    async (config, error, expectedMessage) => {
      const { bootstrapProvider, dbProvider, manager } = createManager();
      bootstrapProvider.loadConfiguration.mockResolvedValue(
        createBootstrapConfig()
      );
      dbProvider.isAvailable.mockResolvedValue(true);
      dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
      await manager.load();
      const previous = manager.getPlatformConfig();
      const handler = dbProvider.subscribe.mock.calls[0][0];

      await handler(config, error);

      expect(manager.getPlatformConfig()).toBe(previous);
      expect(console.error).toHaveBeenCalledWith(
        '[ConfigManager] Database config reload failed, keeping cached config',
        { error: expectedMessage }
      );
    }
  );

  it('applies an external database change and isolates failing subscribers', async () => {
    const { bootstrapProvider, dbProvider, manager, tenantOverrideService } =
      createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();
    await manager.ensureTenantConfig('tenant-a');
    expect(tenantOverrideService.loadOverrides).toHaveBeenCalledOnce();
    manager.getConfigSection('application');
    const successfulSubscriber = vi.fn();
    const failingSubscriber = vi.fn().mockRejectedValue(new Error('offline'));
    manager.subscribe('successful', successfulSubscriber);
    manager.subscribe('failing', failingSubscriber);
    mocks.applyComputedDefaults.mockClear();
    const changed = createPersistedConfig({
      application: { title: 'Externally updated' },
    });
    const handler = dbProvider.subscribe.mock.calls[0][0];

    await handler(changed);

    expect(manager.getPlatformConfig().application.title).toBe(
      'Externally updated'
    );
    expect(mocks.applyComputedDefaults).toHaveBeenCalledOnce();
    expect(successfulSubscriber).toHaveBeenCalledOnce();
    expect(failingSubscriber).toHaveBeenCalledOnce();
    expect(manager.getSectionCacheMetrics().cachedSections).toBe(0);
    await manager.ensureTenantConfig('tenant-a');
    expect(tenantOverrideService.loadOverrides).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'Error notifying subscriber failing:',
      expect.any(Error)
    );
    expect(console.info).toHaveBeenCalledWith(
      '[ConfigManager] Cache updated from database change notification'
    );
  });

  it.each([new Error('bootstrap unavailable'), 'bootstrap unavailable'])(
    'keeps the cached config when processing a database change fails: %s',
    async failure => {
      const { bootstrapProvider, dbProvider, manager } = createManager();
      bootstrapProvider.loadConfiguration
        .mockResolvedValueOnce(createBootstrapConfig())
        .mockRejectedValueOnce(failure);
      dbProvider.isAvailable.mockResolvedValue(true);
      dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
      await manager.load();
      const previous = manager.getPlatformConfig();
      const handler = dbProvider.subscribe.mock.calls[0][0];

      await handler(createPersistedConfig());

      expect(manager.getPlatformConfig()).toBe(previous);
      expect(console.error).toHaveBeenCalledWith(
        '[ConfigManager] Failed to process database config change',
        { error: 'bootstrap unavailable' }
      );
    }
  );

  it('manages subscriber registration and removal', () => {
    const { manager } = createManager();
    const callback = vi.fn();

    manager.subscribe('one', callback);
    manager.subscribe('two', callback);
    expect(manager.getSubscribers()).toEqual(['one', 'two']);

    manager.unsubscribe('one');
    expect(manager.getSubscribers()).toEqual(['two']);
  });

  it('requires initialization before update, reload, and initial flush', async () => {
    const { manager } = createManager();

    await expect(manager.update({})).rejects.toThrow(
      'Configuration not initialized. Call load() first.'
    );
    await expect(manager.reload()).rejects.toThrow(
      'Configuration not initialized. Call load() first.'
    );
    await expect(manager.flushInitial()).rejects.toThrow(
      'Configuration not initialized. Call load() first.'
    );
  });

  it('rejects updates and initial flushes in development file mode', async () => {
    vi.stubEnv('USE_FILE_CONFIG', 'true');
    const { bootstrapProvider, fileProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
      })
    );
    fileProvider.isAvailable.mockResolvedValue(true);
    fileProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();

    await expect(manager.update({})).rejects.toThrow(
      'File configuration does not support updates'
    );
    await expect(manager.flushInitial()).rejects.toThrow(
      'File configuration does not support initial flush'
    );
  });

  it('rejects updates, reloads, and initial flushes when the database is unavailable', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValueOnce(true).mockResolvedValue(false);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();

    await expect(manager.update({})).rejects.toThrow(
      'Cannot update configuration: Database not available'
    );
    await expect(manager.reload()).rejects.toThrow(
      'Failed to reload configuration: Cannot reload configuration: Database not available'
    );
    await expect(manager.flushInitial()).rejects.toThrow(
      'Cannot flush initial configuration: Database not available'
    );
  });

  it('updates database config, invalidates caches, and broadcasts to other processes', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.updateConfig.mockResolvedValue(
      createPersistedConfig({ application: { title: 'Updated' } })
    );
    await manager.load();
    await manager.ensureTenantConfig('tenant-a');
    manager.getConfigSection('application');
    const subscriber = vi.fn();
    manager.subscribe('update-listener', subscriber);
    const pubsub = {
      isConnected: vi.fn().mockReturnValue(true),
      psubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    };
    manager.setPubSub(pubsub as never);

    const updated = await manager.update(
      { application: { title: 'Requested' } } as never,
      7
    );

    expect(dbProvider.updateConfig).toHaveBeenCalledWith(
      { application: { title: 'Requested' } },
      7
    );
    expect(updated.application.title).toBe('Updated');
    expect(subscriber).toHaveBeenCalledWith(updated);
    expect(manager.getSectionCacheMetrics().cachedSections).toBe(0);
    expect(mocks.buildRedisKey).toHaveBeenCalledWith(
      'persisted-prefix',
      'config',
      'invalidated'
    );
    expect(pubsub.publish).toHaveBeenCalledWith('tenant:config:key', {
      originId: 'manager-origin',
      timestamp: Date.now(),
      tenantId: '*',
    });
  });

  it('notifies runtime subscribers once when the database provider echoes a local update', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    const updatedPersistedConfig = createPersistedConfig({
      application: { title: 'Updated once' },
    });
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.updateConfig.mockImplementation(async () => {
      const providerSubscriber = dbProvider.subscribe.mock.calls[0][0];
      void providerSubscriber(
        updatedPersistedConfig,
        undefined,
        'local-update'
      );
      return updatedPersistedConfig;
    });
    await manager.load();
    const subscriber = vi.fn();
    manager.subscribe('update-listener', subscriber);

    const updated = await manager.update({
      application: { title: 'Updated once' },
    } as never);

    expect(updated.application.title).toBe('Updated once');
    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledWith(updated);
  });

  it('serializes concurrent database updates so each partial is applied in order', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());

    let releaseFirstUpdate!: () => void;
    const firstUpdateBlocked = new Promise<void>(resolve => {
      releaseFirstUpdate = resolve;
    });
    dbProvider.updateConfig
      .mockImplementationOnce(async () => {
        await firstUpdateBlocked;
        return createPersistedConfig({
          branding: { companyName: 'Parako', logoDark: null },
        });
      })
      .mockResolvedValueOnce(
        createPersistedConfig({
          branding: {
            companyName: 'Parako',
            logoDark: null,
            favicon: null,
          },
        })
      );
    await manager.load();

    const first = manager.update({
      branding: { logoDark: null },
    } as never);
    await vi.waitFor(() =>
      expect(dbProvider.updateConfig).toHaveBeenCalledTimes(1)
    );

    const second = manager.update({
      branding: { favicon: null },
    } as never);
    await Promise.resolve();

    const callsBeforeFirstCompleted = dbProvider.updateConfig.mock.calls.length;
    releaseFirstUpdate();
    await Promise.all([first, second]);

    expect(callsBeforeFirstCompleted).toBe(1);
    expect(dbProvider.updateConfig).toHaveBeenNthCalledWith(
      2,
      { branding: { favicon: null } },
      undefined
    );
  });

  it('does not fail an update when pubsub broadcasting fails', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.updateConfig.mockResolvedValue(createPersistedConfig());
    await manager.load();
    const publishError = new Error('redis offline');
    manager.setPubSub({
      isConnected: vi.fn().mockReturnValue(true),
      psubscribe: vi.fn(),
      publish: vi.fn().mockRejectedValue(publishError),
    } as never);

    await expect(manager.update({})).resolves.toBeDefined();
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        '[ConfigManager] Failed to broadcast config invalidation:',
        publishError
      );
    });
  });

  it('does not publish update invalidation while pubsub is disconnected', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.updateConfig.mockResolvedValue(createPersistedConfig());
    await manager.load();
    const pubsub = {
      isConnected: vi.fn().mockReturnValue(false),
      psubscribe: vi.fn(),
      publish: vi.fn(),
    };
    manager.setPubSub(pubsub as never);

    await manager.update({});

    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('uses the default Redis prefix when broadcasting an update', async () => {
    const configWithoutPrefix = createPersistedConfig({
      deployment: {
        url: 'https://persisted.example.test',
        server: { trust_proxy_hops: 1 },
      },
    });
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(configWithoutPrefix);
    dbProvider.updateConfig.mockResolvedValue(configWithoutPrefix);
    await manager.load();
    manager.setPubSub({
      isConnected: vi.fn().mockReturnValue(true),
      psubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    } as never);

    await manager.update({});

    expect(mocks.buildRedisKey).toHaveBeenCalledWith(
      'parako',
      'config',
      'invalidated'
    );
  });

  it.each([new Error('write failed'), 'write failed'])(
    'rolls back the cached config when update fails: %s',
    async failure => {
      const { bootstrapProvider, dbProvider, manager } = createManager();
      bootstrapProvider.loadConfiguration.mockResolvedValue(
        createBootstrapConfig()
      );
      dbProvider.isAvailable.mockResolvedValue(true);
      dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
      dbProvider.updateConfig.mockRejectedValue(failure);
      await manager.load();
      const previous = manager.getPlatformConfig();

      await expect(manager.update({})).rejects.toThrow(
        'Failed to update configuration: write failed'
      );
      expect(manager.getPlatformConfig()).toBe(previous);
    }
  );

  it('preserves typed version conflicts and the last-known-good cache', async () => {
    const conflict = new ConfigurationVersionConflictError(7, 8);
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.updateConfig.mockRejectedValue(conflict);
    await manager.load();
    const previous = manager.getPlatformConfig();

    await expect(manager.update({}, 7)).rejects.toBe(conflict);
    expect(manager.getPlatformConfig()).toBe(previous);
  });

  it('reloads from the active database provider and clears tenant config', async () => {
    const { bootstrapProvider, dbProvider, manager, tenantOverrideService } =
      createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.reloadConfiguration.mockResolvedValue(
      createPersistedConfig({ application: { title: 'Reloaded' } })
    );
    tenantOverrideService.loadOverrides.mockResolvedValue(null);
    await manager.load();
    await manager.ensureTenantConfig('tenant-a');

    const reloaded = await manager.reload();

    expect(reloaded.application.title).toBe('Reloaded');
    await manager.ensureTenantConfig('tenant-a');
    expect(tenantOverrideService.loadOverrides).toHaveBeenCalledTimes(2);
  });

  it('reloads from file in development file mode', async () => {
    vi.stubEnv('USE_FILE_CONFIG', 'true');
    const { bootstrapProvider, fileProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
      })
    );
    fileProvider.isAvailable.mockResolvedValue(true);
    fileProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    fileProvider.reloadConfiguration.mockResolvedValue(
      createPersistedConfig({ application: { title: 'File reloaded' } })
    );
    await manager.load();

    const reloaded = await manager.reload();

    expect(reloaded.application.title).toBe('File reloaded');
    expect(fileProvider.reloadConfiguration).toHaveBeenCalledOnce();
  });

  it('keeps the previous config when file reload becomes unavailable', async () => {
    vi.stubEnv('USE_FILE_CONFIG', 'true');
    const { bootstrapProvider, fileProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig({
        deployment: { environment: 'development', server: { port: 9007 } },
      })
    );
    fileProvider.isAvailable
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    fileProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();
    const previous = manager.getPlatformConfig();

    await expect(manager.reload()).rejects.toThrow(
      'Failed to reload configuration: Cannot reload configuration: File configuration not available'
    );
    expect(manager.getPlatformConfig()).toBe(previous);
  });

  it.each([new Error('read failed'), 'read failed'])(
    'keeps the previous config when provider reload fails: %s',
    async failure => {
      const { bootstrapProvider, dbProvider, manager } = createManager();
      bootstrapProvider.loadConfiguration.mockResolvedValue(
        createBootstrapConfig()
      );
      dbProvider.isAvailable.mockResolvedValue(true);
      dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
      dbProvider.reloadConfiguration.mockRejectedValue(failure);
      await manager.load();
      const previous = manager.getPlatformConfig();

      await expect(manager.reload()).rejects.toThrow(
        'Failed to reload configuration: read failed'
      );
      expect(manager.getPlatformConfig()).toBe(previous);
    }
  );

  it('flushes initial database config and notifies subscribers', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    dbProvider.flushInitial.mockResolvedValue(
      createPersistedConfig({ application: { title: 'Flushed' } })
    );
    await manager.load();
    const subscriber = vi.fn();
    manager.subscribe('flush-listener', subscriber);

    const flushed = await manager.flushInitial();

    expect(flushed.application.title).toBe('Flushed');
    expect(subscriber).toHaveBeenCalledWith(flushed);
  });

  it.each([new Error('flush failed'), 'flush failed'])(
    'normalizes initial flush failures: %s',
    async failure => {
      const { bootstrapProvider, dbProvider, manager } = createManager();
      bootstrapProvider.loadConfiguration.mockResolvedValue(
        createBootstrapConfig()
      );
      dbProvider.isAvailable.mockResolvedValue(true);
      dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
      dbProvider.flushInitial.mockRejectedValue(failure);
      await manager.load();

      await expect(manager.flushInitial()).rejects.toThrow(
        'Failed to flush initial configuration: flush failed'
      );
    }
  );

  it('subscribes to the tenant wildcard channel and ignores its own messages', async () => {
    const { manager } = createManager();
    const reload = vi.spyOn(manager, 'reload').mockResolvedValue({} as never);
    const pubsub = {
      psubscribe: vi.fn(),
    };

    manager.setPubSub(pubsub as never);
    expect(pubsub.psubscribe).toHaveBeenCalledWith(
      'parako:*:config:invalidated',
      expect.any(Function)
    );
    const handler = pubsub.psubscribe.mock.calls[0][1];
    handler({ originId: 'manager-origin', tenantId: '*' });
    await Promise.resolve();

    expect(reload).not.toHaveBeenCalled();
  });

  it('broadcasts a tenant-only invalidation on the explicit tenant channel', async () => {
    const { bootstrapProvider, dbProvider, manager } = createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();
    const pubsub = {
      isConnected: vi.fn().mockReturnValue(true),
      psubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    };
    manager.setPubSub(pubsub as never);

    manager.invalidateTenantConfig('tenant-a', { broadcast: true });

    expect(mocks.buildRedisKeyForTenant).toHaveBeenCalledWith(
      'persisted-prefix',
      'tenant-a',
      'config',
      'invalidated'
    );
    expect(pubsub.publish).toHaveBeenCalledWith('tenant-a:config:key', {
      originId: 'manager-origin',
      timestamp: Date.now(),
      tenantId: 'tenant-a',
    });
  });

  it.each([new Error('redis offline'), 'redis offline'])(
    'logs tenant invalidation broadcast failures without rejecting: %s',
    async failure => {
      const configWithoutPrefix = createPersistedConfig({
        deployment: {
          url: 'https://persisted.example.test',
          server: { trust_proxy_hops: 1 },
        },
      });
      const { bootstrapProvider, dbProvider, logger, manager } =
        createManager();
      bootstrapProvider.loadConfiguration.mockResolvedValue(
        createBootstrapConfig()
      );
      dbProvider.isAvailable.mockResolvedValue(true);
      dbProvider.loadConfiguration.mockResolvedValue(configWithoutPrefix);
      await manager.load();
      const pubsub = {
        isConnected: vi.fn().mockReturnValue(true),
        psubscribe: vi.fn(),
        publish: vi.fn().mockRejectedValue(failure),
      };
      manager.setPubSub(pubsub as never);

      await expect(
        manager.invalidateTenantConfig('tenant-a', { broadcast: true })
      ).resolves.toBeUndefined();

      expect(mocks.buildRedisKeyForTenant).toHaveBeenCalledWith(
        'parako',
        'tenant-a',
        'config',
        'invalidated'
      );
      expect(logger.error).toHaveBeenCalledWith(
        failure instanceof Error
          ? failure
          : expect.objectContaining({ message: failure }),
        {
          context: 'tenant_config_invalidation_broadcast_failed',
          tenantId: 'tenant-a',
        }
      );
    }
  );

  it('replaces an existing tenant invalidation subscription', () => {
    const { manager } = createManager();
    const firstPubSub = {
      psubscribe: vi.fn(),
      punsubscribe: vi.fn(),
    };
    const secondPubSub = {
      psubscribe: vi.fn(),
    };

    manager.setPubSub(firstPubSub as never);
    const [pattern, handler] = firstPubSub.psubscribe.mock.calls[0];
    manager.setPubSub(secondPubSub as never);

    expect(firstPubSub.punsubscribe).toHaveBeenCalledWith(pattern, handler);
    expect(secondPubSub.psubscribe).toHaveBeenCalledWith(
      pattern,
      expect.any(Function)
    );
  });

  it('evicts only the addressed tenant for an external tenant invalidation', async () => {
    const { manager } = createManager();
    const reload = vi.spyOn(manager, 'reload').mockResolvedValue({} as never);
    const invalidate = vi.spyOn(manager, 'invalidateTenantConfig');
    const pubsub = { psubscribe: vi.fn() };
    manager.setPubSub(pubsub as never);
    const handler = pubsub.psubscribe.mock.calls[0][1];

    handler({ originId: 'other-process', tenantId: 'tenant-a' });
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledWith('tenant-a');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads on external pubsub invalidation and logs reload failures', async () => {
    const { manager } = createManager();
    const reloadError = new Error('reload unavailable');
    const reload = vi.spyOn(manager, 'reload').mockRejectedValue(reloadError);
    const pubsub = { psubscribe: vi.fn() };
    manager.setPubSub(pubsub as never);
    const handler = pubsub.psubscribe.mock.calls[0][1];

    handler({ originId: 'other-process' });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(console.error).toHaveBeenCalledWith(
      '[ConfigManager] Cross-process config reload failed',
      reloadError
    );
  });

  it('cleans up providers, subscriptions, caches, and loaded state', async () => {
    const { bootstrapProvider, dbProvider, fileProvider, manager } =
      createManager();
    bootstrapProvider.loadConfiguration.mockResolvedValue(
      createBootstrapConfig()
    );
    dbProvider.isAvailable.mockResolvedValue(true);
    dbProvider.loadConfiguration.mockResolvedValue(createPersistedConfig());
    await manager.load();
    manager.subscribe('listener', vi.fn());
    manager.getConfigSection('application');
    const changeHandler = dbProvider.subscribe.mock.calls[0][0];

    manager.cleanup();

    expect(dbProvider.unsubscribe).toHaveBeenCalledWith(changeHandler);
    expect(dbProvider.cleanup).toHaveBeenCalledOnce();
    expect(fileProvider.cleanup).toHaveBeenCalledOnce();
    expect(bootstrapProvider.clearCache).toHaveBeenCalledOnce();
    expect(manager.getSubscribers()).toEqual([]);
    expect(manager.getSectionCacheMetrics().cachedSections).toBe(0);
    expect(manager.isLoaded()).toBe(false);
  });

  it('detaches its config invalidation handler during cleanup', () => {
    const { manager } = createManager();
    const pubsub = {
      psubscribe: vi.fn(),
      punsubscribe: vi.fn(),
    };
    manager.setPubSub(pubsub as never);
    const [pattern, handler] = pubsub.psubscribe.mock.calls[0];

    manager.cleanup();

    expect(pubsub.punsubscribe).toHaveBeenCalledWith(pattern, handler);
  });

  it('handles a tenant config request before global configuration is loaded', async () => {
    const { logger, manager, tenantOverrideService } = createManager();

    await expect(
      manager.ensureTenantConfig('tenant-a')
    ).resolves.toBeUndefined();

    expect(tenantOverrideService.loadOverrides).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'load_tenant_config',
      tenantId: 'tenant-a',
    });
  });
});
