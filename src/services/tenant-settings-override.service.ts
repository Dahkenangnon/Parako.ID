import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ITenantSettingsOverrideService } from '../di/interfaces/tenant-settings-override-service.interface.js';
import type { ITenantSettingsOverrideRepository } from '../db/repositories/interfaces/tenant-settings-override.repository.js';
import type { ITenantSettingsOverride } from '../types/tenant-settings-override.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';
import { ensureEncrypted } from '../utils/encryption.js';
import { getNestedValue, setNestedValue } from '../utils/nested-value.js';

// ── Field-Level Whitelist ───────────────────────────────────────────────────

/**
 * Exhaustive set of dot-paths that tenants may override.
 * Any path not in this set is stripped by stripDisallowedFields().
 *
 * Derived from docs/config-layer-reason.md "Final Verdict" section.
 * Includes free-override, floor-constrained, and ceiling-constrained fields.
 */
export const ALLOWED_TENANT_FIELDS = new Set<string>([
  // ── application ───────────────────────────────────────────────────────────
  'application.title',
  'application.description',
  'application.locales.default',
  'application.locales.available',

  // ── branding (excluding ui.customization.*) ───────────────────────────────
  'branding.companyName',
  'branding.logo',
  'branding.logoDark',
  'branding.logoIcon',
  'branding.logoIconDark',
  'branding.favicon',
  'branding.fonts.sans',
  'branding.fonts.heading',
  'branding.fonts.mono',
  // 33 light-mode color fields
  'branding.colors.light.primary',
  'branding.colors.light.primaryForeground',
  'branding.colors.light.secondary',
  'branding.colors.light.secondaryForeground',
  'branding.colors.light.accent',
  'branding.colors.light.accentForeground',
  'branding.colors.light.destructive',
  'branding.colors.light.destructiveForeground',
  'branding.colors.light.success',
  'branding.colors.light.successForeground',
  'branding.colors.light.warning',
  'branding.colors.light.warningForeground',
  'branding.colors.light.info',
  'branding.colors.light.infoForeground',
  'branding.colors.light.background',
  'branding.colors.light.foreground',
  'branding.colors.light.card',
  'branding.colors.light.cardForeground',
  'branding.colors.light.popover',
  'branding.colors.light.popoverForeground',
  'branding.colors.light.muted',
  'branding.colors.light.mutedForeground',
  'branding.colors.light.border',
  'branding.colors.light.input',
  'branding.colors.light.ring',
  'branding.colors.light.sidebar',
  'branding.colors.light.sidebarForeground',
  'branding.colors.light.sidebarPrimary',
  'branding.colors.light.sidebarPrimaryForeground',
  'branding.colors.light.sidebarAccent',
  'branding.colors.light.sidebarAccentForeground',
  'branding.colors.light.sidebarBorder',
  'branding.colors.light.sidebarRing',
  // 33 dark-mode color fields
  'branding.colors.dark.primary',
  'branding.colors.dark.primaryForeground',
  'branding.colors.dark.secondary',
  'branding.colors.dark.secondaryForeground',
  'branding.colors.dark.accent',
  'branding.colors.dark.accentForeground',
  'branding.colors.dark.destructive',
  'branding.colors.dark.destructiveForeground',
  'branding.colors.dark.success',
  'branding.colors.dark.successForeground',
  'branding.colors.dark.warning',
  'branding.colors.dark.warningForeground',
  'branding.colors.dark.info',
  'branding.colors.dark.infoForeground',
  'branding.colors.dark.background',
  'branding.colors.dark.foreground',
  'branding.colors.dark.card',
  'branding.colors.dark.cardForeground',
  'branding.colors.dark.popover',
  'branding.colors.dark.popoverForeground',
  'branding.colors.dark.muted',
  'branding.colors.dark.mutedForeground',
  'branding.colors.dark.border',
  'branding.colors.dark.input',
  'branding.colors.dark.ring',
  'branding.colors.dark.sidebar',
  'branding.colors.dark.sidebarForeground',
  'branding.colors.dark.sidebarPrimary',
  'branding.colors.dark.sidebarPrimaryForeground',
  'branding.colors.dark.sidebarAccent',
  'branding.colors.dark.sidebarAccentForeground',
  'branding.colors.dark.sidebarBorder',
  'branding.colors.dark.sidebarRing',

  // ── security.authentication ───────────────────────────────────────────────
  'security.authentication.multi_factor.enabled',
  'security.authentication.multi_factor.totp.enabled',
  'security.authentication.multi_factor.totp.issuer_name',
  'security.authentication.multi_factor.email.enabled',
  'security.authentication.multi_factor.email.code_ttl_seconds',
  'security.authentication.multi_factor.sms.enabled',
  'security.authentication.multi_factor.webauthn.enabled',
  'security.authentication.multi_factor.webauthn.rp_name',
  'security.authentication.multi_factor.webauthn.timeout',
  'security.authentication.multi_factor.webauthn.user_verification',
  'security.authentication.multi_factor.webauthn.authenticator_attachment',
  'security.authentication.multi_factor.webauthn.resident_key',
  'security.authentication.multi_factor.webauthn.max_credentials_per_user',
  'security.authentication.session_management.multiple_accounts.enabled',
  'security.authentication.session.bind_ip',
  'security.authentication.session.bind_user_agent',
  'security.authentication.session.bind_device',
  'security.authentication.session.idle_timeout_minutes',
  'security.authentication.session.absolute_timeout_hours',
  'security.authentication.session.max_concurrent_sessions',
  'security.authentication.session.max_accounts_per_session',
  'security.authentication.session.encrypt_session_data',
  'security.authentication.session.notify_new_session',
  'security.authentication.session.require_reauth_on_switch',
  'security.authentication.session.require_2fa_for_new_device',
  'security.authentication.session.new_device_2fa_method',
  'security.authentication.session.new_device_confidence_threshold',
  'security.authentication.login.login_methods',
  'security.authentication.login.password_policy.min_length',
  'security.authentication.login.password_policy.require_uppercase',
  'security.authentication.login.password_policy.require_lowercase',
  'security.authentication.login.password_policy.require_numbers',
  'security.authentication.login.password_policy.require_symbols',
  'security.authentication.login.password_policy.max_age_days',
  'security.authentication.signup.signup_methods',
  'security.authentication.signup.require_email_verification',
  'security.authentication.signup.require_phone_verification',
  'security.authentication.signup.auto_approval.enabled',
  'security.authentication.signup.auto_approval.domains_whitelist',
  'security.authentication.signup.contact_channels',
  'security.authentication.roles.default',
  'security.authentication.custom_identifiers',
  'security.authentication.recovery',

  // ── security.protection ───────────────────────────────────────────────────
  'security.protection.rate_limiting.enabled',
  'security.protection.rate_limiting.requests_per_minute',
  'security.protection.rate_limiting.window_minutes',
  'security.protection.high_risk_countries',
  'security.protection.encrypt_device_data',
  'security.protection.device_matching.min_confidence_score',
  'security.protection.device_matching.ip_similarity_threshold',
  'security.protection.device_matching.impossible_travel_max_speed_kmh',
  'security.protection.device_matching.trust_duration_days',

  // ── features ──────────────────────────────────────────────────────────────
  'features.social_providers.enabled',
  'features.social_providers.behavior',
  'features.social_providers.google.client_id',
  'features.social_providers.google.client_secret',
  'features.social_providers.github.client_id',
  'features.social_providers.github.client_secret',
  'features.social_providers.microsoft.client_id',
  'features.social_providers.microsoft.client_secret',
  'features.social_providers.linkedin.client_id',
  'features.social_providers.linkedin.client_secret',
  'features.social_providers.facebook.client_id',
  'features.social_providers.facebook.client_secret',

  // ── oidc ──────────────────────────────────────────────────────────────────
  'oidc.discovery.claims_locales_supported',
  'oidc.discovery.ui_locales_supported',
  'oidc.discovery.display_values_supported',
  'oidc.discovery.service_documentation',
  'oidc.discovery.op_policy_uri',
  'oidc.discovery.op_tos_uri',
  'oidc.token_ttl.access_token',
  'oidc.token_ttl.authorization_code',
  'oidc.token_ttl.backchannel_auth',
  'oidc.token_ttl.client_credentials',
  'oidc.token_ttl.device_code',
  'oidc.token_ttl.grant',
  'oidc.token_ttl.id_token',
  'oidc.token_ttl.interaction',
  'oidc.token_ttl.refresh_token',
  'oidc.token_ttl.session',

  // ── integrations ──────────────────────────────────────────────────────────
  'integrations.email.smtp_host',
  'integrations.email.smtp_port',
  'integrations.email.smtp_username',
  'integrations.email.smtp_password',
  'integrations.email.from',
  'integrations.email.tls_reject_unauthorized',
  'integrations.urls.website',
  'integrations.urls.privacy_policy',
  'integrations.urls.terms_of_service',
  'integrations.urls.contact',

  // ── notifications ─────────────────────────────────────────────────────────
  'notifications.channels.email.enabled',
  'notifications.channels.sms.enabled',
  'notifications.channels.sms.provider',
  'notifications.channels.sms.api_key',
  'notifications.channels.sms.api_secret',
  'notifications.channels.sms.from_number',
  'notifications.channels.sms.rate_limits.per_phone_per_hour',
  'notifications.channels.sms.rate_limits.per_ip_per_day',
  'notifications.channels.sms.rate_limits.cooldown_seconds',
  'notifications.defaults.security_alerts',
  'notifications.defaults.new_session_alerts',
  'notifications.defaults.allow_user_preferences',
]);

