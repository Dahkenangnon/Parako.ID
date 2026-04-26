import path from 'node:path';
import nunjucks from 'nunjucks';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type {
  IKoaMiddleware,
  KoaRenderContext,
  KoaI18nContext,
} from '../../../di/interfaces/koa-middleware.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IFileSystemUtils } from '../../../di/interfaces/file-system-utils.interface.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { II18nService } from '../../../di/interfaces/i18n-service.interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { ISocialLoginManager } from '../../../di/interfaces/social-login-manager.interface.js';
import type { IUploadMiddleware } from '../../../di/interfaces/upload-middleware.interface.js';
import type { KoaContextWithOIDC } from 'oidc-provider';
import { resolveBrandingUrl } from '../../../utils/views.js';

/**
 * Koa Middleware Service
 * Handles Koa-specific middleware functionality including i18n, rendering, and localization
 */
@injectable()
export class KoaMiddleware implements IKoaMiddleware {
  private nunjucksEnv: nunjucks.Environment;

  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils,
    @inject(TYPES.I18nService) private readonly i18nService: II18nService,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.UploadMiddleware)
    private readonly uploadMiddleware: IUploadMiddleware
  ) {
    this.nunjucksEnv = this.initializeNunjucks();
  }

  /**
   * Initialize Nunjucks environment with view directories
   */
  private initializeNunjucks(): nunjucks.Environment {
    const viewConfig = this.viewResolver.getCurrentConfig();
    const viewDirs = [
      path.join(this.fileSystemUtils.rootDir, viewConfig.defaultViewsRoot),
    ];

    if (viewConfig.enabled) {
      viewDirs.unshift(
        path.join(this.fileSystemUtils.rootDir, viewConfig.customViewsRoot)
      );
    }

    this.logger.info(
      `KoaMiddleware Nunjucks initialized with view directories: ${viewDirs.join(', ')}`,
      {
        context: 'koa_nunjucks_init',
        rootDir: this.fileSystemUtils.rootDir,
        defaultViewsRoot: viewConfig.defaultViewsRoot,
        viewDirs,
      }
    );

    const nunjucksEnv = nunjucks.configure(viewDirs, {
      autoescape: true,
      noCache:
        this.configManager.getConfig().deployment.environment !== 'production',
    });

    this.addNunjucksFilters(nunjucksEnv);
    return nunjucksEnv;
  }

  /**
   * Add custom filters to Nunjucks environment
   */
  private addNunjucksFilters(nunjucksEnv: nunjucks.Environment): void {
    // Capture logger for use in filter functions
    const logger = this.logger;

    nunjucksEnv.addFilter('date', function (date, format = 'MMM DD, YYYY') {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date;

      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const year = d.getFullYear();
      const month = months[d.getMonth()];
      const day = d.getDate().toString().padStart(2, '0');
      const hours = d.getHours().toString().padStart(2, '0');
      const minutes = d.getMinutes().toString().padStart(2, '0');

      if (format === 'MMM DD, YYYY') {
        return `${month} ${day}, ${year}`;
      } else if (format === 'MMM DD, YYYY HH:mm') {
        return `${month} ${day}, ${year} ${hours}:${minutes}`;
      }

      return date;
    });

    nunjucksEnv.addFilter('numberFormat', function (number) {
      if (number === undefined || number === null) return '';
      return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    });

    nunjucksEnv.addFilter('tojson', function (obj) {
      if (obj === undefined || obj === null) return 'null';
      try {
        return JSON.stringify(obj);
      } catch {
        logger.error('Error serializing object to JSON in tojson filter: ');
        return 'null';
      }
    });

    // Usage: {{ "primaryForeground" | kebabCase }} => "primary-foreground"
    nunjucksEnv.addFilter('kebabCase', function (str: any) {
      if (!str || typeof str !== 'string') return '';
      return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    });
  }

  /**
   * Get locale for Koa context
   */
  getKoaLocale = (ctx: KoaI18nContext): string => {
    return this.oidcUtils.getLocale(
      ctx as unknown as KoaContextWithOIDC,
      this.i18nService.getLocale()
    );
  };

  /**
   * Initialize i18n for Koa context
   */
  i18nKoaInit = async (
    ctx: KoaI18nContext,
    next: () => Promise<void>
  ): Promise<void> => {
    ctx.t = (phrase: string, ...args: any[]): string => {
      return this.i18nService.__(phrase, ...args);
    };

    ctx.tn = (phrase: string, count: number, ...args: any[]): string => {
      return this.i18nService.__n(phrase, count, ...args);
    };

    ctx.state = ctx.state || {};
    ctx.state.t = ctx.t;
    ctx.state.tn = ctx.tn;

    await next();
  };

  /**
   * Handle language selection for Koa context
   */
  koaLanguageHandler = async (
    ctx: KoaI18nContext,
    next: () => Promise<void>
  ): Promise<void> => {
    const locale = this.getKoaLocale(ctx);
    const config = this.configManager.getConfig();

    if (
      ctx.query &&
      ctx.query.lang &&
      this.i18nService.getLocales().includes(ctx.query.lang)
    ) {
      ctx.cookies.set('locale', ctx.query.lang, {
        maxAge: config.deployment.cookies.types.locale.maxAge,
        httpOnly: config.deployment.cookies.types.locale.httpOnly,
        secure: config.deployment.cookies.types.locale.secure,
        sameSite: config.deployment.cookies.types.locale.sameSite,
      });
    }

    this.i18nService.setLocale(locale);

    ctx.state = ctx.state || {};
    ctx.state.locale = locale;
    ctx.state.locales = this.i18nService.getLocales();
    ctx.state.currentUrl = ctx.originalUrl ? ctx.originalUrl.split('?')[0] : '';

    await next();
  };

  /**
   * Main i18n middleware for Koa
   */
  koaI18nMiddleware = async (
    ctx: KoaI18nContext,
    next: () => Promise<void>
  ): Promise<void> => {
    ctx.t = (phrase: string, ...args: any[]): string => {
      return this.i18nService.__(phrase, ...args);
    };

    ctx.tn = (phrase: string, count: number, ...args: any[]): string => {
      return this.i18nService.__n(phrase, count, ...args);
    };

    const locale = this.getKoaLocale(ctx);
    const config = this.configManager.getConfig();

    if (
      ctx.query &&
      ctx.query.lang &&
      this.i18nService.getLocales().includes(ctx.query.lang)
    ) {
      ctx.cookies.set('locale', ctx.query.lang, {
        maxAge: config.deployment.cookies.types.locale.maxAge,
        httpOnly: config.deployment.cookies.types.locale.httpOnly,
        secure: config.deployment.cookies.types.locale.secure,
        sameSite: config.deployment.cookies.types.locale.sameSite,
      });
    }

    this.i18nService.setLocale(locale);

    ctx.state = ctx.state || {};
    ctx.state.t = ctx.t;
    ctx.state.tn = ctx.tn;
    ctx.state.locale = locale;
    ctx.state.locales = this.i18nService.getLocales();
    ctx.state.currentUrl = ctx.originalUrl ? ctx.originalUrl.split('?')[0] : '';

    // If not in localhost, set showOIDCDebug to false
    if (ctx.hostname !== 'localhost') {
      ctx.showOIDCDebug = false;
    }

    await next();
  };

  /**
   * Load configuration locals for template rendering
   */
  private loadConfigLocals(): Record<string, any> {
    try {
      const config = this.configManager.getConfig();

      const resolve = (v: string | undefined | null) =>
        resolveBrandingUrl(
          v,
          this.uploadMiddleware.getFileUrl.bind(this.uploadMiddleware)
        );

      return {
        app: {
          title: config.application.title,
          description: config.application.description,
          locales: config.application.locales,
          url: config.deployment.url,
          env: config.deployment.environment,
        },

        branding: {
          companyName: config.branding.companyName,
          logo: resolve(config.branding.logo),
          logoDark: resolve(config.branding.logoDark || config.branding.logo),
          logoIcon: resolve(
            config.branding.logoIcon || '/images/logo-icon-light.svg'
          ),
          logoIconDark: resolve(
            config.branding.logoIconDark || '/images/logo-icon-dark.svg'
          ),
          favicon: resolve(config.branding.favicon || '/favicon.svg'),
          colors: config.branding.colors || { light: {}, dark: {} },
          fonts: config.branding.fonts || {},
        },

        urls: {
          website: config.integrations.urls.website,
          privacy_policy: config.integrations.urls.privacy_policy,
          terms_of_service: config.integrations.urls.terms_of_service,
          contact: config.integrations.urls.contact,
        },

        // Use SocialLoginManager to get only providers that are both enabled AND configured,
        // then intersect with tenant config's enabled list
        socialProviders: (() => {
          const platformProviders =
            this.socialLoginManager.getAvailableProviders();
          const tenantEnabled: string[] =
            (config.features.social_providers.enabled as string[]) || [];
          return {
            enabled: platformProviders.filter((p: string) =>
              tenantEnabled.includes(p)
            ),
            available: config.features.social_providers.available || [
              'google',
              'github',
              'microsoft',
              'linkedin',
              'facebook',
            ],
          };
        })(),

        authentication: {
          loginMethods: {
            email:
              config.security.authentication.login.login_methods.some(cred =>
                cred.includes('email')
              ) || false,
            phone:
              config.security.authentication.login.login_methods.some(
                cred => cred.includes('phone') || cred.includes('phone_number')
              ) || false,
            customIdentifier:
              config.security.authentication.login.login_methods.some(cred =>
                cred.includes('custom_identifier')
              ) || false,
            bothEnabled:
              config.security.authentication.login.login_methods.length > 1 ||
              false,
          },

          signupMethods: {
            bothEnabled:
              config.security.authentication.signup.signup_methods.length > 1 ||
              false,
            requireFullName:
              config.security.authentication.signup.contact_channels?.full_name
                ?.required ?? true,
          },

          customIdentifiers: (config.security.authentication.custom_identifiers
            ?.enabled
            ? (
                config.security.authentication.custom_identifiers.fields ?? []
              ).filter((f: any) => f.usable_for_login)
            : []
          ).map((f: any) => ({
            slot: f.slot,
            key: f.key,
            name: f.name,
            hint: f.hint_for_user,
          })),

          emailVerificationRequired:
            config.security.authentication.signup.require_email_verification ||
            false,
          phoneVerificationRequired:
            config.security.authentication.signup.require_phone_verification ||
            false,
        },

        environment: config.deployment.environment,
        isDevelopment: config.deployment.environment === 'development',
        isProduction: config.deployment.environment === 'production',

        oidc: {
          issuer: config.oidc.issuer,
          path: config.oidc.path,
        },

        currentYear: new Date().getFullYear(),

        routes: {
          // App-level routes
          app: {
            auth: config.deployment.routes.auth,
            accounts: config.deployment.routes.accounts,
            api: config.deployment.routes.api,
            home: config.deployment.routes.home,
            oidc: config.oidc.path,
          },

          // Auth routes with full paths
          authFull: {
            login: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`,
            register: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.register}`,
            forgot_password: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.forgot_password}`,
            reset_password: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.reset_password}`,
            verify_email: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.verify_email}`,
            email_verification: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.email_verification}`,
            email_verification_success: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.email_verification_success}`,
            logout: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.logout}`,
            mfa_verify: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.mfa_verify}`,
            multi_factor: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.multi_factor}`,
            mfa_resend: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.mfa_resend}`,
            account_select: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_select}`,
            continue: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.continue}`,
            social_password_setup: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.social_password_setup}`,
            social_contact_info: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.social_contact_info}`,
            account_recovery: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`,
            recovery_backup_codes: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_backup_codes}`,
            recovery_secondary_email: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_secondary_email}`,
            recovery_verify_code: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_verify_code}`,
            update_theme: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_theme}`,
            update_locale: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_locale}`,
            update_sidebar: `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.update_sidebar}`,
          },

          // Account routes with full paths
          accountFull: {
            accounts_base: config.deployment.routes.accounts,
            dashboard: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`,
            settings: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings}`,
            apps: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.apps}`,
            sessions: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.sessions}`,
            update_profile: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.update_profile}`,
            change_password: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.change_password}`,
            remove_avatar: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.remove_avatar}`,
            enable_mfa: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.enable_mfa}`,
            disable_mfa: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.disable_mfa}`,
            setup_mfa: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.setup_mfa}`,
            switch_account: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.switch_account}`,
            add_account: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.add_account}`,
            remove_account: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.remove_account}`,
            account_switcher_data: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.account_switcher_data}`,
            revoke_app: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.revoke_app}`,
            revoke_all_apps: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.revoke_all_apps}`,
            logout_session: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.logout_session}`,
            logout_all_other_sessions: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.logout_all_other_sessions}`,
            resend_email_verification: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.resend_email_verification}`,
            enable_recovery: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.enable_recovery}`,
            disable_recovery: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.disable_recovery}`,
            recovery_codes: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.recovery_codes}`,
            verify_recovery_email: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.verify_recovery_email}`,
            regenerate_backup_codes: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.regenerate_backup_codes}`,
            recovery_setup: `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.recovery_setup}`,
          },

          // OIDC routes
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
        },
      };
    } catch (error) {
      this.logger.error('Failed to load config for locals: ', { error });

      return {
        app: {
          title: 'Parako.ID',
          description:
            'Self-hosted identity server with SSO, MFA, passkeys, and OAuth2',
          tagline: 'Your auth server. Self-hosted. Free.',
          locales: { default: 'en', available: ['en'] },
          url: 'https://parako.id',
          env: 'development',
        },

        branding: {
          logo: '/images/logo-light.svg',
          theme: {
            type: 'predefined',
            theme: 'default',
          },
          favicon: '/favicon.svg',
          colors: { light: {}, dark: {} },
          fonts: {},
        },

        urls: {
          website: '#',
          privacy_policy: '#',
          terms_of_service: '#',
          contact: '#',
        },

        socialProviders: {
          enabled: [],
          available: ['google', 'github', 'microsoft', 'linkedin', 'facebook'],
        },

        authentication: {
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
        },

        environment: 'development',
        isDevelopment: true,
        isProduction: false,

        oidc: {
          issuer: 'http://localhost:9007/oidc/v1',
          path: '/oidc/v1',
        },

        currentYear: new Date().getFullYear(),

        // Fallback routes for error cases
        routes: {
          app: {
            auth: '/auth',
            accounts: '/accounts',
            api: '/api',
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
            recovery_backup_codes: '/auth/recovery-backup-codes',
            recovery_secondary_email: '/auth/recovery-secondary-email',
            recovery_verify_code: '/auth/recovery-verify-code',
            update_theme: '/auth/update-theme',
            update_locale: '/auth/update-locale',
            update_sidebar: '/auth/update-sidebar',
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
        },
      };
    }
  }

  /**
   * Add render function to Koa context
   */
  private addRenderToContext(
    ctx: KoaRenderContext
  ): (template: string, locals?: Record<string, any>) => Promise<void> {
    return (
      template: string,
      locals: Record<string, any> = {}
    ): Promise<void> => {
      return new Promise((resolve, reject) => {
        const configLocals = this.loadConfigLocals();

        const themeCookie = ctx.cookies.get('theme');
        const userTheme = themeCookie === 'dark' ? 'dark' : 'light';

        const mergedLocals: Record<string, any> = {
          ...configLocals,
          ...ctx.state,
          ...locals,
          url: ctx.url,
          path: ctx.path,
          query: ctx.query,
          t:
            ctx.state?.t ||
            ctx.t ||
            ctx.locals?.t ||
            ((key: string, ..._args: any[]) => key),
          csrf_token: ctx.state?.csrfToken || ctx.locals?.csrfToken,
          // Theme handling for OIDC views
          userTheme,
          htmlClass: userTheme === 'dark' ? 'dark' : '',
        };

        if (ctx.req && ctx.req.flash) {
          mergedLocals.flash = ctx.req.flash();
        } else if (ctx.flash) {
          mergedLocals.flash = ctx.flash;
        }

        if (ctx.state?.locale || ctx.locals?.locale) {
          mergedLocals.locale = ctx.state?.locale || ctx.locals?.locale;
        }

        if (ctx.state?.locales || ctx.locals?.locales) {
          mergedLocals.locales = ctx.state?.locales || ctx.locals?.locales;
        }

        if (ctx.oidc && ctx.oidc.client) {
          mergedLocals.client = {
            clientName: ctx.oidc.client.clientName,
            clientId: ctx.oidc.client.clientId,
            logoUri: ctx.oidc.client.logoUri,
            clientUri: ctx.oidc.client.clientUri,
            policyUri: ctx.oidc.client.policyUri,
            tosUri: ctx.oidc.client.tosUri,
          };
        }

        this.nunjucksEnv.render(template, mergedLocals, (err, result) => {
          if (err) {
            this.logger.error('Template render error', { error: String(err) });
            reject(err);
            return;
          }

          ctx.type = 'html';
          ctx.body = result;
          resolve();
        });
      });
    };
  }

  /**
   * Render middleware for Koa
   */
  renderMiddleware = async (
    ctx: KoaRenderContext,
    next: () => Promise<void>
  ): Promise<void> => {
    ctx.render = this.addRenderToContext(ctx);
    await next();
  };
}
