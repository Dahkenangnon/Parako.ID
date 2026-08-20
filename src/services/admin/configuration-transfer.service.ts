import type { AppConfig } from '../../config/schemas/schema.js';
import type { RuntimeConfig } from '../../config/types.js';
import type { DeepPartial } from '../../utils/config-merge.js';
import type { ConfigDiff, ConfigImpact } from '../../types/settings-service.js';
import {
  prepareSensitiveConfigForDisplay,
  restoreMaskedSensitiveFields,
} from '../../utils/settings.helper.js';

export type ConfigurationObject = Record<string, unknown>;

export type ConfigurationImportFailure =
  | 'No configuration data provided'
  | 'Invalid JSON format'
  | 'Configuration must be a JSON object';

export type ConfigurationImportResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: ConfigurationImportFailure };

export interface ConfigurationTransferDependencies {
  getCurrentConfig(): RuntimeConfig;
  updateConfig(config: DeepPartial<RuntimeConfig>): Promise<void>;
  reloadConfig(): Promise<void>;
  generateConfigDiff(
    current: Partial<AppConfig>,
    imported: Partial<AppConfig>
  ): ConfigDiff[];
  analyzeConfigImpact(diff: ConfigDiff[]): ConfigImpact;
}

export interface ConfigurationExport {
  filename: string;
  data: ConfigurationObject & {
    _export_metadata: {
      exportedAt: string;
      exportedBy: string;
      version: string | number;
      warning: string;
    };
  };
}

export interface ConfigurationImportPreview {
  diff: ConfigDiff[];
  impact: ConfigImpact;
  changeCount: number;
}

export interface ConfigurationImportApplied {
  restoredFields: string[];
}

function asConfigurationObject(value: unknown): ConfigurationObject | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as ConfigurationObject;
}

function withoutExportMetadata(
  configuration: ConfigurationObject
): ConfigurationObject {
  const config = { ...configuration };
  delete config._export_metadata;
  return config;
}

export class ConfigurationTransferService {
  constructor(
    private readonly dependencies: ConfigurationTransferDependencies
  ) {}

  createExport(exportedBy: string, now = new Date()): ConfigurationExport {
    const config = this.dependencies.getCurrentConfig();
    const sanitized = prepareSensitiveConfigForDisplay(
      config
    ) as ConfigurationObject;
    const date = now.toISOString().split('T')[0];
    const configVersion = (
      config as RuntimeConfig & { version?: string | number }
    ).version;

    return {
      filename: `parako-config-export-${date}.json`,
      data: {
        _export_metadata: {
          exportedAt: now.toISOString(),
          exportedBy,
          version: configVersion ?? '1.0.0',
          warning:
            'SECURITY WARNING: Sensitive fields are masked with asterisks. ' +
            'You must manually add actual secret values after importing this configuration.',
        },
        ...sanitized,
      },
    };
  }

  preview(
    input: unknown
  ): ConfigurationImportResult<ConfigurationImportPreview> {
    const parsed = this.parse(input);
    if (!parsed.valid) return parsed;

    const current = this.dependencies.getCurrentConfig();
    const diff = this.dependencies.generateConfigDiff(
      current,
      parsed.value as Partial<AppConfig>
    );

    return {
      valid: true,
      value: {
        diff,
        impact: this.dependencies.analyzeConfigImpact(diff),
        changeCount: diff.length,
      },
    };
  }

  async apply(
    input: unknown
  ): Promise<ConfigurationImportResult<ConfigurationImportApplied>> {
    const parsed = this.parse(input);
    if (!parsed.valid) return parsed;

    const current = this.dependencies.getCurrentConfig();
    const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
      parsed.value,
      current
    ) as {
      restoredConfig: ConfigurationObject;
      restoredFields: string[];
    };

    await this.dependencies.updateConfig(
      restoredConfig as DeepPartial<RuntimeConfig>
    );
    await this.dependencies.reloadConfig();

    return { valid: true, value: { restoredFields } };
  }

  private parse(
    input: unknown
  ): ConfigurationImportResult<ConfigurationObject> {
    if (!input) {
      return { valid: false, error: 'No configuration data provided' };
    }

    let value: unknown = input;
    if (typeof input === 'string') {
      try {
        value = JSON.parse(input);
      } catch {
        return { valid: false, error: 'Invalid JSON format' };
      }
    }

    const configuration = asConfigurationObject(value);
    if (!configuration) {
      return {
        valid: false,
        error: 'Configuration must be a JSON object',
      };
    }

    return { valid: true, value: withoutExportMetadata(configuration) };
  }
}
