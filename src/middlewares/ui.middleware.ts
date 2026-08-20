import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ICookieManager } from '../di/interfaces/cookie-manager.interface.js';
import type { IUIMiddleware } from '../di/interfaces/ui-middleware.interface.js';
import type { II18nService } from '../di/interfaces/i18n-service.interface.js';
import type { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import { TYPES } from '../di/types.js';
import { getDefaultFullConfig } from '../config/constants.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../multi-tenancy/tenant-context.js';
import { buildConfigurationViewLocals } from '../utils/view-locals.js';

function supportedLocale(
  value: unknown,
  availableLocales: readonly string[]
): string | undefined {
  return typeof value === 'string' && availableLocales.includes(value)
    ? value
    : undefined;
}

function supportedTheme(value: unknown): 'light' | 'dark' | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

function booleanPreference(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

@injectable()
export class UIMiddleware implements IUIMiddleware {
  constructor(
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.CookieManager) private readonly cookieManager: ICookieManager,
    @inject(TYPES.I18nService) private readonly i18nService: II18nService,
    @inject(TYPES.UploadMiddleware)
    private readonly uploadMiddleware: IUploadMiddleware
  ) {}

  public setThemeLocals = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      let theme = supportedTheme(this.sessionManager.get(req, 'userTheme'));

      if (!theme && (await this.sessionManager.isAuthenticated(req))) {
        try {
          const userData = this.sessionManager.getActiveUser(req);
          if (userData && userData.username) {
            const dbUser = await this.userService.findByUsername(
              userData.username
            );

            theme = supportedTheme(dbUser?.theme) || 'light';
            this.sessionManager.set(req, 'userTheme', theme);
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'error_loading_theme_from_database',
          });
          theme = 'light';
          this.sessionManager.set(req, 'userTheme', theme);
        }
      }

      const finalTheme = theme || 'light';
      res.locals.userTheme = finalTheme;
      res.locals.htmlClass = finalTheme === 'dark' ? 'dark' : '';

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_setting_theme_locals',
      });

      res.locals.userTheme = 'light';
      res.locals.htmlClass = '';

      next();
    }
  };

  /**
   * Updates the user's theme preference
   *
   * Even if the user is not authenticated, we still have a session,
   * so we always put the theme in the session.
   */
  public updateTheme = async (req: Request, res: Response): Promise<void> => {
    try {
      const { theme } = req.body;

      if (!theme || !['light', 'dark'].includes(theme)) {
        res.status(400).json({ success: false, error: 'Invalid theme value' });
        return;
      }

      const userData = this.sessionManager.getActiveUser(req);

      if (userData && userData.id) {
        await this.userService.updateProfile(userData.id, { theme });
      }

      // Persist locally for both authenticated and anonymous sessions only
      // after an authenticated profile update succeeds.
      this.sessionManager.set(req, 'userTheme', theme);
      this.cookieManager.setThemeCookie(res, theme);

      res.locals.userTheme = theme;
      res.locals.htmlClass = theme === 'dark' ? 'dark' : '';

      if (userData && userData.id) {
        this.activityService.success(
          'theme_changed',
          'User changed theme',
          null,
          {
            ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            actor: {
              ...userData,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
              entity_data: {
                theme,
              },
            },
          }
        );
      }

      res.json({ success: true, theme });
    } catch (error) {
      this.logger.error(error as Error, { context: 'error_updating_theme' });
      res.status(500).json({ success: false, error: 'Failed to update theme' });
    }
  };

  public setSidebarLocals = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      let sidebarExpanded = booleanPreference(
        this.sessionManager.get(req, 'sidebar_expanded')
      );

      if (
        sidebarExpanded === undefined &&
        (await this.sessionManager.isAuthenticated(req))
      ) {
        try {
          const userData = this.sessionManager.getActiveUser(req);
          if (userData && userData.username) {
            const dbUser = await this.userService.findByUsername(
              userData.username
            );

            sidebarExpanded =
              booleanPreference(dbUser?.sidebar_expanded) ?? true;
            this.sessionManager.set(req, 'sidebar_expanded', sidebarExpanded);
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'error_loading_sidebar_from_database',
          });
          sidebarExpanded = true;
          this.sessionManager.set(req, 'sidebar_expanded', sidebarExpanded);
        }
      }

      const finalSidebarExpanded =
        sidebarExpanded !== undefined ? sidebarExpanded : true;
      res.locals.sidebar_expanded = finalSidebarExpanded;

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_setting_sidebar_locals',
      });
      res.locals.sidebar_expanded = true;
      next();
    }
  };

  public updateSidebar = async (req: Request, res: Response): Promise<void> => {
    try {
      const { expanded } = req.body;

      if (typeof expanded !== 'boolean') {
        res
          .status(400)
          .json({ success: false, error: 'Invalid sidebar state value' });
        return;
      }

      const userData = this.sessionManager.getActiveUser(req);

      if (userData && userData.id) {
        await this.userService.updateProfile(userData.id, {
          sidebar_expanded: expanded,
        });
      }

      // Persist locally only after an authenticated profile update succeeds.
      this.sessionManager.set(req, 'sidebar_expanded', expanded);
      res.locals.sidebar_expanded = expanded;

      if (userData && userData.id) {
        this.activityService.success(
          'sidebar_state_changed',
          'User changed sidebar state',
          null,
          {
            ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            actor: {
              ...userData,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
              entity_data: {
                expanded,
              },
            },
          }
        );
      }

      res.json({ success: true, expanded });
    } catch (error) {
      this.logger.error(error as Error, { context: 'error_updating_sidebar' });
      res
        .status(500)
        .json({ success: false, error: 'Failed to update sidebar state' });
    }
  };

  public setLocaleLocals = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const config = this.configManager.getConfig();
      let userLocale = supportedLocale(
        this.sessionManager.get(req, 'userLocale'),
        config.application.locales.available
      );

      if (!userLocale && (await this.sessionManager.isAuthenticated(req))) {
        try {
          const userData = this.sessionManager.getActiveUser(req);
          if (userData && userData.username) {
            const dbUser = await this.userService.findByUsername(
              userData.username
            );

            userLocale =
              supportedLocale(
                dbUser?.locale,
                config.application.locales.available
              ) || config.application.locales.default;
            this.sessionManager.set(req, 'userLocale', userLocale);
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'error_loading_locale_from_database',
          });
          userLocale = config.application.locales.default;
          this.sessionManager.set(req, 'userLocale', userLocale);
        }
      }

      const finalLocale = userLocale || config.application.locales.default;
      res.locals.userLocale = finalLocale;
      res.locals.currentLocale = finalLocale;

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_setting_locale_locals',
      });
      const config = this.configManager.getConfig();

      res.locals.userLocale = config.application.locales.default;
      res.locals.currentLocale = config.application.locales.default;

      next();
    }
  };

  /**
   * Updates the user's locale preference
   * Works for both authenticated and unauthenticated users
   */
  public updateLocale = async (req: Request, res: Response): Promise<void> => {
    try {
      const { locale } = req.body;
      const config = this.configManager.getConfig();

      const availableLocales = config.application.locales.available;
      if (!locale || !availableLocales.includes(locale)) {
        res.status(400).json({ success: false, error: 'Invalid locale value' });
        return;
      }

      const isAuthenticated = await this.sessionManager.isAuthenticated(req);
      const userData = isAuthenticated
        ? this.sessionManager.getActiveUser(req)
        : undefined;

      if (userData && userData.id) {
        await this.userService.updateProfile(userData.id, { locale });
      }

      // Persist locally only after an authenticated profile update succeeds.
      this.sessionManager.set(req, 'userLocale', locale);
      this.cookieManager.setLocaleCookie(res, locale);

      res.locals.userLocale = locale;
      res.locals.currentLocale = locale;

      if (userData && userData.id) {
        this.activityService.success(
          'locale_changed',
          'User changed locale',
          null,
          {
            ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            actor: {
              ...userData,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
              entity_data: {
                locale,
              },
            },
          }
        );
      }

      res.json({ success: true, locale });
    } catch (error) {
      this.logger.error(error as Error, { context: 'error_updating_locale' });
      res
        .status(500)
        .json({ success: false, error: 'Failed to update locale' });
    }
  };

  /**
   * Updates the user's timezone preference
   * Only works for authenticated users
   */
  public updateTimezone = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { timezone } = req.body;

      if (!timezone || typeof timezone !== 'string') {
        res
          .status(400)
          .json({ success: false, error: 'Invalid timezone value' });
        return;
      }

      try {
        new Date().toLocaleString('en-US', { timeZone: timezone });
      } catch {
        res
          .status(400)
          .json({ success: false, error: 'Invalid timezone identifier' });
        return;
      }

      // Timezone updates require authentication
      const isAuthenticated = await this.sessionManager.isAuthenticated(req);
      if (!isAuthenticated) {
        res
          .status(401)
          .json({ success: false, error: 'Authentication required' });
        return;
      }

      const userData = this.sessionManager.getActiveUser(req);
      if (!userData || !userData.id) {
        res.status(401).json({ success: false, error: 'User not found' });
        return;
      }

      await this.userService.updateProfile(userData.id, { zoneinfo: timezone });

      this.sessionManager.updateActiveUserData(req, { zoneinfo: timezone });

      this.activityService.success(
        'timezone_changed',
        'User changed timezone',
        null,
        {
          ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
          user_agent: req.get('User-Agent') || 'unknown',
          actor: {
            ...userData,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
            entity_data: {
              timezone,
            },
          },
        }
      );

      res.json({ success: true, timezone });
    } catch (error) {
      this.logger.error(error as Error, { context: 'error_updating_timezone' });
      res
        .status(500)
        .json({ success: false, error: 'Failed to update timezone' });
    }
  };

  public getAvailableLocales = (): Array<{
    code: string;
    flag: string;
    label: string;
  }> => {
    const config = this.configManager.getConfig();
    const availableLocales = Array.isArray(config.application.locales.available)
      ? config.application.locales.available
      : getDefaultFullConfig().application.locales.available;

    const localeMap: Record<string, { flag: string; label: string }> = {
      en: { flag: '🇺🇸', label: 'English' },
      fr: { flag: '🇫🇷', label: 'Français' },
      es: { flag: '🇪🇸', label: 'Español' },
      de: { flag: '🇩🇪', label: 'Deutsch' },
      it: { flag: '🇮🇹', label: 'Italiano' },
      pt: { flag: '🇵🇹', label: 'Português' },
      ru: { flag: '🇷🇺', label: 'Русский' },
      zh: { flag: '🇨🇳', label: '中文' },
      ja: { flag: '🇯🇵', label: '日本語' },
      ko: { flag: '🇰🇷', label: '한국어' },
    };

    return availableLocales.map((code: string) => ({
      code,
      ...(localeMap[code] || { flag: '🌐', label: code.toUpperCase() }),
    }));
  };

  public initI18n = (req: Request, res: Response, next: NextFunction): void => {
    try {
      this.i18nService.init(req, res, next);
    } catch (error) {
      this.logger.error(error as Error, { context: 'error_initializing_i18n' });
      next();
    }
  };

  /**
   * Extract locale from URL path parameters
   * Locale extractor middleware extracts locale from path and stores it in req.extractedLocale
   * This doesn't interfere with Express route matching
   * Returns null if no valid locale found
   */
  private extractPathLocale(
    req: Request,
    availableLocales: string[]
  ): string | null {
    const extractedLocale = (req as any).extractedLocale;

    if (extractedLocale && availableLocales.includes(extractedLocale)) {
      return extractedLocale;
    }

    // Fallback: If extractor didn't run, try parsing req.originalUrl directly
    // Simple approach: just check if first segment is a valid locale
    const originalUrl = req.originalUrl || req.url || req.path;
    const urlPath = originalUrl.split('?')[0]; // Remove query string
    const pathSegments = urlPath
      .split('/')
      .filter(segment => segment.length > 0);

    if (pathSegments.length > 0) {
      const firstSegment = pathSegments[0];
      if (availableLocales.includes(firstSegment)) {
        return firstSegment;
      }
    }

    return null;
  }

  /**
   * Extract locale from query parameters with priority order:
   * ui_locales -> locale -> lang -> hl -> l
   * Returns null if no valid locale found in query params
   */
  private extractQueryLocale(
    req: Request,
    availableLocales: string[]
  ): string | null {
    const queryParams = ['ui_locales', 'locale', 'lang', 'hl', 'l'];

    for (const param of queryParams) {
      const value = req.query[param];

      if (param === 'ui_locales' && typeof value === 'string') {
        const preferredLocale = value
          .split(/\s+/)
          .find(locale => availableLocales.includes(locale));

        if (preferredLocale) {
          return preferredLocale;
        }

        continue;
      }

      if (typeof value === 'string' && availableLocales.includes(value)) {
        return value;
      }
    }

    return null;
  }

  /**
   * Handles language selection with support for multiple detection methods
   * Priority: query params (ui_locales, locale, lang, hl, l) -> path -> session -> user-agent -> default
   * Query params and path are stateless (don't persist to session)
   */
  public handleLanguage = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    try {
      const config = this.configManager.getConfig();
      const defaultLocale = config.application.locales.default;
      const availableLocales = config.application.locales.available;
      const localeCookieConfig = this.cookieManager.getCookieConfig('locale');

      // Priority 1: Check query parameters (stateless - highest priority)
      const queryLocale = this.extractQueryLocale(req, availableLocales);

      // Priority 2: Check URL path (stateless)
      // IMPORTANT: Always extract path locale independently, even if query takes priority
      const pathLocale = this.extractPathLocale(req, availableLocales);

      // Priority 3: Session locale (persistent)
      const sessionLocale = supportedLocale(
        this.sessionManager.get(req, 'userLocale'),
        availableLocales
      );

      // Priority 4: Cookie locale
      const cookieLocale = supportedLocale(
        localeCookieConfig.name
          ? req.cookies[localeCookieConfig.name]
          : undefined,
        availableLocales
      );

      // Priority 5: Accept-Language header (user-agent locale)
      const acceptLanguage = req.acceptsLanguages(availableLocales);
      const userAgentLocale =
        typeof acceptLanguage === 'string' ? acceptLanguage : null;
      const i18nLocale = supportedLocale(
        this.i18nService.getLocale(),
        availableLocales
      );

      const locale =
        queryLocale ||
        pathLocale ||
        sessionLocale ||
        cookieLocale ||
        userAgentLocale ||
        i18nLocale ||
        defaultLocale;

      this.i18nService.setLocale(req, locale);

      res.locals.detectedLocale = locale;
      res.locals.currentLocale = locale;
      res.locals.localeSource = queryLocale
        ? 'query'
        : pathLocale
          ? 'path'
          : sessionLocale
            ? 'session'
            : cookieLocale
              ? 'cookie'
              : userAgentLocale
                ? 'user-agent'
                : 'default';

      // This is based on the path locale, independent of which locale is actually used
      // Even if query parameter takes priority, we still use path locale for the prefix
      res.locals.localePrefix = pathLocale ? `/${pathLocale}` : '';

      next();
    } catch (error) {
      this.logger.error(error as Error, { context: 'error_handling_language' });

      // Fallback to default locale from config
      const config = this.configManager.getConfig();
      this.i18nService.setLocale(req, config.application.locales.default);
      res.locals.localePrefix = '';
      next();
    }
  };

  /**
   * Adds i18n helper functions to res.locals
   */
  public addI18nHelpers = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    try {
      if (req.t && typeof req.t === 'function') {
        res.locals.t = req.t.bind(req);
        // `tn` is added by the i18n module; cast inline so CI typecheck doesn't
        // depend on whether the express-serve-static-core augmentation is hoisted.
        const reqWithTn = req as Request & {
          tn?: (
            singular: string,
            plural: string,
            count: number,
            ...replace: unknown[]
          ) => string;
        };
        res.locals.tn = reqWithTn.tn ? reqWithTn.tn.bind(reqWithTn) : null;
      } else {
        // The normalized translation helper below provides the fallback.
        res.locals.tn = null;
      }

      res.locals.locale = this.i18nService.getLocale(req);
      res.locals.locales = this.i18nService.getLocales();
      res.locals.currentUrl = req.originalUrl.split('?')[0];

      // This is a helper to ensure that the t function returns a string
      res.locals.t = (key: string, ...args: any[]) => {
        if (req.t && typeof req.t === 'function') {
          const val = req.t(key, ...args);
          return typeof val === 'string' ? val : key;
        }
        return key;
      };

      res.locals.getAvailableLocales = () => this.getAvailableLocales();

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_adding_i18n_helpers',
      });

      const config = this.configManager.getConfig();
      res.locals.t = (key: string) => key;
      res.locals.tn = null;
      res.locals.locale = config.application.locales.default;
      res.locals.locales = config.application.locales.available;
      res.locals.currentUrl = req.originalUrl.split('?')[0];

      next();
    }
  };

  /**
   * Sets all UI-related locals in one middleware call (OPTIMIZED)
   * Fetches user from DB only ONCE and sets theme, sidebar, and locale
   * Reduces 3 DB queries to 1 for authenticated users
   */
  public setAllUILocals = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const config = this.configManager.getConfig();
      const defaultLocale = config.application.locales.default;

      let theme = supportedTheme(this.sessionManager.get(req, 'userTheme'));
      let sidebarExpanded = booleanPreference(
        this.sessionManager.get(req, 'sidebar_expanded')
      );
      let userLocale = supportedLocale(
        this.sessionManager.get(req, 'userLocale'),
        config.application.locales.available
      );

      // Only fetch from DB if any value is missing AND user is authenticated
      const needsDbFetch =
        (!theme || sidebarExpanded === undefined || !userLocale) &&
        (await this.sessionManager.isAuthenticated(req));

      if (needsDbFetch) {
        try {
          const userData = this.sessionManager.getActiveUser(req);
          if (userData && userData.username) {
            // SINGLE DB QUERY for all preferences
            const dbUser = await this.userService.findByUsername(
              userData.username
            );

            if (dbUser) {
              if (!theme) {
                theme = supportedTheme(dbUser.theme) || 'light';
                this.sessionManager.set(req, 'userTheme', theme);
              }

              if (sidebarExpanded === undefined) {
                sidebarExpanded =
                  booleanPreference(dbUser.sidebar_expanded) ?? true;
                this.sessionManager.set(
                  req,
                  'sidebar_expanded',
                  sidebarExpanded
                );
              }

              if (!userLocale) {
                userLocale =
                  supportedLocale(
                    dbUser.locale,
                    config.application.locales.available
                  ) || defaultLocale;
                this.sessionManager.set(req, 'userLocale', userLocale);
              }
            }
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'error_loading_ui_prefs_from_database',
          });
        }
      }

      const finalTheme = theme || 'light';
      const finalSidebarExpanded =
        sidebarExpanded !== undefined ? sidebarExpanded : true;
      const finalLocale = userLocale || defaultLocale;

      res.locals.userTheme = finalTheme;
      res.locals.htmlClass = finalTheme === 'dark' ? 'dark' : '';

      res.locals.sidebar_expanded = finalSidebarExpanded;

      res.locals.userLocale = finalLocale;
      res.locals.currentLocale = finalLocale;

      // Tenant context is active here, so this replaces the platform defaults
      // installed by LocalsMiddleware with the effective tenant configuration.
      const tenantConfig = this.configManager.getConfig();
      const enabledProviders = Array.isArray(
        res.locals.socialProviders?.enabled
      )
        ? res.locals.socialProviders.enabled.filter(
            (provider: unknown): provider is string =>
              typeof provider === 'string'
          )
        : [];

      const tenantLocals = await buildConfigurationViewLocals({
        config: tenantConfig,
        request: req,
        resolveFileUrl: storageKey =>
          this.uploadMiddleware.getFileUrl(storageKey),
        enabledSocialProviders: enabledProviders,
        restrictSocialProviders: true,
      });
      Object.assign(res.locals, tenantLocals);

      const currentTenantId =
        tenantContext.getTenantIdSafe() || DEFAULT_TENANT_ID;
      res.locals.isPlatformTenant =
        !tenantConfig.features.multi_tenancy.enabled ||
        currentTenantId === '_platforms' ||
        currentTenantId === DEFAULT_TENANT_ID;
      res.locals.isMultiTenancyEnabled =
        tenantConfig.features.multi_tenancy.enabled;
      this.addI18nHelpers(req, res, () => {});

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_setting_all_ui_locals',
      });

      const config = this.configManager.getConfig();
      res.locals.userTheme = 'light';
      res.locals.htmlClass = '';
      res.locals.sidebar_expanded = true;
      res.locals.userLocale = config.application.locales.default;
      res.locals.currentLocale = config.application.locales.default;

      next();
    }
  };
}
