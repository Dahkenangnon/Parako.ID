import { injectable, inject, optional } from 'inversify';
import { randomUUID } from 'node:crypto';
import { AppConfigSchema, type AppConfig } from './schemas/schema.js';
import { type RuntimeConfig, type BootstrapConfig } from './types.js';
import { BootstrapConfigProvider } from './provider/bootstrap-provider.js';
import { DatabaseConfigProvider } from './provider/db-provider.js';
import { FileConfigProvider } from './provider/file-provider.js';
import { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IRedisPubSubService } from '../di/interfaces/redis-pubsub-service.interface.js';
import type { ISettingsService } from '../di/interfaces/settings-service.interface.js';
import type { ITenantSettingsOverrideService } from '../di/interfaces/tenant-settings-override-service.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import { TYPES } from '../di/types.js';
import { applyComputedDefaults } from './computed-fields.js';
import { getDefaultFullConfig } from './constants.js';
import { mergeConfig } from '../utils/config-merge.js';
import { buildRedisKey } from '../multi-tenancy/redis-key.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';

/**
 * Build the oidc_storage config section entirely from bootstrap env vars.
 * This is a computed section — never persisted to DB or file.
 *
 * Adapter types:
 * - mongodb: uses STORAGE_MONGODB_URI, extracts database name from URI
 * - redis: uses REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DATABASE
 * - sqlite: only type matters, PrismaClient handles connection via STORAGE_SQLITE_PATH
 * - postgresql: only type matters, PrismaClient handles connection via STORAGE_POSTGRESQL_URL
 */
function buildOidcStorageFromBootstrap(
  bootstrap: BootstrapConfig
): AppConfig['oidc_storage'] {
  const adapter = bootstrap.oidcStorage?.adapter ?? bootstrap.storage.adapter;
  const mongoUri =
    bootstrap.storage.mongodb?.uri ?? 'mongodb://localhost:27017';
  const mongoDb = mongoUri.split('/').pop()?.split('?')[0] || 'parako-id-dev';
  const redis = bootstrap.redis;

  return {
    oidc_adapter: {
      type: adapter,
      mongodb: {
        uri: mongoUri,
        database: mongoDb,
      },
      redis: {
        host: redis?.host ?? 'localhost',
        port: redis?.port ?? 6379,
        password: redis?.password,
        database: redis?.database ?? 0,
      },
    },
  };
}

/**
 * Configuration Manager
 * Manages configuration loading with a 3-source strategy:
 * 1. Bootstrap configuration (always loaded first)
 * 2. File configuration (when USE_FILE_CONFIG=true in development)
 * 3. Database configuration (production default, single source of truth)
 * Implements production-ready caching with automatic cache invalidation
 */
@injectable()
export class ConfigManager implements IConfigManager {
  private cache: RuntimeConfig | null = null;
  private subscribers: Map<
    string,
    (config: RuntimeConfig) => void | Promise<void>
  > = new Map();
  private bootstrapProvider: BootstrapConfigProvider;
  private dbProvider: DatabaseConfigProvider;
  private fileProvider: FileConfigProvider;
  private isInitialized = false;

  // Redis Pub/Sub for cross-process invalidation
  private pubsub: IRedisPubSubService | null = null;
  private readonly originId = randomUUID();

  // Section-based caching for lazy loading
  private sectionCache: Map<string, { data: unknown; timestamp: number }> =
    new Map();
  private readonly SECTION_CACHE_TTL = 60000; // 60 seconds

  private metrics = {
    sectionCacheHits: 0,
    sectionCacheMisses: 0,
    sectionAccessCount: new Map<string, number>(),
  };

  private dbProviderChangeHandler: (
    config: AppConfig | null,
    error?: Error
  ) => void;

  /** Per-tenant RuntimeConfig cache. Entries auto-invalidated on config change. */
  private readonly tenantConfigs = new Map<string, RuntimeConfig>();

  /**
   * Per-tenant loading mutex. Prevents duplicate DB loads when concurrent
   * requests hit an uncached tenant simultaneously. All callers for the same
   * tenant await the same Promise — identical pattern to TenantProviderRegistry.locks.
   */
  private readonly tenantConfigLocks = new Map<string, Promise<void>>();

