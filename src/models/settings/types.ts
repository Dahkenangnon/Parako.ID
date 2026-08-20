import type { PersistedConfig } from '../../config/types.js';
import type { IBaseModel } from '../base.model.js';

export type ISettings = IBaseModel &
  PersistedConfig & {
    key: string;
    version: string;
    schema_version: string;
    _version: number;
    description?: string;
    is_active: boolean;
    metadata?: {
      last_modified_by?: string;
      change_reason?: string;
      tags?: string[];
      environment?: string;
    };
  };

export type ISettingsMethods = {
  incrementVersion(): string;
  activate(): Promise<ISettings>;
  deactivate(): Promise<ISettings>;
  updateValue(
    newValue: Partial<ISettings>,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings>;
  getValue(): ISettings;
  isNewerThan(timestamp: Date): boolean;
};
