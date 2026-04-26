import { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCSocialCallbackHandler } from '../../../di/interfaces/oidc-social-callback-handler.interface.js';
import type { ISocialLoginManager } from '../../../di/interfaces/social-login-manager.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { INotificationService } from '../../../di/interfaces/notification-service.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { IGeolocationService } from '../../../di/interfaces/geolocation-service.interface.js';
import type { IIPReputationService } from '../../../di/interfaces/ip-reputation-service.interface.js';
import type { IAuthService } from '../../../di/interfaces/auth-service.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';
import { type SocialProvider } from '../../../types/social-integration.js';
import type { IMfaUtils } from '../../../di/interfaces/mfa-utils.interface.js';
import type { IMetricsService } from '../../../di/interfaces/metrics-service.interface.js';
import type { OIDCSocialContext } from '../../../types/session-data.js';

/**
 * OIDC Social Callback Handler
 * Handles social login callback for OIDC flow
 */
@injectable()
export class OIDCSocialCallbackHandler implements IOIDCSocialCallbackHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.GeolocationService)
    private readonly geolocationService: IGeolocationService,
    @inject(TYPES.IPReputationService)
    private readonly ipReputationService: IIPReputationService,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.MetricsService)
    private readonly metricsService: IMetricsService
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

  /**
   * GET /oidc/social/:provider/callback handler
   * Handles social login callback for OIDC flow
   */
  handle = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;

      const oidcContext = this.sessionManager.get<OIDCSocialContext>(
        req,
        'oidcSocialContext'
      );
      if (!oidcContext) {
        this.logger.warn('OIDC social callback without context', {
          provider,
          query: req.query,
        });
        return res.status(400).render('auth/oidc/error.njk', {
          title: 'Session Expired',
          error: 'Social login session expired. Please try again.',
          redirectUrl: '/auth/login',
        });
      }

      const sessionAge = Date.now() - oidcContext.timestamp;
      if (sessionAge > 10 * 60 * 1000) {
        this.logger.warn('OIDC social callback session expired', {
          provider,
          sessionAge,
          uid: oidcContext.uid,
        });
        this.sessionManager.remove(req, 'oidcSocialContext');
        return res.status(400).render('auth/oidc/error.njk', {
          title: 'Session Expired',
          error: 'Social login session expired. Please try again.',
          redirectUrl: `${this.oidcPath}/interaction/${oidcContext.uid}`,
        });
      }

      this.logger.info('OIDC social callback processing', {
        provider,
        uid: oidcContext.uid,
        client_id: oidcContext.client_id,
      });

      const result = await this.socialLoginManager.handleCallback(
        provider,
        req
      );

      if (!result.success) {
        this.logger.error('OIDC social callback failed', {
          provider,
          error: result.error,
          uid: oidcContext.uid,
        });
        this.metricsService.recordFederationLogin(provider, 'failure');

        const failedDeviceInfos =
          this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);
        this.activityService.failed(
          'oidc_social_login_failed',
          `Social login with ${provider} failed`,
          null,
          {
            ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            device_infos: failedDeviceInfos as ClientDeviceInfos,
            actor: {
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
              entity_data: {
                provider,
                errorMessage: result.error,
                requiresLinking: result.requiresLinking,
              },
            },
          }
        );

        this.sessionManager.remove(req, 'oidcSocialContext');

        return res.render(this.viewResolver.views.auth.oidc.error, {
          title: 'Social Authentication Failed',
          error:
            result.error || 'Social authentication failed. Please try again.',
          redirectUrl: `${this.oidcPath}/interaction/${oidcContext.uid}`,
        });
      }

      if (!result.user) {
        this.logger.error('OIDC social callback no user found', {
          provider,
          uid: oidcContext.uid,
        });

        this.sessionManager.remove(req, 'oidcSocialContext');

        return res.render(this.viewResolver.views.auth.oidc.error, {
          title: 'User Not Found',
          error: 'User not found after social authentication',
          redirectUrl: `${this.oidcPath}/interaction/${oidcContext.uid}`,
        });
      }

      const userAccount = {
        id: result.user._id?.toString() || '',
        username: result.user.username,
        email: result.user.email,
        email_verified: result.user.email_verified || false,
        given_name: result.user.given_name || '',
        family_name: result.user.family_name || '',
        full_name:
          `${result.user.given_name || ''} ${result.user.family_name || ''}`.trim(),
        picture: result.user.picture || '',
        roles: result.user.roles || ['user'],
        is_admin:
          result.user.roles &&
          (result.user.roles.includes('admin') ||
            result.user.roles.includes('superadmin')),
        last_used: Date.now(),
        phone_number: result.user.phone_number || '',
        phone_number_verified: result.user.phone_number_verified || false,
      };

      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      const sessionConfig =
        this.configManager.getConfig().security?.authentication?.session;
      if (sessionConfig?.require_2fa_for_new_device) {
        const clientDetails =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        const oldDevices = await this.activityService.getDeviceHistoryForUser(
          result.user._id as string
        );

        const deviceMatch = this.clientDeviceInfoManager.evaluateDeviceMatch(
          clientDetails,
          oldDevices
        );
        const confidenceThreshold =
          sessionConfig.new_device_confidence_threshold ?? 70;

        const additionalRiskFactors: string[] = [];

        if (this.ipReputationService.isEnabled()) {
          try {
            const ipReputation =
              await this.ipReputationService.checkIPReputation(
                clientDetails.ip
              );
            if (ipReputation.success) {
              if (
                ipReputation.isVPN ||
                ipReputation.isProxy ||
                ipReputation.isTor
              ) {
                additionalRiskFactors.push('vpn_detected');
                this.logger.info('VPN/Proxy/Tor detected during social login', {
                  username: result.user.username,
                  ip: clientDetails.ip,
                  provider,
                });
              }
              if (
                ipReputation.riskLevel === 'high' ||
                ipReputation.riskLevel === 'critical'
              ) {
                additionalRiskFactors.push('high_fraud_score');
              }
            }
          } catch (err) {
            this.logger.debug('IP reputation check failed, continuing', {
              error: (err as Error).message,
            });
          }
        }

        if (this.geolocationService.isEnabled() && oldDevices.length > 0) {
          try {
            const currentLocation =
              await this.geolocationService.getLocationFromIP(clientDetails.ip);

            if (currentLocation.success) {
              if (this.geolocationService.isHighRiskRegion(currentLocation)) {
                additionalRiskFactors.push('high_risk_region');
              }

              const lastDevice = oldDevices[0];
              if (lastDevice?.ip) {
                const previousLocation =
                  await this.geolocationService.getLocationFromIP(
                    lastDevice.ip
                  );

                if (previousLocation.success) {
                  const timeDiffMinutes = 60;
                  const travelResult =
                    this.geolocationService.checkImpossibleTravel(
                      previousLocation,
                      currentLocation,
                      timeDiffMinutes
                    );

                  if (travelResult.isImpossible) {
                    additionalRiskFactors.push('impossible_travel');
                    this.logger.warn(
                      'Impossible travel detected in social login',
                      {
                        username: result.user.username,
                        provider,
                        distanceKm: travelResult.distanceKm,
                      }
                    );
                  }
                }
              }
            }
          } catch (err) {
            this.logger.debug('Geolocation check failed, continuing', {
              error: (err as Error).message,
            });
          }
        }

        const needsVerification =
          deviceMatch.is_new_device ||
          deviceMatch.requires_2fa ||
          deviceMatch.confidence_score < confidenceThreshold ||
          additionalRiskFactors.length > 0;

        if (needsVerification) {
          // since TOTP may not be set up
          let verifyMethod: 'totp' | 'email' = 'email';
          if (this.mfaUtils.isTotpEnabled(result.user)) {
            verifyMethod = 'totp';
          }

          // If email method, generate and send OTP
          if (verifyMethod === 'email') {
            try {
              const { code } = await this.authService.generateEmailOtp(
                userAccount.id
              );
              await this.notificationService.sendOtp(
                { email: result.user.email!, username: result.user.username },
                code,
                {
                  deviceInfo: deviceInfos?.user_agent || 'Unknown Device',
                  ip: clientDetails.ip,
                }
              );
            } catch (err) {
              this.logger.error(err as Error, {
                context: 'Failed to send new device OTP for social login',
                username: result.user.username,
              });
            }
          }

          this.sessionManager.set(req, 'pendingNewDeviceVerification', {
            userId: userAccount.id,
            username: userAccount.username,
            email: userAccount.email,
            method: verifyMethod,
            userAccount,
            device_info: {
              is_new_device: deviceMatch.is_new_device,
              confidence_score: deviceMatch.confidence_score,
              risk_level: deviceMatch.risk_level,
              additional_risk_factors: additionalRiskFactors,
            },
            interactionUid: oidcContext.uid,
            clientId: oidcContext.client_id,
            created_at: Date.now(),
            socialProvider: provider,
          });

          this.logger.info('Redirecting social login to device verification', {
            provider,
            username: result.user.username,
            is_new_device: deviceMatch.is_new_device,
            confidence_score: deviceMatch.confidence_score,
            additional_risk_factors: additionalRiskFactors,
          });

          return res.redirect(
            `${this.oidcPath}/interaction/${oidcContext.uid}/new-device-verify`
          );
        }
      }

      // Regenerate session ID to prevent session fixation attacks
      // This must happen BEFORE setting authentication state
      try {
        await this.sessionManager.regenerate(req);
        this.logger.debug('Session regenerated after social login', {
          provider,
          username: result.user.username,
        });
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to regenerate session after social login',
          provider,
          username: result.user.username,
        });
        // Continue with authentication even if regeneration fails
      }

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: userAccount,
      });

      try {
        await this.sessionManager.enforceSessionLimit(
          result.user.username,
          req.session?.id
        );
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to enforce session limit after social login',
          provider,
          username: result.user.username,
        });
      }

      try {
        const sessionConfig =
          this.configManager.getConfig().security?.authentication?.session;
        if (sessionConfig?.notify_new_session && result.user.email) {
          await this.notificationService.sendNewSessionAlert(
            { email: result.user.email, username: result.user.username },
            {
              ip: req.ip || 'unknown',
              userAgent: req.headers['user-agent'] || 'unknown',
              timestamp: new Date(),
            }
          );
        }
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to send new session notification',
          username: result.user.username,
        });
      }

      const isNewLink =
        result.integration?.created_at &&
        Date.now() -
          new Date(
            result.integration.created_at as unknown as string
          ).getTime() <
          60000;

      if (isNewLink) {
        this.activityService.success(
          'social_provider_linked',
          `User linked ${provider} account`,
          result.user,
          {
            ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            device_infos: deviceInfos as ClientDeviceInfos,
            actor: result.user,
            target: {
              target_type: 'config',
              entity_name: provider,
              entity_data: {
                provider,
                providerSub: result.integration?.provider_sub,
                providerUsername: result.integration?.provider_username,
              },
            },
          }
        );
      }

      this.activityService.success(
        'oidc_social_login_success',
        'User logged in with social provider via OIDC',
        result.user,
        {
          ip_address: req.ip || req.socket?.remoteAddress || 'unknown',
          user_agent: req.get('User-Agent') || 'unknown',
          device_infos: deviceInfos as ClientDeviceInfos,
          actor: result.user,
          target: {
            target_type: 'none',
            entity_data: {
              provider,
              isNewLink,
            },
          },
        }
      );

      this.metricsService.recordFederationLogin(provider, 'success');

      this.sessionManager.remove(req, 'oidcSocialContext');

      this.logger.info('OIDC social login successful, returning to OIDC flow', {
        provider,
        username: result.user.username,
        uid: oidcContext.uid,
        client_id: oidcContext.client_id,
      });

      // The OIDC flow will detect the authenticated user and handle MFA/consent/etc.
      return res.redirect(`${this.oidcPath}/interaction/${oidcContext.uid}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_social_callback_failed',
        provider: req.params.provider,
      });
      this.metricsService.recordFederationLogin(
        req.params.provider || 'unknown',
        'failure'
      );

      const oidcContext = this.sessionManager.get<OIDCSocialContext>(
        req,
        'oidcSocialContext'
      );
      const uid = oidcContext?.uid || 'unknown';

      this.sessionManager.remove(req, 'oidcSocialContext');

      return res.render(this.viewResolver.views.auth.oidc.error, {
        title: 'Social Login Error',
        error: 'An unexpected error occurred during social authentication.',
        redirectUrl: `${this.oidcPath}/interaction/${uid}`,
      });
    }
  };
}