  private readonly settingsService: ISettingsService;
  private readonly tenantOverrideService?: ITenantSettingsOverrideService;
  private readonly logger: ILogger;

  constructor(
    @inject(TYPES.BootstrapConfigProvider)
    bootstrapProvider: BootstrapConfigProvider,
    @inject(TYPES.DatabaseConfigProvider) dbProvider: DatabaseConfigProvider,
    @inject(TYPES.FileConfigProvider) fileProvider: FileConfigProvider,
    @inject(TYPES.SettingsService) settingsService: ISettingsService,
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.TenantSettingsOverrideService)
    @optional()
    tenantOverrideService?: ITenantSettingsOverrideService
  ) {
    this.bootstrapProvider = bootstrapProvider;
    this.dbProvider = dbProvider;
    this.fileProvider = fileProvider;
    this.settingsService = settingsService;
    this.tenantOverrideService = tenantOverrideService;
    this.logger = logger;

    this.dbProviderChangeHandler = this.handleDbProviderChange.bind(this);
    this.dbProvider.subscribe(this.dbProviderChangeHandler);
  }

  /**
   * Handle configuration changes from DatabaseConfigProvider
   * Called when change stream or polling detects an external update
   *
   * @param config - The updated config, or null if reload failed
   * @param error - Error if reload failed
   */
  private async handleDbProviderChange(
    config: AppConfig | null,
    error?: Error
  ): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const useFileConfig = process.env.USE_FILE_CONFIG === 'true';
    const isDevelopment = this.cache?.deployment.environment === 'development';
    if (useFileConfig && isDevelopment) {
      // File config mode - don't react to database changes
      return;
    }

    if (error || !config) {
      // Config reload failed - log error but don't crash
      // Keep using the cached config
      console.error(
        '[ConfigManager] Database config reload failed, keeping cached config',
        { error: error?.message || 'Unknown error' }
      );
      return;
    }

    try {
      const bootstrapConfig = await this.bootstrapProvider.loadConfiguration();
      let runtimeConfig = this.createRuntimeConfig(
        config,
        bootstrapConfig,
        'database'
      );

      runtimeConfig = applyComputedDefaults(runtimeConfig);

      this.cache = runtimeConfig;
      this.clearSectionCache();
      await this.notifySubscribers(runtimeConfig);

      console.info(
        '[ConfigManager] Cache updated from database change notification'
      );
    } catch (updateError) {
      console.error(
        '[ConfigManager] Failed to process database config change',
        {
          error:
            updateError instanceof Error
              ? updateError.message
              : String(updateError),
        }
      );
    }
  }

  /**
   * Create RuntimeConfig by merging persisted config with bootstrap config
   * Bootstrap fields always take precedence (cannot be overridden via UI)
   *
   * @param persistedConfig - Configuration from database or file
   * @param bootstrapConfig - Configuration from .env
   * @param configProvider - Source of the persisted config
   * @returns RuntimeConfig with bootstrap fields merged in
   */
  private createRuntimeConfig(
    persistedConfig: AppConfig | BootstrapConfig,
    bootstrapConfig: BootstrapConfig,
    configProvider: 'bootstrap' | 'file' | 'database'
  ): RuntimeConfig {
    // When running with bootstrap-only (no database/file), the persisted
    // config is just the bootstrap object and lacks application, branding,
    // security, etc. Layer the cached default-full-config under it so every
    // section has sensible values before computed fields run.
    const base: AppConfig =
      configProvider === 'bootstrap'
        ? mergeConfig(
            getDefaultFullConfig(),
            persistedConfig as unknown as Partial<AppConfig>
          )
        : (persistedConfig as AppConfig);

    return {
      ...base,
      deployment: {
        ...base.deployment,
        environment: bootstrapConfig.deployment.environment,
        ...(bootstrapConfig.deployment.url && {
          url: bootstrapConfig.deployment.url,
        }),
        server: {
          ...base.deployment?.server,
          port: bootstrapConfig.deployment.server.port,
        },
      },
      storage: {
        adapter: bootstrapConfig.storage.adapter,
        mongodb: bootstrapConfig.storage.mongodb,
        sqlite: bootstrapConfig.storage.sqlite,
        postgresql: bootstrapConfig.storage.postgresql,
      },
      // oidc_storage is fully computed from bootstrap — never persisted
      oidc_storage: buildOidcStorageFromBootstrap(bootstrapConfig),
      // Multi-tenancy infrastructure fields from bootstrap (.env wins)
      features: {
        ...base.features,
        multi_tenancy: {
          ...base.features?.multi_tenancy,
          enabled: bootstrapConfig.multiTenancy?.enabled ?? false,
          extraction_priority:
            bootstrapConfig.multiTenancy?.extraction_priority ??
            base.features?.multi_tenancy?.extraction_priority,
          tenant_header:
            bootstrapConfig.multiTenancy?.tenant_header ??
            base.features?.multi_tenancy?.tenant_header,
          provider_pool: {
            ...base.features?.multi_tenancy?.provider_pool,
            ...(bootstrapConfig.multiTenancy?.provider_pool ?? {}),
          },
        },
      },
      _metadata: {
        configProvider,
        isBootstrapMerged: true,
        loadedAt: new Date(),
      },
    };
  }

  /**
   * Load bootstrap configuration and then full configuration
   * This is the main entry point for configuration loading
   * Creates RuntimeConfig by merging bootstrap (from .env) with persisted config (from file/database)
   * Bootstrap fields always take precedence and cannot be overridden via UI
   */
  async load(): Promise<RuntimeConfig> {
    if (this.isInitialized && this.cache) {
      return this.cache;
    }

    try {
      // Step 1: Always load bootstrap configuration first (from .env)
      const bootstrapConfig = await this.bootstrapProvider.loadConfiguration();
      console.info('Bootstrap configuration loaded');

      // Step 2: Check if file configuration is enabled (development mode only)
      const useFileConfig = process.env.USE_FILE_CONFIG === 'true';
      const isDevelopment =
        bootstrapConfig.deployment.environment === 'development';

      let persistedConfig: AppConfig | BootstrapConfig;
      let configProvider: 'bootstrap' | 'file' | 'database';

      if (useFileConfig && isDevelopment) {
        // Step 3a: Use file configuration if enabled AND in development environment
        const isFileAvailable = await this.fileProvider.isAvailable();

        if (isFileAvailable) {
          persistedConfig = await this.fileProvider.loadConfiguration();
          configProvider = 'file';
          console.info(
            'Persisted configuration loaded from file (parako.jsonc) - development mode'
          );
        } else {
          // Fallback: Use bootstrap config as base if file is not available
          persistedConfig = bootstrapConfig;
          configProvider = 'bootstrap';
          console.warn(
            'File configuration not available, using bootstrap configuration only'
          );
        }
      } else {
        // Step 3b: Use database configuration (production default or when file config is disabled)
        const isDbAvailable = await this.dbProvider.isAvailable();

        if (isDbAvailable) {
          // Step 4: Load persisted configuration from database
          persistedConfig = await this.dbProvider.loadConfiguration();
          configProvider = 'database';
          console.info('Persisted configuration loaded from database');
        } else {
          // Fallback: Use bootstrap config as base if database is not available
          persistedConfig = bootstrapConfig;
          configProvider = 'bootstrap';
          console.warn(
            'Database not available, using bootstrap configuration only'
          );
        }
      }

      // Step 5: Create RuntimeConfig by merging bootstrap with persisted config
      let runtimeConfig = this.createRuntimeConfig(
        persistedConfig,
        bootstrapConfig,
        configProvider
      );

      // Step 6: Apply computed defaults to configuration
      // This auto-generates secrets (if empty) and computes derived fields.
      // Derived fields (like oidc.issuer, integration URLs, MFA settings) are ALWAYS
      // recomputed from base values to ensure consistency across the application.
      // Note: oidc_storage is fully computed from bootstrap in createRuntimeConfig().
      runtimeConfig = applyComputedDefaults(runtimeConfig);
      console.info('Computed defaults applied to runtime configuration');

      this.cache = runtimeConfig;
      this.isInitialized = true;
      console.info(
        `Runtime configuration created (provider: ${configProvider}, bootstrap merged: true)`
      );
      return this.cache;
    } catch (error) {
      throw new Error(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get current configuration
   * Returns the RuntimeConfig with all defaults already applied:
   * - Bootstrap fields merged from .env
   * - Computed defaults (secrets, derived fields, OIDC adapter)
   *
   * All computation happens once during load/update/reload/flushInitial,
   * so this method just returns the cached configuration for performance.
   */
  getConfig(): RuntimeConfig {
    if (!this.cache) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    // Multi-tenant: return tenant-specific config if cached.
    // Uses getTenantIdSafe() — returns undefined at startup (no ALS), never throws.
    if (this.cache.features?.multi_tenancy?.enabled) {
      const tenantId = tenantContext.getTenantIdSafe();
      if (tenantId) {
        const tenantConfig = this.tenantConfigs.get(tenantId);
        if (tenantConfig) return tenantConfig;
        // Not cached — caller should have called ensureTenantConfig() first.
        // Fall through to default config for resilience (no crash on cold cache).
      }
    }
    return this.cache;
  }

  /**
   * Get the raw platform configuration without tenant overlays.
   * Always returns the global base config regardless of active tenant context.
   */
  getPlatformConfig(): RuntimeConfig {
    if (!this.cache) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.cache;
  }

  /**
   * Get a specific configuration section with caching
   * Implements lazy loading with 60-second cache TTL
   * @param section - The configuration section key
   * @returns The configuration section data
   */
  getConfigSection<K extends keyof AppConfig>(section: K): AppConfig[K] {
    if (!this.cache) {
      throw new Error('Configuration not loaded. Call load() first.');
    }

    const now = Date.now();
    const cached = this.sectionCache.get(section as string);

    if (cached && now - cached.timestamp < this.SECTION_CACHE_TTL) {
      this.metrics.sectionCacheHits++;
      const accessCount =
        this.metrics.sectionAccessCount.get(section as string) || 0;
      this.metrics.sectionAccessCount.set(section as string, accessCount + 1);

      console.debug(
        `[ConfigManager] Section cache hit: ${String(section)} (age: ${now - cached.timestamp}ms)`
      );

      return cached.data as AppConfig[K];
    }

    this.metrics.sectionCacheMisses++;
    const accessCount =
      this.metrics.sectionAccessCount.get(section as string) || 0;
    this.metrics.sectionAccessCount.set(section as string, accessCount + 1);

    console.debug(
      `[ConfigManager] Section cache miss: ${String(section)} - loading from config`
    );

    const fullConfig = this.getConfig();
    const sectionData = fullConfig[section];

    this.sectionCache.set(section as string, {
      data: sectionData,
      timestamp: now,
    });

    return sectionData;
  }

  /**
   * Clear section cache
   * Called when configuration is updated or reloaded
   */
  private clearSectionCache(): void {
    this.sectionCache.clear();
    console.debug('[ConfigManager] Section cache cleared');
  }

  /**
   * Get section cache metrics
   * Returns statistics about cache hits, misses, and most accessed sections
   */
  getSectionCacheMetrics() {
    const mostAccessedSections = Array.from(
      this.metrics.sectionAccessCount.entries()
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Top 10 most accessed sections
      .map(([section, count]) => ({ section, count }));

    const totalRequests =
      this.metrics.sectionCacheHits + this.metrics.sectionCacheMisses;
    const hitRate =
      totalRequests > 0
        ? ((this.metrics.sectionCacheHits / totalRequests) * 100).toFixed(2)
        : '0.00';

    return {
      cacheHits: this.metrics.sectionCacheHits,
      cacheMisses: this.metrics.sectionCacheMisses,
      totalRequests,
      hitRate: `${hitRate}%`,
      cachedSections: this.sectionCache.size,
      mostAccessedSections,
    };
  }

  /**
   * Subscribe to configuration changes
   * @param subscriberId - Unique identifier for the subscriber
   * @param callback - Function to call when configuration changes
   */
  subscribe(
    subscriberId: string,
    callback: (config: RuntimeConfig) => void | Promise<void>
  ): void {
    this.subscribers.set(subscriberId, callback);
  }

  /**
   * Unsubscribe from configuration changes
   * @param subscriberId - Unique identifier for the subscriber
   */
  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  /**
   * Get list of active subscribers
   */
  getSubscribers(): string[] {
    return Array.from(this.subscribers.keys());
  }

  /**
   * Notify all subscribers of configuration changes
   */
  private async notifySubscribers(updatedConfig: RuntimeConfig): Promise<void> {
    console.info(
      `Notifying ${this.subscribers.size} configuration subscribers`
    );
    const results = await Promise.allSettled(
      Array.from(this.subscribers.entries()).map(
        async ([subscriberId, callback]) => {
          await callback(updatedConfig);
          console.debug(
            `Configuration update sent to subscriber: ${subscriberId}`
          );
        }
      )
    );
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        const subscriberId = Array.from(this.subscribers.keys())[i];
        console.error(
          `Error notifying subscriber ${subscriberId}:`,
          result.reason
        );
      }
    }
  }

  /**
   * Update configuration (only works with database provider)
   * Applies bootstrap merge after update to ensure bootstrap fields remain from .env
   */
  async update(partial: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call load() first.');
    }

    const useFileConfig = process.env.USE_FILE_CONFIG === 'true';
    const isDevelopment = this.cache!.deployment.environment === 'development';

    if (useFileConfig && isDevelopment) {
      throw new Error(
        'Cannot update configuration: File configuration does not support updates. Use database provider for updates.'
      );
    }

    const isDbAvailable = await this.dbProvider.isAvailable();
    if (!isDbAvailable) {
      throw new Error('Cannot update configuration: Database not available');
    }

    const previousCache = this.cache;
    try {
      const persistedConfig = await this.dbProvider.updateConfig!(partial);

      const bootstrapConfig = await this.bootstrapProvider.loadConfiguration();
      let runtimeConfig = this.createRuntimeConfig(
        persistedConfig,
        bootstrapConfig,
        'database'
      );

      runtimeConfig = applyComputedDefaults(runtimeConfig);

      this.cache = runtimeConfig;
      this.clearSectionCache();
      await this.notifySubscribers(runtimeConfig);

      // Global config is the base for ALL tenant merged configs.
      this.tenantConfigs.clear();

      // Channel is tenant-scoped: {prefix}:{tenantId}:config:invalidated
      // (buildRedisKey reads tenant from ALS — correct because config saves
      // happen within an admin panel request, which has tenant context)
      // Send tenantId: '*' to signal all tenant caches should be cleared.
      if (this.pubsub?.isConnected()) {
        const prefix = this.cache?.deployment?.redis_prefix || 'parako';
        this.pubsub
          .publish(buildRedisKey(prefix, 'config', 'invalidated'), {
            originId: this.originId,
            timestamp: Date.now(),
            tenantId: '*',
          })
          .catch((err: unknown) => {
            console.error(
              '[ConfigManager] Failed to broadcast config invalidation:',
              err
            );
          });
      }

      return runtimeConfig;
    } catch (error) {
      // Rollback: restore previous cache so the app continues with last-known-good config
      this.cache = previousCache;
      throw new Error(
        `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Reload configuration from current provider
   * Applies bootstrap merge after reload to ensure bootstrap fields remain from .env
   */
  async reload(): Promise<RuntimeConfig> {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call load() first.');
    }

    const useFileConfig = process.env.USE_FILE_CONFIG === 'true';
    const isDevelopment = this.cache!.deployment.environment === 'development';

    const previousCache = this.cache;
    try {
      let persistedConfig: AppConfig | BootstrapConfig;
      let configProvider: 'file' | 'database';

      if (useFileConfig && isDevelopment) {
        const isFileAvailable = await this.fileProvider.isAvailable();
        if (!isFileAvailable) {
          throw new Error(
            'Cannot reload configuration: File configuration not available'
          );
        }
        persistedConfig = await this.fileProvider.reloadConfiguration();
        configProvider = 'file';
      } else {
        const isDbAvailable = await this.dbProvider.isAvailable();
        if (!isDbAvailable) {
          throw new Error(
            'Cannot reload configuration: Database not available'
          );
        }
        persistedConfig = await this.dbProvider.reloadConfiguration();
        configProvider = 'database';
      }

      const bootstrapConfig = await this.bootstrapProvider.loadConfiguration();
      let runtimeConfig = this.createRuntimeConfig(
        persistedConfig,
        bootstrapConfig,
        configProvider
      );

      runtimeConfig = applyComputedDefaults(runtimeConfig);

      this.cache = runtimeConfig;
      this.clearSectionCache();
      this.tenantConfigs.clear();
      await this.notifySubscribers(runtimeConfig);
      console.info(`Configuration reloaded (provider: ${configProvider})`);
      return runtimeConfig;
    } catch (error) {
      // Keep previous cache so the app continues with last-known-good config
      this.cache = previousCache;
      console.error(
        `[ConfigManager] Reload failed, keeping previous configuration:`,
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get configuration value by path
   */
  getConfigValue<T = unknown>(path: string, defaultValue?: T): T {
    const config = this.getConfig();
    const keys = path.split('.');
    const current: Record<string, unknown> = config as unknown as Record<
      string,
      unknown
    >;

    let value: unknown = current;
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return defaultValue as T;
      }
    }

    return value as T;
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(featurePath: string): boolean {
    return this.getConfigValue<boolean>(`features.${featurePath}`, false);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.bootstrapProvider.clearCache();
    this.dbProvider.clearCache();
    this.fileProvider.clearCache();
    this.clearSectionCache();
    this.tenantConfigs.clear();
    this.cache = null;
    this.isInitialized = false;
    console.info('All configuration caches cleared');
  }

  /**
   * Check if configuration is loaded
   */
  isLoaded(): boolean {
    return this.isInitialized && this.cache !== null;
  }

  /**
   * Get bootstrap configuration only
   */
  async getBootstrapConfig(): Promise<BootstrapConfig> {
    return await this.bootstrapProvider.loadConfiguration();
  }

  /**
   * Check if file configuration is currently being used
   * Returns true only if USE_FILE_CONFIG=true AND environment=development
   */
  isUsingFileConfig(): boolean {
    if (!this.isInitialized || !this.cache) {
      return false;
    }

    const useFileConfig = process.env.USE_FILE_CONFIG === 'true';
    const isDevelopment = this.cache.deployment.environment === 'development';

    return useFileConfig && isDevelopment;
  }

  /**
   * Flush initial default configuration to database if none exists
   * This ensures the database has a complete configuration on first run
   * Applies bootstrap merge after flush
   */
  async flushInitial(): Promise<RuntimeConfig> {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call load() first.');
    }

    const useFileConfig = process.env.USE_FILE_CONFIG === 'true';
    const isDevelopment = this.cache!.deployment.environment === 'development';

    if (useFileConfig && isDevelopment) {
      throw new Error(
        'Cannot flush initial configuration: File configuration does not support initial flush. Use database provider.'
      );
    }

    const isDbAvailable = await this.dbProvider.isAvailable();
    if (!isDbAvailable) {
      throw new Error(
        'Cannot flush initial configuration: Database not available'
      );
    }

    try {
      const persistedConfig = await this.dbProvider.flushInitial();

      const bootstrapConfig = await this.bootstrapProvider.loadConfiguration();
      let runtimeConfig = this.createRuntimeConfig(
        persistedConfig,
        bootstrapConfig,
        'database'
      );

      runtimeConfig = applyComputedDefaults(runtimeConfig);

      this.cache = runtimeConfig;
      await this.notifySubscribers(runtimeConfig);
      console.info('Initial configuration flush completed');
      return runtimeConfig;
    } catch (error) {
      throw new Error(
        `Failed to flush initial configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Ensure the configuration for a specific tenant is loaded into the per-tenant
   * cache. Auto-seeds default configuration if this is the tenant's first access.
   * Concurrent calls for the same tenant coalesce on a single Promise (mutex).
   */
  async ensureTenantConfig(tenantId: string): Promise<void> {
    // Fast path: already cached
    if (this.tenantConfigs.has(tenantId)) return;

    // Mutex: coalesce concurrent loads for same tenant
    const existingLock = this.tenantConfigLocks.get(tenantId);
    if (existingLock) {
      await existingLock;
      return;
    }

    const loadPromise = this.loadTenantConfig(tenantId);
    this.tenantConfigLocks.set(tenantId, loadPromise);
    try {
      await loadPromise;
    } finally {
      this.tenantConfigLocks.delete(tenantId);
    }
  }

  /**
   * Load a tenant's configuration by cloning the global config and overlaying
   * any tenant-specific overrides from TenantSettingsOverride.
   *
   * Global Settings is now cross-tenant (loaded once at startup in this.cache).
   * Per-tenant customization comes from the TenantSettingsOverride model.
   */
  private async loadTenantConfig(tenantId: string): Promise<void> {
    try {
      if (!this.cache) {
        throw new Error(
          '[ConfigManager] Global config not loaded. Call load() first.'
        );
      }

      let tenantConfig: RuntimeConfig = JSON.parse(JSON.stringify(this.cache));

      if (this.tenantOverrideService) {
        const overrides = await tenantContext.run(tenantId, () =>
          this.tenantOverrideService!.loadOverrides(tenantId)
        );

        if (overrides) {
          tenantConfig = mergeConfig(tenantConfig, overrides as any);
        }
      }

      // so that tenantContext.getTenantIdSafe() returns the correct tenant ID
      // for subdomain-based URL derivation.
      tenantConfig = tenantContext.run(tenantId, () =>
        applyComputedDefaults(tenantConfig)
      );

      this.tenantConfigs.set(tenantId, tenantConfig);
      this.logger.info('Tenant config loaded and cached', { tenantId });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'load_tenant_config',
        tenantId,
      });
      // Do NOT cache on failure — next request retries.
      // Do NOT throw — fall back to default config (resilience).
    }
  }

  /**
   * Evict a tenant's cached config, forcing reload on next ensureTenantConfig().
   */
  invalidateTenantConfig(tenantId: string): void {
    this.tenantConfigs.delete(tenantId);
    this.logger.info('Tenant config cache invalidated', { tenantId });
  }

  /**
   * Wire Redis Pub/Sub for cross-process config invalidation.
   *
   * Uses PSUBSCRIBE with pattern `{prefix}:*:config:invalidated` to catch
   * invalidation events from ALL tenants. When any tenant's config is saved,
   * `saveConfig()` publishes to `{prefix}:{tenantId}:config:invalidated`
   * (tenant from ALS). This pattern subscription ensures every process
   * reloads regardless of which tenant triggered the change.
   */
  setPubSub(pubsub: IRedisPubSubService): void {
    this.pubsub = pubsub;

    const prefix = this.cache?.deployment?.redis_prefix || 'parako';
    pubsub.psubscribe(
      `${prefix}:*:config:invalidated`,
      (msg: Record<string, unknown>) => {
        if (msg.originId === this.originId) return;

        const msgTenantId = msg.tenantId as string | undefined;
        if (!msgTenantId || msgTenantId === '*') {
          // Global invalidation — clear all tenant caches
          this.tenantConfigs.clear();
        } else {
          this.invalidateTenantConfig(msgTenantId);
        }

        this.reload().catch(err => {
          console.error(
            '[ConfigManager] Cross-process config reload failed',
            err
          );
        });
      }
    );
  }

  /**
   * Cleanup resources and stop monitoring
   */
  cleanup(): void {
    this.dbProvider.unsubscribe(this.dbProviderChangeHandler);
    this.dbProvider.cleanup();
    this.fileProvider.cleanup();
    this.bootstrapProvider.clearCache();
    this.clearSectionCache();
    this.tenantConfigs.clear();
    this.subscribers.clear();
    this.cache = null;
    this.isInitialized = false;
    console.info('Configuration manager cleaned up');
  }
}

export { AppConfigSchema };
export type { AppConfig };
