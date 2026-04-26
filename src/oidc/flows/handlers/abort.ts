import { Request, Response, NextFunction } from 'express';
import Provider, { InteractionResults } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IOIDCAbortHandler } from '../../../di/interfaces/oidc-abort-handler.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';

/**
 * OIDC Abort Handler
 * Handles user abort of OIDC interactions
 */
@injectable()
export class OIDCAbortHandler implements IOIDCAbortHandler {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * GET /interaction/:uid/abort handler
   * Redirects user agent to the client application with access_denied error
   */
  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const result: InteractionResults = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };
      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      try {
        this.activityService.warning(
          'oidc.abort',
          'User aborted OIDC interaction',
          null,
          {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'] as string,
            device_infos: deviceInfos as ClientDeviceInfos,
            actor: {
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
            },
          }
        );
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error logging abort activity',
        });
      }

      this.logger.debug('User aborted OIDC interaction', {
        uid: req.params.uid,
      });
      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      this.logger.error('Error in abort handler', { error: err });
      next(err);
    }
  };
}