/**
 * Top-level sections that may appear in override documents.
 * Used to iterate sections when loading/deleting overrides.
 */
const ALLOWED_OVERRIDE_SECTIONS = new Set([
  'application',
  'branding',
  'security',
  'features',
  'oidc',
  'integrations',
  'notifications',
]);

// ── Sensitive Fields (encryption) ───────────────────────────────────────────

/**
 * Sensitive fields that must be encrypted before storage.
 * Dot-path notation relative to the override document root.
 */
export const TENANT_SENSITIVE_FIELDS = [
  'integrations.email.smtp_password',
  'notifications.channels.sms.api_key',
  'notifications.channels.sms.api_secret',
  'features.social_providers.google.client_secret',
  'features.social_providers.github.client_secret',
  'features.social_providers.microsoft.client_secret',
  'features.social_providers.linkedin.client_secret',
  'features.social_providers.facebook.client_secret',
];

// ── Floor/Ceiling Constraints ───────────────────────────────────────────────

/**
 * Boolean floor constraints: if platform=true, tenant cannot set false.
 * Numeric floor constraints: tenant value must be >= platform value.
 */
const FLOOR_CONSTRAINTS = new Map<string, 'boolean' | 'numeric'>([
  // boolean floors
  ['security.authentication.multi_factor.enabled', 'boolean'],
  ['security.authentication.multi_factor.totp.enabled', 'boolean'],
  ['security.authentication.multi_factor.email.enabled', 'boolean'],
  ['security.authentication.multi_factor.sms.enabled', 'boolean'],
  ['security.authentication.multi_factor.webauthn.enabled', 'boolean'],
  [
    'security.authentication.login.password_policy.require_uppercase',
    'boolean',
  ],
  [
    'security.authentication.login.password_policy.require_lowercase',
    'boolean',
  ],
  ['security.authentication.login.password_policy.require_numbers', 'boolean'],
  ['security.authentication.login.password_policy.require_symbols', 'boolean'],
  ['security.authentication.signup.require_email_verification', 'boolean'],
  ['security.authentication.signup.require_phone_verification', 'boolean'],
  ['security.authentication.session.bind_ip', 'boolean'],
  ['security.authentication.session.bind_user_agent', 'boolean'],
  ['security.authentication.session.bind_device', 'boolean'],
  ['security.authentication.session.encrypt_session_data', 'boolean'],
  ['security.authentication.session.require_reauth_on_switch', 'boolean'],
  ['security.authentication.session.require_2fa_for_new_device', 'boolean'],
  ['security.protection.encrypt_device_data', 'boolean'],
  ['security.protection.rate_limiting.enabled', 'boolean'],
  // numeric floors
  ['security.authentication.login.password_policy.min_length', 'numeric'],
  ['security.protection.device_matching.min_confidence_score', 'numeric'],
  ['security.protection.device_matching.ip_similarity_threshold', 'numeric'],
  [
    'security.authentication.session.new_device_confidence_threshold',
    'numeric',
  ],
]);

