import { z } from 'zod';
import { isRegexSafe } from '../../utils/custom-identifier-validation.js';

/**
 * Coerce string values to boolean for HTML form inputs
 * Handles: "on", "true", "1" -> true; undefined, null, "off", "false", "0" -> false
 */
const coerceBooleanSchema = z
  .union([z.boolean(), z.string(), z.undefined(), z.null()])
  .transform((val: boolean | string | null | undefined) => {
    if (typeof val === 'boolean') return val;
    if (val === undefined || val === null) return false;
    const strVal = String(val).toLowerCase();
    return strVal === 'on' || strVal === 'true' || strVal === '1';
  });

/**
 * Parako.ID Configuration Schema - Redesigned
 *
 * This schema defines the PERSISTED configuration structure for the OIDC Identity Provider
 * with a clear, logical organization that separates concerns and is future-proof.
 *
 * IMPORTANT: This schema represents configuration that can be stored in the database
 * or file and modified through the admin UI. It EXCLUDES bootstrap-only fields that
 * must be set via environment variables (.env):
 * - deployment.environment (dev/staging/production)
 * - deployment.server.port (HTTP server port)
 * - storage.adapter + storage.mongodb/* | storage.sqlite/* | storage.postgresql/* (main database connection)
 *
 * At runtime, bootstrap config is merged with persisted config to create the complete
 * RuntimeConfig used by the application.
 *
 * Organization:
 * 1. application - Core app identity & metadata
 * 2. branding - UI/UX appearance & theming
 * 3. deployment - Environment & infrastructure (excludes environment, port)
 * 4. security - Security & authentication
 * 5. features - Feature toggles & capabilities
 * 6. oidc_storage - OIDC protocol data storage (COMPUTED from bootstrap, not persisted)
 * 7. oidc - OIDC protocol configuration
 * 8. integrations - External services (email, urls)
 */

/**
 * Persisted Configuration Schema
 *
 * This schema defines configuration that can be stored in database or file
 * and modified through the admin UI or CLI. Bootstrap-only fields (environment,
 * port, database URI) are NOT included here and must be set via .env file.
 *
 * Organization:
 * 1. application - Core app identity & metadata
 * 2. branding - UI/UX appearance & theming
 * 3. deployment - Environment & infrastructure (excludes environment, port)
 * 4. security - Security & authentication
 * 5. features - Feature toggles & capabilities
 * 6. oidc_storage - OIDC protocol data storage (COMPUTED from bootstrap, not persisted)
 * 7. oidc - OIDC protocol configuration
 * 8. integrations - External services
 */
