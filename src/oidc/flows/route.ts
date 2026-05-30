import { Application, Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { setNoCache } from './middleware/cache.middleware.js';
import {
  mfaVerifyLimiter,
  loginBruteForceByIdentifierAndIp,
  loginBruteForceByIp,
} from '../../utils/rate-limiter.js';
import type { Provider } from 'oidc-provider';
import { TYPES } from '../../di/types.js';
import type { IOIDCInteractionHandler } from '../../di/interfaces/oidc-interaction-handler.interface.js';
import type { IOIDCLoginHandler } from '../../di/interfaces/oidc-login-handler.interface.js';
import type { IOIDCConsentHandler } from '../../di/interfaces/oidc-consent-handler.interface.js';
import type { IOIDCSelectAccountHandler } from '../../di/interfaces/oidc-select-account-handler.interface.js';
import type { IOIDCMfaHandler } from '../../di/interfaces/oidc-mfa-handler.interface.js';
import type { IOIDCNewDeviceVerifyHandler } from '../../di/interfaces/oidc-new-device-verify-handler.interface.js';
import type { IOIDCAbortHandler } from '../../di/interfaces/oidc-abort-handler.interface.js';
import type { IOIDCSocialLoginHandler } from '../../di/interfaces/oidc-social-login-handler.interface.js';
import type { IOIDCSocialCallbackHandler } from '../../di/interfaces/oidc-social-callback-handler.interface.js';
import type { IOIDCErrorHandler } from '../../di/interfaces/oidc-error-handler.interface.js';
import type { IOIDCWebAuthnMfaHandler } from '../../di/interfaces/oidc-webauthn-mfa-handler.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IProviderService } from '../../di/interfaces/provider-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IUserService } from '../../di/interfaces/user-service.interface.js';
import type { IMfaUtils } from '../../di/interfaces/mfa-utils.interface.js';
import type { IViewResolver } from '../../di/interfaces/view-resolver.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import { inject, injectable } from 'inversify';
import { IOidcRoutesManager } from '../../di/interfaces/oidc-routes-manager.interface.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../multi-tenancy/tenant-context.js';

