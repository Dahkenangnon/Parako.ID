import { Request, Response, NextFunction } from 'express';
import Provider from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { z } from 'zod';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IAuthService } from '../../../di/interfaces/auth-service.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { INotificationService } from '../../../di/interfaces/notification-service.interface.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { SessionUserAccount } from '../../../types/session-data.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import { activityLoggerFor } from '../../../utils/activity-logger.factory.js';
import {
  oidcNewDeviceVerifyBodySchema,
  oidcUidParamsSchema,
} from '../../../validators/oidc/handlers.js';

const NEW_DEVICE_VERIFICATION_TTL_MS = 10 * 60 * 1000;

interface PendingNewDeviceVerification {
  userId: string;
  username: string;
  email?: string;
  method: 'totp' | 'email';
  userAccount: SessionUserAccount;
  device_info: {
    is_new_device: boolean;
    confidence_score: number;
    risk_level: string;
  };
  interactionUid: string;
  clientId: string;
  created_at: number;
}

export interface IOIDCNewDeviceVerifyHandler {
  handleGet(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;
  handlePost(
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void>;
}

@injectable()
export class OIDCNewDeviceVerifyHandler implements IOIDCNewDeviceVerifyHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

  private get activityLoggerDeps() {
    return {
      activityService: this.activityService,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

  handleGet = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const { uid } = oidcUidParamsSchema.parse(req.params);
      const pendingVerification =
        this.sessionManager.get<PendingNewDeviceVerification>(
          req,
          'pendingNewDeviceVerification'
        );

      if (!pendingVerification || pendingVerification.interactionUid !== uid) {
        // No pending verification, redirect to login
        this.logger.debug('No pending new device verification found', { uid });
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      if (this.isPendingVerificationExpired(pendingVerification)) {
        this.logger.debug('Pending new device verification expired', { uid });
        this.sessionManager.remove(req, 'pendingNewDeviceVerification');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      const client = await provider.Client.find(pendingVerification.clientId);

      return res.render(this.viewResolver.views.auth.oidc.newDeviceVerify, {
        title: `Verify New Device - ${this.configManager.getConfig().application.title}`,
        method: pendingVerification.method,
        email: pendingVerification.email,
        maskedEmail: this.maskEmail(pendingVerification.email || ''),
        device_info: pendingVerification.device_info,
        uid,
        client,
        csrfToken: this.sessionManager.get(req, 'csrfToken'),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        this.logger.warn('New device verification GET received invalid input', {
          issues: err.issues,
        });
        res.status(400).render(this.viewResolver.views.auth.oidc.error, {
          errorType: 'InvalidRequest',
          errorMessage:
            'The request could not be processed. Please return to the previous page and try again.',
        });
        return;
      }
      this.logger.error(err as Error, {
        context: 'New device verification GET error',
      });
      next(err);
    }
  };

  handlePost = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const { uid } = oidcUidParamsSchema.parse(req.params);
      const { code, trust_this_device } = oidcNewDeviceVerifyBodySchema.parse(
        req.body
      );
      const pendingVerification =
        this.sessionManager.get<PendingNewDeviceVerification>(
          req,
          'pendingNewDeviceVerification'
        );

      if (!pendingVerification || pendingVerification.interactionUid !== uid) {
        this.logger.debug('No pending verification on POST', { uid });
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      if (this.isPendingVerificationExpired(pendingVerification)) {
        this.logger.debug('Pending new device verification expired', { uid });
        this.sessionManager.remove(req, 'pendingNewDeviceVerification');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      let isValid = false;

      if (pendingVerification.method === 'totp') {
        isValid = await this.authService.verifyTotp(
          pendingVerification.username,
          code
        );
      } else {
        isValid = await this.authService.verifyEmailOtp(
          pendingVerification.userId,
          code
        );
      }

      if (!isValid) {
        const client = await provider.Client.find(pendingVerification.clientId);

        this.sessionManager
          .flash(req)
          .error('Invalid verification code. Please try again.');

        return res.render(this.viewResolver.views.auth.oidc.newDeviceVerify, {
          title: `Verify New Device - ${this.configManager.getConfig().application.title}`,
          method: pendingVerification.method,
          email: pendingVerification.email,
          maskedEmail: this.maskEmail(pendingVerification.email || ''),
          device_info: pendingVerification.device_info,
          uid,
          client,
          csrfToken: this.sessionManager.get(req, 'csrfToken'),
        });
      }

      // Verification successful - clear pending state
      this.sessionManager.remove(req, 'pendingNewDeviceVerification');

      const clientDetails =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      const config = this.configManager.getConfig();
      const trustDurationDays =
        config.security.protection.device_matching.trust_duration_days || 30;

      const shouldTrustDevice = trust_this_device === 'true';
      const verifiedAt = Date.now();
      const deviceTrust = shouldTrustDevice
        ? {
            trusted: true,
            trusted_at: new Date(verifiedAt),
            trusted_until: new Date(
              verifiedAt + trustDurationDays * 24 * 60 * 60 * 1000
            ),
            fingerprint: clientDetails.fingerprint,
          }
        : undefined;

      activityLoggerFor(this.activityLoggerDeps, req).success(
        'new_device_verified',
        {
          id: pendingVerification.userId,
          username: pendingVerification.username,
        },
        shouldTrustDevice
          ? `New device verified and trusted for ${trustDurationDays} days`
          : 'New device verified successfully',
        {
          actor: {
            username: pendingVerification.username,
            actor_type: 'user',
          },
          target: { target_type: 'session' },
          device_infos: {
            fingerprint: clientDetails.fingerprint,
            browser: clientDetails.browser,
            os: clientDetails.os,
            device: clientDetails.device,
            ...(deviceTrust && { device_trust: deviceTrust }),
          },
        }
      );

      try {
        await this.sessionManager.regenerate(req);
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to regenerate session after new device verification',
        });
      }

      const sessionSuccess = this.oidcUtils.addOrUpdateAccountInSession(
        req,
        pendingVerification.userAccount,
        true
      );

      if (!sessionSuccess) {
        this.sessionManager.setAuthenticated(req, {
          currentActiveLoggedUser: pendingVerification.userAccount,
        });
      }

      try {
        await this.sessionManager.enforceSessionLimit(
          pendingVerification.username,
          req.session?.id
        );
      } catch (err) {
        this.logger.error(err as Error, {
          context:
            'Failed to enforce session limit after new device verification',
        });
      }

      const result = {
        login: {
          accountId: pendingVerification.username,
          amr:
            pendingVerification.method === 'totp'
              ? ['pwd', 'otp']
              : ['pwd', 'email'],
          remember: false,
        },
      };

      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        this.logger.warn(
          'New device verification POST received invalid input',
          {
            issues: err.issues,
          }
        );
        res.status(400).render(this.viewResolver.views.auth.oidc.error, {
          errorType: 'InvalidRequest',
          errorMessage:
            'The request could not be processed. Please return to the previous page and try again.',
        });
        return;
      }
      this.logger.error(err as Error, {
        context: 'New device verification POST error',
      });
      next(err);
    }
  };

  private maskEmail(email: string): string {
    if (!email || !email.includes('@')) return email;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 4))}@${domain}`;
  }

  private isPendingVerificationExpired(
    pendingVerification: PendingNewDeviceVerification
  ): boolean {
    const age = Date.now() - pendingVerification.created_at;
    return (
      !Number.isFinite(pendingVerification.created_at) ||
      age < 0 ||
      age > NEW_DEVICE_VERIFICATION_TTL_MS
    );
  }
}

export default OIDCNewDeviceVerifyHandler;
