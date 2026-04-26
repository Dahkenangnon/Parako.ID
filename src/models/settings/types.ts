import { type IBaseModel } from '../base.model.js';
import { type AppConfig } from '../../config/schemas/schema.js';

/**
 * Settings interface for storing application configuration in database
 * This follows the exact structure defined by AppConfigSchema
 */
export interface ISettings extends IBaseModel {
  /**
   * Configuration key - should be unique for each configuration type
   */
  key: string;

  /**
   * Configuration version for tracking changes (semantic version)
   * Auto-incremented on each update (e.g., 1.0.0 -> 1.0.1)
   */
  version: string;

  /**
   * Schema version for tracking configuration structure changes
   * Used for migrations and compatibility checking
   * @default '1.0.0'
   */
  schema_version: string;

  /**
   * Optimistic locking version counter
   * Incremented on each update to prevent concurrent modification conflicts
   * @default 0
   */
  _version: number;

  /**
   * Description of what this configuration contains
   */
  description?: string;

  /**
   * Whether this configuration is currently active
   */
  is_active: boolean;

  /**
   * Metadata for tracking configuration changes and environment
   */
  metadata?: {
    last_modified_by?: string;
    change_reason?: string;
    tags?: string[];
    /**
     * Environment this configuration applies to (development, staging, production)
     * Moved from root level to metadata to better organize configuration tracking info
     */
    environment?: string;
  };

  // Configuration data following AppConfig structure
  application: AppConfig['application'];
  branding: AppConfig['branding'];
  deployment: AppConfig['deployment'];
  security: AppConfig['security'];
  features: AppConfig['features'];
  oidc: AppConfig['oidc'];
  integrations: AppConfig['integrations'];
  notifications: AppConfig['notifications'];
}

export type ISettingsMethods = {
  /**
   * Activate this configuration
   */
  activate(): Promise<ISettings>;

  /**
   * Deactivate this configuration
   */
  deactivate(): Promise<ISettings>;

  /**
   * Update configuration value with validation
   */
  updateValue(
    newValue: Partial<ISettings>,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings>;

  /**
   * Get configuration value as typed object
   */
  getValue(): ISettings;

  /**
   * Check if configuration is newer than given timestamp
   */
  isNewerThan(timestamp: Date): boolean;
};
