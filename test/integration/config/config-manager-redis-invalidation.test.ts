import { randomUUID } from 'node:crypto';
import { BootstrapEnvironment } from '../../../src/config/bootstrap-environment.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvePostgresqlTestUrl } from '../../../scripts/testing/postgresql-test-url.js';
import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { ConfigManager } from '../../../src/config/index.js';
import { DatabaseConfigProvider } from '../../../src/config/provider/db-provider.js';
import type {
  BootstrapConfig,
  RuntimeConfig,
} from '../../../src/config/types.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { RedisPubSubService } from '../../../src/services/redis-pubsub.service.js';
import { SettingsService } from '../../../src/services/settings.service.js';
import { TenantSettingsOverrideService } from '../../../src/services/tenant-settings-override.service.js';
import {
  createSettingsRepositoryHarness,
  type ContractStorageAdapter,
} from '../../contract/support/settings-repository-harness.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/0';
// gitleaks:allow -- deterministic encryption key for disposable integration data.
const TEST_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

function createLogger(): ILogger {
  return {
    child: vi.fn().mockReturnThis(),
    debug: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    getLogger: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as ILogger;
}

function createPersistedConfig(redisPrefix: string): RuntimeConfig {
  return {
    application: { title: 'Platform' },
    branding: {},
    deployment: {
      environment: 'test',
      redis_prefix: redisPrefix,
      server: { port: 9007 },
      url: 'https://id.example.test',
    },
    features: {
      multi_tenancy: {
        enabled: true,
        extraction_priority: ['header'],
        tenant_header: 'x-tenant-id',
      },
    },
    integrations: {},
    notifications: {},
    oidc: { path: '/oidc/v1' },
    oidc_storage: {},
    security: {},
    storage: { adapter: 'mongodb' },
  } as unknown as RuntimeConfig;
}

function createManager(
  redisPrefix: string,
  overrideService: TenantSettingsOverrideService
): ConfigManager {
  const persistedConfig = createPersistedConfig(redisPrefix);
  const bootstrapProvider = {
    clearCache: vi.fn(),
    loadConfiguration: vi.fn().mockResolvedValue({
      deployment: {
        environment: 'test',
        server: { port: 9007 },
        url: 'https://id.example.test',
      },
      integrations: { file_storage: { provider: 'local' } },
      multiTenancy: {
        enabled: true,
        extraction_priority: ['header'],
        tenant_header: 'x-tenant-id',
      },
      storage: { adapter: 'mongodb' },
    }),
  };
  const dbProvider = {
    initialize: vi.fn(),
    cleanup: vi.fn(),
    clearCache: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(true),
    loadConfiguration: vi.fn().mockResolvedValue(persistedConfig),
    reloadConfiguration: vi.fn().mockResolvedValue(persistedConfig),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  const fileProvider = {
    cleanup: vi.fn(),
    clearCache: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(false),
  };

  return new ConfigManager(
    bootstrapProvider as never,
    dbProvider as never,
    fileProvider as never,
    {} as never,
    createLogger(),
    overrideService
  );
}

function selectedAdapter(): Exclude<ContractStorageAdapter, 'sqlite'> {
  return process.env.CONFIG_INVALIDATION_STORAGE_ADAPTER === 'postgresql'
    ? 'postgresql'
    : 'mongodb';
}

function globalReloadAdapters(): ContractStorageAdapter[] {
  return process.env.CONFIG_INVALIDATION_STORAGE_ADAPTER === 'postgresql'
    ? ['postgresql']
    : ['sqlite', 'mongodb'];
}

function createBootstrapConfig(
  adapter: ContractStorageAdapter
): BootstrapConfig {
  const storage: BootstrapConfig['storage'] = { adapter };
  if (adapter === 'mongodb') {
    storage.mongodb = {
      uri:
        process.env.CONTRACT_MONGODB_URI ??
        process.env.STORAGE_MONGODB_URI ??
        'mongodb://127.0.0.1:27017/parako_config_integration',
    };
  } else if (adapter === 'postgresql') {
    const url = resolvePostgresqlTestUrl(process.env);
    if (!url) {
      throw new Error(
        'CONTRACT_DATABASE_URL, STORAGE_POSTGRESQL_URL, or PARAKO_E2E_POSTGRESQL_URL is required for PostgreSQL config integration'
      );
    }
    storage.postgresql = { url };
  } else {
    storage.sqlite = { path: './runtime/data/config-integration.db' };
  }

  return {
    deployment: {
      environment: 'development',
      server: { port: 9007 },
      url: 'https://id.example.test',
    },
    integrations: { file_storage: { provider: 'local' } },
    multiTenancy: {
      enabled: adapter !== 'sqlite',
      extraction_priority: ['header'],
      tenant_header: 'x-tenant-id',
      provider_pool: {
        cleanup_interval_ms: 60_000,
        idle_ttl_ms: 1_800_000,
        max_size: 50,
      },
    },
    redis: { database: 0, host: '127.0.0.1', port: 6379 },
    storage,
  };
}

function createDatabaseManager(
  adapter: ContractStorageAdapter,
  settingsService: SettingsService,
  overrideService: TenantSettingsOverrideService
): ConfigManager {
  const bootstrapConfig = createBootstrapConfig(adapter);
  const bootstrapProvider = {
    clearCache: vi.fn(),
    getConfigValue: vi.fn((path: string, fallback: unknown) =>
      path === 'storage.adapter' ? adapter : fallback
    ),
    loadConfiguration: vi.fn().mockResolvedValue(bootstrapConfig),
  };
  const dbProvider = new DatabaseConfigProvider(
    settingsService,
    bootstrapProvider as never
  );
  const fileProvider = {
    cleanup: vi.fn(),
    clearCache: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(false),
  };

  return new ConfigManager(
    bootstrapProvider as never,
    dbProvider,
    fileProvider as never,
    settingsService,
    createLogger(),
    overrideService
  );
}

describe('ConfigManager Redis invalidation integration', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    try {
      for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('propagates one real tenant override without evicting a sibling tenant', async () => {
    const adapter = selectedAdapter();
    const harness = await createSettingsRepositoryHarness(adapter);
    const prefix = `parako-config-integration-${randomUUID()}`;
    const suffix = randomUUID().slice(0, 8);
    const acmeTenant = `config-acme-${suffix}`;
    const globexTenant = `config-globex-${suffix}`;
    const overrideService = new TenantSettingsOverrideService(
      harness.tenantRepository,
      createLogger()
    );
    const loadOverrides = vi.spyOn(overrideService, 'loadOverrides');
    const firstManager = createManager(prefix, overrideService);
    const secondManager = createManager(prefix, overrideService);
    const firstBus = new RedisPubSubService(createLogger());
    const secondBus = new RedisPubSubService(createLogger());
    cleanups.push(
      async () => {
        await harness.cleanupTenantSettings([acmeTenant, globexTenant]);
        await harness.close();
      },
      () => firstBus.disconnect(),
      () => secondBus.disconnect(),
      () => firstManager.cleanup(),
      () => secondManager.cleanup()
    );

    await harness.cleanupTenantSettings([acmeTenant, globexTenant]);
    await overrideService.saveOverrides(acmeTenant, {
      application: { title: 'Acme before' },
    });
    await overrideService.saveOverrides(globexTenant, {
      application: { title: 'Globex' },
    });

    await Promise.all([firstManager.load(), secondManager.load()]);
    firstManager.setPubSub(firstBus);
    secondManager.setPubSub(secondBus);
    await Promise.all([
      firstBus.connect(REDIS_URL),
      secondBus.connect(REDIS_URL),
    ]);
    expect(firstBus.isConnected()).toBe(true);
    expect(secondBus.isConnected()).toBe(true);

    await secondManager.ensureTenantConfig(acmeTenant);
    await secondManager.ensureTenantConfig(globexTenant);
    const globexLoadsBefore = loadOverrides.mock.calls.filter(
      ([tenantId]) => tenantId === globexTenant
    ).length;
    expect(
      tenantContext.run(
        acmeTenant,
        () => secondManager.getConfig().application.title
      )
    ).toBe('Acme before');

    await overrideService.saveOverrides(acmeTenant, {
      application: { title: 'Acme after' },
    });
    await firstManager.invalidateTenantConfig(acmeTenant, {
      broadcast: true,
    });

    await vi.waitFor(
      async () => {
        await secondManager.ensureTenantConfig(acmeTenant);
        expect(
          tenantContext.run(
            acmeTenant,
            () => secondManager.getConfig().application.title
          )
        ).toBe('Acme after');
      },
      { timeout: 2_000, interval: 10 }
    );

    await secondManager.ensureTenantConfig(globexTenant);
    expect(
      loadOverrides.mock.calls.filter(([tenantId]) => tenantId === globexTenant)
        .length
    ).toBe(globexLoadsBefore);
    expect(
      tenantContext.run(
        globexTenant,
        () => secondManager.getConfig().application.title
      )
    ).toBe('Globex');
  });

  it.each(globalReloadAdapters())(
    'reloads a persisted global update in another %s-backed process',
    async adapter => {
      vi.stubEnv('ENCRYPTION_KEY', TEST_ENCRYPTION_KEY);
      const harness = await createSettingsRepositoryHarness(adapter);
      const prefix = `parako-global-config-${randomUUID()}`;
      const tenantId = `config-tenant-${randomUUID().slice(0, 8)}`;
      const hasTenantCache = adapter !== 'sqlite';
      const firstSettings = new SettingsService(
        createLogger(),
        harness.repository,
        new BootstrapEnvironment()
      );
      const secondSettings = new SettingsService(
        createLogger(),
        harness.repository,
        new BootstrapEnvironment()
      );
      const firstOverrides = new TenantSettingsOverrideService(
        harness.tenantRepository,
        createLogger()
      );
      const secondOverrides = new TenantSettingsOverrideService(
        harness.tenantRepository,
        createLogger()
      );
      const firstManager = createDatabaseManager(
        adapter,
        firstSettings,
        firstOverrides
      );
      const secondManager = createDatabaseManager(
        adapter,
        secondSettings,
        secondOverrides
      );
      const firstBus = new RedisPubSubService(createLogger());
      const secondBus = new RedisPubSubService(createLogger());
      cleanups.push(
        async () => {
          if (hasTenantCache) {
            await harness.cleanupTenantSettings([tenantId]);
          }
          await harness.cleanup(SettingsService.MAIN_CONFIG_KEY);
          await harness.close();
        },
        () => firstBus.disconnect(),
        () => secondBus.disconnect(),
        () => firstManager.cleanup(),
        () => secondManager.cleanup()
      );

      await harness.cleanup(SettingsService.MAIN_CONFIG_KEY);
      if (hasTenantCache) {
        await harness.cleanupTenantSettings([tenantId]);
      }
      const initialConfig = getDefaultFullConfig();
      initialConfig.application.title = 'Global before';
      initialConfig.deployment.redis_prefix = prefix;
      await firstSettings.saveMainConfigurationWithTransaction(
        initialConfig,
        'config-integration',
        'Seed cross-process reload test'
      );

      await Promise.all([firstManager.load(), secondManager.load()]);
      firstManager.setPubSub(firstBus);
      secondManager.setPubSub(secondBus);
      await Promise.all([
        firstBus.connect(REDIS_URL),
        secondBus.connect(REDIS_URL),
      ]);
      expect(firstBus.isConnected()).toBe(true);
      expect(secondBus.isConnected()).toBe(true);
      if (hasTenantCache) {
        await secondManager.ensureTenantConfig(tenantId);
      }
      expect(secondManager.getPlatformConfig().application.title).toBe(
        'Global before'
      );
      if (hasTenantCache) {
        expect(
          tenantContext.run(
            tenantId,
            () => secondManager.getConfig().application.title
          )
        ).toBe('Global before');
      }

      const secondProcessSubscriber = vi.fn();
      secondManager.subscribe(
        'global-update-evidence',
        secondProcessSubscriber
      );
      const updated = await firstManager.update({
        application: { title: 'Global after' },
      } as never);
      expect(updated.application.title).toBe('Global after');

      await vi.waitFor(
        () => {
          expect(secondManager.getPlatformConfig().application.title).toBe(
            'Global after'
          );
          expect(secondProcessSubscriber).toHaveBeenCalled();
        },
        { timeout: 2_000, interval: 10 }
      );

      if (hasTenantCache) {
        await secondManager.ensureTenantConfig(tenantId);
        expect(
          tenantContext.run(
            tenantId,
            () => secondManager.getConfig().application.title
          )
        ).toBe('Global after');
      }
    }
  );
});
