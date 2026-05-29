import { type AppConfig } from './schemas/schema.js';
import { generateSecureRandomString } from '../utils/misc.js';
import { FileSystemUtils } from '../utils/filesystem.js';
const pkgJson = await new FileSystemUtils().getPackageJson();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Resolve a secret from an env var with a development-only fallback.
 * In production, missing secrets cause a hard startup failure to prevent
 * the server from running with auto-generated (non-persistent) secrets.
 */
function resolveSecret(envVar: string, label: string): string {
  const value = process.env[envVar];
  if (value) return value;
  if (IS_PRODUCTION) {
    throw new Error(
      `[FATAL] ${envVar} is not set. ` +
        `${label} must be explicitly configured in production. ` +
        `Generate one with: openssl rand -hex 32`
    );
  }
  return generateSecureRandomString(32);
}

/**
 * Default full configuration object
 * This contains all the default values for the complete Parako configuration
 * Used for auto-flushing when no configuration exists in the database
 *
 * This configuration strictly follows the AppConfigSchema structure
 *
 * Lazy: secrets are resolved at first access (after dotenv has loaded .env),
 * not at module-evaluation time, so that PM2 / production starts work.
 */
let _cachedDefaultConfig: AppConfig | null = null;
export function getDefaultFullConfig(): AppConfig {
  if (!_cachedDefaultConfig) {
    _cachedDefaultConfig = _buildDefaultFullConfig();
  }
  return _cachedDefaultConfig;
}

