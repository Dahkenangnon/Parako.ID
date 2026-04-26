import type { IBaseModel } from './base.js';

// ── Per-Section Typed Interfaces ────────────────────────────────────────────

/** application.* — all freely customizable */
export interface ITenantApplicationOverride {
  title?: string;
  description?: string;
  locales?: {
    default?: string;
    available?: string[];
  };
}

/** branding.colors.light.* / branding.colors.dark.* — 33 hex color fields each */
export interface ITenantBrandingColorPalette {
  // Core colors (6)
  primary?: string;
  primaryForeground?: string;
  secondary?: string;
  secondaryForeground?: string;
  accent?: string;
  accentForeground?: string;
  // Semantic colors (8)
  destructive?: string;
  destructiveForeground?: string;
  success?: string;
  successForeground?: string;
  warning?: string;
  warningForeground?: string;
  info?: string;
  infoForeground?: string;
  // Surface colors (8)
  background?: string;
  foreground?: string;
  card?: string;
  cardForeground?: string;
  popover?: string;
  popoverForeground?: string;
  muted?: string;
  mutedForeground?: string;
  // Form colors (3)
  border?: string;
  input?: string;
  ring?: string;
  // Sidebar colors (8)
  sidebar?: string;
  sidebarForeground?: string;
  sidebarPrimary?: string;
  sidebarPrimaryForeground?: string;
  sidebarAccent?: string;
  sidebarAccentForeground?: string;
  sidebarBorder?: string;
  sidebarRing?: string;
}

/** branding.* — excluding ui.customization.* (PLATFORM-ONLY) */
export interface ITenantBrandingOverride {
  companyName?: string;
  logo?: string;
  logoDark?: string;
  logoIcon?: string;
  logoIconDark?: string;
  favicon?: string;
  fonts?: {
    sans?: string;
    heading?: string;
    mono?: string;
  };
  colors?: {
    light?: ITenantBrandingColorPalette;
    dark?: ITenantBrandingColorPalette;
  };
}

/** security.authentication.multi_factor.webauthn.* (tenant-customizable subset) */
export interface ITenantWebAuthnOverride {
  enabled?: boolean;
  rp_name?: string;
  timeout?: number;
  user_verification?: 'discouraged' | 'preferred' | 'required';
  authenticator_attachment?: 'platform' | 'cross-platform';
  resident_key?: 'discouraged' | 'preferred' | 'required';
  max_credentials_per_user?: number;
}

/** security.authentication.multi_factor.* (tenant-customizable subset) */
export interface ITenantMultiFactorOverride {
  enabled?: boolean;
  totp?: {
    enabled?: boolean;
    issuer_name?: string;
  };
  email?: {
    enabled?: boolean;
    code_ttl_seconds?: number;
  };
  sms?: {
    enabled?: boolean;
  };
  webauthn?: ITenantWebAuthnOverride;
}

/** security.authentication.session.* (tenant-customizable subset) */
export interface ITenantSessionOverride {
  bind_ip?: boolean;
  bind_user_agent?: boolean;
  bind_device?: boolean;
  idle_timeout_minutes?: number;
  absolute_timeout_hours?: number;
  max_concurrent_sessions?: number;
  max_accounts_per_session?: number;
  encrypt_session_data?: boolean;
  notify_new_session?: boolean;
  require_reauth_on_switch?: boolean;
  require_2fa_for_new_device?: boolean;
  new_device_2fa_method?: string;
  new_device_confidence_threshold?: number;
}

/** security.authentication.login.password_policy.* */
export interface ITenantPasswordPolicyOverride {
  min_length?: number;
  require_uppercase?: boolean;
  require_lowercase?: boolean;
  require_numbers?: boolean;
  require_symbols?: boolean;
  max_age_days?: number;
}

/** security.authentication.login.* */
export interface ITenantLoginOverride {
  login_methods?: string[];
  password_policy?: ITenantPasswordPolicyOverride;
}

