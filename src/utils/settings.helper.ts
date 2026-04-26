/**
 * Settings Helper Utilities
 * Contains utility functions for form data conversion and validation
 * Extracted from AdminSettingsController for better maintainability
 */

import { WEB_SAFE_FONTS } from '../config/constants.js';
import { BOOTSTRAP_ONLY_FIELDS } from '../config/types.js';

/**
 * SENSITIVE_FIELDS - Registry of all sensitive field paths in configuration
 * These fields contain secrets, passwords, or credentials that should:
 * - Be encrypted when stored in the database
 * - Be masked when displayed in the UI
 * - Be redacted from logs
 * - Be audited when revealed
 */
export const SENSITIVE_FIELDS = [
  'security.secrets.jwt_secret',
  'security.secrets.cookie_secrets',
  'integrations.email.smtp_password',
  'integrations.ipinfo.api_token',
  'integrations.ipqualityscore.api_key',
  'integrations.fingerprintjs.api_key',
  'notifications.channels.sms.api_key',
  'notifications.channels.sms.api_secret',
  'features.social_providers.google.client_secret',
  'features.social_providers.github.client_secret',
  'features.social_providers.microsoft.client_secret',
  'features.social_providers.linkedin.client_secret',
  'features.social_providers.facebook.client_secret',
  'oidc.secrets.pairwise_salt',
] as const;

/**
 * BOOTSTRAP_ONLY_FIELDS - Registry of fields that can ONLY be set via .env
 * These fields are infrastructure-level and should never be persisted to database
 * They are loaded from environment variables at bootstrap time only
 *
 * NOTE: Primary definition is in src/config/types.ts - re-exported here for backward compatibility
 */
export { BOOTSTRAP_ONLY_FIELDS } from '../config/types.js';

/**
 * Check if a field path is sensitive and should be encrypted/masked
 *
 * @param {string} fieldPath - Dot-separated path to the field (e.g., 'security.secrets.jwt_secret')
 * @returns {boolean} True if the field is sensitive, false otherwise
 *
 * @example
 * isSensitiveField('security.secrets.jwt_secret'); // true
 * isSensitiveField('application.title'); // false
 */
export function isSensitiveField(fieldPath: string): boolean {
  if (!fieldPath || typeof fieldPath !== 'string') {
    return false;
  }
  return SENSITIVE_FIELDS.includes(fieldPath as any);
}

/**
 * Check if a field path is a bootstrap-only field (from .env)
 *
 * @param {string} fieldPath - Dot-separated path to the field
 * @returns {boolean} True if the field is bootstrap-only, false otherwise
 *
 * @example
 * isBootstrapField('deployment.environment'); // true
 * isBootstrapField('deployment.url'); // false
 */
export function isBootstrapField(fieldPath: string): boolean {
  if (!fieldPath || typeof fieldPath !== 'string') {
    return false;
  }
  return BOOTSTRAP_ONLY_FIELDS.includes(fieldPath as any);
}

/**
 * Mask a sensitive value for display in UI
 * Shows first 4 characters followed by asterisks
 *
 * @param {string} value - The value to mask
 * @returns {string} The masked value
 *
 * @example
 * maskSensitiveValue('abc123def456'); // 'abc1********'
 * maskSensitiveValue('short'); // 'sho*'
 * maskSensitiveValue(''); // ''
 */
export function maskSensitiveValue(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  // For very short values (less than 4 chars), show first char + asterisks
  if (value.length < 4) {
    return value.charAt(0) + '*'.repeat(Math.max(value.length - 1, 1));
  }

  const visibleChars = 4;
  const hiddenLength = Math.max(value.length - visibleChars, 4); // At least 4 asterisks
  return value.substring(0, visibleChars) + '*'.repeat(hiddenLength);
}

/**
 * Check if a value appears to be a masked sensitive value
 * Masked values contain asterisks and follow the pattern from maskSensitiveValue()
 *
 * @param {any} value - The value to check
 * @returns {boolean} True if the value appears to be masked
 *
 * @example
 * isMaskedValue('abcd********'); // true
 * isMaskedValue('a***'); // true
 * isMaskedValue('actual-secret'); // false
 * isMaskedValue(null); // false
 */
export function isMaskedValue(value: any): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  // A masked value should have at least one asterisk and shouldn't be all asterisks
  const hasAsterisks = value.includes('*');
  const notAllAsterisks = value.replace(/\*/g, '').length > 0;

  return hasAsterisks && notAllAsterisks;
}

/**
 * Restore masked sensitive fields from current config
 * When importing a config with masked secrets, replace them with actual values from current config
 *
 * @param {any} importedConfig - The imported configuration (may have masked values)
 * @param {any} currentConfig - The current configuration (has actual values)
 * @returns {{ restoredConfig: any; restoredFields: string[] }} - The config with restored secrets and list of restored fields
 *
 * @example
 * const current = { security: { secrets: { jwt_secret: 'real-secret' } } };
 * const imported = { security: { secrets: { jwt_secret: 'real********' } } };
 * const result = restoreMaskedSensitiveFields(imported, current);
 * // result.restoredConfig.security.secrets.jwt_secret === 'real-secret'
 * // result.restoredFields === ['security.secrets.jwt_secret']
 */
