import type { ITenantSettingsOverride } from '../../types/tenant-settings-override.js';

/**
 * Service for managing per-tenant configuration overrides.
 * Only whitelisted fields can be overridden by tenants.
 */
export interface ITenantSettingsOverrideService {
  /**
   * Load the active override document for a tenant.
   * Returns null if no overrides exist for this tenant.
   */
  loadOverrides(
    tenantId: string
  ): Promise<Partial<ITenantSettingsOverride> | null>;

  /**
   * Save tenant-specific configuration overrides.
   * Only whitelisted fields are accepted -- non-whitelisted paths are rejected.
   *
   * @param platformConfig - Platform global config for floor/ceiling constraint
   *   enforcement. Pass `configManager.getConfig()` cast to `Record<string, any>`.
   *   When null/undefined, constraint enforcement is skipped.
   *   Passed explicitly to avoid a circular DI dependency
   *   (ConfigManager → this service → ConfigManager).
   */
  saveOverrides(
    tenantId: string,
    overrides: Partial<ITenantSettingsOverride>,
    modifiedBy?: string,
    reason?: string,
    platformConfig?: Record<string, any> | null
  ): Promise<ITenantSettingsOverride>;

  /**
   * Delete a specific section from the tenant override doc,
   * reverting that section to platform defaults.
   * If no override sections remain, deactivates the override doc.
   */
  deleteSection(
    tenantId: string,
    section: string,
    modifiedBy?: string,
    reason?: string
  ): Promise<{ reset: true; section: string }>;
}
