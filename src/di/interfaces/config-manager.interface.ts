import {
  type RuntimeConfig,
  type BootstrapConfig,
} from '../../config/types.js';
import { type AppConfig } from '../../config/schemas/schema.js';
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
  /**
   * Load bootstrap configuration and then full configuration
   * This is the main entry point for configuration loading
   * Returns RuntimeConfig with bootstrap fields merged in
   */
  load(): Promise<RuntimeConfig>;

  /**
   * Get current configuration
   * Returns RuntimeConfig with bootstrap fields already merged
   */
  getConfig(): RuntimeConfig;

  /**
   * Get the raw platform configuration without tenant overlays.
   * Always returns the global base config regardless of active tenant context.
   */
  getPlatformConfig(): RuntimeConfig;

  /**
   * Get a specific configuration section with caching
   * Implements lazy loading with 60-second cache TTL
   * @param section - The configuration section key
   * @returns The configuration section data
   */
  getConfigSection<K extends keyof AppConfig>(section: K): AppConfig[K];

  /**
   * Get section cache metrics
   * Returns statistics about cache hits, misses, and most accessed sections
   */
  getSectionCacheMetrics(): {
    cacheHits: number;
    cacheMisses: number;
    totalRequests: number;
    hitRate: string;
    cachedSections: number;
    mostAccessedSections: Array<{ section: string; count: number }>;
  };

  /**
   * Subscribe to configuration changes
   * @param subscriberId - Unique identifier for the subscriber
   * @param callback - Function to call when configuration changes
   */
  subscribe(
    subscriberId: string,
    callback: (config: RuntimeConfig) => void | Promise<void>
  ): void;

  /**
   * Unsubscribe from configuration changes
   * @param subscriberId - Unique identifier for the subscriber
   */
  unsubscribe(subscriberId: string): void;

  /**
   * Get list of active subscribers
   */
  getSubscribers(): string[];

  /**
   * Update configuration (only works with database provider)
   * Note: Bootstrap fields cannot be updated (they come from .env)
   */
  update(partial: Partial<RuntimeConfig>): Promise<RuntimeConfig>;

  /**
   * Reload configuration from database
   * Returns RuntimeConfig with bootstrap fields merged in
   */
  reload(): Promise<RuntimeConfig>;

  /**
   * Get configuration value by path
   * Can access both persisted and bootstrap fields
   */
  getConfigValue<T = unknown>(path: string, defaultValue?: T): T;

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(featurePath: string): boolean;

  /**
   * Clear all caches
   */
  clearCache(): void;

  /**
   * Check if configuration is loaded
   */
  isLoaded(): boolean;

  /**
   * Get bootstrap configuration only (from .env)
   * Returns only the bootstrap fields without persisted config
   */
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
   * Called when a tenant's config is updated (local process) or invalidated
   * (cross-process via Redis PubSub).
   */
  invalidateTenantConfig(tenantId: string): void;

  /**
   * Wire Redis Pub/Sub for cross-process config invalidation
   * Called during bootstrap after PubSub connects
   */
  setPubSub(pubsub: IRedisPubSubService): void;

  /**
   * Cleanup resources and stop monitoring
   */
  cleanup(): void;
}