export function restoreMaskedSensitiveFields(
  importedConfig: any,
  currentConfig: any
): { restoredConfig: any; restoredFields: string[] } {
  // Deep clone imported config to avoid mutations
  const restoredConfig = JSON.parse(JSON.stringify(importedConfig));
  const restoredFields: string[] = [];

  for (const fieldPath of SENSITIVE_FIELDS) {
    const importedValue = getNestedValue(restoredConfig, fieldPath);
    const currentValue = getNestedValue(currentConfig, fieldPath);

    if (importedValue === undefined || importedValue === null) {
      continue;
    }

    if (Array.isArray(importedValue)) {
      let hasRestoredArrayItem = false;
      const restoredArray = importedValue.map((item: any, index: number) => {
        if (isMaskedValue(item)) {
          if (Array.isArray(currentValue) && currentValue[index]) {
            hasRestoredArrayItem = true;
            return currentValue[index];
          }
        }
        return item;
      });

      if (hasRestoredArrayItem) {
        setNestedValue(restoredConfig, fieldPath, restoredArray);
        restoredFields.push(fieldPath);
      }
    } else if (isMaskedValue(importedValue)) {
      if (currentValue !== undefined && currentValue !== null) {
        setNestedValue(restoredConfig, fieldPath, currentValue);
        restoredFields.push(fieldPath);
      }
    }
  }

  return { restoredConfig, restoredFields };
}

/**
 * Get nested object value by path
 * @param obj - The object to get value from
 * @param path - Dot-separated path to the value
 * @returns The value at the path or undefined
 *
 * @example
 * getNestedValue({ security: { secrets: { jwt_secret: 'abc123' } } }, 'security.secrets.jwt_secret');
 * // Returns: 'abc123'
 */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Set nested object value by path
 * Includes prototype pollution protection
 *
 * @param obj - The object to set value in
 * @param path - Dot-separated path to the value
 * @param value - The value to set
 *
 * @example
 * const config = {};
 * setNestedValue(config, 'security.secrets.jwt_secret', 'masked-value');
 * // config is now: { security: { secrets: { jwt_secret: 'masked-value' } } }
 */
export function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;

  // Block prototype pollution vectors
  if (
    lastKey === '__proto__' ||
    lastKey === 'constructor' ||
    lastKey === 'prototype'
  ) {
    return;
  }

  // Check for dangerous keys in the path
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return;
    }
  }

  const target = keys.reduce((current, key) => {
    if (!current[key]) current[key] = {};
    return current[key];
  }, obj);
  target[lastKey] = value;
}

/**
 * Prepare configuration for safe display in UI by masking all sensitive fields
 * This function deep clones the config and replaces all sensitive values with masked versions
 *
 * @param {any} config - The configuration object to mask
 * @returns {any} A new configuration object with all sensitive fields masked
 *
 * @example
 * const config = {
 *   security: {
 *     secrets: {
 *       jwt_secret: 'my-super-secret-key-12345',
 *       cookie_secrets: ['secret1', 'secret2']
 *     }
 *   },
 *   application: {
 *     title: 'My App'  // Non-sensitive, unchanged
 *   }
 * };
 *
 * const maskedConfig = prepareSensitiveConfigForDisplay(config);
 * // Returns:
 * // {
 * //   security: {
 * //     secrets: {
 * //       jwt_secret: 'my-s************************',
 * //       cookie_secrets: ['secr****', 'secr****']
 * //     }
 * //   },
 * //   application: {
 * //     title: 'My App'
 * //   }
 * // }
 */
