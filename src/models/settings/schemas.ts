import { Schema } from 'mongoose';
import { brandingAuthViewsSchema } from './branding/ui/customization/views/auth.js';
import { brandingAccountsViewsSchema } from './branding/ui/customization/views/accounts.js';
import { brandingErrorsViewsSchema } from './branding/ui/customization/views/errorpage.js';

const brandingViewsSchema = new Schema(
  {
    auth: brandingAuthViewsSchema,
    accounts: brandingAccountsViewsSchema,
    errorpage: brandingErrorsViewsSchema,
    email: new Schema(
      {
        mail: { type: String },
      },
      { _id: false }
    ),
    home: new Schema(
      {
        index: { type: String },
      },
      { _id: false }
    ),
  },
  { _id: false }
);

const brandingCustomizationSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    rootPath: { type: String, required: true },
    views: brandingViewsSchema,
  },
  { _id: false }
);

const brandingUiSchema = new Schema(
  {
    customization: brandingCustomizationSchema,
  },
  { _id: false }
);

const themeColorSetSchema = new Schema(
  {
    primary: { type: String },
    primaryForeground: { type: String },
    secondary: { type: String },
    secondaryForeground: { type: String },
    accent: { type: String },
    accentForeground: { type: String },
    destructive: { type: String },
    destructiveForeground: { type: String },
    success: { type: String },
    successForeground: { type: String },
    warning: { type: String },
    warningForeground: { type: String },
    info: { type: String },
    infoForeground: { type: String },
    background: { type: String },
    foreground: { type: String },
    card: { type: String },
    cardForeground: { type: String },
    popover: { type: String },
    popoverForeground: { type: String },
    muted: { type: String },
    mutedForeground: { type: String },
    border: { type: String },
    input: { type: String },
    ring: { type: String },
    sidebar: { type: String },
    sidebarForeground: { type: String },
    sidebarPrimary: { type: String },
    sidebarPrimaryForeground: { type: String },
    sidebarAccent: { type: String },
    sidebarAccentForeground: { type: String },
    sidebarBorder: { type: String },
    sidebarRing: { type: String },
  },
  { _id: false }
);

const brandingColorsSchema = new Schema(
  {
    light: { type: themeColorSetSchema, default: () => ({}) },
    dark: { type: themeColorSetSchema, default: () => ({}) },
  },
  { _id: false }
);

const brandingFontsSchema = new Schema(
  {
    sans: { type: String },
    heading: { type: String },
    mono: { type: String },
  },
  { _id: false }
);

export const brandingSchema = new Schema(
  {
    companyName: { type: String, required: true },
    logo: { type: String },
    logoDark: { type: String },
    logoIcon: { type: String },
    logoIconDark: { type: String },
    favicon: { type: String },
    ui: brandingUiSchema,
    colors: { type: brandingColorsSchema, default: () => ({}) },
    fonts: { type: brandingFontsSchema, default: () => ({}) },
  },
  { _id: false }
);

const deploymentCookiesDefaultsSchema = new Schema(
  {
    maxAge: { type: Number, required: true },
    httpOnly: { type: Boolean, required: true },
    secure: { type: Boolean, required: true },
    sameSite: {
      type: String,
      enum: ['strict', 'lax', 'none'],
      required: true,
    },
    path: { type: String, required: true },
  },
  { _id: false }
);

const deploymentCookiesTypesSchema = new Schema(
  {
    session: {
      name: { type: String, required: true },
      maxAge: { type: Number, required: true },
      httpOnly: { type: Boolean, required: true },
      secure: { type: Boolean, required: true },
      sameSite: {
        type: String,
        enum: ['strict', 'lax', 'none'],
        required: true,
      },
    },
    locale: {
      name: { type: String, required: true },
      maxAge: { type: Number, required: true },
      httpOnly: { type: Boolean, required: true },
      secure: { type: Boolean, required: true },
      sameSite: {
        type: String,
        enum: ['strict', 'lax', 'none'],
        required: true,
      },
    },
    theme: {
      name: { type: String, required: true },
      maxAge: { type: Number, required: true },
      httpOnly: { type: Boolean, required: true },
      secure: { type: Boolean, required: true },
      sameSite: {
        type: String,
        enum: ['strict', 'lax', 'none'],
        required: true,
      },
    },
  },
  { _id: false }
);

