import { z } from 'zod';
import { existsSync } from 'node:fs';
import { injectable } from 'inversify';
import {
  type BootstrapConfig,
  BootstrapConfigSchema,
} from '../schemas/bootstrap-schema.js';
import { AbstractConfigProvider } from './abstract.js';
import dotenv from 'dotenv';

/**
 * Bootstrap configuration provider
 * Loads only bootstrap configuration from .env/.env.local files
 * This provider is only used for essential startup settings
 */
@injectable()
export class BootstrapConfigProvider extends AbstractConfigProvider<BootstrapConfig> {
  private cachedConfig: BootstrapConfig | null = null;
  private readonly envFilePath: string;
  private readonly envLocalFilePath: string;

  constructor() {
    super();
    this.envFilePath = '.env';
    this.envLocalFilePath = '.env.local';
  }

  /**
   * Load environment variables from .env files using dotenv
   * Priority: .env.local > .env > existing env vars
   */
  private loadEnvironmentVariables(): Record<string, string> {
    const envVars: Record<string, string> = {};

    if (existsSync(this.envFilePath)) {
      try {
        const result = dotenv.config({ path: this.envFilePath, quiet: true });
        if (result.parsed) {
          Object.assign(envVars, result.parsed);
        }
      } catch (error) {
        console.warn(
          'Failed to load .env file:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    if (existsSync(this.envLocalFilePath)) {
      try {
        const result = dotenv.config({
          path: this.envLocalFilePath,
          quiet: true,
        });
        if (result.parsed) {
          Object.assign(envVars, result.parsed);
        }
      } catch (error) {
        console.warn(
          'Failed to load .env.local file:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return envVars;
  }

  /**
   * Convert environment variables to bootstrap configuration
   */
  private buildBootstrapConfig(
    envVars: Record<string, string>
  ): BootstrapConfig {
    const config: any = {};

    const envMappings: Record<string, string> = {
      DEPLOYMENT_ENVIRONMENT: 'deployment.environment',
      DEPLOYMENT_URL: 'deployment.url',
      DEPLOYMENT_SERVER_PORT: 'deployment.server.port',
      // DB abstraction adapter selection
      STORAGE_ADAPTER: 'storage.adapter',
      STORAGE_MONGODB_URI: 'storage.mongodb.uri',
      STORAGE_SQLITE_PATH: 'storage.sqlite.path',
      STORAGE_POSTGRESQL_URL: 'storage.postgresql.url',
      // OIDC adapter bootstrap override (optional)
      OIDC_STORAGE_ADAPTER: 'oidcStorage.adapter',
      // Redis connection (session store, BullMQ, pub/sub)
      REDIS_HOST: 'redis.host',
      REDIS_PORT: 'redis.port',
      REDIS_PASSWORD: 'redis.password',
      REDIS_DATABASE: 'redis.database',
      MULTI_TENANCY_ENABLED: 'multiTenancy.enabled',
      MULTI_TENANCY_EXTRACTION_PRIORITY: 'multiTenancy.extraction_priority',
      MULTI_TENANCY_TENANT_HEADER: 'multiTenancy.tenant_header',
      MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE:
        'multiTenancy.provider_pool.max_size',
      MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS:
        'multiTenancy.provider_pool.idle_ttl_ms',
      MULTI_TENANCY_PROVIDER_POOL_CLEANUP_INTERVAL_MS:
        'multiTenancy.provider_pool.cleanup_interval_ms',
      PARAKO_BOOTSTRAP_ADMIN_EMAIL: 'multiTenancy.bootstrap_admin_email',
      PARAKO_BOOTSTRAP_ADMIN_PASSWORD: 'multiTenancy.bootstrap_admin_password',
      SECURITY_LOGGING_ENABLED: 'security.logging.enabled',
      SECURITY_LOGGING_LEVEL: 'security.logging.level',
      SECURITY_LOGGING_PRETTY_PRINT: 'security.logging.pretty_print',
      SECURITY_LOGGING_FILE_LOGGING_ENABLED:
        'security.logging.file_logging.enabled',
      SECURITY_LOGGING_FILE_LOGGING_DIRECTORY:
        'security.logging.file_logging.directory',
    };

    for (const [envKey, configPath] of Object.entries(envMappings)) {
      if (envVars[envKey] !== undefined) {
        const keys = configPath.split('.');

        // Block prototype pollution vectors
        for (const key of keys) {
          if (
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
          ) {
            console.warn(`[BOOTSTRAP CONFIG WARNING] Blocked prototype pollution attempt in environment mapping: "${configPath}"
               - Dangerous key "${key}" detected in configuration path
               - Skipping environment variable: ${envKey}`);
            continue;
          }
        }

        let current = config;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            current[keys[i]] = {};
          }
          current = current[keys[i]];
        }

        let value: any = envVars[envKey];
        if (envKey === 'MULTI_TENANCY_EXTRACTION_PRIORITY') {
          // Comma-separated string → array
          value = value
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (
          envKey.includes('PORT') ||
          envKey.includes('MAX_FILES') ||
          envKey.includes('MAX_SIZE') ||
          envKey.includes('TTL_MS') ||
          envKey.includes('INTERVAL_MS') ||
          envKey === 'REDIS_DATABASE'
        ) {
          value = parseInt(value, 10);
        } else if (
          envKey.includes('ENABLED') ||
          envKey.includes('PRETTY_PRINT')
        ) {
          value = value.toLowerCase() === 'true';
        }

        current[keys[keys.length - 1]] = value;
      }
    }

    return config;
  }

  /**
   * Load bootstrap configuration from environment variables
   */
  private loadBootstrapConfiguration(): BootstrapConfig {
    try {
      const envVars = this.loadEnvironmentVariables();

      if (Object.keys(envVars).length === 0) {
        throw new Error(
          'No bootstrap configuration found. Please provide at least one of: .env or .env.local with required bootstrap settings'
        );
      }

      const config = this.buildBootstrapConfig(envVars);

      const validatedConfig = BootstrapConfigSchema.parse(config);

      console.info('Bootstrap configuration loaded from environment variables');

      return validatedConfig;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map(
            (err: z.core.$ZodIssue) => `${err.path.join('.')}: ${err.message}`
          )
          .join('\n');
        throw new Error(
          `Bootstrap configuration validation failed:\n${errorMessages}`
        );
      }
      throw new Error(
        `Failed to load bootstrap configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async loadConfiguration(): Promise<BootstrapConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const config = this.loadBootstrapConfiguration();
    this.cachedConfig = config;
    return config;
  }

  async reloadConfiguration(): Promise<BootstrapConfig> {
    this.clearCache();
    return this.loadConfiguration();
  }

  clearCache(): void {
    this.cachedConfig = null;
    console.info('Bootstrap configuration cache cleared');
  }

  isCached(): boolean {
    return this.cachedConfig !== null;
  }

  getConfigValue<T = any>(path: string, defaultValue?: T): T {
    if (!this.cachedConfig) {
      // Auto-load synchronously on first access.
      // loadBootstrapConfiguration() reads only from environment variables and
      // is fully synchronous, so this is safe to call in any context — including
      // inside InversifyJS toDynamicValue factories which run before the async
      // loadConfiguration() call in the startup sequence.
      this.cachedConfig = this.loadBootstrapConfiguration();
    }

    const keys = path.split('.');

    // Block prototype pollution vectors
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        console.warn(`[BOOTSTRAP CONFIG WARNING] Blocked prototype pollution attempt: "${path}"
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
        if (arguments.length < 2) {
          console.warn(`[BOOTSTRAP CONFIG WARNING] Accessing undefined configuration key: "${path}"
           - Path "${partialPath}" ${partialPath === path ? 'does not exist' : `exists but "${path}" doesn't`} in bootstrap configuration
           - Using default value: ${JSON.stringify(defaultValue)}
           - Bootstrap config only contains essential startup settings`);
        }
        return defaultValue as T;
      }
    }

    return current as T;
  }

  getProviderName(): string {
    return 'bootstrap';
  }

  async isAvailable(): Promise<boolean> {
    const hasEnvFile = existsSync(this.envFilePath);
    const hasEnvLocalFile = existsSync(this.envLocalFilePath);

    return hasEnvFile || hasEnvLocalFile;
  }

  /**
   * Update configuration (not supported for bootstrap provider)
   */
  async updateConfig?(
    _partial: Partial<BootstrapConfig>
  ): Promise<BootstrapConfig> {
    throw new Error(
      'Configuration updates not supported for bootstrap provider. Use database provider for updates.'
    );
  }
}