/**
 * Ceiling constraints: tenant value must be <= platform value.
 * All numeric. Special handling for 0=unlimited fields.
 */
const CEILING_CONSTRAINTS = new Set<string>([
  'security.authentication.multi_factor.email.code_ttl_seconds',
  'security.authentication.multi_factor.webauthn.max_credentials_per_user',
  'security.authentication.login.password_policy.max_age_days',
  'security.authentication.session.idle_timeout_minutes',
  'security.authentication.session.absolute_timeout_hours',
  'security.authentication.session.max_concurrent_sessions',
  'security.authentication.session.max_accounts_per_session',
  'security.protection.rate_limiting.requests_per_minute',
  'security.protection.rate_limiting.window_minutes',
  'security.protection.device_matching.impossible_travel_max_speed_kmh',
  'security.protection.device_matching.trust_duration_days',
  'oidc.token_ttl.access_token',
  'oidc.token_ttl.authorization_code',
  'oidc.token_ttl.backchannel_auth',
  'oidc.token_ttl.client_credentials',
  'oidc.token_ttl.device_code',
  'oidc.token_ttl.grant',
  'oidc.token_ttl.id_token',
  'oidc.token_ttl.interaction',
  'oidc.token_ttl.refresh_token',
  'oidc.token_ttl.session',
  'notifications.channels.sms.rate_limits.per_phone_per_hour',
  'notifications.channels.sms.rate_limits.per_ip_per_day',
  'notifications.channels.sms.rate_limits.cooldown_seconds',
]);