/** security.authentication.signup.* */
export interface ITenantSignupOverride {
  signup_methods?: string[];
  require_email_verification?: boolean;
  require_phone_verification?: boolean;
  auto_approval?: {
    enabled?: boolean;
    domains_whitelist?: string[];
  };
  contact_channels?: Record<string, any>;
}

/** security.authentication.* (tenant-customizable subset) */
export interface ITenantAuthenticationOverride {
  multi_factor?: ITenantMultiFactorOverride;
  session_management?: {
    multiple_accounts?: { enabled?: boolean };
  };
  session?: ITenantSessionOverride;
  login?: ITenantLoginOverride;
  signup?: ITenantSignupOverride;
  roles?: {
    default?: string;
  };
  custom_identifiers?: Record<string, any>;
  recovery?: Record<string, any>;
}

/** security.protection.rate_limiting.* (tenant-customizable subset) */
export interface ITenantRateLimitingOverride {
  enabled?: boolean;
  requests_per_minute?: number;
  window_minutes?: number;
}

/** security.protection.device_matching.* (tenant-customizable subset) */
export interface ITenantDeviceMatchingOverride {
  min_confidence_score?: number;
  ip_similarity_threshold?: number;
  impossible_travel_max_speed_kmh?: number;
  trust_duration_days?: number;
}

/** security.protection.* (tenant-customizable subset — no trusted_domains, trusted_proxies) */
export interface ITenantProtectionOverride {
  rate_limiting?: ITenantRateLimitingOverride;
  high_risk_countries?: string[];
  encrypt_device_data?: boolean;
  device_matching?: ITenantDeviceMatchingOverride;
}

/** security.* (no secrets, no key_store) */
export interface ITenantSecurityOverride {
  authentication?: ITenantAuthenticationOverride;
  protection?: ITenantProtectionOverride;
}

/** features.social_providers.{provider}.* (Tier 2 tenant-owned credentials) */
export interface ITenantSocialProviderCredentials {
  client_id?: string;
  client_secret?: string;
}

/** features.social_providers.* (no 'available' — PLATFORM-ONLY) */
export interface ITenantSocialProvidersOverride {
  enabled?: string[];
  behavior?: Record<string, any>;
  google?: ITenantSocialProviderCredentials;
  github?: ITenantSocialProviderCredentials;
  microsoft?: ITenantSocialProviderCredentials;
  linkedin?: ITenantSocialProviderCredentials;
  facebook?: ITenantSocialProviderCredentials;
}

/** features.* — only social_providers (no oidc, developer, metrics, multi_tenancy) */
export interface ITenantFeaturesOverride {
  social_providers?: ITenantSocialProvidersOverride;
}

/** oidc.token_ttl.* — all ceiling-constrained */
export interface ITenantOidcTokenTtlOverride {
  access_token?: number;
  authorization_code?: number;
  backchannel_auth?: number;
  client_credentials?: number;
  device_code?: number;
  grant?: number;
  id_token?: number;
  interaction?: number;
  refresh_token?: number;
  session?: number;
}

/** oidc.discovery.* — per-tenant metadata */
export interface ITenantOidcDiscoveryOverride {
  claims_locales_supported?: string[];
  ui_locales_supported?: string[];
  display_values_supported?: string[];
  service_documentation?: string;
  op_policy_uri?: string;
  op_tos_uri?: string;
}

/** oidc.* — only discovery + token_ttl (no issuer, path, routes, secrets, jwa) */
export interface ITenantOidcOverride {
  discovery?: ITenantOidcDiscoveryOverride;
  token_ttl?: ITenantOidcTokenTtlOverride;
}

/** integrations.email.* */
export interface ITenantEmailIntegrationOverride {
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_password?: string;
  from?: string;
  tls_reject_unauthorized?: boolean;
}

/** integrations.urls.* */
export interface ITenantUrlsIntegrationOverride {
  website?: string;
  privacy_policy?: string;
  terms_of_service?: string;
  contact?: string;
}

/** integrations.* — only email + urls (no ipinfo, ipqualityscore, fingerprintjs) */
export interface ITenantIntegrationsOverride {
  email?: ITenantEmailIntegrationOverride;
  urls?: ITenantUrlsIntegrationOverride;
}