const deploymentCookiesSchema = new Schema(
  {
    defaults: deploymentCookiesDefaultsSchema,
    types: deploymentCookiesTypesSchema,
  },
  { _id: false }
);

const deploymentAuthRoutesSchema = new Schema(
  {
    login: { type: String, required: true },
    register: { type: String, required: true },
    forgot_password: { type: String, required: true },
    reset_password: { type: String, required: true },
    email_verification: { type: String, required: true },
    verify_email: { type: String, required: true },
    email_verification_success: { type: String, required: true },
    phone_verification: { type: String, required: true },
    account_select: { type: String, required: true },
    continue: { type: String, required: true },
    multi_factor: { type: String, required: true },
    mfa_verify: { type: String, required: true },
    mfa_resend: { type: String, required: true },
    mfa_select: { type: String, required: true },
    mfa_webauthn: { type: String, required: true },
    logout: { type: String, required: true },
    social_password_setup: { type: String, required: true },
    social_contact_info: { type: String, required: true },
    account_recovery: { type: String, required: true },
    recovery_backup_codes: { type: String, required: true },
    recovery_secondary_email: { type: String, required: true },
    recovery_verify_code: { type: String, required: true },
    update_theme: { type: String, required: true },
    update_locale: { type: String, required: true },
    update_sidebar: { type: String, required: true },
    update_timezone: { type: String, required: true },
    recovery_method_select: { type: String, required: true },
    recovery_security_questions: { type: String, required: true },
    recovery_sms: { type: String, required: true },
  },
  { _id: false }
);

const deploymentAccountRoutesSchema = new Schema(
  {
    dashboard: { type: String, required: true },
    settings: { type: String, required: true },
    apps: { type: String, required: true },
    sessions: { type: String, required: true },
    update_profile: { type: String, required: true },
    change_password: { type: String, required: true },
    remove_avatar: { type: String, required: true },
    enable_mfa: { type: String, required: true },
    disable_mfa: { type: String, required: true },
    setup_mfa: { type: String, required: true },
    setup_webauthn: { type: String, required: true },
    passkeys: { type: String, required: true },
    switch_account: { type: String, required: true },
    add_account: { type: String, required: true },
    remove_account: { type: String, required: true },
    account_switcher_data: { type: String, required: true },
    revoke_app: { type: String, required: true },
    revoke_all_apps: { type: String, required: true },
    logout_session: { type: String, required: true },
    logout_all_other_sessions: { type: String, required: true },
    resend_email_verification: { type: String, required: true },
    enable_recovery: { type: String, required: true },
    disable_recovery: { type: String, required: true },
    recovery_codes: { type: String, required: true },
    verify_recovery_email: { type: String, required: true },
    regenerate_backup_codes: { type: String, required: true },
    recovery_setup: { type: String, required: true },
    security_questions_setup: { type: String, required: true },
    update_notification_preferences: { type: String, required: true },
    settings_profile: { type: String, required: true },
    settings_preferences: { type: String, required: true },
    settings_notifications: { type: String, required: true },
    settings_security: { type: String, required: true },
    settings_recovery: { type: String, required: true },
    settings_social: { type: String, required: true },
  },
  { _id: false }
);

const deploymentApiRoutesSchema = new Schema(
  {
    base: { type: String, required: true },
  },
  { _id: false }
);

const deploymentRoutesSchema = new Schema(
  {
    auth: { type: String, required: true },
    accounts: { type: String, required: true },
    api: { type: String, required: true },
    home: { type: String, required: true },
    auth_routes: deploymentAuthRoutesSchema,
    account_routes: deploymentAccountRoutesSchema,
    api_routes: deploymentApiRoutesSchema,
  },
  { _id: false }
);

const deploymentServerSchema = new Schema(
  {
    // CORS allowlists are arrays so cors v2+ can emit Vary: Origin and
    // legitimately combine with credentials: true (the Fetch spec forbids
    // wildcard + credentials). See src/config/schemas/schema.ts for the
    // canonical Zod definition.
    allowed_origins: { type: [String], default: [] },
    dev_allowed_origins: {
      type: [String],
      default: ['http://localhost:9007', 'http://localhost:5173'],
    },
    // Hop count; replaces the previous boolean `proxy`. 1 = single nginx,
    // 2 = CDN/CloudFront → ALB → app. See Express "behind proxies":
    // https://expressjs.com/en/guide/behind-proxies/
    trust_proxy_hops: { type: Number, default: 1, min: 0, max: 10 },
  },
  { _id: false }
);