@injectable()
export class OidcRoutesManager implements IOidcRoutesManager {
  /**
   * Swappable Express Router holding all OIDC interaction routes.
   * Rebuilt when the OIDC path changes via config update so that
   * path changes take effect without restarting the application.
   */
  private interactionRouter: ReturnType<typeof Router> | null = null;

  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ProviderService)
    private readonly providerService: IProviderService,
    @inject(TYPES.OIDCErrorHandler) private readonly error: IOIDCErrorHandler,
    @inject(TYPES.OIDCAbortHandler) private readonly abort: IOIDCAbortHandler,
    @inject(TYPES.OIDCSocialCallbackHandler)
    private readonly socialCb: IOIDCSocialCallbackHandler,
    @inject(TYPES.OIDCSocialLoginHandler)
    private readonly socialLogin: IOIDCSocialLoginHandler,
    @inject(TYPES.OIDCMfaHandler) private readonly mfa: IOIDCMfaHandler,
    @inject(TYPES.OIDCNewDeviceVerifyHandler)
    private readonly newDeviceVerify: IOIDCNewDeviceVerifyHandler,
    @inject(TYPES.OIDCSelectAccountHandler)
    private readonly selectAccount: IOIDCSelectAccountHandler,
    @inject(TYPES.OIDCConsentHandler)
    private readonly consent: IOIDCConsentHandler,
    @inject(TYPES.OIDCLoginHandler) private readonly login: IOIDCLoginHandler,
    @inject(TYPES.OIDCInteractionHandler)
    private readonly interaction: IOIDCInteractionHandler,
    @inject(TYPES.OIDCWebAuthnMfaHandler)
    private readonly webauthnMfa: IOIDCWebAuthnMfaHandler,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.UserService)
    private readonly userService: IUserService,
    @inject(TYPES.MfaUtils)
    private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.ViewResolver)
    private readonly viewResolver: IViewResolver,
    @inject(TYPES.Logger)
    private readonly logger: ILogger
  ) {}

  /**
   * Resolve the OIDC Provider for the current request's tenant.
   * Single-tenant mode: returns the existing provider (one field access).
   * Multi-tenant mode: delegates to TenantProviderRegistry via ProviderService.
   */
  private async resolveProvider(): Promise<Provider> {
    const tenantId = tenantContext.getTenantId();

    // In multi-tenant mode, DEFAULT_TENANT_ID without an active ALS store
    // signals a middleware ordering bug — tenant context middleware must run
    // before OIDC routes. Failing fast prevents silent cross-tenant leaks (HIGH-2).
    const config = this.configManager.getConfig();
    if (
      config.features.multi_tenancy.enabled &&
      tenantId === DEFAULT_TENANT_ID &&
      !tenantContext.getStore()
    ) {
      throw new Error(
        '[OidcRoutesManager] No tenant context in multi-tenant mode. ' +
          'Ensure TenantContextMiddleware runs before OIDC routes.'
      );
    }

    return this.providerService.getProviderForTenant(tenantId);
  }

  /**
   * Build a fresh Express Router with all OIDC interaction routes
   * using the current oidcPath from config.
   */
  private buildInteractionRouter(): ReturnType<typeof Router> {
    const router = Router();
    const oidcPath = this.configManager.getConfig().oidc.path;

    router.get(
      `${oidcPath}/interaction/:uid`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.interaction.handle(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/login - Handle login form submission
    router.post(
      `${oidcPath}/interaction/:uid/login`,
      setNoCache,
      loginBruteForceByIp,
      loginBruteForceByIdentifierAndIp,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.login.handle(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/confirm - Handle consent confirmation
    router.post(
      `${oidcPath}/interaction/:uid/confirm`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.consent.handle(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/select_account - Handle account selection
    router.post(
      `${oidcPath}/interaction/:uid/select_account`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.selectAccount.handle(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/mfa - Handle MFA verification
    router.post(
      `${oidcPath}/interaction/:uid/mfa`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.mfa.handle(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/webauthn/options - Get WebAuthn authentication options
    router.post(
      `${oidcPath}/interaction/:uid/webauthn/options`,
      setNoCache,
      mfaVerifyLimiter,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.webauthnMfa.getOptions(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/webauthn/verify - Verify WebAuthn authentication
    router.post(
      `${oidcPath}/interaction/:uid/webauthn/verify`,
      setNoCache,
      mfaVerifyLimiter,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.webauthnMfa.verify(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    router.get(
      `${oidcPath}/interaction/:uid/mfa/select`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const { uid } = req.params;
          const pendingUser = this.sessionManager.get(
            req,
            'pendingMfaUser'
          ) as {
            username: string;
            email: string;
          } | null;

          if (!pendingUser) {
            return res.redirect(`${oidcPath}/interaction/${uid}`);
          }

          const user = await this.userService.findByUsername(
            pendingUser.username
          );
          if (!user) {
            return res.redirect(`${oidcPath}/interaction/${uid}`);
          }

          const enabledMethods = this.mfaUtils.getEnabledMethods(user);

          // Resolve provider ONCE at top — reuse throughout (HIGH-4).
          // Resolving twice with async ops between invocations could yield
          // different providers if a pool eviction occurs mid-request.
          const provider = await this.resolveProvider();

          // If multiple methods, show selection page
          if (enabledMethods.length > 1) {
            const details = await provider.interactionDetails(req, res);
            const { params } = details;
            const clientId = params.client_id;
            const client = clientId
              ? await provider.Client.find(clientId as string)
              : null;

            return res.render(this.viewResolver.views.auth.oidc.mfa_select, {
              client,
              uid,
              params,
              title: `Choose Verification - ${this.configManager.getConfig().application.title}`,
              enabledMethods: {
                totp: enabledMethods.includes('totp'),
                email: enabledMethods.includes('email'),
                webauthn: enabledMethods.includes('webauthn'),
              },
              selectUrl: `${oidcPath}/interaction/${uid}/mfa/select`,
              csrfToken: this.sessionManager.get(req, 'csrfToken'),
            });
          }

          const details = await provider.interactionDetails(req, res);
          this.sessionManager.set(req, 'oidcRecoveryIntent', {
            uid,
            clientId: details.params.client_id,
            redirectUri: details.params.redirect_uri,
            scope: details.params.scope,
            state: details.params.state,
            nonce: details.params.nonce,
            timestamp: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
          });

          // No other methods available, show no-fallback page
          return res.render(this.viewResolver.views.auth.oidc.mfa_no_fallback, {
            uid,
            title: `Cannot Complete Login - ${this.configManager.getConfig().application.title}`,
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          });
        } catch (error) {
          this.logger.error('Error in MFA select GET handler', { error });
          next(error);
        }
      }
    );

    // POST /interaction/:uid/mfa/select - Handle MFA method selection
    router.post(
      `${oidcPath}/interaction/:uid/mfa/select`,
      setNoCache,
      (req: Request, res: Response) => {
        const { uid } = req.params;
        const { method } = req.body;

        this.sessionManager.set(req, 'selectedMfaMethod', method);

        return res.redirect(`${oidcPath}/interaction/${uid}`);
      }
    );

    router.get(
      `${oidcPath}/interaction/:uid/new-device-verify`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.newDeviceVerify.handleGet(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    // POST /interaction/:uid/new-device-verify - Handle new device verification
    router.post(
      `${oidcPath}/interaction/:uid/new-device-verify`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.newDeviceVerify.handlePost(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    router.get(
      `${oidcPath}/social/:provider`,
      setNoCache,
      (req: Request, res: Response, next: NextFunction) =>
        this.socialLogin.handle(req, res, next)
    );

    router.get(
      `${oidcPath}/social/:provider/callback`,
      setNoCache,
      (req: Request, res: Response, next: NextFunction) =>
        this.socialCb.handle(req, res, next)
    );

    router.get(
      `${oidcPath}/interaction/:uid/abort`,
      setNoCache,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const provider = await this.resolveProvider();
          await this.abort.handle(req, res, next, provider);
        } catch (error) {
          next(error);
        }
      }
    );

    return router;
  }

  /**
   * Register all OIDC interaction routes.
   * Uses a swappable Router so that OIDC path changes via admin portal
   * take effect without restarting the application.
   * Provider is resolved per-request from ProviderService (tenant-aware).
   * @param app - Express Application instance
   */
  public registerRoutes = (app: Application): void => {
    this.interactionRouter = this.buildInteractionRouter();

    // When the router is rebuilt (on config change), new requests
    // automatically use the updated routes with the new oidcPath.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (this.interactionRouter) {
        this.interactionRouter(req, res, next);
      } else {
        next();
      }
    });

    // Error handler middleware for OIDC Provider routes
    app.use((err: any, req: any, res: any, next: any) =>
      this.error.handle(err, req, res, next)
    );

    // This runs after ProviderService has already recreated/shutdown providers
    // (ProviderService subscribes in its constructor, which runs before this).
    this.configManager.subscribe('OidcRoutesManager', async () => {
      this.logger.info(
        'Rebuilding OIDC interaction routes for updated configuration'
      );
      this.interactionRouter = this.buildInteractionRouter();
    });
  };
}
