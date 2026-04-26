import { type Application, type Router } from 'express';
import { injectable, inject, optional } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IAuthController } from '../di/interfaces/auth-controller.interface.js';
import type { IAccountController } from '../di/interfaces/account-controller.interface.js';
import type { IAdminHomeController } from '../di/interfaces/admin-home-controller.interface.js';
import type { IAdminUsersController } from '../di/interfaces/admin-users-controller.interface.js';
import type { IAdminActivitiesController } from '../di/interfaces/admin-activities-controller.interface.js';
import type { IAdminOidcClientController } from '../di/interfaces/admin-oidc-client-controller.interface.js';
import type { IAdminSessionsController } from '../di/interfaces/admin-sessions-controller.interface.js';
import type { IAdminUserGrantsController } from '../di/interfaces/admin-user-grants-controller.interface.js';
import type { IAdminSettingsController } from '../di/interfaces/admin-settings-controller.interface.js';
import type { IAdminJwksController } from '../di/interfaces/admin-jwks-controller.interface.js';
import type { IAdminConfigurationController } from '../di/interfaces/admin-configuration-controller.interface.js';
import type { IAdminDataTransferController } from '../di/interfaces/admin-data-transfer-controller.interface.js';
import type { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import type { ISecurityMiddleware } from '../di/interfaces/security-middleware.interface.js';
import type { ILocalsMiddleware } from '../di/interfaces/locals-middleware.interface.js';
import type { IUIMiddleware } from '../di/interfaces/ui-middleware.interface.js';
import type { IConfigValidationMiddleware } from '../di/interfaces/config-validation-middleware.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import { accountRoutes } from './accounts.js';
import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { webauthnRoutes } from './webauthn.js';
import type { IMainRoutesManager } from '../di/interfaces/main-routes-manager.interface.js';
import type { IWebAuthnController } from '../di/interfaces/webauthn-controller.interface.js';
import type { OpsTenantMiddleware } from '../middlewares/ops-tenant.middleware.js';
import type { OpsSocialCallbackService } from '../services/ops-social-callback.service.js';
import type { ISocialTier1CompletionService } from '../services/social-tier1-completion.service.js';
import type { PlatformAdminController } from '../controllers/admin/platform.controller.js';
import { opsRoutes } from './ops.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';

/**
 * Main Routes Manager
 * Handles registration of all application routes with DI injectable services
 */
@injectable()
export class MainRoutesManager implements IMainRoutesManager {
  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.AuthController)
    private readonly authController: IAuthController,
    @inject(TYPES.AccountController)
    private readonly accountController: IAccountController,
    @inject(TYPES.AdminUsersController)
    private readonly adminUsersController: IAdminUsersController,
    @inject(TYPES.AdminHomeController)
    private readonly adminHomeController: IAdminHomeController,
    @inject(TYPES.AdminActivitiesController)
    private readonly adminActivitiesController: IAdminActivitiesController,
    @inject(TYPES.AdminOidcClientsController)
    private readonly adminOidcClientController: IAdminOidcClientController,
    @inject(TYPES.AdminSessionsController)
    private readonly adminSessionsController: IAdminSessionsController,
    @inject(TYPES.AdminUserGrantsController)
    private readonly adminUserGrantsController: IAdminUserGrantsController,
    @inject(TYPES.AdminSettingsController)
    private readonly adminSettingsController: IAdminSettingsController,
    @inject(TYPES.AdminJwksController)
    private readonly adminJwksController: IAdminJwksController,
    @inject(TYPES.AdminConfigurationController)
    private readonly adminConfigurationController: IAdminConfigurationController,
    @inject(TYPES.AdminDataTransferController)
    private readonly adminDataTransferController: IAdminDataTransferController,
    @inject(TYPES.UploadMiddleware)
    private readonly avatarUpload: IUploadMiddleware,
    @inject(TYPES.UploadMiddleware)
    private readonly csvUpload: IUploadMiddleware,
    @inject(TYPES.SecurityMiddleware)
    private readonly securityMiddleware: ISecurityMiddleware,
    @inject(TYPES.LocalsMiddleware)
    private readonly localsMiddleware: ILocalsMiddleware,
    @inject(TYPES.UIMiddleware) private readonly uIMiddleware: IUIMiddleware,
    @inject(TYPES.ConfigValidationMiddleware)
    private readonly configValidationMiddleware: IConfigValidationMiddleware,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.WebAuthnController)
    private readonly webauthnController: IWebAuthnController,
    @inject(TYPES.OpsTenantMiddleware)
    @optional()
    private readonly opsTenantMiddleware: OpsTenantMiddleware,
    @inject(TYPES.OpsSocialCallbackService)
    @optional()
    private readonly opsSocialCallbackService: OpsSocialCallbackService,
    @inject(TYPES.SocialTier1CompletionService)
    private readonly tier1CompletionService: ISocialTier1CompletionService,
    @inject(TYPES.PlatformAdminController)
    @optional()
    private readonly platformAdminController: PlatformAdminController,
    @inject(TYPES.ApiV1RoutesManager)
    @optional()
    private readonly apiV1Router: Router
  ) {}

  /**
   * Middleware to extract and validate locale from URL path
   * Manually parses the first path segment before route matching occurs
   * Must be called BEFORE i18n initialization
   */
  public registerLocaleExtractor = (app: Application): void => {
    const config = this.configManager.getConfig();
    const availableLocales = config.application.locales.available;

    app.use((req, _res, next) => {
      // Don't interfere with Express route matching by setting req.params
      const originalUrl = req.originalUrl || req.url || req.path;
      const urlPath = originalUrl.split('?')[0];
      const pathSegments = urlPath
        .split('/')
        .filter(segment => segment.length > 0);

      if (pathSegments.length > 0) {
        const firstSegment = pathSegments[0];

        if (availableLocales.includes(firstSegment)) {
          // This doesn't interfere with Express route matching
          (req as any).extractedLocale = firstSegment;
        }
      }

      next();
    });
  };

  /**
   * Register all application routes with the Express app
   * Uses path-to-regexp v8 syntax: /{:locale} for optional locale parameter
   * @param app - Express Application instance
   */
  public registerRoutes = (app: Application): void => {
    const config = this.configManager.getConfig();
    const routes = config.deployment.routes;
    const authRoutesConfig = config.deployment.routes.auth_routes;

    // Root redirect (no locale)
    app.get('/', (_req, res) => {
      res.redirect(`${routes.auth}${authRoutesConfig.login}`);
    });

    // Root redirect with locale (using v8 optional syntax)
    // Only redirects for valid locale codes, otherwise falls through to 404
    app.get('{/:locale}', (req, res, next) => {
      const locale = req.params.locale;
      const availableLocales = config.application.locales.available;

      if (locale && availableLocales.includes(locale)) {
        // Valid locale - redirect to localized login
        res.redirect(`/${locale}${routes.auth}${authRoutesConfig.login}`);
      } else if (!locale) {
        // No locale - redirect to default login (shouldn't happen, caught by '/' route)
        res.redirect(`${routes.auth}${authRoutesConfig.login}`);
      } else {
        // Invalid locale - pass to next middleware (will 404)
        next();
      }
    });

    const authRouter = authRoutes(
      this.avatarUpload,
      this.configManager,
      this.securityMiddleware,
      this.uIMiddleware,
      this.authController,
      this.tier1CompletionService,
      this.sessionManager
    );

    const accountRouter = accountRoutes(
      this.avatarUpload,
      this.configManager,
      this.securityMiddleware,
      this.localsMiddleware,
      this.uIMiddleware,
      this.accountController
    );

    const webauthnRouter = webauthnRoutes(
      this.securityMiddleware,
      this.webauthnController
    );

    const adminRouter = adminRoutes(
      this.adminHomeController,
      this.adminUsersController,
      this.adminActivitiesController,
      this.adminOidcClientController,
      this.adminSessionsController,
      this.adminUserGrantsController,
      this.adminSettingsController,
      this.adminJwksController,
      this.adminConfigurationController,
      this.adminDataTransferController,
      this.csvUpload,
      this.securityMiddleware,
      this.localsMiddleware,
      this.configValidationMiddleware,
      this.sessionManager,
      this.platformAdminController ?? undefined
    );

    // _ops infrastructure gateway — intercepts requests when tenant is '_ops'.
    // Mounted before all other routes so _ops requests never hit auth/admin/etc.
    if (this.opsTenantMiddleware && this.opsSocialCallbackService) {
      const opsRouter = opsRoutes(
        this.opsTenantMiddleware,
        this.opsSocialCallbackService
      );
      app.use((req, res, next) => {
        const tid = tenantContext.getTenantIdSafe();
        if (tid === '_ops') {
          opsRouter(req, res, next);
          return;
        }
        next();
      });
    }

    // Management API v1 — pure JSON API, no locale prefix, own auth model
    if (this.apiV1Router) {
      // Body-parser error interceptor — catches malformed JSON and oversized
      // bodies before they reach the v1 router, returning Problem Detail JSON
      // instead of Express's default HTML error pages.
      app.use('/api/v1', ((err: any, req: any, res: any, next: any) => {
        if (err.type === 'entity.parse.failed') {
          return res
            .status(400)
            .setHeader('Content-Type', 'application/problem+json')
            .json({
              type: 'urn:parako:error:validation',
              title: 'Malformed JSON',
              status: 400,
              detail: 'Request body contains invalid JSON',
              instance: req.path,
            });
        }
        if (err.type === 'entity.too.large' || err.status === 413) {
          return res
            .status(413)
            .setHeader('Content-Type', 'application/problem+json')
            .json({
              type: 'urn:parako:error:body-too-large',
              title: 'Request Body Too Large',
              status: 413,
              detail: 'Request body exceeds maximum allowed size',
              instance: req.path,
            });
        }
        next(err);
      }) as any);
      app.use('/api/v1', this.apiV1Router);
    }

    // Routes WITHOUT locale prefix (default)
    app.use(routes.auth, authRouter);
    app.use(routes.accounts, accountRouter);
    app.use(`${routes.api}/webauthn`, webauthnRouter);
    app.use('/admin', adminRouter);

    // Routes WITH optional locale parameter (path-to-regexp v8 syntax)
    // Express will set req.params.locale when locale is present in URL
    app.use(`/{:locale}${routes.auth}`, authRouter);
    app.use(`/{:locale}${routes.accounts}`, accountRouter);
    app.use(`/{:locale}${routes.api}/webauthn`, webauthnRouter);
    app.use('/{:locale}/admin', adminRouter);
  };
}