export const deploymentSchema = new Schema(
  {
    url: { type: String, required: true },
    redis_prefix: { type: String, default: 'parako' },
    server: deploymentServerSchema,
    cookies: deploymentCookiesSchema,
    routes: deploymentRoutesSchema,
  },
  { _id: false }
);

const securitySecretsSchema = new Schema(
  {
    jwt_secret: { type: String, required: true },
    jwt_expires_in: { type: String, required: true },
    cookie_secrets: { type: [String], required: true },
    hmac_secret: { type: String },
  },
  { _id: false }
);

const securityRateLimitingSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    requests_per_minute: { type: Number, required: true },
    window_minutes: { type: Number, required: true },
  },
  { _id: false }
);

const securityDeviceMatchingSchema = new Schema(
  {
    min_confidence_score: { type: Number, default: 70, min: 0, max: 100 },
    ip_similarity_threshold: { type: Number, default: 0.8, min: 0, max: 1 },
    enable_impossible_travel: { type: Boolean, default: true },
    impossible_travel_max_speed_kmh: { type: Number, default: 900, min: 1 },
    trust_duration_days: { type: Number, default: 30, min: 1, max: 365 },
  },
  { _id: false }
);

const securityProtectionSchema = new Schema(
  {
    rate_limiting: securityRateLimitingSchema,
    trusted_domains: { type: [String], required: true },
    // Trusted proxy IP addresses/ranges for header validation
    trusted_proxies: { type: [String], default: [] },
    // ISO 3166-1 alpha-2 country codes considered high-risk
    high_risk_countries: { type: [String], default: [] },
    encrypt_device_data: { type: Boolean, default: false },
    device_matching: {
      type: securityDeviceMatchingSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const securityTotpSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    issuer_name: { type: String, required: true },
  },
  { _id: false }
);

const securityEmailMfaSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    code_ttl_seconds: { type: Number, required: true, default: 600 },
  },
  { _id: false }
);

const securitySmsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const securityWebauthnSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    rp_name: { type: String, required: true },
    rp_id: { type: String, required: true },
    timeout: { type: Number, required: true, default: 60000 },
    attestation: {
      type: String,
      enum: ['none', 'indirect', 'direct', 'enterprise'],
      default: 'none',
    },
    user_verification: {
      type: String,
      enum: ['required', 'preferred', 'discouraged'],
      default: 'preferred',
    },
    authenticator_attachment: {
      type: String,
      enum: ['platform', 'cross-platform'],
    },
    resident_key: {
      type: String,
      enum: ['required', 'preferred', 'discouraged'],
      default: 'preferred',
    },
    max_credentials_per_user: { type: Number, required: true, default: 10 },
  },
  { _id: false }
);

const securityMultiFactorSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    totp: securityTotpSchema,
    email: securityEmailMfaSchema,
    sms: securitySmsSchema,
    webauthn: securityWebauthnSchema,
  },
  { _id: false }
);

const securitySessionManagementSchema = new Schema(
  {
    multiple_accounts: {
      enabled: { type: Boolean, required: true },
    },
  },
  { _id: false }
);

const securityPasswordPolicySchema = new Schema(
  {
    min_length: { type: Number, required: true },
    require_uppercase: { type: Boolean, required: true },
    require_lowercase: { type: Boolean, required: true },
    require_numbers: { type: Boolean, required: true },
    require_symbols: { type: Boolean, required: true },
    max_age_days: { type: Number, required: true },
  },
  { _id: false }
);

const securityLoginSchema = new Schema(
  {
    login_methods: { type: [String], required: true },
    password_policy: securityPasswordPolicySchema,
  },
  { _id: false }
);

const securityAutoApprovalSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    domains_whitelist: { type: [String], required: true },
  },
  { _id: false }
);

const securityContactChannelEmailSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const securityContactChannelPhoneSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const securityContactChannelFullNameSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    required: { type: Boolean, default: true },
  },
  { _id: false }
);

