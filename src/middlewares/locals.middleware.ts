import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { ILocalsMiddleware } from '../di/interfaces/locals-middleware.interface.js';
import type { ISocialLoginManager } from '../di/interfaces/social-login-manager.interface.js';
import type { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import { TYPES } from '../di/types.js';
import { isValidHttpUrl, isValidPictureUrl } from '../utils/views.js';
import { WEB_SAFE_FONTS } from '../config/constants.js';
import { CONFIGURABLE_SOCIAL_PROVIDER_IDS } from '../config/social-providers.js';
import {
  buildConfigurationViewLocals,
  canonicalViewPath,
} from '../utils/view-locals.js';

/**
 * Unified middleware class for handling all locals (configuration and user-related)
 */
@injectable()
export class LocalsMiddleware implements ILocalsMiddleware {
  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.UploadMiddleware)
    private readonly uploadMiddleware: IUploadMiddleware
  ) {}

  /**
   * Sets platform configuration locals before locale and tenant detection.
   */
  public configLocals = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const config = this.configManager.getConfig();
      const locals = await buildConfigurationViewLocals({
        config,
        request: req,
        resolveFileUrl: storageKey =>
          this.uploadMiddleware.getFileUrl(storageKey),
        enabledSocialProviders: this.socialLoginManager.getAvailableProviders(),
      });

      Object.assign(res.locals, locals);
      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'failed_to_load_config_for_locals',
      });
      this.logger.warn(
        'Falling back to hardcoded routes due to configuration loading error'
      );

      res.locals.app = {
        title: 'Parako.ID',
        description:
          'Self-hosted identity server with SSO, MFA, passkeys, and OAuth2',
        locales: { default: 'en', available: ['en'] },
        url: 'https://parako.id',
        env: 'development',
      };

      res.locals.branding = {
        companyName: 'Your Organization',
        logo: '/images/logo-light.png',
        logoDark: '/images/logo-dark.png',
        logoIcon: '/images/logo-icon-light.png',
        logoIconDark: '/images/logo-icon-dark.png',
        favicon: '/favicon.png',
        colors: { light: {}, dark: {} },
        fonts: {},
      };

      res.locals.webSafeFonts = WEB_SAFE_FONTS;

      res.locals.urls = {
        website: '#',
        privacy_policy: '#',
        terms_of_service: '#',
        contact: '#',
      };

      res.locals.socialProviders = {
        enabled: [],
        available: [...CONFIGURABLE_SOCIAL_PROVIDER_IDS],
      };

      res.locals.authentication = {
        rememberMe: {
          enabled: false,
          maxAgeDays: 30,
        },
        loginMethods: {
          email: true,
          phone: false,
          bothEnabled: false,
          customIdentifiers: [],
        },
        signupMethods: {
          email: true,
          phone: false,
          bothEnabled: false,
          requireFullName: true,
        },
        customIdentifiers: [],
        emailVerificationRequired: false,
        phoneVerificationRequired: false,
      };

      res.locals.oidc = {
        issuer: 'http://localhost:9007/oidc/v1',
        path: '/oidc/v1',
      };

      res.locals.currentYear = new Date().getFullYear();

      res.locals.request = {
        url: req.url,
        method: req.method,
        protocol: req.protocol,
        hostname: req.hostname,
        originalUrl: req.originalUrl,
      };

      const baseUrl = `http://localhost:9007`;
      res.locals.canonical_url = `${baseUrl}${canonicalViewPath(req.originalUrl)}`;

      res.locals.og = {
        title: 'Parako.ID',
        description:
          'Self-hosted identity server with SSO, MFA, passkeys, and OAuth2',
        url: res.locals.canonical_url,
        site_name: 'Parako.ID',
        locale: 'en',
      };

      res.locals.features = {
        oidc: true,
        deviceFlow: true,
        mfa: true,
        socialLogin: false,
        rateLimiting: true,
      };

      // Fallback routes for error cases
      res.locals.routes = {
        app: {
          auth: '/auth',
          accounts: '/accounts',
          api: '/api/v1',
          home: '/',
          oidc: '/oidc',
        },
        authFull: {
          login: '/auth/login',
          register: '/auth/register',
          forgot_password: '/auth/forgot-password',
          reset_password: '/auth/reset-password',
          verify_email: '/auth/verify-email',
          email_verification: '/auth/email-verification',
          email_verification_success: '/auth/email-verification-success',
          logout: '/auth/logout',
          mfa_verify: '/auth/mfa-verify',
          multi_factor: '/auth/multi-factor',
          mfa_resend: '/auth/mfa-resend',
          account_select: '/auth/account-select',
          continue: '/auth/continue',
          social_password_setup: '/auth/social-password-setup',
          social_contact_info: '/auth/social-contact-info',
          account_recovery: '/auth/account-recovery',
          recovery_method_select: '/auth/recovery-method-select',
          recovery_backup_codes: '/auth/recovery-backup-codes',
          recovery_secondary_email: '/auth/recovery-secondary-email',
          recovery_security_questions: '/auth/recovery-security-questions',
          recovery_sms: '/auth/recovery-sms',
          recovery_verify_code: '/auth/recovery-verify-code',
          update_theme: '/auth/update-theme',
          update_locale: '/auth/update-locale',
          update_sidebar: '/auth/update-sidebar',
          update_timezone: '/auth/update-timezone',
        },
        accountFull: {
          accounts_base: '/accounts',
          dashboard: '/accounts/',
          settings: '/accounts/settings',
          apps: '/accounts/apps',
          sessions: '/accounts/sessions',
          update_profile: '/accounts/update-profile',
          change_password: '/accounts/change-password',
          remove_avatar: '/accounts/remove-avatar',
          enable_mfa: '/accounts/enable-mfa',
          disable_mfa: '/accounts/disable-mfa',
          setup_mfa: '/accounts/setup-mfa',
          switch_account: '/accounts/switch-account',
          add_account: '/accounts/add-account',
          remove_account: '/accounts/remove-account',
          account_switcher_data: '/accounts/account-switcher-data',
          revoke_app: '/accounts/revoke-app',
          revoke_all_apps: '/accounts/revoke-all-apps',
          logout_session: '/accounts/logout-session',
          logout_all_other_sessions: '/accounts/logout-all-other-sessions',
          resend_email_verification: '/accounts/resend-email-verification',
          enable_recovery: '/accounts/enable-recovery',
          disable_recovery: '/accounts/disable-recovery',
          recovery_codes: '/accounts/recovery-codes',
          verify_recovery_email: '/accounts/verify-recovery-email',
          regenerate_backup_codes: '/accounts/regenerate-backup-codes',
          recovery_setup: '/accounts/recovery-setup',
          security_questions_setup: '/accounts/security-questions/setup',
          settings_profile: '/accounts/settings/profile',
          settings_preferences: '/accounts/settings/preferences',
          settings_notifications: '/accounts/settings/notifications',
          settings_security: '/accounts/settings/security',
          settings_recovery: '/accounts/settings/recovery',
          settings_social: '/accounts/settings/social',
        },
        adminFull: {
          dashboard: '/admin',
          users: '/admin/users',
          user_new: '/admin/users/new',
          oidc_clients: '/admin/oidc-clients',
          oidc_client_create: '/admin/oidc-clients/create',
          jwks: '/admin/jwks',
          sessions: '/admin/sessions',
          user_grants: '/admin/user-grants',
          activities: '/admin/activities',
          data_transfer: '/admin/data-transfer',
          settings: '/admin/settings',
          configuration: '/admin/configuration',
          tenants: '/admin/tenants',
          logout: '/auth/logout',
        },
        oidc: {
          authorization: '/oidc/auth',
          userinfo: '/oidc/me',
          registration: '/oidc/reg',
          backchannel_authentication: '/oidc/backchannel',
          challenge: '/oidc/backchannel/challenge',
          code_verification: '/oidc/backchannel/code',
          device_authorization: '/oidc/device/auth',
          end_session: '/oidc/session/end',
          introspection: '/oidc/token/introspection',
          jwks: '/oidc/jwks',
          pushed_authorization_request: '/oidc/request',
          revocation: '/oidc/token/revocation',
          token: '/oidc/token',
        },
      };

      next();
    }
  };

  /**
   * Middleware to build locale-aware routes
   * NOTE: This MUST run AFTER handleLanguage middleware which sets res.locals.localePrefix
   */
  public buildRoutes = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    try {
      const config = this.configManager.getConfig();

      // Use the localePrefix that was already set by handleLanguage middleware
      const localePrefix = res.locals.localePrefix || '';

      const accountRoutes = {
        accounts_base: `${localePrefix}${config.deployment.routes.accounts}`,
        dashboard: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`,
        settings: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings}`,
        apps: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.apps}`,
        sessions: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.sessions}`,
        update_profile: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.update_profile}`,
        change_password: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.change_password}`,
        remove_avatar: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.remove_avatar}`,
        enable_mfa: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.enable_mfa}`,
        disable_mfa: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.disable_mfa}`,
        setup_mfa: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.setup_mfa}`,
        switch_account: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.switch_account}`,
        add_account: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.add_account}`,
        remove_account: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.remove_account}`,
        account_switcher_data: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.account_switcher_data}`,
        revoke_app: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.revoke_app}`,
        revoke_all_apps: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.revoke_all_apps}`,
        logout_session: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.logout_session}`,
        logout_all_other_sessions: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.logout_all_other_sessions}`,
        resend_email_verification: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.resend_email_verification}`,
        enable_recovery: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.enable_recovery}`,
        disable_recovery: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.disable_recovery}`,
        recovery_codes: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.recovery_codes}`,
        verify_recovery_email: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.verify_recovery_email}`,
        regenerate_backup_codes: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.regenerate_backup_codes}`,
        recovery_setup: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.recovery_setup}`,
        update_notification_preferences: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.update_notification_preferences}`,
        security_questions_setup: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.security_questions_setup}`,
        passkeys: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.passkeys}`,
        setup_webauthn: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.setup_webauthn}`,
        settings_profile: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_profile}`,
        settings_preferences: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_preferences}`,
        settings_notifications: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_notifications}`,
        settings_security: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_security}`,
        settings_recovery: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_recovery}`,
        settings_social: `${localePrefix}${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_social}`,
      };

      const adminRoutes = {
        dashboard: `${localePrefix}/admin`,
        users: `${localePrefix}/admin/users`,
        user_new: `${localePrefix}/admin/users/new`,
        oidc_clients: `${localePrefix}/admin/oidc-clients`,
        oidc_client_create: `${localePrefix}/admin/oidc-clients/create`,
        jwks: `${localePrefix}/admin/jwks`,
        sessions: `${localePrefix}/admin/sessions`,
        user_grants: `${localePrefix}/admin/user-grants`,
        activities: `${localePrefix}/admin/activities`,
        data_transfer: `${localePrefix}/admin/data-transfer`,
        settings: `${localePrefix}/admin/settings`,
        configuration: `${localePrefix}/admin/configuration`,
        tenants: `${localePrefix}/admin/tenants`,
        logout: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.logout}`,
      };

      res.locals.routes = {
        // App-level routes (with locale prefix for Express routes, without for OIDC/API)
        app: {
          auth: `${localePrefix}${config.deployment.routes.auth}`,
          accounts: `${localePrefix}${config.deployment.routes.accounts}`,
          api: config.deployment.routes.api, // API routes are not locale-aware
          home: `${localePrefix}${config.deployment.routes.home}`,
          oidc: config.oidc.path, // OIDC routes use ui_locales parameter instead of path prefix
        },

        api: config.deployment.routes.api, // API routes are not locale-aware

        // Auth routes with full paths and locale prefix
        authFull: {
          login: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`,
          register: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.register}`,
          forgot_password: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.forgot_password}`,
          reset_password: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.reset_password}`,
          verify_email: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.verify_email}`,
          email_verification: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.email_verification}`,
          email_verification_success: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.email_verification_success}`,
          logout: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.logout}`,
          mfa_verify: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.mfa_verify}`,
          multi_factor: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.multi_factor}`,
          mfa_resend: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.mfa_resend}`,
          account_select: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_select}`,
          continue: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.continue}`,
          social_password_setup: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.social_password_setup}`,
          social_contact_info: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.social_contact_info}`,
          account_recovery: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`,
          recovery_method_select: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_method_select}`,
          recovery_backup_codes: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_backup_codes}`,
          recovery_secondary_email: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_secondary_email}`,
          recovery_security_questions: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_security_questions}`,
          recovery_sms: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_sms}`,
          recovery_verify_code: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_verify_code}`,
          update_theme: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_theme}`,
          update_locale: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_locale}`,
          update_sidebar: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_sidebar}`,
          update_timezone: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_timezone}`,
          mfa_select: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.mfa_select}`,
          mfa_webauthn: `${localePrefix}${config.deployment.routes.auth}${config.deployment.routes.auth_routes.mfa_webauthn}`,
        },

        // Account routes with full paths and locale prefix
        accountFull: accountRoutes,

        // Admin routes with full paths and locale prefix
        adminFull: adminRoutes,

        // OIDC routes (NO locale prefix - use ui_locales parameter per OIDC spec)
        oidc: {
          authorization: `${config.oidc.path}${config.oidc.routes.authorization}`,
          userinfo: `${config.oidc.path}${config.oidc.routes.userinfo}`,
          registration: `${config.oidc.path}${config.oidc.routes.registration}`,
          backchannel_authentication: `${config.oidc.path}${config.oidc.routes.backchannel_authentication}`,
          challenge: `${config.oidc.path}${config.oidc.routes.challenge}`,
          code_verification: `${config.oidc.path}${config.oidc.routes.code_verification}`,
          device_authorization: `${config.oidc.path}${config.oidc.routes.device_authorization}`,
          end_session: `${config.oidc.path}${config.oidc.routes.end_session}`,
          introspection: `${config.oidc.path}${config.oidc.routes.introspection}`,
          jwks: `${config.oidc.path}${config.oidc.routes.jwks}`,
          pushed_authorization_request: `${config.oidc.path}${config.oidc.routes.pushed_authorization_request}`,
          revocation: `${config.oidc.path}${config.oidc.routes.revocation}`,
          token: `${config.oidc.path}${config.oidc.routes.token}`,
        },
      };

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_building_routes',
      });
      next(error);
    }
  };

  public setAccountLocals = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const config = this.configManager.getConfig();
      const loginRoute =
        res.locals.routes?.authFull?.login ??
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`;

      if (!(await this.sessionManager.isAuthenticated(req))) {
        this.sessionManager.clearAuthenticationData(req);
        res.redirect(loginRoute);
        return;
      }

      const userData = this.sessionManager.getActiveUser(req);

      if (!userData) {
        this.sessionManager.clearAuthenticationData(req);
        res.redirect(loginRoute);
        return;
      }

      // Validate user picture URL - allow HTTP/HTTPS (social login) and relative paths (local uploads)
      let validatedPicture: string | null = null;
      if (userData.picture && isValidPictureUrl(userData.picture)) {
        if (isValidHttpUrl(userData.picture)) {
          // External URL (social login avatar) — pass through as-is
          validatedPicture = userData.picture;
        } else {
          // Storage key or legacy /uploads/ path — resolve to serving URL
          const resolved = this.uploadMiddleware.getFileUrl(userData.picture);
          validatedPicture =
            typeof resolved === 'string' ? resolved : await resolved;
        }
      }

      const currentLoggedUser = {
        ...userData,
        picture: validatedPicture,

        initials: (() => {
          const firstName = userData.given_name || '';
          const lastName = userData.family_name || '';
          if (firstName || lastName) {
            return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
          }
          return userData.username
            ? userData.username.substring(0, 2).toUpperCase()
            : 'U';
        })(),

        displayName:
          userData.full_name ||
          `${userData.given_name || ''} ${userData.family_name || ''}`.trim() ||
          userData.username,

        sidebarName: (() => {
          const name =
            userData.full_name ||
            `${userData.given_name || ''} ${userData.family_name || ''}`.trim() ||
            userData.username ||
            'User';
          return name.length > 15 ? `${name.substring(0, 15)}\u2026` : name;
        })(),

        lastUsedFormatted: userData.last_used
          ? new Date(userData.last_used).toLocaleString()
          : 'Not available',

        rolesList:
          userData.roles && userData.roles.length > 0
            ? userData.roles.join(', ')
            : null,

        accountType: userData.is_admin ? 'Administrator' : 'User',

        hasProfilePicture: !!validatedPicture,
        hasFullName: !!(userData.given_name || userData.family_name),
        hasVerifiedEmail: userData.email_verified === true,
      };

      res.locals.user = currentLoggedUser;
      res.locals.currentUser = currentLoggedUser;

      // All dates will be displayed in the current logged-in user's timezone
      res.locals.displayTimezone = userData.zoneinfo || 'UTC';

      res.locals.currentYear = new Date().getFullYear();

      const allAuthenticatedUsers =
        this.sessionManager.getAuthenticatedUsers(req);

      const totalAccounts = allAuthenticatedUsers
        ? (allAuthenticatedUsers.active ? 1 : 0) +
          allAuthenticatedUsers.others.length
        : 0;

      res.locals.hasMultipleAccounts = totalAccounts > 1;
      res.locals.totalAccountsCount = totalAccounts;

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_in_user_locals_middleware_set_account_locals',
      });
      next(error);
    }
  };

  public setActivePage = (pageName: string) => {
    return (_req: Request, res: Response, next: NextFunction): void => {
      res.locals.activePage = pageName;
      next();
    };
  };
}
