import type { AppConfig } from '../../config/schemas/schema.js';
import { parseSecuritySettingsForm } from '../../config/schemas/settings-form-schema.js';
import { mergeConfig, type DeepPartial } from '../../utils/config-merge.js';
import {
  convertSecurityFormData,
  restoreMaskedSensitiveFields,
} from '../../utils/settings.helper.js';

type UnknownRecord = Record<string, unknown>;

export interface SecuritySettingsDependencies {
  getCurrentConfig(): AppConfig;
  updateSecurity(security: AppConfig['security']): Promise<void>;
}

export type SecuritySettingsUpdateResult =
  | { status: 'invalid'; errors: string[] }
  | {
      status: 'success';
      fieldsModified: number;
      restoredFields: string[];
    };

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function missingText(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function validateSecuritySettings(data: unknown): string[] {
  const security = asRecord(data);
  if (!security) return ['Security settings must be an object'];

  const errors: string[] = [];
  const secrets = asRecord(security.secrets);
  if (secrets) {
    const jwtSecret = secrets.jwt_secret;
    if (
      typeof jwtSecret === 'string' &&
      jwtSecret.length > 0 &&
      jwtSecret.length < 32
    ) {
      errors.push(
        'JWT secret must be at least 32 characters long for security'
      );
    }

    if (secrets.cookie_secrets !== undefined) {
      const cookieSecrets = Array.isArray(secrets.cookie_secrets)
        ? secrets.cookie_secrets.filter(
            (secret): secret is string => typeof secret === 'string'
          )
        : [];
      const isStringArray =
        Array.isArray(secrets.cookie_secrets) &&
        cookieSecrets.length === secrets.cookie_secrets.length;

      if (!isStringArray) {
        errors.push(
          'Cookie secrets must be an array or newline-separated string'
        );
      }
      if (cookieSecrets.length === 0) {
        errors.push('At least one cookie secret is required');
      }
      if (cookieSecrets.some(secret => secret.length < 32)) {
        errors.push('All cookie secrets must be at least 32 characters long');
      }
    }
  }

  const authentication = asRecord(security.authentication);
  const multiFactor = asRecord(authentication?.multi_factor);
  if (multiFactor) {
    const totp = asRecord(multiFactor.totp);
    if (totp?.enabled === true && missingText(totp.issuer_name)) {
      errors.push('TOTP issuer name is required when TOTP is enabled');
    }

    const webauthn = asRecord(multiFactor.webauthn);
    if (webauthn?.enabled === true && missingText(webauthn.rp_id)) {
      errors.push(
        'WebAuthn Relying Party ID is required when WebAuthn is enabled'
      );
    }
    if (webauthn?.enabled === true && missingText(webauthn.rp_name)) {
      errors.push(
        'WebAuthn Relying Party name is required when WebAuthn is enabled'
      );
    }
  }

  return errors;
}

export class SecuritySettingsService {
  constructor(private readonly dependencies: SecuritySettingsDependencies) {}

  async update(formData: unknown): Promise<SecuritySettingsUpdateResult> {
    const parsed = parseSecuritySettingsForm(formData);
    const parsedSecrets = asRecord(parsed.secrets);
    const submittedCookieSecrets = Boolean(
      parsedSecrets &&
      Object.prototype.hasOwnProperty.call(parsedSecrets, 'cookie_secrets')
    );
    const convertedData = convertSecurityFormData(parsed) as DeepPartial<
      AppConfig['security']
    >;

    if (convertedData.secrets && !submittedCookieSecrets) {
      delete convertedData.secrets.cookie_secrets;
    }

    const errors = validateSecuritySettings(convertedData);
    if (errors.length > 0) return { status: 'invalid', errors };

    const currentConfig = this.dependencies.getCurrentConfig();
    const { restoredConfig, restoredFields } = restoreMaskedSensitiveFields(
      { security: convertedData },
      currentConfig
    );
    const mergedSecurity = mergeConfig(
      currentConfig.security || {},
      restoredConfig.security
    ) as AppConfig['security'];

    await this.dependencies.updateSecurity(mergedSecurity);

    return {
      status: 'success',
      fieldsModified: Object.keys(convertedData).length,
      restoredFields,
    };
  }
}