const securityContactChannelsSchema = new Schema(
  {
    require_at_least_one: { type: Boolean, default: true },
    email: {
      type: securityContactChannelEmailSchema,
      default: () => ({ enabled: true, required: false }),
    },
    phone: {
      type: securityContactChannelPhoneSchema,
      default: () => ({ enabled: true, required: false }),
    },
    full_name: {
      type: securityContactChannelFullNameSchema,
      default: () => ({ enabled: true, required: true }),
    },
  },
  { _id: false }
);

const securitySignupSchema = new Schema(
  {
    signup_methods: { type: [String], required: true },
    require_email_verification: { type: Boolean, required: true },
    require_phone_verification: { type: Boolean, required: true },
    auto_approval: securityAutoApprovalSchema,
    contact_channels: {
      type: securityContactChannelsSchema,
      default: () => ({
        require_at_least_one: true,
        email: { enabled: true, required: false },
        phone: { enabled: true, required: false },
        full_name: { enabled: true, required: true },
      }),
    },
  },
  { _id: false }
);

const securityRolesSchema = new Schema(
  {
    available: { type: [String], required: true },
    default: { type: String, required: true },
  },
  { _id: false }
);

const securityCustomIdentifiersSchema = new Schema(
  {
    enabled: { type: Boolean, required: false, default: false },
    fields: {
      type: [
        new Schema(
          {
            slot: { type: Number, required: true, enum: [1, 2, 3] },
            key: { type: String, required: true },
            name: { type: String, required: true },
            hint_for_user: { type: String, required: false, default: '' },
            validation_type: {
              type: String,
              enum: ['none', 'regex', 'charset_mask'],
              default: 'none',
            },
            pattern: { type: String, required: false },
            charset: { type: String, required: false },
            mask: { type: String, required: false },
            min_length: { type: Number, required: false, default: 1 },
            max_length: { type: Number, required: false, default: 100 },
            case_sensitive: { type: Boolean, required: false, default: false },
            required_for_registration: {
              type: Boolean,
              required: false,
              default: false,
            },
            edit_policy: {
              type: String,
              enum: ['admin_only', 'set_once', 'editable', 'full'],
              default: 'set_once',
            },
            usable_for_login: {
              type: Boolean,
              required: false,
              default: true,
            },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

const securityRecoveryBackupCodesSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    count: { type: Number, required: true },
    expiry_days: { type: Number, required: true },
  },
  { _id: false }
);

const securityRecoverySecondaryEmailSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const securityRecoverySmsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const securityRecoverySecurityQuestionsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const securityRecoverySchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    backup_codes: securityRecoveryBackupCodesSchema,
    secondary_email: securityRecoverySecondaryEmailSchema,
    sms: securityRecoverySmsSchema,
    security_questions: securityRecoverySecurityQuestionsSchema,
  },
  { _id: false }
);

const securitySessionSchema = new Schema(
  {
    cookie_name: { type: String, default: 'application_session' },
    same_site: {
      type: String,
      enum: ['strict', 'lax', 'none'],
      default: 'lax',
    },
    bind_ip: { type: Boolean, default: false },
    bind_user_agent: { type: Boolean, default: false },
    bind_device: { type: Boolean, default: false },
    idle_timeout_minutes: { type: Number, default: 30 },
    absolute_timeout_hours: { type: Number, default: 24 },
    max_concurrent_sessions: { type: Number, default: 0 },
    max_accounts_per_session: { type: Number, default: 5 },
    notify_new_session: { type: Boolean, default: false },
    require_reauth_on_switch: { type: Boolean, default: false },
    encrypt_session_data: { type: Boolean, default: false },
    max_flash_messages_per_type: { type: Number, default: 10 },
    max_flash_messages_total: { type: Number, default: 20 },
    // New device verification settings
    require_2fa_for_new_device: { type: Boolean, default: false },
    new_device_2fa_method: {
      type: String,
      enum: ['auto', 'totp', 'email'],
      default: 'auto',
    },
    new_device_confidence_threshold: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
    store_metadata: { type: Boolean, default: false },
  },
  { _id: false }
);

// 19b. Password Breach Detection
const securityPasswordBreachDetectionSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    api_timeout_ms: { type: Number, default: 3000, min: 500, max: 30000 },
    check_on_registration: { type: Boolean, default: true },
    check_on_login: { type: Boolean, default: true },
    check_on_password_reset: { type: Boolean, default: true },
    check_on_password_change: { type: Boolean, default: true },
    min_breach_count: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const securityAuthenticationSchema = new Schema(
  {
    multi_factor: securityMultiFactorSchema,
    session_management: securitySessionManagementSchema,
    session: { type: securitySessionSchema, default: () => ({}) },
    login: securityLoginSchema,
    signup: securitySignupSchema,
    roles: securityRolesSchema,
    custom_identifiers: securityCustomIdentifiersSchema,
    recovery: securityRecoverySchema,
    password_breach_detection: securityPasswordBreachDetectionSchema,
  },
  { _id: false }
);

// 21a. Key Store
const securityKeyStoreSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['database', 'file'],
      default: 'database',
    },
    rotation_interval_days: { type: Number, default: 90, min: 1 },
    overlap_window_seconds: { type: Number, default: 7200, min: 1 },
    algorithms: { type: [String], default: ['RS256', 'ES256', 'EdDSA'] },
    promotion_delay_ms: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// 21b. Security
export const securitySchema = new Schema(
  {
    secrets: securitySecretsSchema,
    protection: securityProtectionSchema,
    key_store: { type: securityKeyStoreSchema, default: () => ({}) },
    authentication: securityAuthenticationSchema,
  },
  { _id: false }
);

const featuresOidcDevInteractionsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcDeviceFlowSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    charset: {
      type: String,
      enum: ['digits', 'base-20'],
      required: true,
    },
    mask: { type: String, required: true },
  },
  { _id: false }
);

const featuresOidcClientCredentialsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcTokenRevocationSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcTokenIntrospectionSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcJwtIntrospectionSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcUserinfoEndpointSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcResourceIndicatorsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcRpInitiatedLogoutSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcBackchannelLogoutSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcDynamicClientRegistrationSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    require_initial_access_token: { type: Schema.Types.Mixed, required: true },
    issue_registration_access_token: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcClientRegistrationManagementSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    rotate_registration_access_token: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcPkceSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    required: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcExtraParamsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
    allowed_params: { type: [String], required: true },
  },
  { _id: false }
);

const featuresOidcAcrValuesSchema = new Schema(
  {
    supported: { type: [String], required: true },
  },
  { _id: false }
);

const featuresOidcDiscoverySchema = new Schema(
  {
    claims_locales_supported: { type: [String] },
    display_values_supported: { type: [String] },
    op_policy_uri: { type: String },
    op_tos_uri: { type: String },
    service_documentation: { type: String },
    ui_locales_supported: { type: [String] },
  },
  { _id: false }
);

const featuresOidcJwaSchema = new Schema(
  {
    attest_signing_alg_values: { type: [String], required: true },
    authorization_encryption_alg_values: { type: [String], required: true },
    authorization_encryption_enc_values: { type: [String], required: true },
    authorization_signing_alg_values: { type: [String], required: true },
    client_auth_signing_alg_values: { type: [String], required: true },
    dpop_signing_alg_values: { type: [String], required: true },
    id_token_encryption_alg_values: { type: [String], required: true },
    id_token_encryption_enc_values: { type: [String], required: true },
    id_token_signing_alg_values: { type: [String], required: true },
    introspection_encryption_alg_values: { type: [String], required: true },
    introspection_encryption_enc_values: { type: [String], required: true },
    introspection_signing_alg_values: { type: [String], required: true },
    request_object_encryption_alg_values: { type: [String], required: true },
    request_object_encryption_enc_values: { type: [String], required: true },
    request_object_signing_alg_values: { type: [String], required: true },
    userinfo_encryption_alg_values: { type: [String], required: true },
    userinfo_encryption_enc_values: { type: [String], required: true },
    userinfo_signing_alg_values: { type: [String], required: true },
  },
  { _id: false }
);

