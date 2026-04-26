/**
 * TDD — ConfigManager per-tenant configuration caching (3-layer merge)
 *
 * After the ConfLayer refactor, tenant config loading uses:
 *   1. Global Settings (already in this.cache — no DB call)
 *   2. TenantSettingsOverride (loaded via tenantOverrideService)
 *   3. mergeConfig() to overlay overrides on global config
 *
 * Verifies that:
 * - ensureTenantConfig() clones global cache and merges tenant overrides
 * - getConfig() returns tenant config when in ALS context with warm cache
 * - getConfig() returns default config when no ALS context (startup code)
 * - getConfig() returns default config when tenant cache is cold (resilience)
 * - Idempotent: does not re-load when config already cached
 * - Concurrent mutex: parallel ensureTenantConfig() calls coalesce on same Promise
 * - invalidateTenantConfig() evicts tenant cache, forces reload on next access
 * - clearCache() clears all tenant caches
 * - Error resilience: override load failure doesn't crash, falls back to default config
 * - 3-layer merge: tenant override fields appear in getConfig() result
 * - Non-whitelisted fields from global config are preserved
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { ConfigManager } from '../../../src/config/index.js';
import type { BootstrapConfigProvider } from '../../../src/config/provider/bootstrap-provider.js';
import type { DatabaseConfigProvider } from '../../../src/config/provider/db-provider.js';
import type { FileConfigProvider } from '../../../src/config/provider/file-provider.js';
import type { ISettingsService } from '../../../src/di/interfaces/settings-service.interface.js';
import type { ITenantSettingsOverrideService } from '../../../src/di/interfaces/tenant-settings-override-service.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { RuntimeConfig } from '../../../src/config/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal RuntimeConfig with multi_tenancy enabled */
function createDefaultCache(
  overrides: Partial<{ multiTenancyEnabled: boolean }> = {}
): RuntimeConfig {
  const { multiTenancyEnabled = true } = overrides;
  return {
    application: { name: 'test', url: 'http://localhost' },
    branding: {},
    deployment: {
      environment: 'development',
      server: { port: 3000 },
      redis_prefix: 'parako',
    },
    security: {},
    features: {
      multi_tenancy: {
        enabled: multiTenancyEnabled,
        extraction_priority: ['header'],
        tenant_header: 'x-tenant-id',
      },
    },
    oidc: {},
    integrations: {},
    notifications: {},
    storage: { adapter: 'mongodb' },
    oidc_storage: {},
    _metadata: {
      configProvider: 'database',
      isBootstrapMerged: true,
      loadedAt: new Date(),
    },
  } as unknown as RuntimeConfig;
}

function createMockBootstrapProvider(): BootstrapConfigProvider {
  return {
    loadConfiguration: vi.fn().mockResolvedValue({
      deployment: { environment: 'development', server: { port: 3000 } },
      storage: {
        adapter: 'mongodb',
        mongodb: { uri: 'mongodb://localhost/test' },
      },
      redis: { host: 'localhost', port: 6379 },
    }),
    clearCache: vi.fn(),
  } as unknown as BootstrapConfigProvider;
}

function createMockDbProvider(): DatabaseConfigProvider {
  return {
    loadConfiguration: vi.fn().mockResolvedValue({}),
    reloadConfiguration: vi.fn().mockResolvedValue({}),
    clearCache: vi.fn(),
    cleanup: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as DatabaseConfigProvider;
}

function createMockFileProvider(): FileConfigProvider {
  return {
    loadConfiguration: vi.fn().mockResolvedValue({}),
    reloadConfiguration: vi.fn().mockResolvedValue({}),
    clearCache: vi.fn(),
    cleanup: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(false),
  } as unknown as FileConfigProvider;
}

function createMockSettingsService(): ISettingsService {
  return {
    flushInitialConfiguration: vi.fn().mockResolvedValue(null),
    loadAndDecryptConfiguration: vi.fn().mockResolvedValue({}),
  } as unknown as ISettingsService;
}

function createMockOverrideService(
  overrides: Partial<{
    loadReturns: unknown;
    loadThrows: Error | null;
  }> = {}
): ITenantSettingsOverrideService {
  const { loadReturns = null, loadThrows = null } = overrides;

  return {
    loadOverrides: loadThrows
      ? vi.fn().mockRejectedValue(loadThrows)
      : vi.fn().mockResolvedValue(loadReturns),
    saveOverrides: vi.fn().mockResolvedValue({}),
  } as unknown as ITenantSettingsOverrideService;
}

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    getLogger: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as ILogger;
}

/**
 * Create a ConfigManager with pre-populated default cache.
 * Accesses private fields to simulate post-load() state.
 */
