import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import type { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import { TYPES } from '../di/types.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';

function safeLocalRoute(candidate: unknown, fallback: string): string {
  return typeof candidate === 'string' &&
    candidate.startsWith('/') &&
    !candidate.startsWith('//')
    ? candidate
    : fallback;
}

@injectable()
export class SecurityMiddleware implements ISecurityMiddleware {
  constructor(
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver
  ) {}

  /**
   * Middleware to require authentication
   * Redirects to login page if user is not authenticated
   */
  public requireAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!(await this.sessionManager.isAuthenticated(req))) {
      const returnUrl = req.originalUrl;
      const config = this.configManager.getConfig();
      this.logger.info(
        'Authentication required or account disabled, redirecting to login',
        {
          returnUrl,
          sessionId: req.session?.id || 'no-session',
        }
      );
      return res.redirect(
        `${safeLocalRoute(
          res.locals.routes?.authFull?.login,
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`
        )}?continue=${encodeURIComponent(returnUrl)}`
      );
    }
    next();
  };

  /**
   * Middleware to require specific roles
   * Redirects to login page if user doesn't have required role
   */
  public requireRole = (role: string) => {
    return async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      if (!(await this.sessionManager.isAuthenticated(req))) {
        const returnUrl = req.originalUrl;
        const config = this.configManager.getConfig();
        this.logger.info(
          'Authentication required or account disabled for role check, redirecting to login',
          {
            returnUrl,
            requiredRole: role,
            sessionId: req.session?.id || 'no-session',
          }
        );
        return res.redirect(
          `${safeLocalRoute(
            res.locals.routes?.authFull?.login,
            `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`
          )}?continue=${encodeURIComponent(returnUrl)}`
        );
      }

      if (!this.sessionManager.hasRole(req, role)) {
        this.logger.warn('Insufficient permissions', {
          requiredRole: role,
          userRoles: this.sessionManager.getUserProperty(req, 'roles'),
          sessionId: req.session?.id || 'no-session',
        });
        const config = this.configManager.getConfig();
        return res.redirect(
          `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`
        );
      }

      next();
    };
  };

  /**
   * Middleware to require admin privileges
   * Redirects to login page if user is not admin
   */
  public requireAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!(await this.sessionManager.isAuthenticated(req))) {
      const returnUrl = req.originalUrl;
      const config = this.configManager.getConfig();
      this.logger.info(
        'Authentication required or account disabled for admin access, redirecting to login',
        {
          returnUrl,
          sessionId: req.session?.id || 'no-session',
        }
      );
      return res.redirect(
        `${safeLocalRoute(
          res.locals.routes?.authFull?.login,
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`
        )}?continue=${encodeURIComponent(returnUrl)}`
      );
    }

    if (!this.sessionManager.isAdmin(req)) {
      this.logger.warn('Admin access denied', {
        userRoles: this.sessionManager.getUserProperty(req, 'roles'),
        sessionId: req.session?.id || 'no-session',
      });
      const config = this.configManager.getConfig();
      return res.redirect(
        `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`
      );
    }

    next();
  };

  /**
   * Middleware to restrict access to platform-only settings.
   * Allows access only from _platforms tenant or when multi-tenancy is disabled.
   */
  public requirePlatformTenant = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const config = this.configManager.getConfig();
    if (!config.features.multi_tenancy.enabled) return next();

    const tenantId = tenantContext.getTenantIdSafe();
    if (tenantId === '_platforms') return next();

    this.sessionManager
      .flash(req)
      .error(
        'Platform settings are only accessible from the platform admin portal.'
      );
    return res.redirect('/admin/configuration');
  };

  /**
   * Middleware to require specific permissions
   */
  public requirePermissions = (permissions: string[]) => {
    return async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      if (!(await this.sessionManager.isAuthenticated(req))) {
        const returnUrl = encodeURIComponent(req.originalUrl);
        const config = this.configManager.getConfig();

        this.logger.info('Unauthorized access attempt', {
          path: req.originalUrl,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });

        return res.redirect(
          `${safeLocalRoute(
            res.locals.routes?.authFull?.login,
            `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`
          )}?continue=${returnUrl}`
        );
      }

      const userPermissions =
        this.sessionManager.get<string[]>(req, 'permissions') || [];

      const hasAllPermissions = permissions.every(permission =>
        userPermissions.includes(permission)
      );

      if (!hasAllPermissions) {
        this.logger.warn('Insufficient permissions', {
          userId: this.sessionManager.getUserProperty(req, 'id'),
          path: req.originalUrl,
          requiredPermissions: permissions,
          userPermissions,
        });

        return res
          .status(403)
          .render(this.viewResolver.views.errors.forbidden, {
            title: 'Access Denied',
            message: 'You do not have permission to access this resource',
          });
      }

      next();
    };
  };

  /**
   * Regenerate session after authentication state changes
   * Helps prevent session fixation attacks
   */
  public regenerateSession = async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (
        (await this.sessionManager.isAuthenticated(req)) &&
        !this.sessionManager.get(req, 'sessionRegenerated')
      ) {
        await this.sessionManager.regenerate(req);
        this.sessionManager.set(req, 'sessionRegenerated', true);
      }
      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'session_regeneration_failed',
      });
      next(error);
    }
  };

  /**
   * Middleware to generate CSRF token and set it in res.locals for views
   */
  public generateCsrfToken = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    try {
      // Generate CSRF token if not already present
      if (!this.sessionManager.get(req, 'csrfToken')) {
        this.sessionManager.generateCsrfToken(req);
      }

      // Set CSRF token in res.locals for use in templates
      res.locals.csrfToken = this.sessionManager.get(req, 'csrfToken');

      next();
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'error_generating_csrf_token',
      });
      next(error);
    }
  };

  /**
   * Middleware to validate CSRF token on non-GET requests
   */
  public validateCsrfToken = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    // Use the existing sessionManager CSRF protection
    this.sessionManager.csrfProtection()(req, res, next);
  };

  /**
   * Sets up all security middleware in one call
   * Combines authentication and CSRF protection.
   */
  public setupAllSecurity = (
    authLevel: 'none' | 'user' | 'admin' = 'none',
    enableCsrf: boolean = true
  ) => {
    return [
      ...(authLevel === 'user' ? [this.requireAuth] : []),
      ...(authLevel === 'admin' ? [this.requireAdmin] : []),
      ...(enableCsrf ? [this.generateCsrfToken] : []),
    ];
  };
}
