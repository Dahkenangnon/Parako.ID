import {
  Express,
  Request,
  Response,
  NextFunction,
  type RequestHandler,
} from 'express';
import { Provider } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { IOIDCMiddleware } from '../../../di/interfaces/oidc-middleware.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { IAuthService } from '../../../di/interfaces/auth-service.interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import { SessionUserAccount } from '../../../utils/session.js';
import { KoaContextWithOIDC } from 'oidc-provider';

/**
 * OIDC Middleware Service
 * Handles OIDC-specific middleware functionality including session management and authentication
 */
@injectable()
export class OIDCMiddleware implements IOIDCMiddleware {
  constructor(
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.Logger) private readonly logger: ILogger
  ) {}

  /**
   * Safely destroy session with error handling
   */
  safelyDestroySession = async (
    req: Request,
    callback: () => void
  ): Promise<void> => {
    try {
      await this.sessionManager.destroy(req);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error destroying session',
      });
    } finally {
      callback();
    }
  };

  /**
   * Apply OIDC middleware to Express app
   */
  applyOidcMiddleware = (app: Express, provider: Provider): RequestHandler => {
    if (!app || !provider) {
      throw new Error(
        'applyOidcMiddleware requires both app and provider parameters'
      );
    }

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const isAuthenticated = await this.sessionManager.isAuthenticated(req);

        res.locals = res.locals || {};

        const oidcContext = provider.createContext(req, res);
        let oidcSession;

        try {
          oidcSession = await provider.Session.get(oidcContext);
        } catch (sessionError) {
          this.logger.error(sessionError as Error, {
            context: 'Error retrieving OIDC session',
          });
          oidcSession = null;
        }

        const isOidcAuthenticated = !!oidcSession?.accountId;

        if (oidcSession) {
          if (oidcSession.accountId)
            this.sessionManager.set(
              req,
              'oidcAccountId',
              oidcSession.accountId
            );
          if (oidcSession.loginTs)
            this.sessionManager.set(req, 'oidcLoginTs', oidcSession.loginTs);
          if (oidcSession.uid)
            this.sessionManager.set(req, 'oidcUid', oidcSession.uid);
          if (oidcSession.authorizations)
            this.sessionManager.set(
              req,
              'oidcAuthorizations',
              oidcSession.authorizations
            );
          if (oidcSession.jti)
            this.sessionManager.set(req, 'oidcJti', oidcSession.jti);
        }

        if (isOidcAuthenticated && !isAuthenticated && oidcSession?.accountId) {
          try {
            const userData = await this.authService.findUserByUsername(
              oidcSession.accountId
            );

            if (userData) {
              const userAccount: SessionUserAccount = {
                id: userData._id?.toString() || userData.id?.toString() || '',
                username: userData.username || '',
                email: userData.email || '',
                given_name: userData.given_name || '',
                family_name: userData.family_name || '',
                full_name:
                  `${userData.given_name || ''} ${userData.family_name || ''}`.trim(),
                roles: userData.roles || [],
                picture: userData.picture || '',
                is_admin:
                  Array.isArray(userData.roles) &&
                  (userData.roles.includes('admin') ||
                    userData.roles.includes('superadmin')),
                last_used: Date.now(),
              };

              this.sessionManager.setAuthenticated(req, {
                currentActiveLoggedUser: userAccount,
              });

              this.logger.info(
                `User ${userAccount.username} (${userAccount.full_name}) authenticated via OIDC`
              );
            } else {
              this.logger.warn(
                `User with accountId ${oidcSession.accountId} not found`
              );
            }
          } catch (error) {
            this.logger.error(error as Error, {
              context: 'Error retrieving user data',
            });
          }
        }

        next();
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'OIDC middleware error',
        });
        await this.safelyDestroySession(req, () => {
          next(error);
        });
      }
    };
  };

  /**
   * Post-processing middleware for OIDC flows
   * Executes after the OIDC provider has processed the request
   */
  postMiddleware = async (ctx: KoaContextWithOIDC): Promise<void> => {
    // Do any action after the OIDC provider has processed the request

    this.logger.info('oidc_post_processing', {
      endpoint: ctx.path,
      method: ctx.method,
      client_id: ctx.oidc?.client?.clientId,
      session_id: ctx.oidc?.session?.uid,
      ip_address: ctx.ip,
      user_agent: ctx.get('user-agent'),
      timestamp: new Date().toISOString(),
    });
  };

  /**
   * Pre-processing middleware for OIDC flows
   * Executes before the OIDC provider processes the request
   */
  preMiddleware = async (ctx: KoaContextWithOIDC): Promise<void> => {
    this.logger.info('oidc_pre_processing', {
      endpoint: ctx.path,
      method: ctx.method,
      client_id: ctx.oidc?.client?.clientId,
      session_id: ctx.oidc?.session?.uid,
      ip_address: ctx.ip,
      user_agent: ctx.get('user-agent'),
      timestamp: new Date().toISOString(),
    });

    // Do any action before the OIDC provider processes the request
  };
}
