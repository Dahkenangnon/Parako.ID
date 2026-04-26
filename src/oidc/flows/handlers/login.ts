import { Request, Response, NextFunction } from 'express';
import Provider, { Client, InteractionResults } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../../di/interfaces/user-service.interface.js';
import type { IAuthService } from '../../../di/interfaces/auth-service.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCLoginHandler } from '../../../di/interfaces/oidc-login-handler.interface.js';
import { SessionUserAccount } from '../../../utils/session.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';
import type { INotificationService } from '../../../di/interfaces/notification-service.interface.js';
import type { IGeolocationService } from '../../../di/interfaces/geolocation-service.interface.js';
import type { IIPReputationService } from '../../../di/interfaces/ip-reputation-service.interface.js';
import type { IMfaUtils } from '../../../di/interfaces/mfa-utils.interface.js';
import type { IMetricsService } from '../../../di/interfaces/metrics-service.interface.js';

/**
 * OIDC Login Handler
 * Handles user login for OIDC interactions
 */
@injectable()
export class OIDCLoginHandler implements IOIDCLoginHandler {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.GeolocationService)
    private readonly geolocationService: IGeolocationService,
    @inject(TYPES.IPReputationService)
    private readonly ipReputationService: IIPReputationService,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.MetricsService)
    private readonly metricsService: IMetricsService
  ) {}

  /**
   * POST /interaction/:uid/login handler
   * Authenticates the user and completes the OIDC login interaction
   */
  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const { params, uid } = interactionDetails;
      const client: Client = (await provider.Client.find(
        params.client_id as string
      )) as Client;

      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      const validation = this.oidcUtils.validateLoginCredentials(req);

      // If credentials are missing, show the login form with an error
      if (!validation.isValid) {
        this.logger.info('Missing credentials');

        this.sessionManager.flash(req).error('Credentials are required.');

        const stepMessage = (params.step_message as string) || '';

        return res.render(this.viewResolver.views.auth.oidc.login, {
          client,
          uid,
          params,
          title: `Sign-in - ${this.configManager.getConfig().application.title}`,
          stepMessage: stepMessage.trim(),
          csrfToken: this.sessionManager.get(req, 'csrfToken'),
        });
      }

      try {
        const identifier = validation.identifier!;

        // Auto-detect identifier type
        const detectedType = this.oidcUtils.detectIdentifierType(identifier);

        // Determine login method label for enforcement check
        const loginMethodLabel =
          typeof detectedType === 'string' ? detectedType : 'custom_identifier';

        this.logger.debug('Auto-detected identifier type', {
          identifier: `${identifier.substring(0, 3)}***`,
          detectedType: loginMethodLabel,
        });

        // Enforce configured login methods
        const configuredLoginMethods =
          this.configManager.getConfig().security.authentication.login
            .login_methods;
        const isMethodAllowed = configuredLoginMethods.some(
          (method: string) => method === loginMethodLabel
        );

        if (!isMethodAllowed) {
          this.logger.info('Login method not allowed', {
            loginMethod: loginMethodLabel,
            configuredLoginMethods,
          });
          this.metricsService.recordLoginAttempt('failure', loginMethodLabel);

          this.sessionManager
            .flash(req)
            .error('This login method is not available.');

          const stepMessage = (params.step_message as string) || '';

          return res.render(this.viewResolver.views.auth.oidc.login, {
            client,
            uid,
            params,
            title: `Sign-in - ${this.configManager.getConfig().application.title}`,
            stepMessage: stepMessage.trim(),
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          });
        }

        let user;
        if (detectedType === 'email') {
          user = await this.authService.loginWithEmail(
            identifier,
            validation.password!
          );
        } else if (detectedType === 'phone') {
          user = await this.authService.loginWithPhoneNumber(
            identifier,
            validation.password!
          );
        } else {
          // Custom identifier
          user = await this.authService.loginWithCustomIdentifier(
            detectedType.slot as 1 | 2 | 3,
            identifier,
            validation.password!
          );
        }

        if (!user) {
          this.logger.info('Invalid credentials');
          this.metricsService.recordLoginAttempt('failure', loginMethodLabel);

          this.sessionManager
            .flash(req)
            .error('Invalid credentials. Please try again.');

          const stepMessage = (params.step_message as string) || '';

          return res.render(this.viewResolver.views.auth.oidc.login, {
            client,
            uid,
            params,
            title: `Sign-in - ${this.configManager.getConfig().application.title}`,
            stepMessage: stepMessage.trim(),
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          });
        }

        const userAccount: SessionUserAccount = {
          id: user._id?.toString() || '',
          username: user.username,
          email: user.email,
          email_verified: user.email_verified || false,
          phone_number: user.phone_number || '',
          phone_number_verified: user.phone_number_verified || false,
          given_name: user.given_name || '',
          family_name: user.family_name || '',
          full_name:
            `${user.given_name || ''} ${user.family_name || ''}`.trim(),
          roles: user.roles || ['user'],
          is_admin:
            user.roles &&
            (user.roles.includes('admin') || user.roles.includes('superadmin')),
          last_used: Date.now(),
          zoneinfo: user.zoneinfo || 'UTC',
          locale: user.locale || 'en',
        };

        const sessionConfig =
          this.configManager.getConfig().security?.authentication?.session;
        if (sessionConfig?.require_2fa_for_new_device) {
          const clientDetails =
            this.clientDeviceInfoManager.getClientInfoFromRequest(req);

          const isTrustedDevice = await this.activityService.isTrustedDevice(
            user._id as string,
            clientDetails.fingerprint
          );

          if (isTrustedDevice) {
            this.logger.info(
              'Trusted device detected, skipping new device verification',
              {
                username: user.username,
                fingerprint: `${clientDetails.fingerprint?.substring(0, 16)}...`,
              }
            );
          } else {
            const oldDevices =
              await this.activityService.getDeviceHistoryForUser(
                user._id as string
              );

            const deviceMatch =
              this.clientDeviceInfoManager.evaluateDeviceMatch(
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
                    this.logger.info('VPN/Proxy/Tor detected during login', {
                      username: user.username,
                      ip: clientDetails.ip,
                      isVPN: ipReputation.isVPN,
                      isProxy: ipReputation.isProxy,
                      isTor: ipReputation.isTor,
                    });
                  }
                  if (
                    ipReputation.riskLevel === 'high' ||
                    ipReputation.riskLevel === 'critical'
                  ) {
                    additionalRiskFactors.push('high_fraud_score');
                    this.logger.warn('High fraud score detected during login', {
                      username: user.username,
                      ip: clientDetails.ip,
                      fraudScore: ipReputation.fraudScore,
                      riskLevel: ipReputation.riskLevel,
                    });
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
                  await this.geolocationService.getLocationFromIP(
                    clientDetails.ip
                  );

                if (currentLocation.success) {
                  if (
                    this.geolocationService.isHighRiskRegion(currentLocation)
                  ) {
                    additionalRiskFactors.push('high_risk_region');
                    this.logger.info('Login from high-risk region', {
                      username: user.username,
                      country: currentLocation.country,
                    });
                  }

                  const lastDevice = oldDevices[0];
                  if (lastDevice?.ip) {
                    const previousLocation =
                      await this.geolocationService.getLocationFromIP(
                        lastDevice.ip
                      );

                    if (previousLocation.success) {
                      // Assume last login was within the last 24 hours
                      // In a real implementation, we'd get the actual timestamp
                      const timeDiffMinutes = 60; // Conservative estimate
                      const travelResult =
                        this.geolocationService.checkImpossibleTravel(
                          previousLocation,
                          currentLocation,
                          timeDiffMinutes
                        );

                      if (travelResult.isImpossible) {
                        additionalRiskFactors.push('impossible_travel');
                        this.logger.warn('Impossible travel detected', {
                          username: user.username,
                          previousCountry: previousLocation.country,
                          currentCountry: currentLocation.country,
                          distanceKm: travelResult.distanceKm,
                          speedKmh: travelResult.speedKmh,
                        });
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
              const configMethod =
                sessionConfig.new_device_2fa_method || 'auto';
              let verifyMethod: 'totp' | 'email';

              if (configMethod === 'auto') {
                // Use TOTP if user has it enabled, otherwise email
                verifyMethod = this.mfaUtils.isTotpEnabled(user)
                  ? 'totp'
                  : 'email';
              } else if (configMethod === 'totp') {
                // TOTP only works if user has it enabled
                if (this.mfaUtils.isTotpEnabled(user)) {
                  verifyMethod = 'totp';
                } else {
                  // Fallback to email if user doesn't have TOTP
                  verifyMethod = 'email';
                }
              } else {
                verifyMethod = 'email';
              }

              // If email method, generate and send OTP
              if (verifyMethod === 'email') {
                try {
                  const { code } = await this.authService.generateEmailOtp(
                    userAccount.id
                  );
                  await this.notificationService.sendOtp(
                    { email: user.email!, username: user.username },
                    code,
                    {
                      deviceInfo: deviceInfos?.user_agent || 'Unknown Device',
                      ip: req.ip || 'unknown',
                    }
                  );
                } catch (err) {
                  this.logger.error(err as Error, {
                    context: 'Failed to send new device OTP',
                    username: user.username,
                  });
                  // Continue without new device verification if email fails
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
                },
                interactionUid: uid,
                clientId: params.client_id,
                created_at: Date.now(),
              });

              const oidcPath = this.configManager.getConfig().oidc.path;
              return res.redirect(
                `${oidcPath}/interaction/${uid}/new-device-verify`
              );
            }
          } // End of else block for non-trusted devices
        }

        // Regenerate session ID to prevent session fixation attacks
        // This must happen BEFORE setting authentication state
        try {
          await this.sessionManager.regenerate(req);
          this.logger.debug('Session regenerated after OIDC login', {
            username: userAccount.username,
          });
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to regenerate session after OIDC login',
            username: userAccount.username,
          });
          // Continue with authentication even if regeneration fails
          // The security middleware will catch suspicious sessions
        }

        const sessionSuccess = this.oidcUtils.addOrUpdateAccountInSession(
          req,
          userAccount,
          true
        );

        if (sessionSuccess) {
          this.logger.debug(
            'Successfully managed account in OIDC login session',
            {
              username: userAccount.username,
            }
          );
        } else {
          this.logger.warn(
            'Failed to manage account in session, falling back to basic auth',
            {
              username: userAccount.username,
            }
          );
          this.sessionManager.setAuthenticated(req, {
            currentActiveLoggedUser: userAccount,
          });
        }

        try {
          await this.sessionManager.enforceSessionLimit(
            userAccount.username,
            req.session?.id
          );
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to enforce session limit after OIDC login',
            username: userAccount.username,
          });
        }

        try {
          const sessionConfig =
            this.configManager.getConfig().security?.authentication?.session;
          if (sessionConfig?.notify_new_session && user.email) {
            await this.notificationService.sendNewSessionAlert(
              { email: user.email, username: user.username },
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
            username: user.username,
          });
        }

        const acrValues = (params.acr_values as string | undefined) ?? '';
        const wantsOtp = acrValues.split(' ').includes('urn:mfa:otp');
        const userHasMfa = this.mfaUtils.isMfaEnabled(user);
        const enabledMethods = this.mfaUtils.getEnabledMethods(user);
        const hasSupportedMethod =
          enabledMethods.includes('totp') ||
          enabledMethods.includes('email') ||
          enabledMethods.includes('webauthn');
        const wantsMfa = wantsOtp && userHasMfa && hasSupportedMethod;

        const result: InteractionResults = {
          login: {
            accountId: user.username,
            amr: ['pwd'],
          },
        } as InteractionResults;

        if (!wantsMfa) {
          // No MFA required, complete authentication
          result.ts = Math.floor(Date.now() / 1000);
          result.login!.acr = 'urn:pwd';
        } else {
          // MFA required - set acr to trigger MFA prompt
          result.login!.acr = 'urn:mfa:otp';
        }

        this.metricsService.recordLoginAttempt('success', loginMethodLabel);

        try {
          await this.userService.updateUserLastLoginDate(
            user._id as string,
            user.username
          );
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'Error updating last login date',
          });
        }

        try {
          this.activityService.success(
            'oidc.login.success',
            'User logged in using OIDC',
            user,
            {
              ip_address: req.ip,
              user_agent: req.headers['user-agent'] as string,
              client_id: params.client_id as string,
              device_infos: deviceInfos as ClientDeviceInfos,
              actor: user,
              target: {
                target_type: 'none',
              },
            }
          );
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'Error logging login activity',
          });
        }

        return await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        });
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error during login process',
        });
        this.metricsService.recordLoginAttempt(
          'error',
          (req.body.login_method as string) || 'unknown'
        );

        this.sessionManager
          .flash(req)
          .error('The credentials you provided are not valid.');

        const stepMessage = (params.step_message as string) || '';

        return res.render(this.viewResolver.views.auth.oidc.login, {
          client,
          uid,
          params,
          title: `Sign-in - ${this.configManager.getConfig().application.title}`,
          stepMessage: stepMessage.trim(),
          csrfToken: this.sessionManager.get(req, 'csrfToken'),
        });
      }
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error in login handler',
      });
      next(err);
    }
  };
}