export const AppConfigSchema = z.object({
  // APPLICATION - Core Identity & Metadata
  // Basic application information and localization

  /**
   * Core application identity and metadata
   */
  application: z.object({
    title: z.string().min(1, 'Application title cannot be empty'),
    description: z.string().min(1, 'Application description cannot be empty'),

    /**
     * Internationalization and localization settings
     * Supported languages: en, fr, es, pt, de, it, ru, zh, ja, ko
     */
    locales: z.object({
      default: z
        .string()
        .min(2, 'Default locale must be at least 2 characters')
        .default('en'),
      available: z
        .array(z.string().min(2, 'Locale code must be at least 2 characters'))
        .min(1, 'At least one locale must be available')
        .default(['en', 'fr', 'es', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko']),
    }),
  }),

  // BRANDING - UI/UX Appearance & Theming
  // Visual identity, themes, and social sharing

  /**
   * Branding and visual identity configuration
   */
  branding: z.object({
    companyName: z
      .string()
      .min(1, 'Company name cannot be empty')
      .default('Your Organization'),
    logo: z
      .string()
      .min(1, 'Logo path cannot be empty')
      .default('/images/logo-light.svg')
      .refine((val: string) => {
        if (val.startsWith('/')) {
          return true;
        }
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      }, 'Logo must be a valid URL (http://example.com/logo.png) or relative path (/images/logo.png)'),

    /**
     * Dark mode logo variant (optional)
     * Falls back to main logo if not set
     */
    logoDark: z
      .string()
      .min(1, 'Dark logo path cannot be empty')
      .refine((val: string) => {
        if (val.startsWith('/')) return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      }, 'Dark logo must be a valid URL or relative path')
      .nullable()
      .optional(),

    /**
     * Icon-only logo for collapsed sidebar (optional)
     * Falls back to main logo if not set
     */
    logoIcon: z
      .string()
      .min(1, 'Icon logo path cannot be empty')
      .refine((val: string) => {
        if (val.startsWith('/')) return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      }, 'Icon logo must be a valid URL or relative path')
      .nullable()
      .optional(),

    /**
     * Dark mode icon-only logo variant (optional)
     * Falls back to icon logo or main logo if not set
     */
    logoIconDark: z
      .string()
      .min(1, 'Dark icon logo path cannot be empty')
      .refine((val: string) => {
        if (val.startsWith('/')) return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      }, 'Dark icon logo must be a valid URL or relative path')
      .nullable()
      .optional(),

    /**
     * Custom favicon (optional)
     * Falls back to /favicon.svg if not set
     */
    favicon: z
      .string()
      .min(1, 'Favicon path cannot be empty')
      .refine((val: string) => {
        if (val.startsWith('/')) return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      }, 'Favicon must be a valid URL or relative path')
      .nullable()
      .optional(),

    /**
     * UI customization and theming configuration
     * Allows users to override default views with custom templates
     * For theme colors, users can place a custom colors.css file in the runtime/ directory
     */
    ui: z.object({
      /**
       * View customization settings
       */
      customization: z.object({
        enabled: z
          .boolean()
          .default(false)
          .describe('Whether to enable custom view overrides'),
        rootPath: z
          .string()
          .default('runtime/views')
          .describe('Root path for custom view templates'),

        /**
         * Custom view overrides for different sections
         * When enabled, these paths will be checked before falling back to default views
         * All view paths are optional - only define the ones you want to customize
         */
        views: z
          .object({
            /**
             * Authentication views (auth routes)
             * Default paths for custom view templates
             */
            auth: z
              .object({
                login: z
                  .string()
                  .default('auth/login.njk')
                  .describe('Login page template'),
                register: z
                  .string()
                  .default('auth/_register.njk')
                  .describe('Registration page template'),
                forgot_password: z
                  .string()
                  .default('auth/forgot-password.njk')
                  .describe('Forgot password page template'),
                reset_password: z
                  .string()
                  .default('auth/reset-password.njk')
                  .describe('Reset password page template'),
                email_verification: z
                  .string()
                  .default('auth/email-verification.njk')
                  .describe('Email verification page template'),
                verify_email: z
                  .string()
                  .default('auth/verify-email.njk')
                  .describe('Email verification success template'),
                email_verification_success: z
                  .string()
                  .default('auth/email-verification-success.njk')
                  .describe('Email verification success template'),
                account_select: z
                  .string()
                  .default('auth/account-select.njk')
                  .describe('Account selection template'),
                continue: z
                  .string()
                  .default('auth/continue.njk')
                  .describe('Continue with account template'),
                multi_factor: z
                  .string()
                  .default('auth/multi-factor.njk')
                  .describe('Multi-factor authentication template'),
                mfa_verify: z
                  .string()
                  .default('auth/mfa-verify.njk')
                  .describe('MFA verification template'),
                mfa_resend: z
                  .string()
                  .default('auth/mfa-resend.njk')
                  .describe('MFA resend template'),
                logout: z
                  .string()
                  .default('auth/logout.njk')
                  .describe('Logout page template'),
                social_password_setup: z
                  .string()
                  .default('auth/social-password-setup.njk')
                  .describe('Social password setup template'),
                social_contact_info: z
                  .string()
                  .default('auth/social-contact-info.njk')
                  .describe('Social contact info template'),
                account_recovery: z
                  .string()
                  .default('auth/account-recovery.njk')
                  .describe('Account recovery template'),
                recovery_backup_codes: z
                  .string()
                  .default('auth/recovery-backup-codes.njk')
                  .describe('Recovery backup codes template'),
                recovery_secondary_email: z
                  .string()
                  .default('auth/recovery-secondary-email.njk')
                  .describe('Recovery secondary email template'),
                recovery_verify_code: z
                  .string()
                  .default('auth/recovery-verify-code.njk')
                  .describe('Recovery verify code template'),
                setup_mfa: z
                  .string()
                  .default('auth/setup-mfa.njk')
                  .describe('MFA setup template'),
                social_callback: z
                  .string()
                  .default('auth/social-cb.njk')
                  .describe('Social login callback template'),
                recovery_method_select: z
                  .string()
                  .default('auth/recovery-method-select.njk')
                  .describe('Recovery method selection template'),
                recovery_security_questions: z
                  .string()
                  .default('auth/recovery-security-questions.njk')
                  .describe('Recovery security questions template'),
                recovery_sms: z
                  .string()
                  .default('auth/recovery-sms.njk')
                  .describe('Recovery SMS template'),
                recovery_codes_display: z
                  .string()
                  .default('auth/recovery-codes-display.njk')
                  .describe('Recovery codes display template'),
                setup_webauthn: z
                  .string()
                  .default('auth/setup-webauthn.njk')
                  .describe('WebAuthn setup template'),
                mfa_select: z
                  .string()
                  .default('auth/mfa-select.njk')
                  .describe('MFA method selection template'),
                mfa_webauthn: z
                  .string()
                  .default('auth/mfa-webauthn.njk')
                  .describe('MFA WebAuthn verification template'),
                mfa_no_fallback: z
                  .string()
                  .default('auth/mfa-no-fallback.njk')
                  .describe('MFA no fallback template'),

                /**
                 * OIDC-specific views
                 * Default paths for OIDC view templates
                 */
                oidc: z
                  .object({
                    consent: z
                      .string()
                      .default('auth/oidc/consent.njk')
                      .describe('OIDC consent page template'),
                    device_flow_code_input: z
                      .string()
                      .default('auth/oidc/_device-flow-code-input.njk')
                      .describe('Device flow code input template'),
                    device_flow_confirm_code: z
                      .string()
                      .default('auth/oidc/device-flow-confirm-code.njk')
                      .describe('Device flow confirm code template'),
                    device_flow_success: z
                      .string()
                      .default('auth/oidc/device-flow-success.njk')
                      .describe('Device flow success template'),
                    error: z
                      .string()
                      .default('auth/oidc/error.njk')
                      .describe('OIDC error page template'),
                    login: z
                      .string()
                      .default('auth/oidc/login.njk')
                      .describe('OIDC login page template'),
                    logout_success: z
                      .string()
                      .default('auth/oidc/logout-success.njk')
                      .describe('OIDC logout success template'),
                    logout: z
                      .string()
                      .default('auth/oidc/logout.njk')
                      .describe('OIDC logout page template'),
                    mfa: z
                      .string()
                      .default('auth/oidc/mfa.njk')
                      .describe('OIDC MFA template'),
                    mfa_select: z
                      .string()
                      .default('auth/oidc/mfa-select.njk')
                      .describe('OIDC MFA selection template'),
                    mfa_webauthn: z
                      .string()
                      .default('auth/oidc/mfa-webauthn.njk')
                      .describe('OIDC MFA WebAuthn template'),
                    mfa_no_fallback: z
                      .string()
                      .default('auth/oidc/mfa-no-fallback.njk')
                      .describe('OIDC MFA no fallback template'),
                    newDeviceVerify: z
                      .string()
                      .default('auth/oidc/new-device-verify.njk')
                      .describe('New device verification template'),
                  })
                  .default({
                    consent: 'auth/oidc/consent.njk',
                    device_flow_code_input:
                      'auth/oidc/_device-flow-code-input.njk',
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
                  }),
              })
              .default({
                login: 'auth/login.njk',
                register: 'auth/_register.njk',
                forgot_password: 'auth/forgot-password.njk',
                reset_password: 'auth/reset-password.njk',
                email_verification: 'auth/email-verification.njk',
                verify_email: 'auth/verify-email.njk',
                email_verification_success:
                  'auth/email-verification-success.njk',
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
                  device_flow_code_input:
                    'auth/oidc/_device-flow-code-input.njk',
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
              }),

            /**
             * Account management views (accounts routes)
             * Default paths for account view templates
             */
            accounts: z
              .object({
                my_account: z
                  .string()
                  .default('accounts/my-account.njk')
                  .describe('My account profile template'),
                settings: z
                  .string()
                  .default('accounts/settings.njk')
                  .describe('Account settings template'),
                apps: z
                  .string()
                  .default('accounts/apps.njk')
                  .describe('Connected applications template'),
                sessions: z
                  .string()
                  .default('accounts/sessions.njk')
                  .describe('Active sessions template'),
                recovery_codes: z
                  .string()
                  .default('accounts/recovery-codes.njk')
                  .describe('Recovery codes display template'),
                recovery_setup: z
                  .string()
                  .default('accounts/recovery-setup.njk')
                  .describe('Recovery setup template'),
                settings_profile: z
                  .string()
                  .default('accounts/settings/profile.njk')
                  .describe('Profile settings template'),
                settings_preferences: z
                  .string()
                  .default('accounts/settings/preferences.njk')
                  .describe('Preferences settings template'),
                settings_notifications: z
                  .string()
                  .default('accounts/settings/notifications.njk')
                  .describe('Notifications settings template'),
                settings_security: z
                  .string()
                  .default('accounts/settings/security.njk')
                  .describe('Security settings template'),
                settings_recovery: z
                  .string()
                  .default('accounts/settings/recovery.njk')
                  .describe('Recovery settings template'),
                settings_social: z
                  .string()
                  .default('accounts/settings/social.njk')
                  .describe('Social accounts settings template'),
                security_questions_setup: z
                  .string()
                  .default('accounts/security-questions-setup.njk')
                  .describe('Security questions setup template'),
                passkeys: z
                  .string()
                  .default('accounts/passkeys.njk')
                  .describe('Passkeys management template'),
              })
              .default({
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
                security_questions_setup:
                  'accounts/security-questions-setup.njk',
                passkeys: 'accounts/passkeys.njk',
              }),

            /**
             * Error pages
             * Default paths for error page templates
             */
            errorpage: z
              .object({
                unauthorized: z
                  .string()
                  .default('error/401.njk')
                  .describe('Unauthorized error template'),
                forbidden: z
                  .string()
                  .default('error/403.njk')
                  .describe('Forbidden error template'),
                notfound: z
                  .string()
                  .default('error/404.njk')
                  .describe('Not found error template'),
                server_error: z
                  .string()
                  .default('error/500.njk')
                  .describe('Server error template'),
                rate_limit: z
                  .string()
                  .default('error/rate-limit-inline.html')
                  .describe('Rate limit error template'),
              })
              .default({
                unauthorized: 'error/401.njk',
                forbidden: 'error/403.njk',
                notfound: 'error/404.njk',
                server_error: 'error/500.njk',
                rate_limit: 'error/rate-limit-inline.html',
              }),

            /**
             * Email templates
             * Default paths for email templates
             */
            email: z
              .object({
                mail: z
                  .string()
                  .default('email/mail.njk')
                  .describe('Email template wrapper'),
              })
              .default({
                mail: 'email/mail.njk',
              }),

            /**
             * Home page
             * Default path for home page template
             */
            home: z
              .object({
                index: z
                  .string()
                  .default('home/index.njk')
                  .describe('Home page template'),
              })
              .default({
                index: 'home/index.njk',
              }),
          })
          .default({
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
          }),
      }),
    }),

    /**
     * Font family customization
     * Stores font family values for typography
     * These override the default CSS font variables
     */
    fonts: z
      .object({
        sans: z.string().max(200).nullable().optional(),
        heading: z.string().max(200).nullable().optional(),
        mono: z.string().max(200).nullable().optional(),
      })
      .optional()
      .default({
        sans: 'ui-sans-serif, system-ui, sans-serif',
        heading: 'ui-sans-serif, system-ui, sans-serif',
        mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      }),

    /**
     * Theme color customization
     * Stores hex colors for light and dark modes
     * These override the default CSS variable values
     */
    colors: z
      .object({
        light: z
          .object({
            primary: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            primaryForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            secondary: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            secondaryForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            accent: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            accentForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            destructive: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            destructiveForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            success: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            successForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            warning: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            warningForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            info: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            infoForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            background: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            foreground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            card: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            cardForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            popover: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            popoverForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            muted: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            mutedForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            border: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            input: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            ring: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebar: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarPrimary: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarPrimaryForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarAccent: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarAccentForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarBorder: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarRing: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
          })
          .default({}),
        dark: z
          .object({
            primary: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            primaryForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            secondary: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            secondaryForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            accent: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            accentForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            destructive: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            destructiveForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            success: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            successForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            warning: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            warningForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            info: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            infoForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            background: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            foreground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            card: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            cardForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            popover: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            popoverForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            muted: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            mutedForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            border: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            input: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            ring: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebar: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarPrimary: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarPrimaryForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarAccent: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarAccentForeground: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarBorder: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
            sidebarRing: z
              .string()
              .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color')
              .nullable()
              .optional(),
          })
          .default({}),
      })
      .default({ light: {}, dark: {} }),
  }),

  // DEPLOYMENT - Environment & Infrastructure
  // Server settings, environment configuration, and routing

  /**
   * Deployment and infrastructure configuration
   *
   * NOTE: Bootstrap-only fields (environment, server.port) are NOT included here.
   * They must be set via .env file and cannot be modified through the admin UI.
   */
  deployment: z.object({
    url: z
      .url('Application URL must be a valid URL')
      .describe('Public URL of the application'),

    /**
     * Server configuration
     *
     * NOTE: server.port is a bootstrap-only field and is NOT included here.
     * It must be set via PORT environment variable in .env file.
     */
    server: z.object({
      allowed_origins: z.string().min(1, 'Allowed origins cannot be empty'),
      proxy: z
        .boolean()
        .default(false)
        .describe(
          'Trust proxy headers (enable in production behind reverse proxy)'
        ),
    }),

    /**
     * Base Redis key prefix shared by all subsystems.
     * Each subsystem appends its own suffix:
     *   session  → {redis_prefix}:session:
     *   oidc     → {redis_prefix}:oidc:
     *   rl       → {redis_prefix}:rl:{name}:
     *   pubsub   → {redis_prefix}:pubsub:
     */
    redis_prefix: z
      .string()
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        'Redis prefix must contain only alphanumeric characters, hyphens, and underscores'
      )
      .default('parako')
      .describe('Base Redis key prefix shared by all subsystems'),

    /**
     * Cookie configuration for application cookies
     * Controls security, expiration, and behavior of cookies based on deployment environment
     */
    cookies: z
      .object({
        /**
         * Default cookie settings applied to all application cookies
         */
        defaults: z.object({
          maxAge: z
            .number()
            .int()
            .positive('Cookie max age must be a positive integer')
            .default(365 * 24 * 60 * 60 * 1000)
            .describe('Default cookie max age in milliseconds (1 year)'),
          httpOnly: z
            .boolean()
            .default(true)
            .describe('Whether cookies should be HTTP-only by default'),
          secure: z
            .boolean()
            .default(false)
            .describe(
              'Whether cookies should be secure (HTTPS only) by default'
            ),
          sameSite: z
            .enum(['strict', 'lax', 'none'])
            .default('lax')
            .describe('SameSite attribute for cookies'),
          path: z.string().default('/').describe('Default path for cookies'),
        }),

        /**
         * Specific cookie configurations for different types
         */
        types: z.object({
          session: z.object({
            name: z
              .string()
              .default('application_session')
              .describe('Cookie name for session'),
            maxAge: z
              .number()
              .int()
              .positive()
              .default(24 * 60 * 60 * 1000)
              .describe('Session cookie max age in milliseconds (24 hours)'),
            httpOnly: z
              .boolean()
              .default(true)
              .describe('Whether session cookie should be HTTP-only'),
            secure: z
              .boolean()
              .default(false)
              .describe('Whether session cookie should be secure'),
            sameSite: z
              .enum(['strict', 'lax', 'none'])
              .default('lax')
              .describe('SameSite attribute for session cookie'),
          }),
          locale: z.object({
            name: z
              .string()
              .default('locale')
              .describe('Cookie name for locale preference'),
            maxAge: z
              .number()
              .int()
              .positive()
              .default(365 * 24 * 60 * 60 * 1000)
              .describe('Locale cookie max age in milliseconds'),
            httpOnly: z
              .boolean()
              .default(true)
              .describe('Whether locale cookie should be HTTP-only'),
            secure: z
              .boolean()
              .default(false)
              .describe('Whether locale cookie should be secure'),
            sameSite: z
              .enum(['strict', 'lax', 'none'])
              .default('lax')
              .describe('SameSite attribute for locale cookie'),
          }),
          theme: z.object({
            name: z
              .string()
              .default('theme')
              .describe('Cookie name for theme preference'),
            maxAge: z
              .number()
              .int()
              .positive()
              .default(365 * 24 * 60 * 60 * 1000)
              .describe('Theme cookie max age in milliseconds'),
            httpOnly: z
              .boolean()
              .default(true)
              .describe('Whether theme cookie should be HTTP-only'),
            secure: z
              .boolean()
              .default(false)
              .describe('Whether theme cookie should be secure'),
            sameSite: z
              .enum(['strict', 'lax', 'none'])
              .default('lax')
              .describe('SameSite attribute for theme cookie'),
          }),
        }),
      })
      .default({
        defaults: {
          maxAge: 365 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/',
        },
        types: {
          session: {
            name: 'application_session',
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
          },
          locale: {
            name: 'locale',
            maxAge: 365 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
          },
          theme: {
            name: 'theme',
            maxAge: 365 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
          },
        },
      }),

    /**
     * Application route configuration
     * Controls custom paths for authentication, accounts, and API endpoints
     */
    routes: z.object({
      auth: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/auth')
        .describe('Authentication routes base path'),
      accounts: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/accounts')
        .describe('Account management routes base path'),
      api: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/api/v1')
        .describe('API routes base path'),
      home: z
        .string()
        .startsWith('/')
        .default('/')
        .describe('Home/root route path'),

      /**
       * Individual authentication route paths
       */
      auth_routes: z.object({
        login: z.string().startsWith('/').min(2).default('/login'),
        register: z.string().startsWith('/').min(2).default('/register'),
        forgot_password: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/forgot-password'),
        reset_password: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/reset-password'),
        email_verification: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/email-verification'),
        verify_email: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/verify-email'),
        email_verification_success: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/email-verification-success'),
        account_select: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/account-select'),
        continue: z.string().startsWith('/').min(2).default('/continue'),
        multi_factor: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/multi-factor'),
        mfa_verify: z.string().startsWith('/').min(2).default('/mfa-verify'),
        mfa_resend: z.string().startsWith('/').min(2).default('/mfa-resend'),
        mfa_select: z.string().startsWith('/').min(2).default('/mfa-select'),
        mfa_webauthn: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/mfa-webauthn'),
        logout: z.string().startsWith('/').min(2).default('/logout'),
        social_password_setup: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/social-password-setup'),
        social_contact_info: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/social-contact-info'),
        account_recovery: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/account-recovery'),
        recovery_backup_codes: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-backup-codes'),
        recovery_secondary_email: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-secondary-email'),
        recovery_verify_code: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-verify-code'),
        recovery_method_select: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-method-select'),
        recovery_security_questions: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-security-questions'),
        recovery_sms: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-sms'),
        update_theme: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/update-theme'),
        update_locale: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/update-locale'),
        update_sidebar: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/update-sidebar'),
        update_timezone: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/update-timezone'),
      }),

      /**
       * Individual account management route paths
       */
      account_routes: z.object({
        dashboard: z.string().startsWith('/').default('/'),
        settings: z.string().startsWith('/').min(2).default('/settings'),
        apps: z.string().startsWith('/').min(2).default('/apps'),
        sessions: z.string().startsWith('/').min(2).default('/sessions'),
        update_profile: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/update-profile'),
        change_password: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/change-password'),
        remove_avatar: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/remove-avatar'),
        enable_mfa: z.string().startsWith('/').min(2).default('/enable-mfa'),
        disable_mfa: z.string().startsWith('/').min(2).default('/disable-mfa'),
        setup_mfa: z.string().startsWith('/').min(2).default('/setup-mfa'),
        setup_webauthn: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/setup-webauthn'),
        passkeys: z.string().startsWith('/').min(2).default('/passkeys'),
        switch_account: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/switch-account'),
        add_account: z.string().startsWith('/').min(2).default('/add-account'),
        remove_account: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/remove-account'),
        account_switcher_data: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/account-switcher-data'),
        revoke_app: z.string().startsWith('/').min(2).default('/revoke-app'),
        revoke_all_apps: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/revoke-all-apps'),
        logout_session: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/logout-session'),
        logout_all_other_sessions: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/logout-all-other-sessions'),
        resend_email_verification: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/resend-email-verification'),
        enable_recovery: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/enable-recovery'),
        disable_recovery: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/disable-recovery'),
        recovery_codes: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-codes'),
        verify_recovery_email: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/verify-recovery-email'),
        regenerate_backup_codes: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/regenerate-backup-codes'),
        recovery_setup: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/recovery-setup'),
        security_questions_setup: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/security-questions/setup'),
        update_notification_preferences: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/update-notification-preferences'),
        settings_profile: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/settings/profile'),
        settings_preferences: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/settings/preferences'),
        settings_notifications: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/settings/notifications'),
        settings_security: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/settings/security'),
        settings_recovery: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/settings/recovery'),
        settings_social: z
          .string()
          .startsWith('/')
          .min(2)
          .default('/settings/social'),
      }),

      /**
       * API route paths
       */
      api_routes: z.object({
        base: z.string().startsWith('/').min(1).default('/'),
      }),
    }),
  }),

  // SECURITY - Security & Authentication
  // All security-related configuration including secrets, auth, and logging

  /**
   * Security and authentication configuration
   */
  security: z.object({
    /**
     * Core security secrets and JWT configuration
     */
    secrets: z.object({
      jwt_secret: z
        .string()
        .min(32, 'JWT secret should be at least 32 characters for security'),
      jwt_expires_in: z
        .string()
        .min(1, 'JWT expiration cannot be empty')
        .default('1h'),
      cookie_secrets: z
        .array(
          z
            .string()
            .min(
              32,
              'Cookie secret should be at least 32 characters for security'
            )
        )
        .min(1, 'At least one cookie secret is required'),
      hmac_secret: z
        .string()
        .min(32, 'HMAC secret should be at least 32 characters for security')
        .optional(),
    }),

    /**
     * Security protection mechanisms
     */
    protection: z.object({
      rate_limiting: z.object({
        enabled: z.boolean().default(true),
        requests_per_minute: z
          .number()
          .int()
          .positive('Requests per minute must be a positive integer')
          .default(100),
        window_minutes: z
          .number()
          .int()
          .positive('Window in minutes must be a positive integer')
          .default(15),
      }),
      trusted_domains: z
        .array(z.string().min(1, 'Domain cannot be empty'))
        .default([])
        .describe('List of trusted domains for secure redirects'),
      /**
       * Trusted proxy IP ranges
       * Only trust X-Forwarded-For and X-Real-IP headers from these proxies
       * Supports CIDR notation (e.g., '10.0.0.0/8') and single IPs
       */
      trusted_proxies: z
        .array(z.string().min(1, 'Proxy IP/range cannot be empty'))
        .default([])
        .describe(
          'List of trusted proxy IP addresses/ranges for header validation'
        ),
      /**
       * High-risk country codes (ISO 3166-1 alpha-2)
       * Logins from these regions may trigger additional verification
       */
      high_risk_countries: z
        .array(z.string().length(2, 'Country code must be 2 characters'))
        .default([])
        .describe('ISO 3166-1 alpha-2 country codes considered high-risk'),
      /**
       * Encrypt sensitive device data at rest
       * Uses AES-256-GCM encryption via ENCRYPTION_KEY env var
       * Encrypts fingerprint, fingerprintJsId, and geoLocation in activity logs
       */
      encrypt_device_data: coerceBooleanSchema.default(false),
      /**
       * Device matching configuration for new device detection
       */
      device_matching: z
        .object({
          min_confidence_score: z
            .number()
            .int()
            .min(0)
            .max(100)
            .default(70)
            .describe('Minimum score to consider device as known (0-100)'),
          ip_similarity_threshold: z
            .number()
            .min(0)
            .max(1)
            .default(0.8)
            .describe('IP similarity threshold (0-1)'),
          enable_impossible_travel: z
            .boolean()
            .default(true)
            .describe('Enable impossible travel detection'),
          impossible_travel_max_speed_kmh: z
            .number()
            .int()
            .positive()
            .default(900)
            .describe('Maximum travel speed in km/h before flagging'),
          trust_duration_days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .default(30)
            .describe('Number of days a trusted device remains trusted'),
        })
        .default({
          min_confidence_score: 70,
          ip_similarity_threshold: 0.8,
          enable_impossible_travel: true,
          impossible_travel_max_speed_kmh: 900,
          trust_duration_days: 30,
        }),
    }),

    /**
     * Authentication and user management
     */
    authentication: z.object({
      /**
       * Multi-factor authentication configuration
       */
      multi_factor: z.object({
        enabled: z.boolean().default(true),
        totp: z
          .object({
            enabled: z.boolean().default(true),
            issuer_name: z
              .string()
              .min(1, 'TOTP issuer name cannot be empty')
              .default('OIDC Provider'),
          })
          .default({ enabled: true, issuer_name: 'OIDC Provider' }),
        email: z
          .object({
            enabled: z.boolean().default(true),
            code_ttl_seconds: z
              .number()
              .int()
              .min(60, 'Email OTP TTL must be at least 60 seconds')
              .max(3600, 'Email OTP TTL cannot exceed 3600 seconds')
              .default(600),
          })
          .default({ enabled: true, code_ttl_seconds: 600 }),
        sms: z
          .object({
            enabled: z.boolean().default(false),
          })
          .default({ enabled: false }),
        webauthn: z
          .object({
            enabled: z.boolean().default(false),
            rp_name: z
              .string()
              .min(1, 'WebAuthn RP name cannot be empty')
              .default('OIDC Provider'),
            rp_id: z
              .string()
              .min(1, 'WebAuthn RP ID cannot be empty')
              .default('localhost'),
            timeout: z
              .number()
              .int()
              .min(30000, 'WebAuthn timeout must be at least 30 seconds')
              .max(300000, 'WebAuthn timeout cannot exceed 5 minutes')
              .default(60000),
            attestation: z
              .enum(['none', 'indirect', 'direct', 'enterprise'])
              .default('none'),
            user_verification: z
              .enum(['required', 'preferred', 'discouraged'])
              .default('preferred'),
            authenticator_attachment: z
              .enum(['platform', 'cross-platform'])
              .optional(),
            resident_key: z
              .enum(['required', 'preferred', 'discouraged'])
              .default('preferred'),
            max_credentials_per_user: z
              .number()
              .int()
              .min(1, 'Must allow at least 1 credential per user')
              .max(50, 'Cannot exceed 50 credentials per user')
              .default(10),
          })
          .default({
            enabled: false,
            rp_name: 'OIDC Provider',
            rp_id: 'localhost',
            timeout: 60000,
            attestation: 'none',
            user_verification: 'preferred',
            resident_key: 'preferred',
            max_credentials_per_user: 10,
          }),
      }),

      /**
       * Session management configuration
       */
      session_management: z.object({
        multiple_accounts: z.object({
          enabled: z.boolean().default(true),
        }),
      }),

      /**
       * Session security configuration
       * Controls session hijacking prevention and timeout enforcement
       */
      session: z
        .object({
          /**
           * Custom session cookie name
           * Use a non-predictable name to obscure session cookie identity
           */
          cookie_name: z
            .string()
            .regex(/^[a-zA-Z0-9_-]+$/)
            .default('application_session'),

          /**
           * SameSite cookie attribute
           * 'strict' - Cookie only sent in first-party context (highest security)
           * 'lax' - Cookie sent with same-site requests and top-level navigation (default)
           * 'none' - Cookie sent in all contexts (requires Secure attribute)
           */
          same_site: z.enum(['strict', 'lax', 'none']).default('lax'),

          /**
           * Bind sessions to the originating IP address
           * When enabled, sessions will be invalidated if the IP changes
           * Note: May cause issues with mobile users or users behind proxies
           */
          bind_ip: coerceBooleanSchema.default(false),

          /**
           * Bind sessions to the User-Agent string
           * When enabled, sessions will be invalidated if User-Agent changes
           */
          bind_user_agent: coerceBooleanSchema.default(false),

          /**
           * Bind sessions to device fingerprint
           * When enabled, sessions will be invalidated if device fingerprint changes
           * Uses a combination of User-Agent, language, timezone, and screen properties
           */
          bind_device: coerceBooleanSchema.default(false),

          /**
           * Idle timeout in minutes
           * Sessions inactive for longer than this will be invalidated
           * Set to 0 to disable idle timeout
           */
          idle_timeout_minutes: z.coerce.number().int().min(0).default(30),

          /**
           * Absolute session timeout in hours
           * Sessions older than this will be invalidated regardless of activity
           * Set to 0 to disable absolute timeout
           */
          absolute_timeout_hours: z.coerce.number().int().min(0).default(24),

          /**
           * Maximum concurrent sessions per user
           * When exceeded, oldest sessions will be revoked
           * Set to 0 for unlimited sessions
           */
          max_concurrent_sessions: z.coerce.number().int().min(0).default(0),

          /**
           * Maximum accounts per session (multi-account)
           * Limits how many accounts can be logged in simultaneously
           */
          max_accounts_per_session: z.coerce.number().int().min(1).default(5),

          /**
           * Encrypt sensitive session data at rest
           * Uses AES-256-GCM encryption via ENCRYPTION_KEY env var
           */
          encrypt_session_data: coerceBooleanSchema.default(false),

          /**
           * Send email notification when new session is created
           */
          notify_new_session: coerceBooleanSchema.default(false),

          /**
           * Require re-authentication when switching accounts
           */
          require_reauth_on_switch: coerceBooleanSchema.default(false),

          /**
           * Maximum flash messages per type (success, error, info, warning)
           * When exceeded, oldest messages of that type are removed
           */
          max_flash_messages_per_type: z.coerce
            .number()
            .int()
            .min(1)
            .max(50)
            .default(10),

          /**
           * Maximum total flash messages across all types
           * When exceeded, oldest messages from the type with most messages are removed
           */
          max_flash_messages_total: z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20),

          /**
           * Require 2FA verification for new device logins
           * When enabled, users logging in from unrecognized devices must verify identity
           */
          require_2fa_for_new_device: coerceBooleanSchema.default(false),

          /**
           * Default 2FA method for new device verification
           * 'auto' - Use account's MFA method (TOTP if enabled, otherwise email OTP)
           * 'totp' - Always require TOTP (only works for users with MFA enabled)
           * 'email' - Always require email OTP
           */
          new_device_2fa_method: z
            .enum(['auto', 'totp', 'email'])
            .default('auto'),

          /**
           * Minimum confidence score to consider a device as "known"
           * Devices with match scores below this threshold trigger 2FA verification
           * Range: 0-100, where 100 requires exact match
           */
          new_device_confidence_threshold: z.coerce
            .number()
            .int()
            .min(0)
            .max(100)
            .default(70),

          /**
           * Store verbose session metadata for debugging
           * When enabled, sessions include creation source, browser details, etc.
           */
          store_metadata: coerceBooleanSchema.default(false),
        })
        .default({
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
        }),

      /**
       * Login configuration
       */
      login: z.object({
        login_methods: z.array(z.string()).default(['email', 'phone']),
        password_policy: z.object({
          min_length: z
            .number()
            .int()
            .min(1, 'Password minimum length must be at least 1')
            .default(8),
          require_uppercase: z.boolean().default(true),
          require_lowercase: z.boolean().default(true),
          require_numbers: z.boolean().default(true),
          require_symbols: z.boolean().default(false),
          max_age_days: z
            .number()
            .int()
            .positive('Password max age must be a positive integer')
            .default(90),
        }),
      }),

      /**
       * User registration configuration
       */
      signup: z.object({
        signup_methods: z.array(z.string()).default(['email', 'phone']),
        require_email_verification: z.boolean().default(false),
        require_phone_verification: z.boolean().default(false),
        auto_approval: z.object({
          enabled: z.boolean().default(true),
          domains_whitelist: z.array(z.string()).default([]),
        }),
        /**
         * Contact channel configuration for registration
         * Controls which contact methods are available and required during signup
         */
        contact_channels: z
          .object({
            require_at_least_one: z
              .boolean()
              .default(true)
              .describe(
                'Require at least one contact channel (email or phone) for account recovery'
              ),
            email: z
              .object({
                enabled: z
                  .boolean()
                  .default(true)
                  .describe('Allow email as a contact method'),
                required: z
                  .boolean()
                  .default(false)
                  .describe('Require email during registration'),
              })
              .default({ enabled: true, required: false }),
            phone: z
              .object({
                enabled: z
                  .boolean()
                  .default(true)
                  .describe('Allow phone number as a contact method'),
                required: z
                  .boolean()
                  .default(false)
                  .describe('Require phone number during registration'),
              })
              .default({ enabled: true, required: false }),
            full_name: z
              .object({
                enabled: z
                  .boolean()
                  .default(true)
                  .describe('Show full name field during registration'),
                required: z
                  .boolean()
                  .default(true)
                  .describe('Require full name during registration'),
              })
              .default({ enabled: true, required: true }),
          })
          .default({
            require_at_least_one: true,
            email: { enabled: true, required: false },
            phone: { enabled: true, required: false },
            full_name: { enabled: true, required: true },
          }),
      }),

      /**
       * User roles configuration
       */
      roles: z.object({
        available: z
          .array(z.string())
          .min(1, 'At least one role must be available')
          .default(['user', 'admin', 'superadmin'])
          .transform((arr: string[]) =>
            arr.map((role: string) => role.trim())
          ),
        default: z
          .string()
          .min(1, 'Default role cannot be empty')
          .default('user')
          .transform((str: string) => str.trim()),
      }),

      /**
       * Custom identifiers configuration (up to 3 admin-configurable login fields)
       */
      custom_identifiers: z.object({
        enabled: z
          .boolean()
          .default(false)
          .describe('Enable custom identifier fields for login/registration'),
        fields: z
          .array(
            z
              .object({
                slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                key: z
                  .string()
                  .min(1)
                  .max(50)
                  .regex(
                    /^[a-z][a-z0-9_]*$/,
                    'Key must be lowercase alphanumeric with underscores'
                  ),
                name: z.string().min(1).max(100),
                hint_for_user: z.string().max(200).default(''),
                validation_type: z
                  .enum(['none', 'regex', 'charset_mask'])
                  .default('none'),
                pattern: z.string().optional(),
                charset: z.string().optional(),
                mask: z.string().optional(),
                min_length: z.number().int().min(1).max(100).default(1),
                max_length: z.number().int().min(1).max(100).default(100),
                case_sensitive: z.boolean().default(false),
                required_for_registration: z.boolean().default(false),
                edit_policy: z
                  .enum(['admin_only', 'set_once', 'editable', 'full'])
                  .default('set_once'),
                usable_for_login: z.boolean().default(true),
              })
              .transform((field: any) => {
                // Auto-correct inconsistent field configurations:
                // If validation_type requires dependencies that are missing,
                // fall back to 'none' to prevent runtime validation errors.
                if (field.validation_type === 'regex') {
                  if (!field.pattern) {
                    field.validation_type = 'none';
                  } else if (!isRegexSafe(field.pattern)) {
                    field.validation_type = 'none';
                    field.pattern = undefined;
                  }
                }
                if (field.validation_type === 'charset_mask') {
                  if (!field.charset || !field.mask) {
                    field.validation_type = 'none';
                    field.charset = undefined;
                    field.mask = undefined;
                  }
                }
                // Clamp: ensure min_length <= max_length
                if (field.min_length > field.max_length) {
                  field.min_length = field.max_length;
                }
                return field;
              })
          )
          .max(3)
          .superRefine(
            (fields: Array<any>, ctx: z.core.$RefinementCtx) => {
              // Unique slot validation
              const slots = fields.map((f: any) => f.slot);
              if (new Set(slots).size !== slots.length) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: 'Each field must use a unique slot number',
                });
              }
              // Unique key validation
              const keys = fields.map((f: any) => f.key);
              if (new Set(keys).size !== keys.length) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: 'Each field must have a unique key',
                });
              }
            }
          )
          .default([]),
      }),

      /**
       * Account recovery configuration
       */
      recovery: z.object({
        enabled: z
          .boolean()
          .default(true)
          .describe('Whether to enable account recovery features'),
        backup_codes: z.object({
          enabled: z
            .boolean()
            .default(true)
            .describe('Whether to enable backup codes for account recovery'),
          count: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(10)
            .describe('Number of backup codes to generate'),
          expiry_days: z
            .number()
            .int()
            .min(1)
            .default(365)
            .describe('Number of days before backup codes expire'),
        }),
        secondary_email: z.object({
          enabled: z
            .boolean()
            .default(true)
            .describe('Whether to enable secondary email for account recovery'),
        }),
        sms: z.object({
          enabled: z
            .boolean()
            .default(false)
            .describe('Whether to enable SMS for account recovery'),
        }),
        security_questions: z.object({
          enabled: z
            .boolean()
            .default(false)
            .describe(
              'Whether to enable security questions for account recovery'
            ),
        }),
      }),

      /**
       * Password Breach Detection (HIBP Pwned Passwords)
       * Uses k-anonymity — only 5-char SHA1 prefix sent to API
       */
      password_breach_detection: z
        .object({
          enabled: z
            .boolean()
            .default(true)
            .describe('Enable password breach detection via HIBP'),
          api_timeout_ms: z
            .number()
            .int()
            .min(500)
            .max(30000)
            .default(3000)
            .describe('Timeout in ms for HIBP API calls'),
          check_on_registration: z
            .boolean()
            .default(true)
            .describe('Block registration with breached passwords'),
          check_on_login: z
            .boolean()
            .default(true)
            .describe('Async breach check after successful login'),
          check_on_password_reset: z
            .boolean()
            .default(true)
            .describe('Block password reset with breached passwords'),
          check_on_password_change: z
            .boolean()
            .default(true)
            .describe('Block password change to breached passwords'),
          min_breach_count: z
            .number()
            .int()
            .min(1)
            .default(1)
            .describe('Minimum breach count to trigger action'),
        })
        .default({
          enabled: true,
          api_timeout_ms: 3000,
          check_on_registration: true,
          check_on_login: true,
          check_on_password_reset: true,
          check_on_password_change: true,
          min_breach_count: 1,
        }),
    }),

    /**
     * JWKS Key Store configuration
     * Controls where signing keys are stored and how they are rotated
     */
    key_store: z
      .object({
        type: z.enum(['database', 'file']).default('database'),
        rotation_interval_days: z
          .number()
          .int()
          .positive('Rotation interval must be a positive integer')
          .default(90),
        overlap_window_seconds: z
          .number()
          .int()
          .positive('Overlap window must be a positive integer')
          .default(7200),
        algorithms: z
          .array(z.enum(['RS256', 'ES256', 'EdDSA']))
          .default(['RS256', 'ES256', 'EdDSA']),
        promotion_delay_ms: z
          .number()
          .int()
          .min(0, 'Promotion delay must be non-negative')
          .max(86_400_000, 'Promotion delay cannot exceed 24 hours')
          .default(0),
      })
      .default({
        type: 'database' as const,
        rotation_interval_days: 90,
        overlap_window_seconds: 7200,
        algorithms: ['RS256', 'ES256', 'EdDSA'],
        promotion_delay_ms: 0,
      }),
  }),

  // FEATURES - Feature Toggles & Capabilities
  // Feature flags and external provider configurations

  /**
   * Feature toggles and capabilities configuration
   */
  features: z.object({
    /**
     * OIDC feature configuration
     */
    oidc: z.object({
      // Core OIDC flows and endpoints
      dev_interactions: z.object({ enabled: z.boolean().default(false) }),
      device_flow: z.object({
        enabled: z.boolean().default(true),
        charset: z
          .enum(['digits', 'base-20'])
          .default('digits')
          .describe('Character set for device codes'),
        mask: z
          .string()
          .min(1, 'Device code mask cannot be empty')
          .default('***-*-***')
          .describe('Display mask for device codes'),
      }),
      client_credentials: z.object({ enabled: z.boolean().default(true) }),
      token_revocation: z.object({ enabled: z.boolean().default(true) }),
      token_introspection: z.object({ enabled: z.boolean().default(true) }),
      jwt_introspection: z.object({ enabled: z.boolean().default(false) }),
      userinfo_endpoint: z.object({ enabled: z.boolean().default(true) }),
      resource_indicators: z.object({ enabled: z.boolean().default(true) }),
      rp_initiated_logout: z.object({ enabled: z.boolean().default(true) }),
      backchannel_logout: z.object({ enabled: z.boolean().default(true) }),

      dynamic_client_registration: z
        .object({
          enabled: z.boolean().default(false),
          require_initial_access_token: z
            .union([z.boolean(), z.string()])
            .default(true),
          issue_registration_access_token: z.boolean().default(true),
        })
        .transform((val: any) => {
          // When DCR is enabled, force IAT requirement — no open registration
          if (val.enabled && val.require_initial_access_token === false) {
            val.require_initial_access_token = true;
          }
          return val;
        }),
      client_registration_management: z.object({
        enabled: z.boolean().default(false),
        rotate_registration_access_token: z.boolean().default(true),
      }),

      // Security enhancements
      pkce: z.object({
        enabled: z.boolean().default(true),
        required: z.boolean().default(true),
      }),
      extra_params: z.object({
        enabled: z.boolean().default(true),
        allowed_params: z
          .array(z.string())
          .default([
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
            'tenant_id',
            'app_id',
            'continue',
          ]),
      }),

      accept_query_param_access_tokens: z.boolean().default(true),
      conform_id_token_claims: z.boolean().default(false),
      allow_omitting_single_registered_redirect_uri: z.boolean().default(true),
      enable_http_post_methods: z.boolean().default(false),
      expires_with_session: z.boolean().default(true),
      rotate_refresh_token: z.boolean().default(true),
      client_based_cors: z.boolean().default(true),
      clock_tolerance: z.number().int().nonnegative().default(15),

      // Claims and scopes configuration
      acr_values: z.object({
        supported: z
          .array(z.string())
          .default(['urn:mfa:otp', 'urn:mfa:webauthn']),
      }),
      claims: z.record(z.string(), z.array(z.string())).optional(),
      scopes: z
        .array(z.string())
        .default([
          'openid',
          'profile',
          'email',
          'phone',
          'address',
          'offline_access',
        ]),
      subject_types: z
        .array(z.enum(['public', 'pairwise']))
        .default(['public', 'pairwise']),

      allowOmittingSingleRegisteredRedirectUri: z.boolean().default(true),

      // Encryption and JWT features
      encryption: z.object({
        enabled: z.boolean().default(false),
      }),
      jwt_response_modes: z.object({
        enabled: z.boolean().default(false),
      }),
      jwt_userinfo: z.object({
        enabled: z.boolean().default(false),
      }),
      request_objects: z.object({
        enabled: z
          .boolean()
          .default(true)
          .describe('Whether to enable request objects support'),
      }),

      extra_client_metadata: z
        .object({
          properties: z
            .array(z.string())
            .default([
              'allowedResources',
              'resourcesScopes',
              'isInternalClient',
            ]),
          validator: z.function().optional(),
        })
        .optional(),
    }),

    /**
     * Social authentication providers configuration
     */
    social_providers: z.object({
      enabled: z.array(z.string()).default([]),
      available: z
        .array(z.string())
        .default(['google', 'github', 'microsoft', 'linkedin', 'facebook']),

      behavior: z.object({
        existing_user_no_integration: z
          .enum(['auto_link', 'require_manual_link'])
          .default('require_manual_link'),
        no_user_account: z
          .enum(['allow_registration', 'require_existing_account'])
          .default('allow_registration'),
        missing_contact_info: z
          .enum(['redirect_to_form', 'reject_login'])
          .default('redirect_to_form'),
        require_password_on_registration: z.boolean().default(false),
        options: z.object({
          allow_multiple_providers: z.boolean().default(true),
          auto_verify_email: z.boolean().default(true),
          show_helpful_errors: z.boolean().default(false),
          max_providers_per_user: z.number().min(1).max(10).default(5),
        }),
      }),

      google: z
        .object({
          client_id: z
            .string()
            .min(1, 'Google client ID cannot be empty')
            .optional(),
          client_secret: z
            .string()
            .min(1, 'Google client secret cannot be empty')
            .optional(),
          discovery_url: z
            .url('Google discovery URL must be a valid URL')
            .default(
              'https://accounts.google.com/.well-known/openid-configuration'
            ),
          scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
        })
        .optional(),

      github: z
        .object({
          client_id: z
            .string()
            .min(1, 'GitHub client ID cannot be empty')
            .optional(),
          client_secret: z
            .string()
            .min(1, 'GitHub client secret cannot be empty')
            .optional(),
          authorization_endpoint: z
            .url('GitHub authorization endpoint must be a valid URL')
            .default('https://github.com/login/oauth/authorize'),
          token_endpoint: z
            .url('GitHub token endpoint must be a valid URL')
            .default('https://github.com/login/oauth/access_token'),
          userinfo_endpoint: z
            .url('GitHub userinfo endpoint must be a valid URL')
            .default('https://api.github.com/user'),
          scopes: z.array(z.string()).default(['user:email']),
        })
        .optional(),

      microsoft: z
        .object({
          client_id: z.string().optional(),
          client_secret: z.string().optional(),
          discovery_url: z
            .url('Microsoft discovery URL must be a valid URL')
            .default(
              'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration'
            ),
          scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
        })
        .optional(),

      linkedin: z
        .object({
          client_id: z.string().optional(),
          client_secret: z.string().optional(),
          authorization_endpoint: z
            .url('LinkedIn authorization endpoint must be a valid URL')
            .default('https://www.linkedin.com/oauth/v2/authorization'),
          token_endpoint: z
            .url('LinkedIn token endpoint must be a valid URL')
            .default('https://www.linkedin.com/oauth/v2/accessToken'),
          userinfo_endpoint: z
            .url('LinkedIn userinfo endpoint must be a valid URL')
            .default('https://api.linkedin.com/v2/userinfo'),
          scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
        })
        .optional(),

      facebook: z
        .object({
          client_id: z.string().optional(),
          client_secret: z.string().optional(),
          authorization_endpoint: z
            .url('Facebook authorization endpoint must be a valid URL')
            .default('https://www.facebook.com/v19.0/dialog/oauth'),
          token_endpoint: z
            .url('Facebook token endpoint must be a valid URL')
            .default('https://graph.facebook.com/v19.0/oauth/access_token'),
          userinfo_endpoint: z
            .url('Facebook userinfo endpoint must be a valid URL')
            .default('https://graph.facebook.com/me'),
          scopes: z.array(z.string()).default(['email', 'public_profile']),
        })
        .optional(),
    }),

    /**
     * Prometheus metrics endpoint configuration.
     * Exposes application and OIDC metrics in Prometheus exposition format.
     */
    metrics: z
      .object({
        /** Enable the /metrics endpoint. Default: false (opt-in). */
        enabled: z.boolean().default(false),
        /** URL path for the metrics endpoint. */
        path: z.string().default('/metrics'),
        /** Collect Node.js process metrics (event loop lag, heap, GC, etc.). */
        include_default_metrics: z.boolean().default(true),
        /** Prefix for all metric names. Change for multi-service deployments. */
        prefix: z.string().default('parako_'),
      })
      .default({
        enabled: false,
        path: '/metrics',
        include_default_metrics: true,
        prefix: 'parako_',
      }),

    /**
     * Multi-tenancy configuration.
     * When enabled, all data is automatically scoped per tenant via
     * AsyncLocalStorage + Mongoose plugin + Prisma extension + PostgreSQL RLS.
     */
    multi_tenancy: z
      .object({
        /** Master toggle. When false, everything runs as DEFAULT_TENANT_ID with zero overhead. */
        enabled: z.boolean().default(false),
        /** Priority order for tenant extraction from requests. */
        extraction_priority: z
          .array(z.enum(['header', 'subdomain']))
          .default(['header', 'subdomain']),
        /** Header name for x-tenant-id extraction. */
        tenant_header: z.string().default('x-tenant-id'),
        /** OIDC Provider-per-tenant pool configuration. */
        provider_pool: z
          .object({
            /** Max concurrent Provider instances in memory. */
            max_size: z.number().int().min(1).default(50),
            /** Idle TTL in ms — evict providers not accessed within this window. */
            idle_ttl_ms: z.number().int().min(60000).default(1_800_000),
            /** How often to run the eviction sweep (ms). */
            cleanup_interval_ms: z.number().int().min(10000).default(60_000),
          })
          .default({
            max_size: 50,
            idle_ttl_ms: 1_800_000,
            cleanup_interval_ms: 60_000,
          }),
      })
      .default({
        enabled: false,
        extraction_priority: ['header', 'subdomain'],
        tenant_header: 'x-tenant-id',
        provider_pool: {
          max_size: 50,
          idle_ttl_ms: 1_800_000,
          cleanup_interval_ms: 60_000,
        },
      }),
  }),

  // OIDC_STORAGE - OIDC Adapter Configuration
  // OIDC-specific data storage configuration for tokens, sessions, and temporary data

  /**
   * OIDC protocol data storage (tokens, sessions, grants) - separate from main app database
   *
   * This configuration is for OIDC-specific data storage only and is completely separate
   * from the main application database (which stores users, settings, etc.).
   *
   * OIDC storage handles temporary protocol data like:
   * - Access tokens, refresh tokens, ID tokens
   * - Authorization codes
   * - OIDC sessions and interactions
   * - Device codes
   * - Grants and consents
   *
   * COMPUTED — not persisted to database or file.
   * This section is auto-computed from bootstrap env vars at runtime:
   * - STORAGE_ADAPTER / OIDC_STORAGE_ADAPTER -> type
   * - STORAGE_MONGODB_URI -> mongodb.uri, mongodb.database
   * - REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DATABASE -> redis.*
   * - STORAGE_SQLITE_PATH / STORAGE_POSTGRESQL_URL -> handled by PrismaClient
   *
   * The Zod schema is kept here solely for TypeScript type generation.
   */
  oidc_storage: z
    .object({
      oidc_adapter: z.object({
        type: z
          .enum(['mongodb', 'redis', 'sqlite', 'postgresql'])
          .default('sqlite'),

        mongodb: z
          .object({
            uri: z.string().default(''),
            database: z.string().default(''),
          })
          .default({
            uri: '',
            database: '',
          }),

        redis: z
          .object({
            host: z.string().min(1).default('localhost'),
            port: z.number().int().positive().max(65535).default(6379),
            password: z.string().optional(),
            database: z.number().int().min(0).max(15).default(0),
          })
          .default({
            host: 'localhost',
            port: 6379,
            database: 0,
          }),
      }),
    })
    .optional()
    .default({
      oidc_adapter: {
        type: 'sqlite',
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
    }),

  // OIDC - OIDC Protocol Configuration
  // OpenID Connect specific settings, routes, and cryptographic configuration

  /**
   * OpenID Connect protocol configuration
   */
  oidc: z.object({
    issuer: z.url('OIDC issuer must be a valid URL'),
    path: z
      .string()
      .startsWith('/', 'OIDC path must start with /')
      .min(2, 'OIDC path cannot be just "/"')
      .default('/oidc/v1'),

    /**
     * OIDC endpoint routes configuration
     */
    routes: z.object({
      authorization: z.string().startsWith('/').min(2).default('/authorize'),
      userinfo: z.string().startsWith('/').min(2).default('/userinfo'),
      registration: z.string().startsWith('/').min(2).default('/register-rp'),
      backchannel_authentication: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/backchannel'),
      challenge: z.string().startsWith('/').min(2).default('/challenge'),
      code_verification: z.string().startsWith('/').min(2).default('/device'),
      device_authorization: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/device/auth'),
      end_session: z.string().startsWith('/').min(2).default('/session/end'),
      introspection: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/token/introspection'),
      jwks: z.string().startsWith('/').min(2).default('/jwks'),
      pushed_authorization_request: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/request'),
      revocation: z
        .string()
        .startsWith('/')
        .min(2)
        .default('/token/revocation'),
      token: z.string().startsWith('/').min(2).default('/token'),
    }),

    /**
     * OIDC secrets and cryptographic configuration
     */
    secrets: z.object({
      pairwise_salt: z
        .string()
        .min(1, 'Pairwise salt cannot be empty')
        .default('parako-id-salt'),
    }),

    /**
     * Token time-to-live configuration
     */
    token_ttl: z.object({
      access_token: z
        .number()
        .int()
        .positive('Access token TTL must be a positive integer')
        .default(3600),
      authorization_code: z
        .number()
        .int()
        .positive('Authorization code TTL must be a positive integer')
        .default(600),
      backchannel_auth: z
        .number()
        .int()
        .positive('Backchannel authentication TTL must be a positive integer')
        .default(600),
      client_credentials: z
        .number()
        .int()
        .positive('Client credentials TTL must be a positive integer')
        .default(3600),
      device_code: z
        .number()
        .int()
        .positive('Device code TTL must be a positive integer')
        .default(600),
      grant: z
        .number()
        .int()
        .positive('Grant TTL must be a positive integer')
        .default(3600),
      id_token: z
        .number()
        .int()
        .positive('ID token TTL must be a positive integer')
        .default(3600),
      interaction: z
        .number()
        .int()
        .positive('Interaction TTL must be a positive integer')
        .default(600),
      refresh_token: z
        .number()
        .int()
        .positive('Refresh token TTL must be a positive integer')
        .default(86400),
      session: z
        .number()
        .int()
        .positive('Session TTL must be a positive integer')
        .default(86400),
    }),

    /**
     * OIDC Discovery Document configuration
     */
    discovery: z
      .object({
        claims_locales_supported: z
          .array(z.string())
          .default(['en', 'fr', 'es', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko'])
          .optional(),
        display_values_supported: z
          .array(z.string())
          .default(['en'])
          .optional(),
        op_policy_uri: z
          .union([z.literal(''), z.url('OP policy URI must be a valid URL')])
          .optional(),
        op_tos_uri: z
          .union([
            z.literal(''),
            z.url('OP terms of service URI must be a valid URL'),
          ])
          .optional(),
        service_documentation: z
          .union([
            z.literal(''),
            z.url('Service documentation URI must be a valid URL'),
          ])
          .optional(),
        ui_locales_supported: z
          .array(z.string())
          .default(['en', 'fr', 'es', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko'])
          .optional(),
      })
      .catchall(z.any()),

    /**
     * JSON Web Algorithms (JWA) configuration
     */
    jwa: z.object({
      attest_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
          ])
        )
        .default(['ES256', 'Ed25519', 'EdDSA']),

      authorization_encryption_alg_values: z
        .array(
          z.enum([
            'RSA-OAEP',
            'RSA-OAEP-256',
            'RSA-OAEP-384',
            'RSA-OAEP-512',
            'ECDH-ES',
            'ECDH-ES+A128KW',
            'ECDH-ES+A192KW',
            'ECDH-ES+A256KW',
            'A128KW',
            'A192KW',
            'A256KW',
            'A128GCMKW',
            'A192GCMKW',
            'A256GCMKW',
            'dir',
          ])
        )
        .default([
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ]),

      authorization_encryption_enc_values: z
        .array(
          z.enum([
            'A128CBC-HS256',
            'A128GCM',
            'A192CBC-HS384',
            'A192GCM',
            'A256CBC-HS512',
            'A256GCM',
          ])
        )
        .default(['A128CBC-HS256', 'A128GCM', 'A256CBC-HS512', 'A256GCM']),

      authorization_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
            'HS256',
            'HS384',
            'HS512',
          ])
        )
        .default(['RS256', 'PS256', 'ES256', 'Ed25519', 'EdDSA']),

      client_auth_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
            'HS256',
            'HS384',
            'HS512',
          ])
        )
        .default(['HS256', 'RS256', 'PS256', 'ES256', 'Ed25519', 'EdDSA']),

      dpop_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
          ])
        )
        .default(['ES256', 'Ed25519', 'EdDSA']),

      id_token_encryption_alg_values: z
        .array(
          z.enum([
            'RSA-OAEP',
            'RSA-OAEP-256',
            'RSA-OAEP-384',
            'RSA-OAEP-512',
            'ECDH-ES',
            'ECDH-ES+A128KW',
            'ECDH-ES+A192KW',
            'ECDH-ES+A256KW',
            'A128KW',
            'A192KW',
            'A256KW',
            'A128GCMKW',
            'A192GCMKW',
            'A256GCMKW',
            'dir',
          ])
        )
        .default([
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ]),

      id_token_encryption_enc_values: z
        .array(
          z.enum([
            'A128CBC-HS256',
            'A128GCM',
            'A192CBC-HS384',
            'A192GCM',
            'A256CBC-HS512',
            'A256GCM',
          ])
        )
        .default(['A128CBC-HS256', 'A128GCM', 'A256CBC-HS512', 'A256GCM']),

      id_token_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
            'HS256',
            'HS384',
            'HS512',
          ])
        )
        .default(['RS256', 'PS256', 'ES256', 'Ed25519', 'EdDSA']),

      introspection_encryption_alg_values: z
        .array(
          z.enum([
            'RSA-OAEP',
            'RSA-OAEP-256',
            'RSA-OAEP-384',
            'RSA-OAEP-512',
            'ECDH-ES',
            'ECDH-ES+A128KW',
            'ECDH-ES+A192KW',
            'ECDH-ES+A256KW',
            'A128KW',
            'A192KW',
            'A256KW',
            'A128GCMKW',
            'A192GCMKW',
            'A256GCMKW',
            'dir',
          ])
        )
        .default([
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ]),

      introspection_encryption_enc_values: z
        .array(
          z.enum([
            'A128CBC-HS256',
            'A128GCM',
            'A192CBC-HS384',
            'A192GCM',
            'A256CBC-HS512',
            'A256GCM',
          ])
        )
        .default(['A128CBC-HS256', 'A128GCM', 'A256CBC-HS512', 'A256GCM']),

      introspection_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
            'HS256',
            'HS384',
            'HS512',
          ])
        )
        .default(['RS256', 'PS256', 'ES256', 'Ed25519', 'EdDSA']),

      request_object_encryption_alg_values: z
        .array(
          z.enum([
            'RSA-OAEP',
            'RSA-OAEP-256',
            'RSA-OAEP-384',
            'RSA-OAEP-512',
            'ECDH-ES',
            'ECDH-ES+A128KW',
            'ECDH-ES+A192KW',
            'ECDH-ES+A256KW',
            'A128KW',
            'A192KW',
            'A256KW',
            'A128GCMKW',
            'A192GCMKW',
            'A256GCMKW',
            'dir',
          ])
        )
        .default([
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ]),

      request_object_encryption_enc_values: z
        .array(
          z.enum([
            'A128CBC-HS256',
            'A128GCM',
            'A192CBC-HS384',
            'A192GCM',
            'A256CBC-HS512',
            'A256GCM',
          ])
        )
        .default(['A128CBC-HS256', 'A128GCM', 'A256CBC-HS512', 'A256GCM']),

      request_object_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
            'HS256',
            'HS384',
            'HS512',
          ])
        )
        .default(['HS256', 'RS256', 'PS256', 'ES256', 'Ed25519', 'EdDSA']),

      userinfo_encryption_alg_values: z
        .array(
          z.enum([
            'RSA-OAEP',
            'RSA-OAEP-256',
            'RSA-OAEP-384',
            'RSA-OAEP-512',
            'ECDH-ES',
            'ECDH-ES+A128KW',
            'ECDH-ES+A192KW',
            'ECDH-ES+A256KW',
            'A128KW',
            'A192KW',
            'A256KW',
            'A128GCMKW',
            'A192GCMKW',
            'A256GCMKW',
            'dir',
          ])
        )
        .default([
          'A128KW',
          'A256KW',
          'ECDH-ES',
          'RSA-OAEP',
          'RSA-OAEP-256',
          'dir',
        ]),

      userinfo_encryption_enc_values: z
        .array(
          z.enum([
            'A128CBC-HS256',
            'A128GCM',
            'A192CBC-HS384',
            'A192GCM',
            'A256CBC-HS512',
            'A256GCM',
          ])
        )
        .default(['A128CBC-HS256', 'A128GCM', 'A256CBC-HS512', 'A256GCM']),

      userinfo_signing_alg_values: z
        .array(
          z.enum([
            'RS256',
            'RS384',
            'RS512',
            'PS256',
            'PS384',
            'PS512',
            'ES256',
            'ES384',
            'ES512',
            'Ed25519',
            'EdDSA',
            'HS256',
            'HS384',
            'HS512',
          ])
        )
        .default(['RS256', 'PS256', 'ES256', 'Ed25519', 'EdDSA']),
    }),
  }),

  // INTEGRATIONS - External Services
  // Configuration for external services and URLs

  /**
   * External integrations and services configuration
   */
  integrations: z.object({
    /**
     * Email service configuration
     */
    email: z.object({
      smtp_host: z.string().min(1, 'SMTP host cannot be empty'),
      smtp_port: z
        .number()
        .int()
        .positive('SMTP port must be a positive integer'),
      smtp_username: z.string().min(1, 'SMTP username cannot be empty'),
      smtp_password: z.string().min(1, 'SMTP password cannot be empty'),
      from: z
        .string()
        .min(1, 'Email from field cannot be empty')
        .refine((val: string) => {
          const simpleEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const rfc5322Regex = /^.+\s*<[^\s@]+@[^\s@]+\.[^\s@]+>$/;
          return simpleEmailRegex.test(val) || rfc5322Regex.test(val);
        }, 'From email must be a valid email address or RFC 5322 format'),
      tls_reject_unauthorized: z
        .boolean()
        .optional()
        .describe(
          'Override TLS certificate verification (defaults to true in production)'
        ),
    }),

    /**
     * External URLs configuration
     */
    urls: z.object({
      website: z.url('Website URL must be valid'),
      privacy_policy: z.url('Privacy policy URL must be valid'),
      terms_of_service: z.url('Terms of service URL must be valid'),
      contact: z.url('Contact URL must be valid'),
    }),

    /**
     * IP geolocation service (ipinfo.io)
     * Used for impossible travel detection and geolocation enrichment
     */
    ipinfo: z
      .object({
        enabled: z.boolean().default(false),
        api_token: z
          .string()
          .optional()
          .describe('ipinfo.io API token (optional for basic tier)'),
        cache_ttl_hours: z
          .number()
          .int()
          .positive()
          .default(24)
          .describe('Cache TTL for geolocation data in hours'),
      })
      .default({ enabled: false, cache_ttl_hours: 24 }),

    /**
     * IP reputation service (IPQualityScore)
     * Used for VPN/proxy detection and fraud scoring
     */
    ipqualityscore: z
      .object({
        enabled: z.boolean().default(false),
        api_key: z.string().optional().describe('IPQualityScore API key'),
        fraud_score_threshold: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(75)
          .describe('Fraud score threshold for blocking (0-100)'),
        cache_ttl_hours: z
          .number()
          .int()
          .positive()
          .default(6)
          .describe('Cache TTL for reputation data in hours'),
      })
      .default({
        enabled: false,
        fraud_score_threshold: 75,
        cache_ttl_hours: 6,
      }),

    /**
     * FingerprintJS Pro configuration
     * Optional - enables enhanced device fingerprinting with Pro features
     */
    fingerprintjs: z
      .object({
        enabled: z.boolean().default(false),
        api_key: z
          .string()
          .optional()
          .describe(
            'FingerprintJS Pro API key (leave empty for open-source version)'
          ),
        endpoint: z
          .string()
          .optional()
          .describe(
            'Custom FingerprintJS endpoint (optional, for enterprise deployments)'
          ),
      })
      .default({ enabled: false }),

    /**
     * File storage provider configuration
     * Supports local filesystem or AWS S3 for file uploads (avatars, logos, favicons)
     */
    file_storage: z
      .object({
        provider: z
          .enum(['local', 's3'])
          .default('local')
          .describe('Storage backend: local filesystem or AWS S3'),
        upload_dir: z
          .string()
          .default('./uploads')
          .describe(
            'Base directory for local uploads (relative to project root)'
          ),
        signed_url_expiry_seconds: z
          .number()
          .int()
          .positive()
          .default(3600)
          .describe('Expiry duration for signed/presigned URLs in seconds'),
        s3: z
          .object({
            region: z.string().default('us-east-1'),
            bucket: z.string().default(''),
            access_key_id: z.string().default(''),
            secret_access_key: z.string().default(''),
          })
          .default({
            region: 'us-east-1',
            bucket: '',
            access_key_id: '',
            secret_access_key: '',
          }),
      })
      .default({
        provider: 'local' as const,
        upload_dir: './uploads',
        signed_url_expiry_seconds: 3600,
        s3: {
          region: 'us-east-1',
          bucket: '',
          access_key_id: '',
          secret_access_key: '',
        },
      }),
  }),

  // NOTIFICATIONS - Notification Channels & Preferences
  // Configuration for notification channels and default user preferences

  /**
   * Notification channels and default preferences configuration
   */
  notifications: z
    .object({
      /**
       * Notification channel configuration
       */
      channels: z.object({
        email: z
          .object({
            enabled: coerceBooleanSchema.default(true),
          })
          .default({ enabled: true }),
        sms: z
          .object({
            enabled: coerceBooleanSchema.default(false),
            provider: z.enum(['twilio']).optional(),
            api_key: z.string().optional(),
            api_secret: z.string().optional(),
            from_number: z.string().optional(),
            rate_limits: z
              .object({
                per_phone_per_hour: z.number().default(3),
                per_ip_per_day: z.number().default(10),
                cooldown_seconds: z.number().default(60),
              })
              .optional(),
          })
          .default({ enabled: false }),
      }),
      /**
       * Default notification preferences for new users
       */
      defaults: z.object({
        security_alerts: coerceBooleanSchema.default(true),
        new_session_alerts: coerceBooleanSchema.default(true),
        allow_user_preferences: coerceBooleanSchema
          .default(true)
          .describe('Allow users to customize their notification preferences'),
      }),
    })
    .default({
      channels: {
        email: { enabled: true },
        sms: { enabled: false },
      },
      defaults: {
        security_alerts: true,
        new_session_alerts: true,
        allow_user_preferences: true,
      },
    }),
});

/**
 * Inferred TypeScript type from the new schema
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;
