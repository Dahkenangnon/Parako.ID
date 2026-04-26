import type { ISettings } from '../../../models/settings/types.js';
import type { IBaseRepository } from './base.repository.js';

export type CreateSettingsDto = Omit<
  ISettings,
  'id' | '_id' | 'created_at' | 'updated_at'
>;

export interface SettingsMeta {
  last_modified_by?: string;
  change_reason?: string;
  tags?: string[];
  environment?: string;
}

export interface ISettingsRepository extends IBaseRepository<
  ISettings,
  CreateSettingsDto
> {
  /**
   * Find the currently active settings for a given key.
   */
  findActive(key: string): Promise<ISettings | null>;

  /**
   * Find a specific version of settings by key + semver string.
   */
  findVersion(key: string, version: string): Promise<ISettings | null>;

  /**
   * Return the version history for a key, newest first.
   */
  findHistory(key: string, limit?: number): Promise<ISettings[]>;

  /**
   * Atomically deactivate the current active row for `key` and create a new
   * row with an incremented `_version`. Versioning logic lives here, not in the service.
   */
  save(
    key: string,
    value: Partial<ISettings>,
    meta?: SettingsMeta
  ): Promise<ISettings>;

  /**
   * Return the highest semver string seen for a key, or null if none exists.
   */
  getLatestVersion(key: string): Promise<string | null>;
}