/**
 * Fields where 0 means "unlimited" and should be exempt from ceiling logic.
 * When platform=0 (unlimited), any tenant value is valid.
 * When platform>0 and tenant=0 (unlimited), enforce platform ceiling.
 */
const ZERO_MEANS_UNLIMITED = new Set([
  'security.authentication.session.max_concurrent_sessions',
  'security.authentication.session.idle_timeout_minutes',
  'security.authentication.session.absolute_timeout_hours',
]);

/**
 * Ordered enum for webauthn.user_verification.
 * Lower index = weaker. Tenant cannot weaken below platform value.
 */
const USER_VERIFICATION_ORDER: readonly string[] = [
  'discouraged',
  'preferred',
  'required',
];

/** Absolute minimum password length per NIST SP 800-63B */
const NIST_MIN_PASSWORD_LENGTH = 8;

// ── Constraint Violation ────────────────────────────────────────────────────

export interface ConstraintViolation {
  field: string;
  original: unknown;
  adjusted: unknown;
  reason: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

@injectable()
export class TenantSettingsOverrideService implements ITenantSettingsOverrideService {
  constructor(
    @inject(TYPES.TenantSettingsOverrideRepository)
    private readonly repo: ITenantSettingsOverrideRepository,
    @inject(TYPES.Logger) private readonly logger: ILogger
  ) {}

  // ── Load ──────────────────────────────────────────────────────────────────

