import { Request, Response, NextFunction } from 'express';
import Provider, { Grant } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCConsentHandler } from '../../../di/interfaces/oidc-consent-handler.interface.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';

/**
 * OIDC Consent Handler
 * Handles user consent for OIDC interactions
 */
@injectable()
export class OIDCConsentHandler implements IOIDCConsentHandler {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * POST /interaction/:uid/confirm handler
   * Processes user consent for the requested scopes and claims
   */
  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const {
        prompt: { name, details },
        params,
        session,
      } = interactionDetails;

      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      this.logger.debug('Processing consent confirmation', {
        uid: req.params.uid,
        clientId: params.client_id,
        promptName: name,
        hasSession: !!session,
        hasGrantId: !!interactionDetails.grantId,
      });

      if (!session || !session.accountId) {
        this.logger.error('Session data is missing in consent confirmation');
        return res.render(this.viewResolver.views.auth.oidc.error, {
          errorType: 'SessionNotFound',
          errorMessage:
            'Your session has expired or is invalid. Please try authenticating again.',
        });
      }

      const { accountId } = session;

      if (name !== 'consent') {
        this.logger.error('Expected consent prompt but got', {
          promptName: name,
        });
        return res.render(this.viewResolver.views.auth.oidc.error, {
          errorType: 'InvalidPrompt',
          errorMessage: 'Invalid interaction prompt. Expected consent prompt.',
        });
      }

      let { grantId } = interactionDetails;
      let grant: Grant | undefined;

      if (grantId) {
        // Modify existing grant in existing session
        grant = (await provider.Grant.find(grantId)) as Grant;
      } else {
        grant = new provider.Grant({
          accountId,
          clientId: params.client_id as string,
        }) as Grant;
      }

      if (details.missingOIDCScope && Array.isArray(details.missingOIDCScope)) {
        grant.addOIDCScope(details.missingOIDCScope.join(' '));
      }

      if (
        details.missingOIDCClaims &&
        Array.isArray(details.missingOIDCClaims)
      ) {
        grant.addOIDCClaims(details.missingOIDCClaims);
      }

      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(
          details.missingResourceScopes
        )) {
          if (Array.isArray(scopes)) {
            grant.addResourceScope(indicator, scopes.join(' '));
          }
        }
      }

      grantId = await grant.save();

      const consent: Record<string, any> = {};
      if (!interactionDetails.grantId) {
        consent.grantId = grantId;
      }

      await this.oidcUtils.syncSessionAfterConsent(req, accountId);

      try {
        this.activityService.success(
          'oidc.confirm',
          'User consented to OIDC grant',
          null,
          {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'] as string,
            client_id: params.client_id as string,
            device_infos: deviceInfos as ClientDeviceInfos,
            actor: {
              username: accountId,
              actor_type: 'user',
            },
            target: {
              target_type: 'client',
              entity_id: params.client_id as string,
            },
          }
        );
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error logging consent activity',
        });
      }

      await provider.interactionFinished(
        req,
        res,
        { consent },
        { mergeWithLastSubmission: true }
      );

      this.logger.info('Consent interaction completed successfully', {
        uid: req.params.uid,
        clientId: params.client_id,
        grantId,
      });
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error in consent handler',
      });
      next(err);
    }
  };
}
