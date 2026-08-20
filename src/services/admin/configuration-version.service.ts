import type { AppConfig } from '../../config/schemas/schema.js';
import type { ISettings } from '../../models/settings/types.js';

const CONFIGURATION_FIELDS = [
  'application',
  'branding',
  'deployment',
  'security',
  'features',
  'oidc',
  'integrations',
  'notifications',
] as const satisfies readonly (keyof AppConfig)[];

export interface ConfigurationVersionDependencies {
  findVersion(versionId: string): Promise<ISettings | null>;
  getCurrentVersion(): Promise<string>;
  saveVersion(
    config: Partial<AppConfig>,
    modifiedBy: string,
    reason: string
  ): Promise<void>;
  reloadConfig(): Promise<void>;
}

export type ConfigurationRollbackResult =
  | { status: 'not-found'; versionId: string }
  | { status: 'active'; versionId: string; version: string }
  | {
      status: 'success';
      versionId: string;
      fromVersion: string;
      toVersion: string;
    };

export function parseConfigurationVersionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const versionId = value.trim();
  return versionId || null;
}

function extractConfiguration(record: ISettings): Partial<AppConfig> {
  const configuration: Partial<AppConfig> = {};

  for (const field of CONFIGURATION_FIELDS) {
    const value = record[field];
    if (value !== undefined) {
      Object.assign(configuration, { [field]: value });
    }
  }

  return configuration;
}

export class ConfigurationVersionService {
  constructor(
    private readonly dependencies: ConfigurationVersionDependencies
  ) {}

  async rollback(
    versionId: string,
    requestedBy: string
  ): Promise<ConfigurationRollbackResult> {
    const target = await this.dependencies.findVersion(versionId);
    if (!target) return { status: 'not-found', versionId };
    if (target.is_active) {
      return {
        status: 'active',
        versionId,
        version: target.version,
      };
    }

    const fromVersion = await this.dependencies.getCurrentVersion();
    const reason = `Rollback to version ${target.version} (from ${fromVersion})`;

    await this.dependencies.saveVersion(
      extractConfiguration(target),
      requestedBy,
      reason
    );
    await this.dependencies.reloadConfig();

    return {
      status: 'success',
      versionId,
      fromVersion,
      toVersion: target.version,
    };
  }
}