/** notifications.channels.sms.rate_limits.* */
export interface ITenantSmsRateLimitsOverride {
  per_phone_per_hour?: number;
  per_ip_per_day?: number;
  cooldown_seconds?: number;
}

/** notifications.channels.sms.* */
export interface ITenantSmsChannelOverride {
  enabled?: boolean;
  provider?: string;
  api_key?: string;
  api_secret?: string;
  from_number?: string;
  rate_limits?: ITenantSmsRateLimitsOverride;
}

/** notifications.channels.* */
export interface ITenantNotificationChannelsOverride {
  email?: { enabled?: boolean };
  sms?: ITenantSmsChannelOverride;
}

/** notifications.defaults.* */
export interface ITenantNotificationDefaultsOverride {
  security_alerts?: boolean;
  new_session_alerts?: boolean;
  allow_user_preferences?: boolean;
}

/** notifications.* */
export interface ITenantNotificationsOverride {
  channels?: ITenantNotificationChannelsOverride;
  defaults?: ITenantNotificationDefaultsOverride;
}

// ── Main Override Interface ─────────────────────────────────────────────────

/**
 * Per-tenant configuration overrides.
 * Only whitelisted fields can be overridden -- all fields are optional (sparse).
 *
 * Each section is strongly typed to include ONLY the fields that tenants
 * are allowed to customize. Platform-only fields are excluded at the type level.
 * Runtime enforcement via field-level whitelist in TenantSettingsOverrideService.
 */
export interface ITenantSettingsOverride extends IBaseModel {
  tenant_id: string;
  key: string; // Always 'parako_config'
  version: string;
  _version: number;
  is_active: boolean;
  metadata?: {
    last_modified_by?: string;
    change_reason?: string;
  };
  // Tenant-customizable sections — all optional (sparse overlay)
  application?: ITenantApplicationOverride;
  branding?: ITenantBrandingOverride;
  security?: ITenantSecurityOverride;
  features?: ITenantFeaturesOverride;
  oidc?: ITenantOidcOverride;
  integrations?: ITenantIntegrationsOverride;
  notifications?: ITenantNotificationsOverride;
}

export type ITenantSettingsOverrideMethods = object;

// ── Helper Type: Valid Dot-Path Union ───────────────────────────────────────

/**
 * Union of all valid dot-paths that tenants may set in overrides.
 * Used for compile-time safety when referencing override field paths.
 * This is a curated subset — see ALLOWED_TENANT_FIELDS in the service for runtime.
 */