  async loadOverrides(
    tenantId: string
  ): Promise<Partial<ITenantSettingsOverride> | null> {
    return tenantContext.run(tenantId, async () => {
      const doc = await this.repo.findActive();
      if (!doc) return null;

      const overrides: Partial<ITenantSettingsOverride> = {};
      for (const section of ALLOWED_OVERRIDE_SECTIONS) {
        const value = (doc as Record<string, any>)[section];
        if (value !== undefined && value !== null) {
          (overrides as Record<string, any>)[section] = value;
        }
      }
      return Object.keys(overrides).length > 0 ? overrides : null;
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async saveOverrides(
    tenantId: string,
    overrides: Partial<ITenantSettingsOverride>,
    modifiedBy?: string,
    reason?: string,
    platformConfig?: Record<string, any> | null
  ): Promise<ITenantSettingsOverride> {
    // 1. Section-level filter (quick reject for unknown top-level keys)
    const sectionFiltered: Record<string, any> = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (ALLOWED_OVERRIDE_SECTIONS.has(key)) {
        sectionFiltered[key] = value;
      } else {
        this.logger.warn(`Rejected non-whitelisted override section: ${key}`, {
          tenantId,
        });
      }
    }

    if (Object.keys(sectionFiltered).length === 0) {
      throw new Error(
        `No valid override fields provided. Only these sections can be overridden: ${Array.from(ALLOWED_OVERRIDE_SECTIONS).join(', ')}`
      );
    }

    // 2. Field-level whitelist — strip any path not in ALLOWED_TENANT_FIELDS
    const stripped = this.stripDisallowedFields(sectionFiltered, tenantId);

    if (Object.keys(stripped).length === 0) {
      throw new Error(
        'No valid override fields provided after field-level filtering'
      );
    }

    // 2b. Strip empty string values — empty string in a form means "use default"
    const sanitized = this.stripEmptyValues(stripped);

    if (Object.keys(sanitized).length === 0) {
      throw new Error(
        'No valid override fields provided after empty-value filtering'
      );
    }

    // 3. Floor/ceiling constraint enforcement
    // Platform config is passed explicitly by the caller (controller) to avoid
    // a circular DI dependency: ConfigManager → this service → ConfigManager.
    const { result: constrained, violations } = this.enforceConstraints(
      sanitized,
      platformConfig ?? null
    );
    if (violations.length > 0) {
      for (const v of violations) {
        this.logger.warn(
          `Constraint adjusted field '${v.field}': ${String(v.original)} → ${String(v.adjusted)} (${v.reason})`,
          { tenantId }
        );
      }
    }

    return tenantContext.run(tenantId, async () => {
      const existing = await this.repo.findActive();
      const merged: Record<string, any> = {};

      // Carry forward existing whitelisted sections
      if (existing) {
        for (const section of ALLOWED_OVERRIDE_SECTIONS) {
          const value = (existing as Record<string, any>)[section];
          if (value !== undefined && value !== null) {
            merged[section] = value;
          }
        }
      }

      // 4. Encrypt sensitive fields (pass existing data so masked sentinels
      // can be resolved to their current encrypted values)
      const encrypted = this._encryptSensitiveFields(
        constrained,
        existing as Record<string, any> | null
      );

      for (const [key, value] of Object.entries(encrypted)) {
        merged[key] = value;
      }

      return this.repo.save(merged as Partial<ITenantSettingsOverride>, {
        modifiedBy,
        reason: reason ?? 'Tenant configuration update',
      });
    });
  }

  // ── Delete Section ────────────────────────────────────────────────────────

  async deleteSection(
    tenantId: string,
    section: string,
    modifiedBy?: string,
    reason?: string
  ): Promise<{ reset: true; section: string }> {
    if (!ALLOWED_OVERRIDE_SECTIONS.has(section)) {
      throw new Error(`Section '${section}' is not a valid override section`);
    }

    return tenantContext.run(tenantId, async () => {
      const doc = await this.repo.findActive();
      if (!doc) {
        return { reset: true as const, section };
      }

      const updates: Record<string, any> = {};
      let remainingSections = 0;

      for (const s of ALLOWED_OVERRIDE_SECTIONS) {
        if (s === section) continue;
        const value = (doc as Record<string, any>)[s];
        if (value !== undefined && value !== null) {
          updates[s] = value;
          remainingSections++;
        }
      }

      if (remainingSections === 0) {
        await this.repo.save({} as Partial<ITenantSettingsOverride>, {
          modifiedBy,
          reason: reason ?? `Reset ${section} configuration (doc deactivated)`,
        });
      } else {
        (updates as any)[section] = null;
        await this.repo.save(updates as Partial<ITenantSettingsOverride>, {
          modifiedBy,
          reason: reason ?? `Reset ${section} configuration`,
        });
      }

      this.logger.info(
        `Deleted override section '${section}' for tenant '${tenantId}'`
      );
      return { reset: true as const, section };
    });
  }

  // ── Strip Disallowed Fields ───────────────────────────────────────────────

  /**
   * Recursively walk incoming override object, building dot-paths.
   * Remove any path not in ALLOWED_TENANT_FIELDS.
   * Returns a new (deep-cloned) object with only allowed fields.
   */
  stripDisallowedFields(
    incoming: Record<string, any>,
    tenantId?: string
  ): Record<string, any> {
    const result: Record<string, any> = {};

    const walk = (obj: Record<string, any>, prefix: string): void => {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          // like custom_identifiers, recovery, behavior, contact_channels)
          if (ALLOWED_TENANT_FIELDS.has(path)) {
            setNestedValue(result, path, JSON.parse(JSON.stringify(value)));
          } else {
            // Recurse into sub-objects
            walk(value, path);
          }
        } else {
          // Leaf value (string, number, boolean, array, null)
          if (ALLOWED_TENANT_FIELDS.has(path)) {
            setNestedValue(
              result,
              path,
              Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value
            );
          } else {
            this.logger.warn(
              `Stripped disallowed tenant override field: ${path}`,
              { tenantId: tenantId ?? 'unknown' }
            );
          }
        }
      }
    };

    walk(incoming, '');
    return result;
  }

