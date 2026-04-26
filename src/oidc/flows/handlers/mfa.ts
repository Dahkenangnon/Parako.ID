import { Request, Response, NextFunction } from 'express';
import Provider from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../../di/interfaces/user-service.interface.js';
import type { IAuthService } from '../../../di/interfaces/auth-service.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCMfaHandler } from '../../../di/interfaces/oidc-mfa-handler.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { IMfaUtils } from '../../../di/interfaces/mfa-utils.interface.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';

/**
 * OIDC MFA Handler
 * Handles MFA verification for OIDC interactions
 */
@injectable()
export class OIDCMfaHandler implements IOIDCMfaHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

  /**
   * POST /interaction/:uid/mfa handler
   * Handles MFA verification for OIDC interactions
   */
  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const { uid } = req.params;
      const interactionDetails = await provider.interactionDetails(req, res);
      const { session, params } = interactionDetails;

      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      if (!session?.accountId) {
        this.logger.error('MFA route without valid session');
        return res.render(this.viewResolver.views.auth.oidc.error, {
          errorType: 'SessionNotFound',
          errorMessage: 'Session expired. Please login again.',
        });
      }

      const validation = this.oidcUtils.validateMfaCode(req);
      if (!validation.isValid) {
        this.sessionManager.flash(req).error('Code is required');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      let verified = false;
      let userDoc = null;
      let mfaMethod: string | null = null;

      try {
        userDoc = await this.userService.findByUsername(session.accountId);
        if (!userDoc) {
          this.logger.warn('User not found for MFA verification', {
            accountId: session.accountId,
          });
          verified = false;
        } else {
          const requestedMethod = req.body.method as string | undefined;
          mfaMethod =
            requestedMethod || this.mfaUtils.getPreferredMethod(userDoc);

          if (mfaMethod === 'totp') {
            verified = await this.authService.verifyTotp(
              session.accountId,
              validation.code!
            );
          } else if (mfaMethod === 'email') {
            verified = await this.userService.verifyEmailOtp(
              session.accountId,
              validation.code!
            );
          } else {
            this.logger.warn(
              'MFA verification attempted for unsupported method',
              {
                accountId: session.accountId,
                method: mfaMethod,
                mfaEnabled: this.mfaUtils.isMfaEnabled(userDoc),
              }
            );
            verified = false;
          }
        }
      } catch (err) {
        const error = err as Error;
        this.logger.error(error, {
          context: 'OTP verification error',
          accountId: session.accountId,
          errorMessage: error.message,
        });
      }

      if (!verified) {
        try {
          this.activityService.failed(
            'oidc.mfa.verification',
            'Invalid or expired MFA code',
            null,
            {
              ip_address: req.ip,
              user_agent: req.headers['user-agent'] as string,
              client_id: params.client_id as string,
              device_infos: deviceInfos as ClientDeviceInfos,
              actor: {
                username: session.accountId,
                actor_type: 'user',
              },
              target: {
                target_type: 'none',
              },
            }
          );
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'Error logging failed MFA activity',
          });
        }

        this.sessionManager.flash(req).error('Invalid or expired code');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      const existingAmr = session.amr || ['pwd'];
      const updatedAmr = existingAmr.includes('otp')
        ? existingAmr
        : [...existingAmr, 'otp'];

      try {
        this.activityService.success(
          'oidc.mfa.verification',
          'MFA verification successful',
          userDoc!,
          {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'] as string,
            client_id: params.client_id as string,
            device_infos: deviceInfos as ClientDeviceInfos,
            actor: userDoc!,
            target: {
              target_type: 'none',
            },
          }
        );
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error logging successful MFA activity',
        });
      }

      await provider.interactionFinished(
        req,
        res,
        {
          login: {
            accountId: session.accountId,
            acr: 'urn:mfa:otp',
            amr: updatedAmr,
          },
          ts: Math.floor(Date.now() / 1000),
        },
        { mergeWithLastSubmission: true }
      );

      this.logger.info('MFA verified and interaction completed', {
        uid,
        accountId: session.accountId,
      });
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error in MFA handler',
      });
      next(err);
    }
  };
}