export type TenantOverrideFieldPath =
  // application
  | 'application.title'
  | 'application.description'
  | 'application.locales.default'
  | 'application.locales.available'
  // branding
  | 'branding.companyName'
  | 'branding.logo'
  | 'branding.logoDark'
  | 'branding.logoIcon'
  | 'branding.logoIconDark'
  | 'branding.favicon'
  | 'branding.fonts.sans'
  | 'branding.fonts.heading'
  | 'branding.fonts.mono'
  | `branding.colors.${'light' | 'dark'}.${keyof ITenantBrandingColorPalette}`
  // security.authentication
  | 'security.authentication.multi_factor.enabled'
  | 'security.authentication.multi_factor.totp.enabled'
  | 'security.authentication.multi_factor.totp.issuer_name'
  | 'security.authentication.multi_factor.email.enabled'
  | 'security.authentication.multi_factor.email.code_ttl_seconds'
  | 'security.authentication.multi_factor.sms.enabled'
  | 'security.authentication.multi_factor.webauthn.enabled'
  | 'security.authentication.multi_factor.webauthn.rp_name'
  | 'security.authentication.multi_factor.webauthn.timeout'
  | 'security.authentication.multi_factor.webauthn.user_verification'
  | 'security.authentication.multi_factor.webauthn.authenticator_attachment'
  | 'security.authentication.multi_factor.webauthn.resident_key'
  | 'security.authentication.multi_factor.webauthn.max_credentials_per_user'
  | 'security.authentication.session_management.multiple_accounts.enabled'
  | 'security.authentication.session.bind_ip'
  | 'security.authentication.session.bind_user_agent'
  | 'security.authentication.session.bind_device'
  | 'security.authentication.session.idle_timeout_minutes'
  | 'security.authentication.session.absolute_timeout_hours'
  | 'security.authentication.session.max_concurrent_sessions'
  | 'security.authentication.session.max_accounts_per_session'
  | 'security.authentication.session.encrypt_session_data'
  | 'security.authentication.session.notify_new_session'
  | 'security.authentication.session.require_reauth_on_switch'
  | 'security.authentication.session.require_2fa_for_new_device'
  | 'security.authentication.session.new_device_2fa_method'
  | 'security.authentication.session.new_device_confidence_threshold'
  | 'security.authentication.login.login_methods'
  | 'security.authentication.login.password_policy.min_length'
  | 'security.authentication.login.password_policy.require_uppercase'
  | 'security.authentication.login.password_policy.require_lowercase'
  | 'security.authentication.login.password_policy.require_numbers'
  | 'security.authentication.login.password_policy.require_symbols'
  | 'security.authentication.login.password_policy.max_age_days'
  | 'security.authentication.signup.signup_methods'
  | 'security.authentication.signup.require_email_verification'
  | 'security.authentication.signup.require_phone_verification'
  | 'security.authentication.signup.auto_approval.enabled'
  | 'security.authentication.signup.auto_approval.domains_whitelist'
  | 'security.authentication.signup.contact_channels'
  | 'security.authentication.roles.default'
  | 'security.authentication.custom_identifiers'
  | 'security.authentication.recovery'
  // security.protection
  | 'security.protection.rate_limiting.enabled'
  | 'security.protection.rate_limiting.requests_per_minute'
  | 'security.protection.rate_limiting.window_minutes'
  | 'security.protection.high_risk_countries'
  | 'security.protection.encrypt_device_data'
  | 'security.protection.device_matching.min_confidence_score'
  | 'security.protection.device_matching.ip_similarity_threshold'
  | 'security.protection.device_matching.impossible_travel_max_speed_kmh'
  | 'security.protection.device_matching.trust_duration_days'
  // features
  | 'features.social_providers.enabled'
  | 'features.social_providers.behavior'
  | `features.social_providers.${'google' | 'github' | 'microsoft' | 'linkedin' | 'facebook'}.client_id`
  | `features.social_providers.${'google' | 'github' | 'microsoft' | 'linkedin' | 'facebook'}.client_secret`
  // oidc
  | 'oidc.discovery.claims_locales_supported'
  | 'oidc.discovery.ui_locales_supported'
  | 'oidc.discovery.display_values_supported'
  | 'oidc.discovery.service_documentation'
  | 'oidc.discovery.op_policy_uri'
  | 'oidc.discovery.op_tos_uri'
  | `oidc.token_ttl.${keyof ITenantOidcTokenTtlOverride}`
  // integrations
  | 'integrations.email.smtp_host'
  | 'integrations.email.smtp_port'
  | 'integrations.email.smtp_username'
  | 'integrations.email.smtp_password'
  | 'integrations.email.from'
  | 'integrations.email.tls_reject_unauthorized'
  | 'integrations.urls.website'
  | 'integrations.urls.privacy_policy'
  | 'integrations.urls.terms_of_service'
  | 'integrations.urls.contact'
  // notifications
  | 'notifications.channels.email.enabled'
  | 'notifications.channels.sms.enabled'
  | 'notifications.channels.sms.provider'
  | 'notifications.channels.sms.api_key'
  | 'notifications.channels.sms.api_secret'
  | 'notifications.channels.sms.from_number'
  | 'notifications.channels.sms.rate_limits.per_phone_per_hour'
  | 'notifications.channels.sms.rate_limits.per_ip_per_day'
  | 'notifications.channels.sms.rate_limits.cooldown_seconds'
  | 'notifications.defaults.security_alerts'
  | 'notifications.defaults.new_session_alerts'
  | 'notifications.defaults.allow_user_preferences';
