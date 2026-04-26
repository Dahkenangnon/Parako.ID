import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IOIDCSocialLoginHandler } from '../../../di/interfaces/oidc-social-login-handler.interface.js';
import { type SocialProvider } from '../../../types/social-integration.js';
import type { ISocialLoginManager } from '../../../di/interfaces/social-login-manager.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';

/**
 * OIDC Social Login Handler
 * Initiates social login for OIDC flow
 */
@injectable()
export class OIDCSocialLoginHandler implements IOIDCSocialLoginHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

  /**
   * GET /oidc/social/:provider handler
   * Initiates social login for OIDC flow
   */
  handle = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;
      const { uid, client_id, prompt, acr_values, ...otherParams } = req.query;

      if (!uid || !client_id) {
        this.logger.warn('OIDC social login missing required parameters', {
          provider,
          uid,
          client_id,
          query: req.query,
        });
        return res.status(400).render('auth/oidc/error.njk', {
          title: 'Invalid Request',
          error: 'Missing required OIDC parameters',
          redirectUrl: `${this.oidcPath}/interaction/${uid}`,
        });
      }

      if (!this.socialLoginManager.isProviderAvailable(provider)) {
        this.logger.warn(
          'OIDC social login attempted with unavailable provider',
          {
            provider,
            uid,
            client_id,
          }
        );
        return res.status(400).render('auth/oidc/error.njk', {
          title: 'Provider Not Available',
          error: `${provider} login is not available`,
          redirectUrl: `${this.oidcPath}/interaction/${uid}`,
        });
      }

      this.sessionManager.set(req, 'oidcSocialContext', {
        uid: uid as string,
        client_id: client_id as string,
        prompt: prompt as string,
        acr_values: acr_values as string,
        otherParams,
        timestamp: Date.now(),
      });

      this.logger.info('OIDC social login initiated', {
        provider,
        uid,
        client_id,
        prompt,
      });

      const authUrl = await this.socialLoginManager.getAuthorizationUrl(
        provider,
        req
      );

      res.redirect(authUrl);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_social_login_initiation_failed',
        provider: req.params.provider,
      });

      const uid = req.query.uid as string;
      return res.status(500).render('auth/oidc/error.njk', {
        title: 'Social Login Error',
        error: 'Failed to initiate social login. Please try again.',
        redirectUrl: uid
          ? `${this.oidcPath}/interaction/${uid}`
          : '/auth/login',
      });
    }
  };
}