const featuresOidcExtraClientMetadataSchema = new Schema(
  {
    properties: { type: [String], required: true },
    validator: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const featuresOidcEncryptionSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcJwtResponseModesSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcJwtUserinfoSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcRequestObjectsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const featuresOidcSchema = new Schema(
  {
    dev_interactions: featuresOidcDevInteractionsSchema,
    device_flow: featuresOidcDeviceFlowSchema,
    client_credentials: featuresOidcClientCredentialsSchema,
    token_revocation: featuresOidcTokenRevocationSchema,
    token_introspection: featuresOidcTokenIntrospectionSchema,
    jwt_introspection: featuresOidcJwtIntrospectionSchema,
    userinfo_endpoint: featuresOidcUserinfoEndpointSchema,
    resource_indicators: featuresOidcResourceIndicatorsSchema,
    rp_initiated_logout: featuresOidcRpInitiatedLogoutSchema,
    backchannel_logout: featuresOidcBackchannelLogoutSchema,
    dynamic_client_registration: featuresOidcDynamicClientRegistrationSchema,
    client_registration_management:
      featuresOidcClientRegistrationManagementSchema,
    pkce: featuresOidcPkceSchema,
    extra_params: featuresOidcExtraParamsSchema,
    accept_query_param_access_tokens: { type: Boolean, required: true },
    conform_id_token_claims: { type: Boolean, required: true },
    allow_omitting_single_registered_redirect_uri: {
      type: Boolean,
      required: true,
    },
    enable_http_post_methods: { type: Boolean, required: true },
    expires_with_session: { type: Boolean, required: true },
    rotate_refresh_token: { type: Boolean, required: true },
    client_based_cors: { type: Boolean, required: true },
    clock_tolerance: { type: Number, required: true },
    acr_values: featuresOidcAcrValuesSchema,
    claims: { type: Schema.Types.Mixed },
    scopes: { type: [String], required: true },
    subject_types: { type: [String], required: true },
    allowOmittingSingleRegisteredRedirectUri: { type: Boolean, required: true },
    discovery: featuresOidcDiscoverySchema,
    jwa: featuresOidcJwaSchema,
    extra_client_metadata: featuresOidcExtraClientMetadataSchema,
    encryption: featuresOidcEncryptionSchema,
    jwt_response_modes: featuresOidcJwtResponseModesSchema,
    jwt_userinfo: featuresOidcJwtUserinfoSchema,
    request_objects: featuresOidcRequestObjectsSchema,
  },
  { _id: false }
);

const featuresSocialProvidersBehaviorOptionsSchema = new Schema(
  {
    allow_multiple_providers: { type: Boolean, required: true },
    auto_verify_email: { type: Boolean, required: true },
    show_helpful_errors: { type: Boolean, required: true },
    max_providers_per_user: { type: Number, required: true },
  },
  { _id: false }
);

const featuresSocialProvidersBehaviorSchema = new Schema(
  {
    existing_user_no_integration: {
      type: String,
      enum: ['auto_link', 'require_manual_link'],
      required: true,
    },
    no_user_account: {
      type: String,
      enum: ['allow_registration', 'require_existing_account'],
      required: true,
    },
    missing_contact_info: {
      type: String,
      enum: ['redirect_to_form', 'reject_login'],
      required: true,
    },
    require_password_on_registration: { type: Boolean, required: true },
    options: featuresSocialProvidersBehaviorOptionsSchema,
  },
  { _id: false }
);

const featuresSocialProvidersGoogleSchema = new Schema(
  {
    client_id: { type: String },
    client_secret: { type: String },
    discovery_url: { type: String, required: true },
    scopes: { type: [String], required: true },
  },
  { _id: false }
);

const featuresSocialProvidersGithubSchema = new Schema(
  {
    client_id: { type: String },
    client_secret: { type: String },
    authorization_endpoint: { type: String, required: true },
    token_endpoint: { type: String, required: true },
    userinfo_endpoint: { type: String, required: true },
    scopes: { type: [String], required: true },
  },
  { _id: false }
);

const featuresSocialProvidersMicrosoftSchema = new Schema(
  {
    client_id: { type: String },
    client_secret: { type: String },
    discovery_url: { type: String, required: true },
    scopes: { type: [String], required: true },
  },
  { _id: false }
);

const featuresSocialProvidersLinkedinSchema = new Schema(
  {
    client_id: { type: String },
    client_secret: { type: String },
    authorization_endpoint: { type: String, required: true },
    token_endpoint: { type: String, required: true },
    userinfo_endpoint: { type: String, required: true },
    scopes: { type: [String], required: true },
  },
  { _id: false }
);

const featuresSocialProvidersFacebookSchema = new Schema(
  {
    client_id: { type: String },
    client_secret: { type: String },
    authorization_endpoint: { type: String, required: true },
    token_endpoint: { type: String, required: true },
    userinfo_endpoint: { type: String, required: true },
    scopes: { type: [String], required: true },
  },
  { _id: false }
);

const featuresSocialProvidersSchema = new Schema(
  {
    enabled: { type: [String], required: true },
    available: { type: [String], required: true },
    behavior: featuresSocialProvidersBehaviorSchema,
    google: featuresSocialProvidersGoogleSchema,
    github: featuresSocialProvidersGithubSchema,
    microsoft: featuresSocialProvidersMicrosoftSchema,
    linkedin: featuresSocialProvidersLinkedinSchema,
    facebook: featuresSocialProvidersFacebookSchema,
  },
  { _id: false }
);

const featuresMetricsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    path: { type: String, default: '/metrics' },
    include_default_metrics: { type: Boolean, default: true },
    prefix: { type: String, default: 'parako_' },
  },
  { _id: false }
);

const featuresMultiTenancySchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
  },
  { _id: false }
);

export const featuresSchema = new Schema(
  {
    oidc: featuresOidcSchema,
    social_providers: featuresSocialProvidersSchema,
    metrics: { type: featuresMetricsSchema, default: () => ({}) },
    multi_tenancy: {
      type: featuresMultiTenancySchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const oidcRoutesSchema = new Schema(
  {
    authorization: { type: String, required: true },
    userinfo: { type: String, required: true },
    registration: { type: String, required: true },
    backchannel_authentication: { type: String, required: true },
    challenge: { type: String, required: true },
    code_verification: { type: String, required: true },
    device_authorization: { type: String, required: true },
    end_session: { type: String, required: true },
    introspection: { type: String, required: true },
    jwks: { type: String, required: true },
    pushed_authorization_request: { type: String, required: true },
    revocation: { type: String, required: true },
    token: { type: String, required: true },
  },
  { _id: false }
);

const oidcSecretsSchema = new Schema(
  {
    pairwise_salt: { type: String, required: true },
  },
  { _id: false }
);

const oidcTokenTtlSchema = new Schema(
  {
    access_token: { type: Number, required: true },
    authorization_code: { type: Number, required: true },
    backchannel_auth: { type: Number, required: true },
    client_credentials: { type: Number, required: true },
    device_code: { type: Number, required: true },
    grant: { type: Number, required: true },
    id_token: { type: Number, required: true },
    interaction: { type: Number, required: true },
    refresh_token: { type: Number, required: true },
    session: { type: Number, required: true },
  },
  { _id: false }
);

const oidcDiscoverySchema = new Schema(
  {
    claims_locales_supported: { type: [String] },
    display_values_supported: { type: [String] },
    op_policy_uri: { type: String },
    op_tos_uri: { type: String },
    service_documentation: { type: String },
    ui_locales_supported: { type: [String] },
  },
  { _id: false }
);

const oidcJwaSchema = new Schema(
  {
    attest_signing_alg_values: { type: [String], required: true },
    authorization_encryption_alg_values: { type: [String], required: true },
    authorization_encryption_enc_values: { type: [String], required: true },
    authorization_signing_alg_values: { type: [String], required: true },
    client_auth_signing_alg_values: { type: [String], required: true },
    dpop_signing_alg_values: { type: [String], required: true },
    id_token_encryption_alg_values: { type: [String], required: true },
    id_token_encryption_enc_values: { type: [String], required: true },
    id_token_signing_alg_values: { type: [String], required: true },
    introspection_encryption_alg_values: { type: [String], required: true },
    introspection_encryption_enc_values: { type: [String], required: true },
    introspection_signing_alg_values: { type: [String], required: true },
    request_object_encryption_alg_values: { type: [String], required: true },
    request_object_encryption_enc_values: { type: [String], required: true },
    request_object_signing_alg_values: { type: [String], required: true },
    userinfo_encryption_alg_values: { type: [String], required: true },
    userinfo_encryption_enc_values: { type: [String], required: true },
    userinfo_signing_alg_values: { type: [String], required: true },
  },
  { _id: false }
);

export const oidcSchema = new Schema(
  {
    issuer: { type: String, required: true },
    path: { type: String, required: true },
    routes: oidcRoutesSchema,
    secrets: oidcSecretsSchema,
    token_ttl: oidcTokenTtlSchema,
    discovery: oidcDiscoverySchema,
    jwa: oidcJwaSchema,
  },
  { _id: false }
);

const integrationsEmailSchema = new Schema(
  {
    smtp_host: { type: String, required: true },
    smtp_port: { type: Number, required: true },
    smtp_username: { type: String, required: true },
    smtp_password: { type: String, required: true },
    from: { type: String, required: true },
  },
  { _id: false }
);

const integrationsUrlsSchema = new Schema(
  {
    website: { type: String, required: true },
    privacy_policy: { type: String, required: true },
    terms_of_service: { type: String, required: true },
    contact: { type: String, required: true },
  },
  { _id: false }
);

// IP Geolocation Service (ipinfo.io)
const integrationsIpinfoSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    api_token: { type: String },
    cache_ttl_hours: { type: Number, default: 24, min: 1 },
  },
  { _id: false }
);

// IP Reputation Service (IPQualityScore)
const integrationsIpqualityscoreSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    api_key: { type: String },
    fraud_score_threshold: { type: Number, default: 75, min: 0, max: 100 },
    cache_ttl_hours: { type: Number, default: 6, min: 1 },
  },
  { _id: false }
);

