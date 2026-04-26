import type { ITenantSettingsOverride } from '../../../types/tenant-settings-override.js';

export interface ITenantSettingsOverrideRepository {
  /**
   * Find the currently active override document for the tenant in context.
   * Tenant scoping is handled by the Mongoose plugin / Prisma extension.
   */
  findActive(): Promise<ITenantSettingsOverride | null>;

  /**
   * Atomically deactivate the current active row and create a new one.
   * Same deactivate-old + insert-new pattern as SettingsRepository.
   */
  save(
    value: Partial<ITenantSettingsOverride>,
    meta?: { modifiedBy?: string; reason?: string }
  ): Promise<ITenantSettingsOverride>;
}
