import { injectable, inject } from 'inversify';
import mongoose from 'mongoose';
import { type AppConfig, AppConfigSchema } from '../schemas/schema.js';
import { AbstractConfigProvider } from './abstract.js';
import { SettingsService } from '../../services/settings.service.js';
import { getDefaultFullConfig } from '../constants.js';
import { TYPES } from '../../di/types.js';
import {
  validateNonBootstrapConfig,
  stripBootstrapFields,
} from '../validation/persistence-validator.js';
import { applyComputedDefaults } from '../computed-fields.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../multi-tenancy/tenant-context.js';

/**
 * Database-based configuration provider
 * Acts as the single source of truth for all non-bootstrap configuration
 * Automatically flushes default configuration if none exists
 * Implements production-ready caching with automatic cache invalidation
 */
@injectable()
export class DatabaseConfigProvider extends AbstractConfigProvider {
  private cachedConfig: AppConfig | null = null;
  private lastConfigUpdate: Date | null = null;
  private settingsService: SettingsService;
  /**
   * Subscribers receive config updates (or null + error on reload failure)
   * This allows subscribers to handle both success and error cases
   */
  private subscribers: Set<(config: AppConfig | null, error?: Error) => void> =
    new Set();
  private cacheCheckInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_CHECK_INTERVAL = 30000; // 30 seconds
  private changeStream: any = null; // MongoDB change stream
  private usingChangeStreams = false;

  constructor(@inject(TYPES.SettingsService) settingsService: SettingsService) {
    super();
    this.settingsService = settingsService;
    this.startCacheMonitoring();
  }