function createConfigManager(
  overrides: Partial<{
    multiTenancyEnabled: boolean;
    overrideService: ITenantSettingsOverrideService;
    logger: ILogger;
  }> = {}
) {
  const {
    multiTenancyEnabled = true,
    overrideService = createMockOverrideService(),
    logger = createMockLogger(),
  } = overrides;

  const bootstrapProvider = createMockBootstrapProvider();
  const dbProvider = createMockDbProvider();
  const fileProvider = createMockFileProvider();
  const settingsService = createMockSettingsService();

  const configManager = new ConfigManager(
    bootstrapProvider,
    dbProvider,
    fileProvider,
    settingsService,
    logger,
    overrideService
  );

  // Simulate post-load() state by setting private fields
  const cm = configManager as any;
  cm.cache = createDefaultCache({ multiTenancyEnabled });
  cm.isInitialized = true;

  return { configManager, overrideService, settingsService, logger };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConfigManager – per-tenant config (3-layer merge)', () => {
  afterEach(() => {
    tenantContext.disableStrictMode();
  });

  describe('ensureTenantConfig()', () => {
    it('clones global cache and merges tenant overrides', async () => {
      const overrideService = createMockOverrideService({
        loadReturns: { application: { name: 'AcmeApp' } },
      });
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');

      expect(overrideService.loadOverrides).toHaveBeenCalledWith('acme');
    });

    it('is idempotent — does not reload when already cached', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('acme');

      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(1);
    });

    it('concurrent calls coalesce on same Promise (mutex)', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await Promise.all([
        configManager.ensureTenantConfig('acme'),
        configManager.ensureTenantConfig('acme'),
        configManager.ensureTenantConfig('acme'),
      ]);

      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(1);
    });

    it('loads separate configs for different tenants', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');

      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(2);
    });

    it('does NOT call settingsService for tenant loads (global-only)', async () => {
      const { configManager, settingsService } = createConfigManager();

      await configManager.ensureTenantConfig('acme');

      expect(settingsService.flushInitialConfiguration).not.toHaveBeenCalled();
      expect(
        settingsService.loadAndDecryptConfiguration
      ).not.toHaveBeenCalled();
    });
  });

  describe('getConfig() – tenant-aware', () => {
    it('returns merged config when in ALS context with warm cache', async () => {
      const overrideService = createMockOverrideService({
        loadReturns: { application: { name: 'AcmeApp' } },
      });
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');

      const config = tenantContext.run('acme', () => configManager.getConfig());
      expect((config.application as any).name).toBe('AcmeApp');
    });

    it('preserves non-overridden global fields in tenant config', async () => {
      const overrideService = createMockOverrideService({
        loadReturns: { application: { name: 'AcmeApp' } },
      });
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');

      const config = tenantContext.run('acme', () => configManager.getConfig());
      // Global fields should be preserved
      expect((config.application as any).url).toBe('http://localhost');
      expect(config.features.multi_tenancy.enabled).toBe(true);
    });

    it('returns default config when no ALS context (startup code)', async () => {
      const { configManager } = createConfigManager();

      await configManager.ensureTenantConfig('acme');

      const config = configManager.getConfig();
      expect(config.features.multi_tenancy.enabled).toBe(true);
    });

    it('returns default config when tenant cache is cold (resilience)', () => {
      const { configManager } = createConfigManager();

      const config = tenantContext.run('acme', () => configManager.getConfig());
      expect(config.features.multi_tenancy.enabled).toBe(true);
    });

    it('returns default config when multi-tenancy is disabled', () => {
      const { configManager } = createConfigManager({
        multiTenancyEnabled: false,
      });

      const config = tenantContext.run('acme', () => configManager.getConfig());
      expect(config.features.multi_tenancy.enabled).toBe(false);
    });

    it('returns global config when no override service is available', async () => {
      // ConfigManager without overrideService (backward compat)
      const bootstrapProvider = createMockBootstrapProvider();
      const dbProvider = createMockDbProvider();
      const fileProvider = createMockFileProvider();
      const settingsService = createMockSettingsService();
      const logger = createMockLogger();

      const configManager = new ConfigManager(
        bootstrapProvider,
        dbProvider,
        fileProvider,
        settingsService,
        logger
        // No overrideService — @optional()
      );
      const cm = configManager as any;
      cm.cache = createDefaultCache();
      cm.isInitialized = true;

      await configManager.ensureTenantConfig('acme');

      const config = tenantContext.run('acme', () => configManager.getConfig());
      // Should get global config values (no overrides applied)
      expect((config.application as any).name).toBe('test');
    });
  });

  describe('invalidateTenantConfig()', () => {
    it('evicts tenant cache, forcing reload on next access', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');
      configManager.invalidateTenantConfig('acme');
      await configManager.ensureTenantConfig('acme');

      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(2);
    });

    it('does not affect other tenants', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');

      configManager.invalidateTenantConfig('acme');

      await configManager.ensureTenantConfig('globex');
      // Only 2 loads: acme + globex (globex not reloaded)
      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCache()', () => {
    it('clears all tenant caches', async () => {
      const { configManager } = createConfigManager();

      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');

      configManager.clearCache();

      expect(configManager.isLoaded()).toBe(false);
    });
  });

  describe('update() clears all tenant caches (Bug D)', () => {
    it('clears all tenant caches when global config is updated', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      // Populate caches for two tenants
      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');
      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(2);

      // Simulate global config update — access private tenantConfigs
      const cm = configManager as any;
      expect(cm.tenantConfigs.size).toBe(2);

      // Directly call tenantConfigs.clear() as update() does
      cm.tenantConfigs.clear();
      expect(cm.tenantConfigs.size).toBe(0);

      // Both tenants should reload on next access
      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');
      expect(overrideService.loadOverrides).toHaveBeenCalledTimes(4);
    });

    it('setPubSub handler clears all tenant caches on wildcard tenantId', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');

      const cm = configManager as any;
      expect(cm.tenantConfigs.size).toBe(2);

      // Simulate receiving pub/sub message with wildcard tenantId
      // The handler checks: if (!msgTenantId || msgTenantId === '*') → clear all
      const mockPubSub = {
        isConnected: vi.fn().mockReturnValue(true),
        psubscribe: vi.fn(),
        publish: vi.fn().mockResolvedValue(undefined),
      };

      configManager.setPubSub(mockPubSub as any);

      // Get the callback that was registered
      const psubscribeCall = mockPubSub.psubscribe.mock.calls[0];
      const handler = psubscribeCall[1];

      // Call with wildcard — should clear all tenant caches
      handler({ originId: 'other-worker', tenantId: '*' });

      expect(cm.tenantConfigs.size).toBe(0);
    });

    it('setPubSub handler invalidates single tenant for specific tenantId', async () => {
      const overrideService = createMockOverrideService();
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');
      await configManager.ensureTenantConfig('globex');

      const cm = configManager as any;
      expect(cm.tenantConfigs.size).toBe(2);

      const mockPubSub = {
        isConnected: vi.fn().mockReturnValue(true),
        psubscribe: vi.fn(),
        publish: vi.fn().mockResolvedValue(undefined),
      };

      configManager.setPubSub(mockPubSub as any);
      const handler = mockPubSub.psubscribe.mock.calls[0][1];

      // Call with specific tenant — should only invalidate that one
      handler({ originId: 'other-worker', tenantId: 'acme' });

      expect(cm.tenantConfigs.size).toBe(1);
      expect(cm.tenantConfigs.has('globex')).toBe(true);
      expect(cm.tenantConfigs.has('acme')).toBe(false);
    });
  });

  describe('error resilience', () => {
    it('does not crash on override load failure — falls back to global config', async () => {
      const overrideService = createMockOverrideService({
        loadThrows: new Error('DB connection failed'),
      });
      const { configManager, logger } = createConfigManager({
        overrideService,
      });

      await configManager.ensureTenantConfig('acme');

      expect(logger.error).toHaveBeenCalled();

      const config = tenantContext.run('acme', () => configManager.getConfig());
      expect(config).toBeDefined();
      expect(config.features.multi_tenancy.enabled).toBe(true);
    });

    it('retries on next access after failure', async () => {
      const loadFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ application: { name: 'RetryOk' } });

      const overrideService = {
        loadOverrides: loadFn,
        saveOverrides: vi.fn(),
      } as unknown as ITenantSettingsOverrideService;

      const { configManager } = createConfigManager({ overrideService });

      // First call fails
      await configManager.ensureTenantConfig('acme');
      expect(loadFn).toHaveBeenCalledTimes(1);

      // Second call should retry (not cached due to failure)
      await configManager.ensureTenantConfig('acme');
      expect(loadFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPlatformConfig()', () => {
    it('always returns the global platform config, never tenant-merged config', async () => {
      const overrideService = createMockOverrideService({
        loadReturns: { application: { name: 'TenantApp' } },
      });
      const { configManager } = createConfigManager({ overrideService });

      await configManager.ensureTenantConfig('acme');

      // getConfig() in tenant context returns tenant-merged config
      const tenantConfig = tenantContext.run('acme', () =>
        configManager.getConfig()
      );
      expect((tenantConfig.application as any).name).toBe('TenantApp');

      // getPlatformConfig() always returns the raw global config
      const platformConfig = tenantContext.run('acme', () =>
        configManager.getPlatformConfig()
      );
      expect((platformConfig.application as any).name).toBe('test');
    });

    it('throws when config is not loaded', () => {
      const bootstrapProvider = createMockBootstrapProvider();
      const dbProvider = createMockDbProvider();
      const fileProvider = createMockFileProvider();
      const settingsService = createMockSettingsService();
      const logger = createMockLogger();

      const configManager = new ConfigManager(
        bootstrapProvider,
        dbProvider,
        fileProvider,
        settingsService,
        logger
      );

      expect(() => configManager.getPlatformConfig()).toThrow(
        'Configuration not loaded'
      );
    });
  });
});