// FingerprintJS Pro Service (optional enhanced fingerprinting)
const integrationsFingerprintjsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    api_key: { type: String },
    endpoint: { type: String },
  },
  { _id: false }
);

const integrationsS3StorageSchema = new Schema(
  {
    region: { type: String, default: 'us-east-1' },
    bucket: { type: String, default: '' },
    access_key_id: { type: String, default: '' },
    secret_access_key: { type: String, default: '' },
    endpoint: { type: String, default: '' },
    force_path_style: { type: Boolean, default: false },
  },
  { _id: false }
);

const integrationsFileStorageSchema = new Schema(
  {
    upload_dir: { type: String, default: './runtime/uploads' },
    signed_url_expiry_seconds: { type: Number, default: 3600, min: 1 },
    s3: { type: integrationsS3StorageSchema, default: () => ({}) },
  },
  { _id: false }
);

export const integrationsSchema = new Schema(
  {
    email: integrationsEmailSchema,
    urls: integrationsUrlsSchema,
    // IP geolocation service for impossible travel detection
    ipinfo: { type: integrationsIpinfoSchema, default: () => ({}) },
    // IP reputation service for VPN/proxy/fraud detection
    ipqualityscore: {
      type: integrationsIpqualityscoreSchema,
      default: () => ({}),
    },
    // FingerprintJS Pro service for enhanced fingerprinting
    fingerprintjs: {
      type: integrationsFingerprintjsSchema,
      default: () => ({}),
    },
    file_storage: {
      type: integrationsFileStorageSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const notificationChannelsEmailSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationChannelsSmsRateLimitsSchema = new Schema(
  {
    per_phone_per_hour: { type: Number, default: 3 },
    per_ip_per_day: { type: Number, default: 10 },
    cooldown_seconds: { type: Number, default: 60 },
  },
  { _id: false }
);

const notificationChannelsSmsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: ['twilio'] },
    api_key: { type: String },
    api_secret: { type: String },
    from_number: { type: String },
    rate_limits: {
      type: notificationChannelsSmsRateLimitsSchema,
      required: false,
    },
  },
  { _id: false }
);

const notificationChannelsSchema = new Schema(
  {
    email: { type: notificationChannelsEmailSchema, default: () => ({}) },
    sms: { type: notificationChannelsSmsSchema, default: () => ({}) },
  },
  { _id: false }
);

const notificationDefaultsSchema = new Schema(
  {
    security_alerts: { type: Boolean, default: true },
    new_session_alerts: { type: Boolean, default: true },
    allow_user_preferences: { type: Boolean, default: true },
  },
  { _id: false }
);

export const notificationsSchema = new Schema(
  {
    channels: { type: notificationChannelsSchema, default: () => ({}) },
    defaults: { type: notificationDefaultsSchema, default: () => ({}) },
  },
  { _id: false }
);

export { applicationSchema } from './application.js';
