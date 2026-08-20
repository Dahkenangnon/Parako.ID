import {
  type RuntimeConfig,
  type BootstrapConfig,
  type DeepPartial,
} from '../../config/types.js';
import type { IRedisPubSubService } from './redis-pubsub-service.interface.js';

/**
 * Interface for the configuration manager
 * Defines the contract for managing application configuration
 *
 * Note: All methods return/use RuntimeConfig which includes:
 * - Persisted config from database/file
 * - Bootstrap config from .env (merged in)
 * - Runtime metadata
 */
export interface IConfigManager {
  load(): Promise<RuntimeConfig>;

  getConfig(): RuntimeConfig;

  /**
   * Get the raw platform configuration without tenant overlays.
   * Always returns the global base config regardless of active tenant context.
   */
  getPlatformConfig(): RuntimeConfig;

  subscribe(
    subscriberId: string,
    callback: (config: RuntimeConfig) => void | Promise<void>
  ): void;

  unsubscribe(subscriberId: string): void;

  getSubscribers(): string[];

  /**
   * Update configuration (only works with database provider)
   * Note: Bootstrap fields cannot be updated (they come from .env)
   */
  update(
    partial: DeepPartial<RuntimeConfig>,
    expectedVersion?: number
  ): Promise<RuntimeConfig>;

  reload(): Promise<RuntimeConfig>;

  getConfigValue<T = unknown>(path: string, defaultValue?: T): T;

  isFeatureEnabled(featurePath: string): boolean;

  clearCache(): void;

  isLoaded(): boolean;

  getBootstrapConfig(): Promise<BootstrapConfig>;

  /**
   * Check if file configuration is currently being used
   * Returns true only if USE_FILE_CONFIG=true AND environment=development
   */
  isUsingFileConfig(): boolean;

  /**
   * Flush initial default configuration to database if none exists
   * This ensures the database has a complete configuration on first run
   */
  flushInitial(): Promise<RuntimeConfig>;

  /**
   * Ensure the configuration for a specific tenant is loaded into the per-tenant
   * cache. Auto-seeds default configuration if this is the tenant's first access.
   * Concurrent calls for the same tenant coalesce on a single Promise (mutex).
   *
   * Call from TenantContextMiddleware BEFORE entering tenantContext.run() so that
   * getConfig() returns the correct tenant-scoped config for all downstream code.
   */
  ensureTenantConfig(tenantId: string): Promise<void>;

  /**
   * Evict a tenant's cached config, forcing reload on next ensureTenantConfig().
   * Set broadcast when the current process persisted a tenant override so
   * other processes evict the same tenant without clearing sibling caches.
   */
  invalidateTenantConfig(
    tenantId: string,
    options?: { broadcast?: boolean }
  ): Promise<void>;

  /**
   * Wire Redis Pub/Sub for cross-process config invalidation
   * Called during bootstrap after PubSub connects
   */
  setPubSub(pubsub: IRedisPubSubService): void;

  cleanup(): void;
}
