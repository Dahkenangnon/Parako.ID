/**
 * Configuration Type Definitions
 *
 * This file defines the type separation between:
 * 1. BootstrapConfig - Configuration loaded from .env (required to start the app)
 * 2. PersistedConfig - Configuration loaded from database or file
 * 3. RuntimeConfig - Combined configuration used at runtime
 *
 * This separation ensures that critical infrastructure settings (like database URI,
 * environment, port) cannot be modified through the admin UI and must be set in .env.
 */

import {
  BootstrapConfig,
  BootstrapConfigSchema,
} from './schemas/bootstrap-schema.js';
import { AppConfig, AppConfigSchema } from './schemas/schema.js';

// BOOTSTRAP CONFIG - From .env only, cannot be changed via UI

/**
 * Bootstrap configuration loaded from environment variables
 * These fields are required to start the application and connect to the database
 * They CANNOT be modified through the admin UI for security reasons
 *
 * Fields:
 * - deployment.environment: dev/staging/production
 * - deployment.server.port: HTTP server port
 * - storage.adapter: Main DB adapter (mongodb | sqlite | postgresql)
 * - storage.mongodb.uri: MongoDB connection URI (when adapter=mongodb)
 * - storage.sqlite.path: SQLite file path (when adapter=sqlite)
 * - storage.postgresql.url: PostgreSQL URL (when adapter=postgresql)
 */
export type { BootstrapConfig };
export { BootstrapConfigSchema };

// PERSISTED CONFIG - From database or file, excludes bootstrap fields

/**
 * Persisted configuration schema
 * This is the main application configuration stored in database/file
 * It excludes bootstrap-only fields (environment, port, database URI)
 *
 * Note: This schema is the same as AppConfigSchema but semantically
 * represents the subset of config that can be persisted and modified
 */
export const PersistedConfigSchema = AppConfigSchema;

/**
 * Persisted configuration type
 * This represents configuration that can be stored in database and modified via admin UI
 *
 * Note: While this currently matches AppConfig, the separation is important
 * because in the future we may want to explicitly exclude certain fields from
 * being persisted (like computed fields or bootstrap fields)
 */
export type PersistedConfig = AppConfig;

// RUNTIME CONFIG - Merged bootstrap + persisted + metadata

/**
 * Configuration metadata
 * Tracks the source and state of the loaded configuration
 */
export interface ConfigMetadata {
  /**
   * Source of the configuration
   * - 'bootstrap': Only bootstrap config loaded (initial state)
   * - 'file': Loaded from parako.jsonc file (development mode)
   * - 'database': Loaded from MongoDB database (production mode)
   */
  configProvider: 'bootstrap' | 'file' | 'database';

  /**
   * Whether bootstrap config has been merged into the runtime config
   * This should always be true in normal operation
   */
  isBootstrapMerged: boolean;

  /**
   * Timestamp when the configuration was loaded into memory
   */
  loadedAt: Date;

  /**
   * Schema version of the persisted configuration
   * Used for migrations when schema changes
   */
  schema_version?: string;

  /**
   * Version number for optimistic locking
   * Incremented on each update to prevent concurrent modification issues
   */
  version?: number;
}

/**
 * Runtime configuration type
 * This is the complete configuration used by the application at runtime
 *
 * It combines:
 * - Bootstrap config (from .env)
 * - Persisted config (from database/file)
 * - Metadata (runtime information)
 *
 * The bootstrap config takes precedence for overlapping fields to ensure
 * that critical infrastructure settings cannot be overridden by database config
 */
// NOTE: Declared as a type intersection rather than `interface ... extends PersistedConfig`
// because PersistedConfig is a zod-inferred type alias (z.infer<typeof AppConfigSchema>).
// TypeScript's interface inheritance from a complex type alias with overridden indexed
// keys (e.g. `deployment: PersistedConfig['deployment'] & { ... }`) silently drops the
// rest of the parent's keys — `keyof` of the resulting interface only sees the
// explicitly-listed overrides. Using a type intersection preserves the full key set.
export type RuntimeConfig = PersistedConfig & {
  /**
   * Deployment configuration with bootstrap fields merged in
   */
  deployment: PersistedConfig['deployment'] & {
    /** Environment type (from bootstrap, cannot be modified via UI) */
    environment: 'development' | 'staging' | 'production';
    server: PersistedConfig['deployment']['server'] & {
      /** HTTP server port (from bootstrap, cannot be modified via UI) */
      port: number;
    };
  };

  /**
   * Main application database configuration (from bootstrap, cannot be modified via UI)
   */
  storage: BootstrapConfig['storage'];

  /**
   * Runtime metadata about the configuration
   * This is not persisted but added when config is loaded into memory
   */
  _metadata: ConfigMetadata;
};

/**
 * Partial runtime config for updates
 * Used when updating configuration - allows partial updates
 */
export type PartialRuntimeConfig = Partial<Omit<RuntimeConfig, '_metadata'>> & {
  _metadata?: Partial<ConfigMetadata>;
};

// TYPE GUARDS

/**
 * Type guard to check if a config object is a RuntimeConfig
 */
export function isRuntimeConfig(config: unknown): config is RuntimeConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    '_metadata' in config &&
    typeof (config as RuntimeConfig)._metadata === 'object'
  );
}

/**
 * Type guard to check if a config object is a BootstrapConfig
 */
export function isBootstrapConfig(config: unknown): config is BootstrapConfig {
  return BootstrapConfigSchema.safeParse(config).success;
}

/**
 * Type guard to check if a config object is a PersistedConfig
 */
export function isPersistedConfig(config: unknown): config is PersistedConfig {
  return PersistedConfigSchema.safeParse(config).success;
}

// BOOTSTRAP FIELD PATHS

/**
 * List of field paths that are bootstrap-only
 * These fields can ONLY be set via .env and cannot be modified through the admin UI
 *
 * Format: dot-notation path (e.g., 'deployment.environment')
 */
export const BOOTSTRAP_ONLY_FIELDS = [
  'deployment.environment',
  'deployment.server.port',
  'storage.adapter',
  'storage.mongodb.uri',
  'storage.sqlite.path',
  'storage.postgresql.url',
  'features.multi_tenancy.extraction_priority',
  'features.multi_tenancy.tenant_header',
  'features.multi_tenancy.provider_pool.max_size',
  'features.multi_tenancy.provider_pool.idle_ttl_ms',
  'features.multi_tenancy.provider_pool.cleanup_interval_ms',
] as const;

/**
 * Type for bootstrap-only field paths
 */
export type BootstrapOnlyField = (typeof BOOTSTRAP_ONLY_FIELDS)[number];

/**
 * Check if a field path is a bootstrap-only field
 *
 * @param fieldPath - The dot-notation field path to check
 * @returns true if the field is bootstrap-only
 */
export function isBootstrapField(fieldPath: string): boolean {
  return BOOTSTRAP_ONLY_FIELDS.includes(fieldPath as BootstrapOnlyField);
}

// EXPORTS

export type { AppConfig } from './schemas/schema.js';
export { AppConfigSchema } from './schemas/schema.js';
