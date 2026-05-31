import { Request, Response, NextFunction } from 'express';
import Provider, { InteractionResults } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { z } from 'zod';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IOIDCAbortHandler } from '../../../di/interfaces/oidc-abort-handler.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import { activityLoggerFor } from '../../../utils/activity-logger.factory.js';
import { oidcUidParamsSchema } from '../../../validators/oidc/handlers.js';

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
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager
  ) {}

  private get activityLoggerDeps() {
    return {
      activityService: this.activityService,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

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
      const params = oidcUidParamsSchema.parse(req.params);
      const result: InteractionResults = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };

      try {
        activityLoggerFor(this.activityLoggerDeps, req).warning(
          'oidc.abort',
          null,
          'User aborted OIDC interaction',
          {
            actor: { actor_type: 'anonymous' },
            target: { target_type: 'none' },
          }
        );
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error logging abort activity',
        });
      }

      this.logger.debug('User aborted OIDC interaction', { uid: params.uid });
      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        this.logger.warn('OIDC abort received invalid input', {
          issues: err.issues,
        });
        res.status(400).render('auth/oidc/error.njk', {
          title: 'Invalid Request',
          error:
            'The request could not be processed. Please return to the previous page and try again.',
          redirectUrl: '/auth/login',
        });
        return;
      }
      this.logger.error('Error in abort handler', { error: err });
      next(err);
    }
  };
}