function _buildDefaultFullConfig(): AppConfig {
  return {
    // APPLICATION - Core Identity & Metadata
    application: {
      title: 'Parako.ID',
      description: pkgJson.description,
      locales: {
        default: 'en',
        available: ['en', 'fr', 'es', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko'],
      },
    },

    // BRANDING - UI/UX Appearance & Theming
    branding: {
      companyName: 'Your Organization',
      logo: '/images/logo-light.svg',
      logoDark: '/images/logo-dark.svg',
      logoIcon: '/images/logo-icon-light.svg',
      logoIconDark: '/images/logo-icon-dark.svg',
      favicon: '/favicon.svg',
      // Theme colors - defaults match public/css/theme.css (Parako.ID Brand Theme)
      // Admins can customize via /admin/settings/branding
      // Font families - defaults to system fonts, customizable via /admin/settings/branding
      fonts: {
        sans: 'ui-sans-serif, system-ui, sans-serif',
        heading: 'ui-sans-serif, system-ui, sans-serif',
        mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      },
      colors: {
        light: {
          background: '#eef0f5',
          foreground: '#2b2b2b',
          card: '#f3f4f8',
          cardForeground: '#2b2b2b',
          popover: '#f3f4f8',
          popoverForeground: '#2b2b2b',
          primary: '#2563eb',
          primaryForeground: '#fefeff',
          secondary: '#e2e4ea',
          secondaryForeground: '#2b2b2b',
          muted: '#e8e9ef',
          mutedForeground: '#5b5c62',
          accent: '#e0e3eb',
          accentForeground: '#2b2b2b',
          destructive: '#c53030',
          destructiveForeground: '#ffffff',
          success: '#16803c',
          successForeground: '#ffffff',
          warning: '#c49a1b',
          warningForeground: '#2b2b2b',
          info: '#2558d1',
          infoForeground: '#ffffff',
          border: '#d4d6de',
          input: '#e3e4e9',
          ring: '#2563eb',
          sidebar: '#e2e4ea',
          sidebarForeground: '#2b2b2b',
          sidebarPrimary: '#2563eb',
          sidebarPrimaryForeground: '#fefeff',
          sidebarAccent: '#d4d6de',
          sidebarAccentForeground: '#2b2b2b',
          sidebarBorder: '#d4d6de',
          sidebarRing: '#2563eb',
        },
        dark: {
          background: '#252838',
          foreground: '#d8dae0',
          card: '#2f3240',
          cardForeground: '#d8dae0',
          popover: '#2f3240',
          popoverForeground: '#d8dae0',
          primary: '#6b8aff',
          primaryForeground: '#ffffff',
          secondary: '#3e4158',
          secondaryForeground: '#d8dae0',
          muted: '#2f3240',
          mutedForeground: '#8b8d96',
          accent: '#363950',
          accentForeground: '#b4b8ff',
          destructive: '#f87171',
          destructiveForeground: '#252838',
          success: '#4ade80',
          successForeground: '#252838',
          warning: '#facc15',
          warningForeground: '#252838',
          info: '#93b4ff',
          infoForeground: '#252838',
          border: '#3e4158',
          input: '#3e4158',
          ring: '#6b8aff',
          sidebar: '#2f3240',
          sidebarForeground: '#d8dae0',
          sidebarPrimary: '#6b8aff',
          sidebarPrimaryForeground: '#ffffff',
          sidebarAccent: '#363950',
          sidebarAccentForeground: '#b4b8ff',
          sidebarBorder: '#3e4158',
          sidebarRing: '#6b8aff',
        },
      },
      ui: {
        customization: {
          enabled: false,
          rootPath: 'runtime/views',
          views: {
            auth: {
              login: 'auth/login.njk',
              register: 'auth/_register.njk',
              forgot_password: 'auth/forgot-password.njk',
              reset_password: 'auth/reset-password.njk',
              email_verification: 'auth/email-verification.njk',
              verify_email: 'auth/verify-email.njk',
              email_verification_success: 'auth/email-verification-success.njk',
              account_select: 'auth/account-select.njk',
              continue: 'auth/continue.njk',
              multi_factor: 'auth/multi-factor.njk',
              mfa_verify: 'auth/mfa-verify.njk',
              mfa_resend: 'auth/mfa-resend.njk',
              logout: 'auth/logout.njk',
              social_password_setup: 'auth/social-password-setup.njk',
              social_contact_info: 'auth/social-contact-info.njk',
              account_recovery: 'auth/account-recovery.njk',
              recovery_backup_codes: 'auth/recovery-backup-codes.njk',
              recovery_secondary_email: 'auth/recovery-secondary-email.njk',
              recovery_verify_code: 'auth/recovery-verify-code.njk',
              setup_mfa: 'auth/setup-mfa.njk',
              social_callback: 'auth/social-cb.njk',
              recovery_method_select: 'auth/recovery-method-select.njk',
              recovery_security_questions:
                'auth/recovery-security-questions.njk',
              recovery_sms: 'auth/recovery-sms.njk',
              recovery_codes_display: 'auth/recovery-codes-display.njk',
              setup_webauthn: 'auth/setup-webauthn.njk',
              mfa_select: 'auth/mfa-select.njk',
              mfa_webauthn: 'auth/mfa-webauthn.njk',
              mfa_no_fallback: 'auth/mfa-no-fallback.njk',
              oidc: {
                consent: 'auth/oidc/consent.njk',
                device_flow_code_input: 'auth/oidc/_device-flow-code-input.njk',
                device_flow_confirm_code:
                  'auth/oidc/device-flow-confirm-code.njk',
                device_flow_success: 'auth/oidc/device-flow-success.njk',
                error: 'auth/oidc/error.njk',
                login: 'auth/oidc/login.njk',
                logout_success: 'auth/oidc/logout-success.njk',
                logout: 'auth/oidc/logout.njk',
                mfa: 'auth/oidc/mfa.njk',
                mfa_select: 'auth/oidc/mfa-select.njk',
                mfa_webauthn: 'auth/oidc/mfa-webauthn.njk',
                mfa_no_fallback: 'auth/oidc/mfa-no-fallback.njk',
                newDeviceVerify: 'auth/oidc/new-device-verify.njk',
              },
            },
            accounts: {
              my_account: 'accounts/my-account.njk',
              settings: 'accounts/settings.njk',
              apps: 'accounts/apps.njk',
              sessions: 'accounts/sessions.njk',
              recovery_codes: 'accounts/recovery-codes.njk',
              recovery_setup: 'accounts/recovery-setup.njk',
              settings_profile: 'accounts/settings/profile.njk',
              settings_preferences: 'accounts/settings/preferences.njk',
              settings_notifications: 'accounts/settings/notifications.njk',
              settings_security: 'accounts/settings/security.njk',
              settings_recovery: 'accounts/settings/recovery.njk',
              settings_social: 'accounts/settings/social.njk',
              security_questions_setup: 'accounts/security-questions-setup.njk',
              passkeys: 'accounts/passkeys.njk',
            },
            errorpage: {
              unauthorized: 'error/401.njk',
              forbidden: 'error/403.njk',
              notfound: 'error/404.njk',
              server_error: 'error/500.njk',
              rate_limit: 'error/rate-limit-inline.html',
            },
            email: {
              mail: 'email/mail.njk',
            },
            home: {
              index: 'home/index.njk',
            },
          },
        },
      },
    },

    // DEPLOYMENT - Environment & Infrastructure
    // Note: deployment.environment is a bootstrap-only field from .env
    deployment: {
      url: 'https://example.com',
      server: {
        allowed_origins: '*',
        proxy: false,
      },
      redis_prefix: 'parako',
      cookies: {
        // Note: secure defaults to true in production to ensure cookies are only sent over HTTPS
        defaults: {
          maxAge: 31536000000, // 1 year
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
        },
        types: {
          session: {
            name: 'application_session',
            maxAge: 86400000, // 24 hours
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
          },
          locale: {
            name: 'locale',
            maxAge: 31536000000, // 1 year
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
          },
          theme: {
            name: 'theme',
            maxAge: 31536000000, // 1 year
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
          },
        },
      },
      routes: {
        auth: '/auth',
        accounts: '/accounts',
        api: '/api/v1',
        home: '/',
        auth_routes: {
          login: '/login',
          register: '/register',
          forgot_password: '/forgot-password',
          reset_password: '/reset-password',
          email_verification: '/email-verification',
          verify_email: '/verify-email',
          email_verification_success: '/email-verification-success',
          account_select: '/account-select',
          continue: '/continue',
          multi_factor: '/multi-factor',
          mfa_verify: '/mfa-verify',
          mfa_resend: '/mfa-resend',
          mfa_select: '/mfa-select',
          mfa_webauthn: '/mfa-webauthn',
          logout: '/logout',
          social_password_setup: '/social-password-setup',
          social_contact_info: '/social-contact-info',
          account_recovery: '/account-recovery',
          recovery_method_select: '/recovery-method-select',
          recovery_backup_codes: '/recovery-backup-codes',
          recovery_secondary_email: '/recovery-secondary-email',
          recovery_security_questions: '/recovery-security-questions',
          recovery_sms: '/recovery-sms',
          recovery_verify_code: '/recovery-verify-code',
          update_theme: '/update-theme',
          update_locale: '/update-locale',
          update_sidebar: '/update-sidebar',
          update_timezone: '/update-timezone',
        },
        account_routes: {
          dashboard: '/',
          settings: '/settings',
          apps: '/apps',
          sessions: '/sessions',
          update_profile: '/update-profile',
          change_password: '/change-password',
          remove_avatar: '/remove-avatar',
          enable_mfa: '/enable-mfa',
          disable_mfa: '/disable-mfa',
          setup_mfa: '/setup-mfa',
          setup_webauthn: '/setup-webauthn',
          passkeys: '/passkeys',
          switch_account: '/switch-account',
          add_account: '/add-account',
          remove_account: '/remove-account',
          account_switcher_data: '/account-switcher-data',
          revoke_app: '/revoke-app',
          revoke_all_apps: '/revoke-all-apps',
          logout_session: '/logout-session',
          logout_all_other_sessions: '/logout-all-other-sessions',
          resend_email_verification: '/resend-email-verification',
          enable_recovery: '/enable-recovery',
          disable_recovery: '/disable-recovery',
          recovery_codes: '/recovery-codes',
          verify_recovery_email: '/verify-recovery-email',
          regenerate_backup_codes: '/regenerate-backup-codes',
          recovery_setup: '/recovery-setup',
          security_questions_setup: '/security-questions/setup',
          update_notification_preferences: '/update-notification-preferences',
          settings_profile: '/settings/profile',
          settings_preferences: '/settings/preferences',
          settings_notifications: '/settings/notifications',
          settings_security: '/settings/security',
          settings_recovery: '/settings/recovery',
          settings_social: '/settings/social',
        },
        api_routes: {
          base: '/',
        },
      },
    },

    // SECURITY - Security & Authentication
    security: {
      secrets: {
        jwt_secret: resolveSecret('JWT_SECRET', 'JWT signing secret'),
        jwt_expires_in: '1h',
        cookie_secrets: [
          resolveSecret('COOKIE_SECRET_1', 'Cookie encryption secret 1'),
          resolveSecret('COOKIE_SECRET_2', 'Cookie encryption secret 2'),
        ],
        hmac_secret: resolveSecret('HMAC_SECRET', 'HMAC signing secret'),
      },
      protection: {
        rate_limiting: {
          enabled: true,
          requests_per_minute: 100,
          window_minutes: 15,
        },
        trusted_domains: [],
        trusted_proxies: [],
        high_risk_countries: [],
        encrypt_device_data: false,
        device_matching: {
          min_confidence_score: 70,
          ip_similarity_threshold: 0.8,
          enable_impossible_travel: true,
          impossible_travel_max_speed_kmh: 900,
          trust_duration_days: 30,
        },
      },
      key_store: {
        type: 'database' as const,
        rotation_interval_days: 90,
        overlap_window_seconds: 7200,
        algorithms: ['RS256', 'ES256', 'EdDSA'] as const,
        promotion_delay_ms: 0,
      },
      authentication: {
        multi_factor: {
          enabled: true,
          totp: {
            enabled: true,
            issuer_name: 'OIDC Provider',
          },
          email: {
            enabled: true,
            code_ttl_seconds: 600,
          },
          sms: {
            enabled: false,
          },
          webauthn: {
            enabled: false,
            rp_name: 'OIDC Provider',
            rp_id: 'localhost',
            timeout: 60000,
            attestation: 'none' as const,
            user_verification: 'preferred' as const,
            resident_key: 'preferred' as const,
            max_credentials_per_user: 10,
          },
        },
        session_management: {
          multiple_accounts: {
            enabled: true,
          },
        },
        session: {
          cookie_name: 'application_session',
          same_site: 'lax' as const,
          bind_ip: false,
          bind_user_agent: false,
          bind_device: false,
          idle_timeout_minutes: 30,
          absolute_timeout_hours: 24,
          max_concurrent_sessions: 0,
          max_accounts_per_session: 5,
          encrypt_session_data: false,
          notify_new_session: false,
          require_reauth_on_switch: false,
          max_flash_messages_per_type: 10,
          max_flash_messages_total: 20,
          require_2fa_for_new_device: false,
          new_device_2fa_method: 'auto' as const,
          new_device_confidence_threshold: 70,
          store_metadata: false,
        },
        login: {
          login_methods: ['email', 'phone'],
          password_policy: {
            min_length: 8,
            require_uppercase: true,
            require_lowercase: true,
            require_numbers: true,
            require_symbols: false,
            max_age_days: 90,
          },
        },
        signup: {
          signup_methods: ['email', 'phone'],
          require_email_verification: false,
          require_phone_verification: false,
          auto_approval: {
            enabled: true,
            domains_whitelist: [],
          },
          contact_channels: {
            require_at_least_one: true,
            email: { enabled: true, required: false },
            phone: { enabled: true, required: false },
            full_name: { enabled: true, required: true },
          },
        },
        roles: {
          available: ['user', 'admin', 'superadmin'],
          default: 'user',
        },
        custom_identifiers: {
          enabled: false,
          fields: [],
        },
        recovery: {
          enabled: true,
          backup_codes: {
            enabled: true,
            count: 10,
            expiry_days: 365,
          },
          secondary_email: {
            enabled: true,
          },
          sms: {
            enabled: false,
          },
          security_questions: {
            enabled: false,
          },
        },
        password_breach_detection: {
          enabled: true,
          api_timeout_ms: 3000,
          check_on_registration: true,
          check_on_login: true,
          check_on_password_reset: true,
          check_on_password_change: true,
          min_breach_count: 1,
        },
      },
    },

    // FEATURES - Feature Toggles & Capabilities
    features: {
      oidc: {
        dev_interactions: { enabled: false },
        device_flow: {
          enabled: true,
          charset: 'digits',
          mask: '***-*-***',
        },
        client_credentials: { enabled: true },
        token_revocation: { enabled: true },
        token_introspection: { enabled: true },
        jwt_introspection: { enabled: false },
        userinfo_endpoint: { enabled: true },
        resource_indicators: { enabled: true },
        rp_initiated_logout: { enabled: true },
        backchannel_logout: { enabled: true },
        dynamic_client_registration: {
          enabled: false,
          require_initial_access_token: true,
          issue_registration_access_token: true,
        },
        client_registration_management: {
          enabled: false,
          rotate_registration_access_token: true,
        },
        pkce: {
          enabled: true,
          required: true,
        },
        extra_params: {
          enabled: true,
          allowed_params: [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
            'tenant_id',
            'app_id',
            'continue',
          ],
        },
        accept_query_param_access_tokens: true,
        conform_id_token_claims: false,
        allow_omitting_single_registered_redirect_uri: true,
        enable_http_post_methods: false,
        expires_with_session: true,
        rotate_refresh_token: true,
        client_based_cors: true,
        clock_tolerance: 15,
        acr_values: {
          supported: ['urn:mfa:otp', 'urn:mfa:webauthn'],
        },
        claims: {
          openid: ['sub'],
          profile: [
            'name',
            'family_name',
            'given_name',
            'picture',
            'locale',
            'username',
          ],
          email: ['email', 'email_verified'],
          phone: ['phone_number', 'phone_number_verified'],
          address: ['address'],
          custom_identifiers: [] as string[],
        },
        scopes: [
          'openid',
          'profile',
          'email',
          'phone',
          'address',
          'offline_access',
          'custom_identifiers',
        ],
        subject_types: ['public', 'pairwise'],
        allowOmittingSingleRegisteredRedirectUri: true,
        encryption: {
          enabled: false,
        },
        jwt_response_modes: {
          enabled: false,
        },
        jwt_userinfo: {
          enabled: false,
        },
        request_objects: {
          enabled: true,
        },
        extra_client_metadata: {
          properties: [
            'allowedResources',
            'resourcesScopes',
            'isInternalClient',
          ],
        },
      },
      social_providers: {
        enabled: [],
        available: ['google', 'github', 'microsoft', 'linkedin', 'facebook'],
        behavior: {
          existing_user_no_integration: 'require_manual_link',
          no_user_account: 'allow_registration',
          missing_contact_info: 'redirect_to_form',
          require_password_on_registration: false,
          options: {
            allow_multiple_providers: true,
            auto_verify_email: true,
            show_helpful_errors: false,
            max_providers_per_user: 5,
          },
        },
        google: {
          client_id: 'your-google-client-id',
          client_secret: 'your-google-client-secret',
          discovery_url:
            'https://accounts.google.com/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'email'],
        },
        github: {
          client_id: 'your-github-client-id',
          client_secret: 'your-github-client-secret',
          authorization_endpoint: 'https://github.com/login/oauth/authorize',
          token_endpoint: 'https://github.com/login/oauth/access_token',
          userinfo_endpoint: 'https://api.github.com/user',
          scopes: ['user:email'],
        },
        microsoft: {
          client_id: 'your-microsoft-client-id',
          client_secret: 'your-microsoft-client-secret',
          discovery_url:
            'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'email'],
        },
        linkedin: {
          client_id: 'your-linkedin-client-id',
          client_secret: 'your-linkedin-client-secret',
          authorization_endpoint:
            'https://www.linkedin.com/oauth/v2/authorization',
          token_endpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
          userinfo_endpoint: 'https://api.linkedin.com/v2/userinfo',
          scopes: ['openid', 'profile', 'email'],
        },
        facebook: {
          client_id: 'your-facebook-client-id',
          client_secret: 'your-facebook-client-secret',
          authorization_endpoint: 'https://www.facebook.com/v19.0/dialog/oauth',
          token_endpoint: 'https://graph.facebook.com/v19.0/oauth/access_token',
          userinfo_endpoint: 'https://graph.facebook.com/me',
          scopes: ['email', 'public_profile'],
        },
      },
      metrics: {
        enabled: false,
        path: '/metrics',
        include_default_metrics: true,
        prefix: 'parako_',
      },
      multi_tenancy: {
        enabled: false,
        extraction_priority: ['header', 'subdomain'] as (
          | 'header'
          | 'subdomain'
        )[],
        tenant_header: 'x-tenant-id',
        provider_pool: {
          max_size: 50,
          idle_ttl_ms: 1_800_000,
          cleanup_interval_ms: 60_000,
        },
      },
    },

    // OIDC STORAGE — computed from bootstrap env vars at runtime.
    // These defaults exist only for type safety; buildOidcStorageFromBootstrap()
    // in config/index.ts overwrites them with actual bootstrap values.
    oidc_storage: {
      oidc_adapter: {
        type: 'sqlite' as const,
        mongodb: {
          uri: '',
          database: '',
        },
        redis: {
          host: 'localhost',
          port: 6379,
          database: 0,
        },
      },
    },

    // OIDC - OIDC Protocol Configuration
    oidc: {
      issuer: 'https://example.com/oidc/v1',
      path: '/oidc/v1',
      routes: {
        authorization: '/authorize',
        userinfo: '/userinfo',
        registration: '/register-rp',
        backchannel_authentication: '/backchannel',
        challenge: '/challenge',
        code_verification: '/device',
        device_authorization: '/device/auth',
        end_session: '/session/end',
        introspection: '/token/introspection',
        jwks: '/jwks',
        pushed_authorization_request: '/request',
        revocation: '/token/revocation',
        token: '/token',
      },
      secrets: {
        pairwise_salt: resolveSecret(
          'PAIRWISE_SALT',
          'OIDC pairwise subject salt'
        ),
      },
      token_ttl: {
        access_token: 3600,
        authorization_code: 600,
        backchannel_auth: 600,
        client_credentials: 3600,
        device_code: 600,
        grant: 3600,
        id_token: 3600,
        interaction: 600,
        refresh_token: 86400,
        session: 86400,
      },
      discovery: {
        claims_locales_supported: [
          'en',
          'fr',
          'es',
          'pt',
          'de',
          'it',
          'ru',
          'zh',
          'ja',
          'ko',
        ],
        display_values_supported: [
          'en',
          'fr',
          'es',
          'pt',
          'de',
          'it',
          'ru',
          'zh',
          'ja',
          'ko',
        ],
        ui_locales_supported: [
          'en',
          'fr',
          'es',
          'pt',
          'de',
          'it',
          'ru',
          'zh',
          'ja',
          'ko',
        ],
        op_policy_uri: '',
        op_tos_uri: '',
        service_documentation: '',
      },
      jwa: {
        attest_signing_alg_values: ['ES256', 'Ed25519', 'EdDSA'],
        authorization_encryption_alg_values: [
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ],
        authorization_encryption_enc_values: [
          'A128CBC-HS256',
          'A128GCM',
          'A256CBC-HS512',
          'A256GCM',
        ],
        authorization_signing_alg_values: [
          'RS256',
          'PS256',
          'ES256',
          'Ed25519',
          'EdDSA',
        ],
        client_auth_signing_alg_values: [
          'HS256',
          'RS256',
          'PS256',
          'ES256',
          'Ed25519',
          'EdDSA',
        ],
        dpop_signing_alg_values: ['ES256', 'Ed25519', 'EdDSA'],
        id_token_encryption_alg_values: [
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ],
        id_token_encryption_enc_values: [
          'A128CBC-HS256',
          'A128GCM',
          'A256CBC-HS512',
          'A256GCM',
        ],
        id_token_signing_alg_values: [
          'RS256',
          'PS256',
          'ES256',
          'Ed25519',
          'EdDSA',
        ],
        introspection_encryption_alg_values: [
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ],
        introspection_encryption_enc_values: [
          'A128CBC-HS256',
          'A128GCM',
          'A256CBC-HS512',
          'A256GCM',
        ],
        introspection_signing_alg_values: [
          'RS256',
          'PS256',
          'ES256',
          'Ed25519',
          'EdDSA',
        ],
        request_object_encryption_alg_values: [
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ],
        request_object_encryption_enc_values: [
          'A128CBC-HS256',
          'A128GCM',
          'A256CBC-HS512',
          'A256GCM',
        ],
        request_object_signing_alg_values: [
          'HS256',
          'RS256',
          'PS256',
          'ES256',
          'Ed25519',
          'EdDSA',
        ],
        userinfo_encryption_alg_values: [
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ],
        userinfo_encryption_enc_values: [
          'A128CBC-HS256',
          'A128GCM',
          'A256CBC-HS512',
          'A256GCM',
        ],
        userinfo_signing_alg_values: [
          'RS256',
          'PS256',
          'ES256',
          'Ed25519',
          'EdDSA',
        ],
      },
    },

    // INTEGRATIONS - External Services
    integrations: {
      email: {
        smtp_host: 'your-smtp-host',
        smtp_port: 587,
        smtp_username: 'your-email@example.com',
        smtp_password: process.env.SMTP_PASSWORD || 'not-configured',
        from: 'your-email@example.com',
      },
      urls: {
        website: 'https://example.com',
        privacy_policy: 'https://example.com/privacy',
        terms_of_service: 'https://example.com/terms',
        contact: 'https://example.com/contact',
      },
      ipinfo: {
        enabled: false,
        cache_ttl_hours: 24,
      },
      ipqualityscore: {
        enabled: false,
        fraud_score_threshold: 75,
        cache_ttl_hours: 6,
      },
      fingerprintjs: {
        enabled: false,
      },
      file_storage: {
        provider: 'local' as const,
        upload_dir: './uploads',
        signed_url_expiry_seconds: 3600,
        s3: {
          region: 'us-east-1',
          bucket: '',
          access_key_id: '',
          secret_access_key: '',
        },
      },
    },

    // NOTIFICATIONS - Notification Channels & Preferences
    notifications: {
      channels: {
        email: { enabled: true },
        sms: { enabled: false },
      },
      defaults: {
        security_alerts: true,
        new_session_alerts: true,
        allow_user_preferences: true,
      },
    },
  };
}

/**
 * Web-safe font options for font customization
 * These fonts are available on most operating systems without needing to load external fonts
 */
export const WEB_SAFE_FONTS = {
  sans: [
    { value: 'system-ui, sans-serif', label: 'System Default' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
    { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
    { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
    { value: "'Palatino Linotype', Palatino, serif", label: 'Palatino' },
    { value: "'Book Antiqua', Palatino, serif", label: 'Book Antiqua' },
    { value: 'Garamond, serif', label: 'Garamond' },
    { value: "'Segoe UI', Tahoma, sans-serif", label: 'Segoe UI' },
    { value: "'Lucida Sans', sans-serif", label: 'Lucida Sans' },
    { value: 'Impact, sans-serif', label: 'Impact' },
    { value: "'Century Gothic', sans-serif", label: 'Century Gothic' },
    { value: "'Gill Sans', sans-serif", label: 'Gill Sans' },
  ],
  mono: [
    { value: 'monospace', label: 'System Monospace' },
    { value: "'Courier New', Courier, monospace", label: 'Courier New' },
    { value: "'Lucida Console', Monaco, monospace", label: 'Lucida Console' },
    { value: 'Consolas, monospace', label: 'Consolas' },
    { value: "'Andale Mono', monospace", label: 'Andale Mono' },
    { value: 'Monaco, monospace', label: 'Monaco' },
  ],
};
