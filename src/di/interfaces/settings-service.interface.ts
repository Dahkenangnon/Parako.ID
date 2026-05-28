import { type ISettings } from '../../models/settings.model.js';
import { type IBaseService } from './base-service.interface.js';
import { z } from 'zod';
import type {
  ConfigDiff,
  ConfigImpact,
} from '../../services/settings.service.js';
import type { AppConfig } from '../../config/schemas/schema.js';

/**
 * Interface for SettingsService — manages versioned application configuration.
 *
 * All configuration is stored as immutable versioned records: each save creates
 * a new active row and deactivates the previous one. This preserves full history
 * and enables rollback.
 *
 * Sensitive field values are encrypted at rest; the service transparently
 * encrypts on write and decrypts on read via the encryption utilities.
 */
export interface ISettingsService extends IBaseService<ISettings> {
  /**
   * Return the currently active main application configuration document,
   * or null if none has been persisted yet (first-run scenario).
   */
  getMainConfiguration(): Promise<ISettings | null>;

  /**
   * Persist the main application configuration as a new immutable version.
   * Deactivates the previous active record atomically.
   * @param config    - Partial configuration to merge and save
   * @param modifiedBy - Display name / username of the actor making the change
   * @param reason    - Human-readable reason for the change (audit trail)
   */
  saveMainConfiguration(
    config: Partial<AppConfig>,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings>;

  /**
   * Return the active configuration document for the given key, or null.
   */
  getConfigurationByKey(key: string): Promise<ISettings | null>;

  /**
   * Save a configuration document for an arbitrary key as a new immutable version.
   */
  saveConfigurationByKey(
    key: string,
    value: unknown,
    description?: string,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings>;

  /**
   * Return the `updated_at` timestamp of the currently active main configuration,
   * or null if no configuration exists.
   */
  getMainConfigurationLastUpdated(): Promise<Date | null>;

  /**
   * Return true if an active main configuration document exists in the database.
   */
  hasMainConfiguration(): Promise<boolean>;

  /**
   * Return true if a main configuration document physically exists, regardless
   * of whether it can be decrypted. Used to distinguish first-run from load failure.
   */
  configDocumentExists(): Promise<boolean>;

  /**
   * Return all currently active configuration documents across all keys.
   */
  getAllActiveConfigurations(): Promise<ISettings[]>;

  /**
   * Return the full version history for the given configuration key,
   * ordered from newest to oldest.
   */
  getConfigurationHistory(key: string): Promise<ISettings[]>;

  /**
   * Validate an arbitrary value against the application configuration schema.
   * Returns a Zod parse result (does not throw on validation failure).
   */
  validateConfiguration(config: unknown): z.ZodSafeParseResult<any>;

  /**
   * Return a summary of configuration storage statistics.
   */
  getConfigurationStatistics(): Promise<{
    totalConfigurations: number;
    activeConfigurations: number;
    mainConfigurationExists: boolean;
    lastMainConfigurationUpdate: Date | null;
  }>;

  /**
   * Migrate an existing file-based configuration to the database, creating
   * a new versioned record. Safe to call multiple times (idempotent).
   */
  migrateFromFile(
    fileConfig: Partial<AppConfig>,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings>;

  /**
   * If no configuration exists, write a default initial configuration to the
   * database. Returns null if a configuration already exists.
   */
  flushInitialConfiguration(
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings | null>;

  /**
   * Load the active main configuration from the database and decrypt all
   * sensitive fields. Returns null if no configuration exists.
   */
  loadAndDecryptConfiguration(): Promise<ISettings | null>;

  /**
   * Delete old (inactive) configuration versions for the given key, retaining
   * only the most recent `keepCount` versions.
   * @returns Number of records deleted
   */
  cleanupOldVersions(key: string, keepCount?: number): Promise<number>;

  /**
   * Compute a structured diff between two configuration objects.
   * Returns an array of changed paths with old and new values.
   */
  generateConfigDiff(
    oldConfig: Partial<AppConfig>,
    newConfig: Partial<AppConfig>,
    pathPrefix?: string
  ): ConfigDiff[];

  /**
   * Analyse the impact of a set of configuration changes and return
   * categorised impact metadata (restart required, affected services, etc.).
   */
  analyzeConfigImpact(changes: ConfigDiff[]): ConfigImpact;

  /**
   * Validate that at most one active configuration record exists per key.
   * If multiple active records are found, deactivates all but the latest
   * and returns a summary of the fix applied.
   */
  validateAndFixActiveConfigs(): Promise<{
    isValid: boolean;
    multipleActiveFound: boolean;
    fixedCount: number;
    keptVersion: string | null;
    details: string;
  }>;
}