export function prepareSensitiveConfigForDisplay(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // Deep clone to avoid mutating the original config
  const maskedConfig = JSON.parse(JSON.stringify(config));

  // Iterate through all sensitive fields and mask them
  for (const fieldPath of SENSITIVE_FIELDS) {
    const value = getNestedValue(maskedConfig, fieldPath);

    if (value === undefined || value === null) {
      continue;
    }

    try {
      if (Array.isArray(value)) {
        const maskedArray = value.map((item: any) => {
          if (typeof item === 'string' && item.length > 0) {
            return maskSensitiveValue(item);
          }
          return item;
        });
        setNestedValue(maskedConfig, fieldPath, maskedArray);
      } else if (typeof value === 'string' && value.length > 0) {
        const maskedValue = maskSensitiveValue(value);
        setNestedValue(maskedConfig, fieldPath, maskedValue);
      }
      // For other types (objects, numbers, etc.), leave unchanged
    } catch (error) {
      // If masking fails for any reason, log a warning but continue
      console.warn(
        `Failed to mask sensitive field: ${fieldPath}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return maskedConfig;
}

/**
 * Convert form data with boolean checkboxes
 * @param data - The form data to convert
 * @param booleanFields - Array of field paths that should be converted to booleans
 * @returns Converted data with proper boolean values
 */
export function convertBooleanFields(data: any, booleanFields: string[]): any {
  const converted = { ...data };

  for (const fieldPath of booleanFields) {
    const value = getNestedValue(converted, fieldPath);
    if (Array.isArray(value)) {
      // Hidden+checkbox pattern: ["", "on"] (checked) or [""] (unchecked)
      setNestedValue(converted, fieldPath, value.includes('on'));
    } else if (value === 'on') {
      setNestedValue(converted, fieldPath, true);
    } else if (value === '') {
      // Empty string from hidden input = unchecked checkbox on THIS page
      setNestedValue(converted, fieldPath, false);
    }
    // undefined = field not on this page → leave absent → mergeConfig skips it
  }

  return converted;
}

/**
 * Validate IP addresses (IPv4 and IPv6)
 * @param ip - The IP address to validate
 * @returns True if valid IP address, false otherwise
 */
export function isValidIP(ip: string): boolean {
  // IPv4 regex
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;

  // IPv6 regex (more comprehensive)
  const ipv6Regex =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^::ffff:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Sanitize a hex color value
 * Security: Prevents CSS injection by only allowing valid hex colors
 * @param value - The value to sanitize
 * @returns Sanitized hex color or null if invalid
 */
function sanitizeHexColor(value: any): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Convert color mode data (light or dark) to sanitized colors
 * @param data - The color mode data object
 * @returns Object with only valid hex colors
 */
function convertColorMode(data: any): Record<string, string> {
  if (!data || typeof data !== 'object') return {};

  const colorKeys = [
    'primary',
    'primaryForeground',
    'secondary',
    'secondaryForeground',
    'accent',
    'accentForeground',
    'destructive',
    'destructiveForeground',
    'success',
    'successForeground',
    'warning',
    'warningForeground',
    'info',
    'infoForeground',
    'background',
    'foreground',
    'card',
    'cardForeground',
    'popover',
    'popoverForeground',
    'muted',
    'mutedForeground',
    'border',
    'input',
    'ring',
    'sidebar',
    'sidebarForeground',
    'sidebarPrimary',
    'sidebarPrimaryForeground',
    'sidebarAccent',
    'sidebarAccentForeground',
    'sidebarBorder',
    'sidebarRing',
  ];

  const result: Record<string, string> = {};
  for (const key of colorKeys) {
    const sanitized = sanitizeHexColor(data[key]);
    if (sanitized) {
      result[key] = sanitized;
    }
  }
  return result;
}

/**
 * Sanitize a font family value
 * Security: Only allows values from the predefined WEB_SAFE_FONTS list
 * @param value - The value to sanitize
 * @param allowedFonts - Array of allowed font values
 * @returns Sanitized font or null if invalid
 */
function sanitizeFontFamily(value: any, allowedFonts: string[]): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Only allow fonts from the predefined list
  if (!allowedFonts.includes(trimmed)) return null;
  return trimmed;
}

/**
 * Convert branding form data to proper types
 * @param data - The form data to convert
 * @returns Converted branding data
 */
export function convertBrandingFormData(data: any): any {
  const converted = { ...data };

  if (converted.ui && converted.ui.customization) {
    converted.ui.customization.enabled =
      converted.ui.customization.enabled === 'on' ||
      converted.ui.customization.enabled === true;
  }

  if (converted.colors) {
    converted.colors = {
      light: convertColorMode(converted.colors?.light),
      dark: convertColorMode(converted.colors?.dark),
    };
  }

  if (converted.fonts) {
    const allowedSansFonts = WEB_SAFE_FONTS.sans.map(
      (f: { value: string }) => f.value
    );
    const allowedMonoFonts = WEB_SAFE_FONTS.mono.map(
      (f: { value: string }) => f.value
    );

    converted.fonts = {
      sans: sanitizeFontFamily(converted.fonts.sans, allowedSansFonts),
      heading: sanitizeFontFamily(converted.fonts.heading, allowedSansFonts),
      mono: sanitizeFontFamily(converted.fonts.mono, allowedMonoFonts),
    };
  }

  return converted;
}

/**
 * Convert deployment form data to proper types
 * @param data - The form data to convert
 * @returns Converted deployment data
 */
export function convertDeploymentFormData(data: any): any {
  let converted = { ...data };

  if (converted.server && converted.server.port) {
    converted.server.port = parseInt(converted.server.port, 10);
  }

  if (
    converted.cookies &&
    converted.cookies.defaults &&
    converted.cookies.defaults.maxAge
  ) {
    converted.cookies.defaults.maxAge = parseInt(
      converted.cookies.defaults.maxAge,
      10
    );
  }

  const booleanFields = [
    'server.proxy',
    'cookies.defaults.httpOnly',
    'cookies.defaults.secure',
  ];

  converted = convertBooleanFields(converted, booleanFields);

  return converted;
}

/**
 * Convert features form data to proper types
 * @param data - The form data to convert
 * @returns Converted features data
 */
export function convertFeaturesFormData(data: any): any {
  let converted = { ...data };

  if (
    converted.oidc &&
    converted.oidc.extra_params &&
    converted.oidc.extra_params.allowed_params &&
    typeof converted.oidc.extra_params.allowed_params === 'string'
  ) {
    converted.oidc.extra_params.allowed_params =
      converted.oidc.extra_params.allowed_params
        .split('\n')
        .map((param: string) => param.trim())
        .filter((param: string) => param);
  }

  if (
    converted.oidc &&
    converted.oidc.acr_values &&
    converted.oidc.acr_values.supported &&
    typeof converted.oidc.acr_values.supported === 'string'
  ) {
    converted.oidc.acr_values.supported = converted.oidc.acr_values.supported
      .split('\n')
      .map((acr: string) => acr.trim())
      .filter((acr: string) => acr);
  }

  if (
    converted.oidc &&
    converted.oidc.scopes &&
    typeof converted.oidc.scopes === 'string'
  ) {
    converted.oidc.scopes = converted.oidc.scopes
      .split('\n')
      .map((scope: string) => scope.trim())
      .filter((scope: string) => scope);
  }

  if (
    converted.oidc &&
    converted.oidc.extra_client_metadata &&
    converted.oidc.extra_client_metadata.properties &&
    typeof converted.oidc.extra_client_metadata.properties === 'string'
  ) {
    converted.oidc.extra_client_metadata.properties =
      converted.oidc.extra_client_metadata.properties
        .split('\n')
        .map((prop: string) => prop.trim())
        .filter((prop: string) => prop);
  }

  if (converted.oidc && converted.oidc.clock_tolerance) {
    converted.oidc.clock_tolerance = parseInt(
      converted.oidc.clock_tolerance,
      10
    );
  }

  if (
    converted.social_providers &&
    converted.social_providers.behavior &&
    converted.social_providers.behavior.options &&
    converted.social_providers.behavior.options.max_providers_per_user
  ) {
    converted.social_providers.behavior.options.max_providers_per_user =
      parseInt(
        converted.social_providers.behavior.options.max_providers_per_user,
        10
      );
  }

  if (
    converted.oidc &&
    converted.oidc.extra_params &&
    !converted.oidc.extra_params.allowed_params
  ) {
    converted.oidc.extra_params.allowed_params = [];
  }

  if (
    converted.oidc &&
    converted.oidc.acr_values &&
    !converted.oidc.acr_values.supported
  ) {
    converted.oidc.acr_values.supported = [];
  }

  if (converted.oidc && !converted.oidc.scopes) {
    converted.oidc.scopes = [];
  }

  if (
    converted.oidc &&
    converted.oidc.extra_client_metadata &&
    !converted.oidc.extra_client_metadata.properties
  ) {
    converted.oidc.extra_client_metadata.properties = [];
  }

  if (converted.social_providers && 'enabled' in converted.social_providers) {
    const enabled = converted.social_providers.enabled;
    if (typeof enabled === 'string') {
      converted.social_providers.enabled = enabled ? [enabled] : [];
    } else if (Array.isArray(enabled)) {
      converted.social_providers.enabled = enabled.filter(
        (v: string) => v !== '' && v !== undefined
      );
    }
  }

  const booleanFields = [
    'oidc.dev_interactions.enabled',
    'oidc.device_flow.enabled',
    'oidc.client_credentials.enabled',
    'oidc.token_revocation.enabled',
    'oidc.token_introspection.enabled',
    'oidc.jwt_introspection.enabled',
    'oidc.userinfo_endpoint.enabled',
    'oidc.resource_indicators.enabled',
    'oidc.rp_initiated_logout.enabled',
    'oidc.backchannel_logout.enabled',
    'oidc.dynamic_client_registration.enabled',
    'oidc.dynamic_client_registration.require_initial_access_token',
    'oidc.dynamic_client_registration.issue_registration_access_token',
    'oidc.client_registration_management.enabled',
    'oidc.client_registration_management.rotate_registration_access_token',
    'oidc.pkce.enabled',
    'oidc.pkce.required',
    'oidc.extra_params.enabled',
    'oidc.accept_query_param_access_tokens',
    'oidc.conform_id_token_claims',
    'oidc.allow_omitting_single_registered_redirect_uri',
    'oidc.enable_http_post_methods',
    'oidc.expires_with_session',
    'oidc.rotate_refresh_token',
    'oidc.client_based_cors',
    'oidc.encryption.enabled',
    'oidc.jwt_response_modes.enabled',
    'oidc.jwt_userinfo.enabled',
    'oidc.request_objects.enabled',
    'social_providers.behavior.require_password_on_registration',
    'social_providers.behavior.options.allow_multiple_providers',
    'social_providers.behavior.options.auto_verify_email',
    'social_providers.behavior.options.show_helpful_errors',
  ];

  converted = convertBooleanFields(converted, booleanFields);

  return converted;
}

/**
 * Convert OIDC form data to proper types
 * @param data - The form data to convert
 * @returns Converted OIDC data
 */
export function convertOidcFormData(data: any): any {
  const converted = { ...data };

  if (converted.oidc && converted.oidc.token_ttl) {
    const numericFields = [
      'access_token',
      'authorization_code',
      'backchannel_auth',
      'client_credentials',
      'device_code',
      'grant',
      'id_token',
      'interaction',
      'refresh_token',
      'session',
    ];

    for (const field of numericFields) {
      if (converted.oidc.token_ttl[field]) {
        converted.oidc.token_ttl[field] = parseInt(
          converted.oidc.token_ttl[field],
          10
        );
      }
    }
  }

  if (converted.oidc && converted.oidc.discovery) {
    const arrayFields = [
      'claims_locales_supported',
      'ui_locales_supported',
      'display_values_supported',
    ];

    for (const field of arrayFields) {
      if (
        converted.oidc.discovery[field] &&
        typeof converted.oidc.discovery[field] === 'string'
      ) {
        converted.oidc.discovery[field] = converted.oidc.discovery[field]
          .split(',')
          .map((item: string) => item.trim())
          .filter((item: string) => item);
      }
    }
  }

  if (converted.oidc && converted.oidc.jwa) {
    const algorithmFields = [
      'attest_signing_alg_values',
      'authorization_encryption_alg_values',
      'authorization_encryption_enc_values',
      'authorization_signing_alg_values',
      'client_auth_signing_alg_values',
      'dpop_signing_alg_values',
      'id_token_encryption_alg_values',
      'id_token_encryption_enc_values',
      'id_token_signing_alg_values',
      'introspection_encryption_alg_values',
      'introspection_encryption_enc_values',
      'introspection_signing_alg_values',
      'request_object_encryption_alg_values',
      'request_object_encryption_enc_values',
      'request_object_signing_alg_values',
      'userinfo_encryption_alg_values',
      'userinfo_encryption_enc_values',
      'userinfo_signing_alg_values',
    ];

    for (const field of algorithmFields) {
      if (
        converted.oidc.jwa[field] &&
        !Array.isArray(converted.oidc.jwa[field])
      ) {
        converted.oidc.jwa[field] = [converted.oidc.jwa[field]];
      } else if (!converted.oidc.jwa[field]) {
        // If no checkboxes were selected, ensure it's an empty array
        converted.oidc.jwa[field] = [];
      }
    }
  }

  return converted;
}

/**
 * Convert integrations form data to proper types
 * @param data - The form data to convert
 * @returns Converted integrations data
 */
export function convertIntegrationsFormData(data: any): any {
  // The form sends data as { integrations: { email: {...}, urls: {...} } }
  const converted = data.integrations || data;

  if (converted.email && converted.email.smtp_port) {
    converted.email.smtp_port = parseInt(converted.email.smtp_port, 10);
  }

  if (converted.ipinfo) {
    if (converted.ipinfo.enabled !== undefined) {
      converted.ipinfo.enabled =
        converted.ipinfo.enabled === 'true' ||
        converted.ipinfo.enabled === true ||
        converted.ipinfo.enabled === 'on';
    }
    if (converted.ipinfo.cache_ttl_hours !== undefined) {
      converted.ipinfo.cache_ttl_hours = parseInt(
        converted.ipinfo.cache_ttl_hours,
        10
      );
    }
  }

  if (converted.ipqualityscore) {
    if (converted.ipqualityscore.enabled !== undefined) {
      converted.ipqualityscore.enabled =
        converted.ipqualityscore.enabled === 'true' ||
        converted.ipqualityscore.enabled === true ||
        converted.ipqualityscore.enabled === 'on';
    }
    if (converted.ipqualityscore.fraud_score_threshold !== undefined) {
      converted.ipqualityscore.fraud_score_threshold = parseInt(
        converted.ipqualityscore.fraud_score_threshold,
        10
      );
    }
    if (converted.ipqualityscore.cache_ttl_hours !== undefined) {
      converted.ipqualityscore.cache_ttl_hours = parseInt(
        converted.ipqualityscore.cache_ttl_hours,
        10
      );
    }
  }

  if (converted.fingerprintjs) {
    if (converted.fingerprintjs.enabled !== undefined) {
      converted.fingerprintjs.enabled =
        converted.fingerprintjs.enabled === 'true' ||
        converted.fingerprintjs.enabled === true ||
        converted.fingerprintjs.enabled === 'on';
    }
    if (converted.fingerprintjs.api_key) {
      converted.fingerprintjs.api_key =
        converted.fingerprintjs.api_key.trim() || undefined;
    }
    if (converted.fingerprintjs.endpoint) {
      converted.fingerprintjs.endpoint =
        converted.fingerprintjs.endpoint.trim() || undefined;
    }
  }

  return converted;
}

/**
 * Convert notifications form data to proper types
 * @param data - The form data to convert
 * @returns Converted notifications data
 */
export function convertNotificationsFormData(data: any): any {
  // The form sends data as { notifications: { channels: {...}, defaults: {...} } }
  const converted = data.notifications || data;

  // Helper to check if checkbox was checked in form submission.
  // The hidden+checkbox pattern produces arrays: ["", "on"] (checked) or [""] (unchecked).
  // Standard checkboxes send "on" or are absent (undefined).
  const isChecked = (value: any): boolean => {
    if (Array.isArray(value)) return value.includes('on');
    return value === 'true' || value === true || value === 'on';
  };

  if (!converted.channels) {
    converted.channels = {};
  }

  // Email channel - checkbox unchecked means enabled=false
  // The email checkbox is always present in the form, so missing = unchecked = false
  converted.channels.email = {
    enabled: isChecked(converted.channels.email?.enabled),
  };

  // SMS channel - process all fields
  // Always include all fields to ensure mergeConfig can properly update/clear them
  const smsData = converted.channels.sms || {};
  const trimmedProvider = smsData.provider
    ? String(smsData.provider).trim()
    : '';
  const trimmedApiKey = smsData.api_key ? String(smsData.api_key).trim() : '';
  const trimmedApiSecret = smsData.api_secret
    ? String(smsData.api_secret).trim()
    : '';
  const trimmedFromNumber = smsData.from_number
    ? String(smsData.from_number).trim()
    : '';

  converted.channels.sms = {
    enabled: isChecked(smsData.enabled),
    // Explicitly set undefined for empty values to allow clearing existing values
    provider: trimmedProvider || undefined,
    api_key: trimmedApiKey || undefined,
    api_secret: trimmedApiSecret || undefined,
    from_number: trimmedFromNumber || undefined,
  };

  if (smsData.rate_limits) {
    const rl = smsData.rate_limits;
    converted.channels.sms.rate_limits = {} as Record<string, number>;
    if (rl.per_phone_per_hour) {
      converted.channels.sms.rate_limits.per_phone_per_hour = parseInt(
        rl.per_phone_per_hour,
        10
      );
    }
    if (rl.per_ip_per_day) {
      converted.channels.sms.rate_limits.per_ip_per_day = parseInt(
        rl.per_ip_per_day,
        10
      );
    }
    if (rl.cooldown_seconds) {
      converted.channels.sms.rate_limits.cooldown_seconds = parseInt(
        rl.cooldown_seconds,
        10
      );
    }
  }

  // Defaults section - all checkboxes, so missing = unchecked = false
  const defaultsData = converted.defaults || {};
  converted.defaults = {
    security_alerts: isChecked(defaultsData.security_alerts),
    new_session_alerts: isChecked(defaultsData.new_session_alerts),
    allow_user_preferences: isChecked(defaultsData.allow_user_preferences),
  };

  return converted;
}

/**
 * Convert security form data to proper types
 * @param data - The form data to convert
 * @returns Converted security data
 */
export function convertSecurityFormData(data: any): any {
  let converted = { ...data };

  if (converted.protection && converted.protection.rate_limiting) {
    if (converted.protection.rate_limiting.requests_per_minute) {
      converted.protection.rate_limiting.requests_per_minute = parseInt(
        converted.protection.rate_limiting.requests_per_minute,
        10
      );
    }
    if (converted.protection.rate_limiting.window_minutes) {
      converted.protection.rate_limiting.window_minutes = parseInt(
        converted.protection.rate_limiting.window_minutes,
        10
      );
    }
  }

  if (
    converted.authentication &&
    converted.authentication.login &&
    converted.authentication.login.password_policy
  ) {
    if (converted.authentication.login.password_policy.min_length) {
      converted.authentication.login.password_policy.min_length = parseInt(
        converted.authentication.login.password_policy.min_length,
        10
      );
    }
    if (converted.authentication.login.password_policy.max_age_days) {
      converted.authentication.login.password_policy.max_age_days = parseInt(
        converted.authentication.login.password_policy.max_age_days,
        10
      );
    }
  }

  if (
    converted.authentication &&
    converted.authentication.recovery &&
    converted.authentication.recovery.backup_codes
  ) {
    if (converted.authentication.recovery.backup_codes.count) {
      converted.authentication.recovery.backup_codes.count = parseInt(
        converted.authentication.recovery.backup_codes.count,
        10
      );
    }
    if (converted.authentication.recovery.backup_codes.expiry_days) {
      converted.authentication.recovery.backup_codes.expiry_days = parseInt(
        converted.authentication.recovery.backup_codes.expiry_days,
        10
      );
    }
  }

  if (
    converted.authentication &&
    converted.authentication.password_breach_detection
  ) {
    const pbd = converted.authentication.password_breach_detection;

    // Coerce checkbox booleans (standard checkboxes send "on" or are absent)
    const isChecked = (value: any): boolean => {
      if (Array.isArray(value)) return value.includes('on');
      return value === 'true' || value === true || value === 'on';
    };

    pbd.enabled = isChecked(pbd.enabled);
    pbd.check_on_registration = isChecked(pbd.check_on_registration);
    pbd.check_on_login = isChecked(pbd.check_on_login);
    pbd.check_on_password_reset = isChecked(pbd.check_on_password_reset);
    pbd.check_on_password_change = isChecked(pbd.check_on_password_change);

    if (pbd.api_timeout_ms) {
      pbd.api_timeout_ms = parseInt(pbd.api_timeout_ms, 10);
    }
    if (pbd.min_breach_count) {
      pbd.min_breach_count = parseInt(pbd.min_breach_count, 10);
    }
  }

  if (converted.authentication && converted.authentication.session) {
    if (converted.authentication.session.idle_timeout_minutes) {
      converted.authentication.session.idle_timeout_minutes = parseInt(
        converted.authentication.session.idle_timeout_minutes,
        10
      );
    }
    if (converted.authentication.session.absolute_timeout_hours) {
      converted.authentication.session.absolute_timeout_hours = parseInt(
        converted.authentication.session.absolute_timeout_hours,
        10
      );
    }
    if (converted.authentication.session.max_concurrent_sessions) {
      converted.authentication.session.max_concurrent_sessions = parseInt(
        converted.authentication.session.max_concurrent_sessions,
        10
      );
    }
    if (converted.authentication.session.max_accounts_per_session) {
      converted.authentication.session.max_accounts_per_session = parseInt(
        converted.authentication.session.max_accounts_per_session,
        10
      );
    }
    if (converted.authentication.session.new_device_confidence_threshold) {
      converted.authentication.session.new_device_confidence_threshold =
        parseInt(
          converted.authentication.session.new_device_confidence_threshold,
          10
        );
    }
    if (converted.authentication.session.cookie_name) {
      converted.authentication.session.cookie_name =
        converted.authentication.session.cookie_name.trim();
    }
    if (converted.authentication.session.same_site) {
      converted.authentication.session.same_site =
        converted.authentication.session.same_site.trim();
    }
  }

  if (
    converted.logging &&
    converted.logging.file_logging &&
    converted.logging.file_logging.max_files
  ) {
    converted.logging.file_logging.max_files = parseInt(
      converted.logging.file_logging.max_files,
      10
    );
  }

  if (
    converted.secrets &&
    converted.secrets.cookie_secrets &&
    typeof converted.secrets.cookie_secrets === 'string'
  ) {
    converted.secrets.cookie_secrets = converted.secrets.cookie_secrets
      .split('\n')
      .map((secret: string) => secret.trim())
      .filter((secret: string) => secret);
  }

  if (
    converted.protection &&
    converted.protection.trusted_domains &&
    typeof converted.protection.trusted_domains === 'string'
  ) {
    converted.protection.trusted_domains = converted.protection.trusted_domains
      .split('\n')
      .map((domain: string) => domain.trim())
      .filter((domain: string) => domain);
  }

  if (
    converted.protection &&
    typeof converted.protection.trusted_proxies === 'string'
  ) {
    converted.protection.trusted_proxies = converted.protection.trusted_proxies
      ? converted.protection.trusted_proxies
          .split('\n')
          .map((proxy: string) => proxy.trim())
          .filter((proxy: string) => proxy)
      : [];
  }

  if (
    converted.protection &&
    typeof converted.protection.high_risk_countries === 'string'
  ) {
    converted.protection.high_risk_countries = converted.protection
      .high_risk_countries
      ? converted.protection.high_risk_countries
          .split('\n')
          .map((country: string) => country.trim().toUpperCase())
          .filter((country: string) => /^[A-Z]{2}$/.test(country))
      : [];
  }

  if (converted.protection && converted.protection.device_matching) {
    const dm = converted.protection.device_matching;

    if (dm.min_confidence_score !== undefined) {
      dm.min_confidence_score = parseInt(dm.min_confidence_score, 10);
    }
    if (dm.ip_similarity_threshold !== undefined) {
      dm.ip_similarity_threshold = parseFloat(dm.ip_similarity_threshold);
    }
    if (dm.impossible_travel_max_speed_kmh !== undefined) {
      dm.impossible_travel_max_speed_kmh = parseInt(
        dm.impossible_travel_max_speed_kmh,
        10
      );
    }
    if (dm.trust_duration_days !== undefined) {
      dm.trust_duration_days = parseInt(dm.trust_duration_days, 10);
    }
    if (dm.similarity_threshold !== undefined) {
      dm.similarity_threshold = parseInt(dm.similarity_threshold, 10);
    }
    if (dm.new_device_confidence_threshold !== undefined) {
      dm.new_device_confidence_threshold = parseInt(
        dm.new_device_confidence_threshold,
        10
      );
    }

    if (dm.enable_impossible_travel !== undefined) {
      dm.enable_impossible_travel =
        dm.enable_impossible_travel === 'true' ||
        dm.enable_impossible_travel === true ||
        dm.enable_impossible_travel === 'on';
    }
  }

  if (
    converted.authentication &&
    converted.authentication.login &&
    converted.authentication.login.login_methods
  ) {
    if (!Array.isArray(converted.authentication.login.login_methods)) {
      converted.authentication.login.login_methods = [
        converted.authentication.login.login_methods,
      ];
    }
    // Normalize: filter values containing at least one valid method part
    const VALID_LOGIN_PARTS = [
      'email',
      'phone',
      'phone_number',
      'custom_identifier',
      'password',
      'otp',
      'webauthn',
    ];
    converted.authentication.login.login_methods =
      converted.authentication.login.login_methods.filter(
        (m: string) =>
          m &&
          m.trim() !== '' &&
          VALID_LOGIN_PARTS.some(part => m.includes(part))
      );
    if (converted.authentication.login.login_methods.length === 0) {
      converted.authentication.login.login_methods = ['email+password'];
    }
  }

  if (
    converted.authentication &&
    converted.authentication.signup &&
    converted.authentication.signup.signup_methods
  ) {
    if (!Array.isArray(converted.authentication.signup.signup_methods)) {
      converted.authentication.signup.signup_methods = [
        converted.authentication.signup.signup_methods,
      ];
    }
    // Normalize: filter values containing at least one valid method part
    const VALID_SIGNUP_PARTS = [
      'email',
      'phone',
      'phone_number',
      'custom_identifier',
      'full_name',
      'password',
      'otp',
      'webauthn',
    ];
    converted.authentication.signup.signup_methods =
      converted.authentication.signup.signup_methods.filter(
        (m: string) =>
          m &&
          m.trim() !== '' &&
          VALID_SIGNUP_PARTS.some(part => m.includes(part))
      );
    if (converted.authentication.signup.signup_methods.length === 0) {
      converted.authentication.signup.signup_methods = ['email+password'];
    }
  }

  if (converted.authentication && converted.authentication.roles) {
    const CORE_ROLES = ['user', 'admin', 'superadmin'];

    if (
      converted.authentication.roles.available &&
      typeof converted.authentication.roles.available === 'string'
    ) {
      converted.authentication.roles.available =
        converted.authentication.roles.available
          .split('\n')
          .map((role: string) => role.trim())
          .filter((role: string) => role.length > 0);

      // Always ensure core roles are included
      CORE_ROLES.forEach(coreRole => {
        if (!converted.authentication.roles.available.includes(coreRole)) {
          converted.authentication.roles.available.push(coreRole);
        }
      });
    } else if (Array.isArray(converted.authentication.roles.available)) {
      converted.authentication.roles.available =
        converted.authentication.roles.available
          .map((role: string) => role.trim())
          .filter((role: string) => role.length > 0);

      // Always ensure core roles are included
      CORE_ROLES.forEach(coreRole => {
        if (!converted.authentication.roles.available.includes(coreRole)) {
          converted.authentication.roles.available.push(coreRole);
        }
      });
    }

    if (
      converted.authentication.roles.default &&
      typeof converted.authentication.roles.default === 'string'
    ) {
      converted.authentication.roles.default =
        converted.authentication.roles.default.trim();
    }

    delete converted.authentication.roles.admin_roles;
    delete converted.authentication.roles.system_roles;
  }

  if (
    converted.authentication &&
    converted.authentication.signup &&
    converted.authentication.signup.auto_approval &&
    converted.authentication.signup.auto_approval.domains_whitelist
  ) {
    if (
      typeof converted.authentication.signup.auto_approval.domains_whitelist ===
      'string'
    ) {
      converted.authentication.signup.auto_approval.domains_whitelist =
        converted.authentication.signup.auto_approval.domains_whitelist
          .split('\n')
          .map((domain: string) => domain.trim())
          .filter((domain: string) => domain);
    }
  }

  if (
    converted.logging &&
    converted.logging.http_logging &&
    converted.logging.http_logging.ignore_paths
  ) {
    if (typeof converted.logging.http_logging.ignore_paths === 'string') {
      converted.logging.http_logging.ignore_paths =
        converted.logging.http_logging.ignore_paths
          .split('\n')
          .map((path: string) => path.trim())
          .filter((path: string) => path);
    }
  }

  if (
    converted.logging &&
    converted.logging.redaction &&
    converted.logging.redaction.paths
  ) {
    if (typeof converted.logging.redaction.paths === 'string') {
      converted.logging.redaction.paths = converted.logging.redaction.paths
        .split('\n')
        .map((path: string) => path.trim())
        .filter((path: string) => path);
    }
  }

  // custom_identifiers.fields is an array of objects — ensure proper shape
  if (
    converted.authentication &&
    converted.authentication.custom_identifiers &&
    converted.authentication.custom_identifiers.fields
  ) {
    const fields = converted.authentication.custom_identifiers.fields;

    // HTML hidden+checkbox pattern sends arrays: [""] (unchecked) or ["", "on"] (checked)
    const isChecked = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.includes('on');
      return value === true || value === 'true' || value === 'on';
    };

    if (Array.isArray(fields)) {
      converted.authentication.custom_identifiers.fields = fields
        .filter((f: Record<string, unknown>) => f && f.key)
        .map((f: Record<string, unknown>) => ({
          slot: Number(f.slot) || 1,
          key: String(f.key || ''),
          name: String(f.name || ''),
          hint_for_user: String(f.hint_for_user || ''),
          validation_type: String(f.validation_type || 'none'),
          pattern: f.pattern ? String(f.pattern) : undefined,
          charset: f.charset ? String(f.charset) : undefined,
          mask: f.mask ? String(f.mask) : undefined,
          min_length: Number(f.min_length) || 1,
          max_length: Number(f.max_length) || 100,
          edit_policy: String(f.edit_policy || 'set_once'),
          case_sensitive: isChecked(f.case_sensitive),
          required_for_registration: isChecked(f.required_for_registration),
          usable_for_login: isChecked(f.usable_for_login),
        }));
    }
  }

  if (converted.secrets && !converted.secrets.cookie_secrets) {
    converted.secrets.cookie_secrets = [];
  }

  if (converted.protection && !converted.protection.trusted_domains) {
    converted.protection.trusted_domains = [];
  }

  if (
    converted.authentication &&
    converted.authentication.signup &&
    converted.authentication.signup.auto_approval &&
    !converted.authentication.signup.auto_approval.domains_whitelist
  ) {
    converted.authentication.signup.auto_approval.domains_whitelist = [];
  }

  if (converted.authentication && converted.authentication.roles) {
    if (!converted.authentication.roles.available) {
      converted.authentication.roles.available = [
        'user',
        'admin',
        'superadmin',
      ];
    }
    // admin_roles and system_roles are not part of the schema - removed
  }

  if (
    converted.authentication &&
    converted.authentication.custom_identifiers &&
    !converted.authentication.custom_identifiers.fields
  ) {
    converted.authentication.custom_identifiers.fields = [];
  }

  if (
    converted.logging &&
    converted.logging.http_logging &&
    !converted.logging.http_logging.ignore_paths
  ) {
    converted.logging.http_logging.ignore_paths = [];
  }

  if (
    converted.logging &&
    converted.logging.redaction &&
    !converted.logging.redaction.paths
  ) {
    converted.logging.redaction.paths = [];
  }

  if (converted.authentication?.multi_factor?.email) {
    const email = converted.authentication.multi_factor.email;
    if (email.code_ttl_seconds !== undefined) {
      email.code_ttl_seconds = parseInt(email.code_ttl_seconds, 10);
    }
  }

  if (converted.authentication?.multi_factor?.webauthn) {
    const webauthn = converted.authentication.multi_factor.webauthn;
    if (webauthn.timeout !== undefined) {
      webauthn.timeout = parseInt(webauthn.timeout, 10);
    }
    if (webauthn.max_credentials_per_user !== undefined) {
      webauthn.max_credentials_per_user = parseInt(
        webauthn.max_credentials_per_user,
        10
      );
    }
    if (
      webauthn.authenticator_attachment === '' ||
      webauthn.authenticator_attachment === 'any'
    ) {
      delete webauthn.authenticator_attachment;
    }
  }

  const booleanFields = [
    'protection.rate_limiting.enabled',
    'authentication.multi_factor.enabled',
    'authentication.multi_factor.totp.enabled',
    'authentication.multi_factor.email.enabled',
    'authentication.multi_factor.sms.enabled',
    'authentication.multi_factor.webauthn.enabled',
    'authentication.session_management.multiple_accounts.enabled',
    'authentication.session.bind_ip',
    'authentication.session.bind_user_agent',
    'authentication.session.bind_device',
    'authentication.session.encrypt_session_data',
    'authentication.session.notify_new_session',
    'authentication.session.require_reauth_on_switch',
    'authentication.session.store_metadata',
    'authentication.session.require_2fa_for_new_device',
    'protection.encrypt_device_data',
    'authentication.login.password_policy.require_uppercase',
    'authentication.login.password_policy.require_lowercase',
    'authentication.login.password_policy.require_numbers',
    'authentication.login.password_policy.require_symbols',
    'authentication.signup.require_email_verification',
    'authentication.signup.require_phone_verification',
    'authentication.signup.auto_approval.enabled',
    'authentication.signup.contact_channels.require_at_least_one',
    'authentication.signup.contact_channels.email.enabled',
    'authentication.signup.contact_channels.email.required',
    'authentication.signup.contact_channels.phone.enabled',
    'authentication.signup.contact_channels.phone.required',
    'authentication.signup.contact_channels.full_name.enabled',
    'authentication.signup.contact_channels.full_name.required',
    'authentication.custom_identifiers.enabled',
    'authentication.recovery.enabled',
    'authentication.recovery.backup_codes.enabled',
    'authentication.recovery.secondary_email.enabled',
    'authentication.recovery.sms.enabled',
    'authentication.recovery.security_questions.enabled',
    'logging.enabled',
    'logging.pretty_print',
    'logging.file_logging.enabled',
    'logging.http_logging.enabled',
    'logging.redaction.enabled',
  ];

  converted = convertBooleanFields(converted, booleanFields);

  return converted;
}

/**
 * Get section icon for settings overview
 * @param sectionKey - The section key
 * @returns The icon name for the section
 */
export function getSectionIcon(sectionKey: string): string {
  const icons: { [key: string]: string } = {
    application: 'cog',
    branding: 'palette',
    deployment: 'server',
    security: 'shield-check',
    features: 'sparkles',
    oidc: 'key',
    integrations: 'plug',
  };
  return icons[sectionKey] || 'cog';
}

/**
 * Check if section is configured
 * @param config - The configuration object
 * @param sectionKey - The section key to check
 * @returns True if section is configured, false otherwise
 */
export function getSectionStatus(config: any, sectionKey: string): boolean {
  return !!(config as any)[sectionKey];
}