  // ── Floor/Ceiling Constraint Enforcement ──────────────────────────────────

  /**
   * Enforce floor and ceiling constraints on tenant override values.
   * Compares against platform global config.
   * Returns adjusted data + list of violations for audit logging.
   *
   * @param incoming - Tenant override data to constrain
   * @param platformConfig - Platform global config for floor/ceiling comparison.
   *   When omitted, fetches from ConfigManager (falls back to no-op if unavailable).
   *   Callers should pass this explicitly when running inside a tenant ALS context
   *   to avoid accidentally reading the tenant-scoped config.
   */
  enforceConstraints(
    incoming: Record<string, any>,
    platformConfig?: Record<string, any> | null
  ): {
    result: Record<string, any>;
    violations: ConstraintViolation[];
  } {
    const result: Record<string, any> = JSON.parse(JSON.stringify(incoming));
    const violations: ConstraintViolation[] = [];

    // Platform config must be passed explicitly by callers.
    // No internal fallback — this avoids a circular DI dependency.
    if (!platformConfig) {
      this.logger.warn(
        'Platform config unavailable — skipping floor/ceiling enforcement'
      );
      return { result, violations };
    }

    // ── Floor constraints ─────────────────────────────────────────────────
    for (const [field, type] of FLOOR_CONSTRAINTS) {
      const tenantValue = getNestedValue(result, field);
      if (tenantValue === undefined || tenantValue === null) continue;

      const platformValue = getNestedValue(platformConfig, field);
      if (platformValue === undefined || platformValue === null) continue;

      if (type === 'boolean') {
        // If platform=true, tenant cannot set false
        if (platformValue === true && tenantValue === false) {
          setNestedValue(result, field, true);
          violations.push({
            field,
            original: false,
            adjusted: true,
            reason: 'Boolean floor: platform requires enabled',
          });
        }
      } else if (type === 'numeric') {
        const tVal = Number(tenantValue);
        const pVal = Number(platformValue);
        if (!isNaN(tVal) && !isNaN(pVal) && tVal < pVal) {
          setNestedValue(result, field, pVal);
          violations.push({
            field,
            original: tVal,
            adjusted: pVal,
            reason: `Numeric floor: must be >= platform value (${pVal})`,
          });
        }
      }
    }

    // ── Absolute NIST minimum for password length ─────────────────────────
    const pwLenPath =
      'security.authentication.login.password_policy.min_length';
    const pwLen = getNestedValue(result, pwLenPath);
    if (pwLen !== undefined && pwLen !== null) {
      const numPwLen = Number(pwLen);
      if (!isNaN(numPwLen) && numPwLen < NIST_MIN_PASSWORD_LENGTH) {
        setNestedValue(result, pwLenPath, NIST_MIN_PASSWORD_LENGTH);
        violations.push({
          field: pwLenPath,
          original: numPwLen,
          adjusted: NIST_MIN_PASSWORD_LENGTH,
          reason: `Absolute minimum ${NIST_MIN_PASSWORD_LENGTH} per NIST SP 800-63B`,
        });
      }
    }

    // ── Ceiling constraints ───────────────────────────────────────────────
    for (const field of CEILING_CONSTRAINTS) {
      const tenantValue = getNestedValue(result, field);
      if (tenantValue === undefined || tenantValue === null) continue;

      const platformValue = getNestedValue(platformConfig, field);
      if (platformValue === undefined || platformValue === null) continue;

      const tVal = Number(tenantValue);
      const pVal = Number(platformValue);
      if (isNaN(tVal) || isNaN(pVal)) continue;

      // Special: 0=unlimited fields
      if (ZERO_MEANS_UNLIMITED.has(field)) {
        // Platform 0 (unlimited) → any tenant value is valid
        if (pVal === 0) continue;
        // Tenant 0 (unlimited) when platform has a limit → enforce ceiling
        if (tVal === 0) {
          setNestedValue(result, field, pVal);
          violations.push({
            field,
            original: 0,
            adjusted: pVal,
            reason: `Ceiling: tenant cannot set unlimited when platform limits to ${pVal}`,
          });
          continue;
        }
      }

      if (tVal > pVal) {
        setNestedValue(result, field, pVal);
        violations.push({
          field,
          original: tVal,
          adjusted: pVal,
          reason: `Ceiling: must be <= platform value (${pVal})`,
        });
      }
    }

    // ── Special: webauthn.user_verification ordered enum ──────────────────
    const uvPath =
      'security.authentication.multi_factor.webauthn.user_verification';
    const tenantUV = getNestedValue(result, uvPath);
    const platformUV = getNestedValue(platformConfig, uvPath);
    if (
      tenantUV &&
      platformUV &&
      typeof tenantUV === 'string' &&
      typeof platformUV === 'string'
    ) {
      const tenantIdx = USER_VERIFICATION_ORDER.indexOf(tenantUV);
      const platformIdx = USER_VERIFICATION_ORDER.indexOf(platformUV);
      if (tenantIdx >= 0 && platformIdx >= 0 && tenantIdx < platformIdx) {
        setNestedValue(result, uvPath, platformUV);
        violations.push({
          field: uvPath,
          original: tenantUV,
          adjusted: platformUV,
          reason: `Floor: cannot weaken from '${platformUV}' to '${tenantUV}'`,
        });
      }
    }

    return { result, violations };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Recursively strip empty string values from override objects.
   * Empty string in a form means "use default" — these should NOT be stored
   * as overrides since they would replace the global default with "".
   */
  private stripEmptyValues(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === '') continue;
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const nested = this.stripEmptyValues(value);
        if (Object.keys(nested).length > 0) {
          result[key] = nested;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Encrypt sensitive fields in the override data before persisting.
   * Only encrypts non-empty string values that are not already encrypted.
   */
  /**
   * Sentinel value used in forms to indicate "keep existing secret".
   * When a form field contains this value, the existing encrypted value
   * is preserved instead of re-encrypting the sentinel string.
   */
  static readonly MASKED_SENTINEL = '**masked**';

  private _encryptSensitiveFields(
    data: Record<string, any>,
    existingData?: Record<string, any> | null
  ): Record<string, any> {
    const result = JSON.parse(JSON.stringify(data)); // deep clone

    for (const fieldPath of TENANT_SENSITIVE_FIELDS) {
      const value = getNestedValue(result, fieldPath);
      if (value && typeof value === 'string' && value.trim() !== '') {
        if (value === TenantSettingsOverrideService.MASKED_SENTINEL) {
          const existingValue = existingData
            ? getNestedValue(existingData, fieldPath)
            : undefined;
          if (existingValue) {
            setNestedValue(result, fieldPath, existingValue);
          } else {
            // No existing value — remove the sentinel so we don't store it
            setNestedValue(result, fieldPath, undefined);
          }
          continue;
        }

        try {
          setNestedValue(result, fieldPath, ensureEncrypted(value));
        } catch (err) {
          this.logger.warn(
            `Failed to encrypt field '${fieldPath}', storing as-is`,
            {
              error: (err as Error).message,
            }
          );
        }
      }
    }

    return result;
  }
}
