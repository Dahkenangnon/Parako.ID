import { injectable, inject } from 'inversify';
import type { IConfigFileReader } from '../../di/interfaces/config-file-reader.interface.js';
import type { AppConfig } from '../schemas/schema.js';
import { AppConfigSchema } from '../schemas/schema.js';
import { AbstractConfigProvider } from './abstract.js';
import { TYPES } from '../../di/types.js';
import { getDefaultFullConfig } from '../constants.js';
import { mergeConfig } from '../../utils/config-merge.js';
import {
  validateEnvVars,
  PARAKO_ENV_SPECS,
} from '../../utils/env-validator.js';

/**
 * File-based configuration provider
 * Loads configuration from JSONC/JSON files using the ConfigFileReader
 * Only used when USE_FILE_CONFIG=true in development mode
 *
 * Usage:
 * 1. Set USE_FILE_CONFIG=true in your .env file
 * 2. Ensure a config file exists in the project root (parako.jsonc or parako.json)
 * 3. The configuration will be loaded and validated against AppConfigSchema
 *
 * Note: This provider does not support updates - use database provider for updates
 */
@injectable()
export class FileConfigProvider extends AbstractConfigProvider {
  private cache: AppConfig | null = null;
  private isInitialized = false;

  constructor(
    @inject(TYPES.ConfigFileReader)
    private readonly configFileReader: IConfigFileReader
  ) {
    super();
  }

  /**
   * Load configuration from JSONC file
   */
  async loadConfiguration(): Promise<AppConfig> {
    if (this.isInitialized && this.cache) {
      return this.cache;
    }

    try {
      // Pre-flight: validate env vars before config parsing (catches missing secrets early)
      validateEnvVars(PARAKO_ENV_SPECS);

      const rawConfig = this.configFileReader.readAppConfig<any>();

      const mergedConfig = mergeConfig(getDefaultFullConfig(), rawConfig);

      const config = AppConfigSchema.parse(mergedConfig);

      this.cache = config;
      this.isInitialized = true;

      console.info('File configuration loaded and validated from config file');
      return config;
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new Error(
          `File configuration validation failed: ${error.message}`
        );
      }
      throw new Error(
        `Failed to load file configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if file configuration is available.
   * Uses readAppConfig's own rootDir-aware path resolution by delegating
   * to the reader's isFileReadable with the full resolved path.
   */
  async isAvailable(): Promise<boolean> {
    try {
      // readAppConfig() already searches rootDir/parako.{yaml,yml,jsonc,json}
      // and throws if none found — so we just attempt a lightweight check.
      this.configFileReader.readAppConfig();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update configuration (not supported for file provider)
   */
  async updateConfig?(_partial: Partial<AppConfig>): Promise<AppConfig> {
    throw new Error(
      'File configuration cannot be updated. Use database provider for updates.'
    );
  }

  /**
   * Reload configuration from file
   */
  async reloadConfiguration(): Promise<AppConfig> {
    this.cache = null;
    this.isInitialized = false;
    return this.loadConfiguration();
  }

  /**
   * Flush initial configuration (not supported for file provider)
   */
  async flushInitial?(): Promise<AppConfig> {
    throw new Error(
      'File configuration does not support initial flush. Use database provider.'
    );
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache = null;
    this.isInitialized = false;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.clearCache();
  }

  /**
   * Check if configuration is currently cached
   */
  isCached(): boolean {
    return this.cache !== null;
  }

  /**
   * Get a specific configuration value by path
   */
  getConfigValue<T = any>(path: string, defaultValue?: T): T {
    if (!this.cache) {
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

    let current: any = this.cache;
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

  /**
   * Get the provider name for identification
   */
  getProviderName(): string {
    return 'file';
  }
}