  /**
   * Check if MongoDB deployment supports Change Streams
   * Change Streams require MongoDB replica set or sharded cluster
   * @returns true if Change Streams are supported
   */
  private supportsChangeStreams(): boolean {
    try {
      const connection = mongoose.connection;
      if (!connection || !connection.readyState) {
        return false;
      }

      // Change streams require replica set or sharded cluster
      const topology = (connection as any).client?.topology;
      if (!topology) {
        return false;
      }

      const topologyType = topology.constructor?.name;
      const supportsStreams =
        topologyType === 'ReplicaSet' || topologyType === 'Sharded';

      if (supportsStreams) {
        console.info(
          `MongoDB Change Streams available (topology: ${topologyType})`
        );
      }

      return supportsStreams;
    } catch (error) {
      console.warn(
        'Unable to determine Change Streams support:',
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * Watch the settings collection for changes using MongoDB Change Streams
   * Automatically invalidates cache and reloads configuration on changes
   */
  private async watchCollection(): Promise<void> {
    try {
      const connection = mongoose.connection;
      if (!connection || !connection.db) {
        throw new Error('Database connection not available');
      }

      const collection = connection.db.collection('settings');

      // Filter for main config key only to avoid unnecessary reloads
      this.changeStream = collection.watch(
        [
          {
            $match: {
              operationType: { $in: ['insert', 'update', 'replace'] },
              'fullDocument.key': 'main', // Only watch main config changes
            },
          },
        ],
        { fullDocument: 'updateLookup' }
      );

      this.usingChangeStreams = true;

      this.changeStream.on('change', async (change: any) => {
        console.info(
          `Configuration change detected via Change Stream (operation: ${change.operationType})`
        );

        this.clearCache();

        try {
          const newConfig = await this.loadConfiguration();
          this.notifySubscribers(newConfig);
        } catch (error) {
          console.error(
            'Failed to reload configuration after change:',
            error instanceof Error ? error.message : String(error)
          );
          this.notifySubscribers(
            null,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      });

      this.changeStream.on('error', (error: Error) => {
        console.error('MongoDB Change Stream error:', error.message);
        console.warn('Falling back to polling-based cache monitoring');

        if (this.changeStream) {
          this.changeStream.close().catch((err: Error) => {
            console.error('Error closing change stream:', err.message);
          });
          this.changeStream = null;
        }

        this.usingChangeStreams = false;

        // Fall back to polling
        this.startPollingMonitoring();
      });

      this.changeStream.on('close', () => {
        console.info('MongoDB Change Stream closed');
        this.changeStream = null;
        this.usingChangeStreams = false;
      });

      console.info('MongoDB Change Stream initialized successfully');
    } catch (error) {
      console.error(
        'Failed to initialize MongoDB Change Stream:',
        error instanceof Error ? error.message : String(error)
      );
      this.usingChangeStreams = false;
      throw error;
    }
  }

  /**
   * Start polling-based cache monitoring (fallback when Change Streams unavailable)
   */
  private startPollingMonitoring(): void {
    if (this.cacheCheckInterval) {
      clearInterval(this.cacheCheckInterval);
    }

    console.info(
      `Starting polling-based cache monitoring (interval: ${this.CACHE_CHECK_INTERVAL}ms)`
    );

    this.cacheCheckInterval = setInterval(async () => {
      if (this.cachedConfig && (await this.isDatabaseConfigUpdated())) {
        console.info(
          'Configuration change detected via polling, invalidating cache...'
        );
        this.clearCache();
        try {
          const newConfig = await this.loadConfiguration();
          this.notifySubscribers(newConfig);
        } catch (error) {
          console.error(
            'Failed to reload configuration after change:',
            error instanceof Error ? error.message : String(error)
          );
          this.notifySubscribers(
            null,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }, this.CACHE_CHECK_INTERVAL);
  }

  /**
   * Start monitoring database for configuration changes
   * Tries to use MongoDB Change Streams first, falls back to polling if unavailable
   */
  private startCacheMonitoring(): void {
    if (this.supportsChangeStreams()) {
      console.info(
        'Attempting to use MongoDB Change Streams for config monitoring...'
      );
      this.watchCollection().catch(error => {
        console.warn(
          'Failed to start Change Stream, falling back to polling:',
          error instanceof Error ? error.message : String(error)
        );
        this.startPollingMonitoring();
      });
    } else {
      console.warn(
        'MongoDB Change Streams not available (requires replica set or sharded cluster)'
      );
      console.info('Using polling-based cache monitoring as fallback');
      this.startPollingMonitoring();
    }
  }

  /**
   * Stop monitoring database for configuration changes
   * Closes change stream if active, or clears polling interval
   */
  private stopCacheMonitoring(): void {
    if (this.changeStream) {
      console.info('Closing MongoDB Change Stream...');
      this.changeStream.close().catch((error: Error) => {
        console.error('Error closing change stream:', error.message);
      });
      this.changeStream = null;
      this.usingChangeStreams = false;
    }

    // Stop polling interval if active
    if (this.cacheCheckInterval) {
      clearInterval(this.cacheCheckInterval);
      this.cacheCheckInterval = null;
    }

    console.info('Configuration monitoring stopped');
  }

  /**
   * Load configuration from database
   * Uses loadAndDecryptConfiguration to automatically decrypt sensitive fields
   *
   * IMPORTANT: This method distinguishes between:
   * - "No config exists" (first run) → returns null, safe to auto-flush
   * - "Config exists but failed to load" → THROWS error, do NOT auto-flush
   *
   * This prevents accidentally overwriting valid encrypted config with defaults
   * when decryption fails (e.g., wrong ENCRYPTION_KEY).
   */
  private async loadFromDatabase(): Promise<AppConfig | null> {
    // Step 1: Check if document exists (without loading content)
    const documentExists = await this.settingsService.configDocumentExists();

    if (!documentExists) {
      console.info('No configuration document found in database (first run)');
      return null; // Legitimate first run - auto-flush is appropriate
    }

    // Step 2: Document exists - attempt to load and decrypt
    // If this fails, it's an ERROR (not "no config"), so we must throw
    try {
      const settings = await this.settingsService.loadAndDecryptConfiguration();

      if (!settings) {
        // Document exists but failed to load - this is an ERROR state
        // Do NOT return null (which would trigger auto-flush)
        throw new Error(
          'Configuration document exists but failed to load. ' +
            'Check ENCRYPTION_KEY matches the key used to encrypt config. ' +
            'Check database connectivity and permissions.'
        );
      }

      this.lastConfigUpdate =
        await this.settingsService.getMainConfigurationLastUpdated();
      console.info('Configuration loaded and decrypted from database', {
        lastUpdated: this.lastConfigUpdate,
      });

      // oidc_storage is omitted — it's computed from bootstrap env vars in
      // ConfigManager.createRuntimeConfig(), which always runs after this.
      const config = {
        application: settings.application,
        branding: settings.branding,
        deployment: settings.deployment,
        security: settings.security,
        features: settings.features as any,
        oidc: settings.oidc as any,
        integrations: settings.integrations,
        notifications: settings.notifications,
      } as AppConfig;

      return config;
    } catch (error) {
      // Re-throw with context - do NOT swallow and return null
      console.error('Failed to load configuration from database', {
        error: error instanceof Error ? error.message : String(error),
        context: 'load_from_database',
        documentExists: true,
      });
      throw error;
    }
  }

  /**
   * Auto-flush default configuration to database if none exists
   */
  private async autoFlushDefaultConfig(): Promise<AppConfig> {
    try {
      console.info(
        'No configuration found in database, auto-flushing default configuration...'
      );

      // Use the default full configuration from constants
      const defaultConfig = AppConfigSchema.parse(getDefaultFullConfig());

      await this.settingsService.saveMainConfigurationWithTransaction(
        defaultConfig
      );

      console.info('Default configuration flushed to database');

      this.cachedConfig = defaultConfig;
      this.lastConfigUpdate = new Date();

      return defaultConfig;
    } catch (error) {
      console.error(
        'Failed to auto-flush default configuration:',
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `Failed to auto-flush default configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Subscribe to configuration changes
   * Subscribers receive:
   * - config: The new configuration, or null if reload failed
   * - error: Error object if reload failed, undefined on success
   */
  subscribe(fn: (config: AppConfig | null, error?: Error) => void): void {
    this.subscribers.add(fn);
  }

  /**
   * Unsubscribe from configuration changes
   */
  unsubscribe(fn: (config: AppConfig | null, error?: Error) => void): void {
    this.subscribers.delete(fn);
  }

  /**
   * Notify subscribers of configuration changes or reload failures
   * @param config - The new configuration, or null if reload failed
   * @param error - Error object if reload failed
   */
  private notifySubscribers(config: AppConfig | null, error?: Error): void {
    this.subscribers.forEach(fn => {
      try {
        fn(config, error);
      } catch (subscriberError) {
        console.error(
          'Error in config subscriber:',
          subscriberError instanceof Error
            ? subscriberError.message
            : String(subscriberError)
        );
      }
    });
  }

  /**
   * Check if database configuration has been updated
   */
  private async isDatabaseConfigUpdated(): Promise<boolean> {
    try {
      const lastUpdate =
        await this.settingsService.getMainConfigurationLastUpdated();
      if (!lastUpdate || !this.lastConfigUpdate) {
        // No timestamps to compare — assume no change
        // (config will be loaded fresh on next access if cache is empty)
        return false;
      }
      return lastUpdate.getTime() > this.lastConfigUpdate.getTime();
    } catch (error) {
      console.error(
        'Failed to check database config update:',
        error instanceof Error ? error.message : String(error)
      );
      // Don't force reload on transient errors — keep serving cached config
      return false;
    }
  }

  async loadConfiguration(): Promise<AppConfig> {
    // Trust Change Streams or polling to invalidate cache - don't check DB on every access
    // This eliminates database query overhead on every config access
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const config = await this.loadFromDatabase();

    if (!config) {
      // Auto-flush default configuration if none exists
      return await this.autoFlushDefaultConfig();
    }

    this.cachedConfig = config;
    return config;
  }

  async reloadConfiguration(): Promise<AppConfig> {
    this.clearCache();
    return this.loadConfiguration();
  }

  clearCache(): void {
    this.cachedConfig = null;
    // Keep lastConfigUpdate so polling doesn't false-positive after cache clear
    console.info('Database configuration cache cleared');
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopCacheMonitoring();
    this.subscribers.clear();
    this.clearCache();
  }

  isCached(): boolean {
    return this.cachedConfig !== null;
  }

  /**
   * Update configuration in database
   * Automatically validates, strips bootstrap fields, and encrypts sensitive fields before saving
   */
  async updateConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
    try {
      const currentConfig = await this.loadConfiguration();

      const updatedConfig = { ...currentConfig, ...partial };

      // Bootstrap fields (deployment.environment, deployment.server.port, storage.adapter + storage.mongodb|sqlite|postgresql.*)
      // must ONLY come from .env and should NEVER be persisted to database
      const validation = validateNonBootstrapConfig(updatedConfig);
      if (!validation.isValid) {
        console.warn(
          'Attempted to persist bootstrap fields to database - these will be stripped',
          {
            bootstrapFields: validation.bootstrapFieldsFound,
            message:
              'Bootstrap fields are infrastructure settings that must be set in .env file only',
            action: 'Fields will be automatically removed before saving',
          }
        );
      }

      const sanitizedConfig = stripBootstrapFields(updatedConfig);

      // This auto-generates missing secrets and recalculates all derived fields
      // (OIDC issuer, integration URLs, MFA settings, etc.) from base configuration values
      // ensuring consistency across the application even when base values change
      const configWithDefaults = applyComputedDefaults(sanitizedConfig);

      const validatedConfig = AppConfigSchema.parse(configWithDefaults);

      // NOTE: saveMainConfiguration() automatically encrypts sensitive fields
      // So we do NOT encrypt here to avoid double encryption
      await this.settingsService.saveMainConfigurationWithTransaction(
        validatedConfig
      );

      this.clearCache();

      const reloadedConfig = await this.loadConfiguration();

      this.notifySubscribers(reloadedConfig);

      console.info('Configuration updated in database', {
        timestamp: new Date().toISOString(),
        bootstrapFieldsStripped: validation.bootstrapFieldsFound.length,
      });

      return reloadedConfig;
    } catch (error) {
      console.error(
        'Failed to update configuration:',
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Flush initial default configuration to database if none exists
   * This ensures the database has a complete configuration on first run
   */
  async flushInitial(): Promise<AppConfig> {
    // Explicit ALS context for startup — prevents breakage if strict mode
    // is enabled before first request (app.ts enables strict in multi-tenant).
    return tenantContext.run(DEFAULT_TENANT_ID, async () => {
      try {
        console.info('Checking if initial configuration flush is needed...');

        // Use the settings service to flush initial configuration
        const savedConfig =
          await this.settingsService.flushInitialConfiguration(
            'system',
            'Initial configuration flush'
          );

        if (savedConfig) {
          // Configuration was just flushed, now load it with decryption
          const decryptedConfig = await this.loadAndDecryptConfiguration();

          if (decryptedConfig) {
            // oidc_storage is omitted — it's computed from bootstrap env vars in
            // ConfigManager.createRuntimeConfig(), which always runs after this.
            const config = {
              application: decryptedConfig.application,
              branding: decryptedConfig.branding,
              deployment: decryptedConfig.deployment,
              security: decryptedConfig.security,
              features: decryptedConfig.features as any,
              oidc: decryptedConfig.oidc as any,
              integrations: decryptedConfig.integrations,
              notifications: decryptedConfig.notifications,
            } as AppConfig;

            this.cachedConfig = config;
            this.lastConfigUpdate = new Date();

            console.info('Initial configuration flush completed successfully');
            return config;
          }
        }

        // Configuration already exists, load it
        return await this.loadConfiguration();
      } catch (error) {
        console.error(
          'Failed to flush initial configuration:',
          error instanceof Error ? error.message : String(error)
        );
        throw new Error(
          `Failed to flush initial configuration: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  /**
   * Load and decrypt configuration - helper method for internal use
   * @private
   */
  private async loadAndDecryptConfiguration() {
    return await this.settingsService.loadAndDecryptConfiguration();
  }

  getConfigValue<T = any>(path: string, defaultValue?: T): T {
    if (!this.cachedConfig) {
      throw new Error(
        'Configuration not loaded. Call loadConfiguration() first.'
      );
    }

    const keys = path.split('.');

    // Block prototype pollution vectors
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        console.warn(`[CONFIG WARNING] Blocked prototype pollution attempt: "${path}"
           - Dangerous key "${key}" detected in configuration path
           - Using default value: ${JSON.stringify(defaultValue)}`);
        return defaultValue as T;
      }
    }

    let current: any = this.cachedConfig;
    let partialPath = '';

    for (const key of keys) {
      partialPath = partialPath ? `${partialPath}.${key}` : key;

      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        console.warn(`[CONFIG WARNING] Accessing undefined configuration key: "${path}"
           - Path "${partialPath}" ${partialPath === path ? 'does not exist' : `exists but "${path}" doesn't`} in configuration
           - Using default value: ${JSON.stringify(defaultValue)} 
           - To fix this, ensure the key is defined in AppConfigSchema`);
        return defaultValue as T;
      }
    }

    return current as T;
  }

  getProviderName(): string {
    return 'database';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.settingsService.getMainConfiguration();
      return true;
    } catch (error) {
      console.warn(
        'Database configuration provider not available:',
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }
}
