import crypto from 'crypto';
import { Request, Response } from 'express';
import { injectable, inject } from 'inversify';
import { type SocialProvider } from '../types/social-integration.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type {
  IAuthService,
  AuthUserData,
} from '../di/interfaces/auth-service.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import type { IAuthController } from '../di/interfaces/auth-controller.interface.js';
import type { INotificationService } from '../di/interfaces/notification-service.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IRedirectAuthority } from '../di/interfaces/redirect-authority.interface.js';
import type { IClientDeviceInfoManager } from '../di/interfaces/client-device-info-manager.interface.js';
import type { ISocialLoginManager } from '../di/interfaces/social-login-manager.interface.js';
import type { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';
import type { IMfaUtils } from '../di/interfaces/mfa-utils.interface.js';
import type { IRecoveryUtils } from '../di/interfaces/recovery-utils.interface.js';
import type { IRecoveryService } from '../di/interfaces/recovery-service.interface.js';
import type { IWebAuthnService } from '../di/interfaces/webauthn-service.interface.js';
import type { IOIDCUtils } from '../di/interfaces/oidc-utils.interface.js';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { SmsService } from '../services/sms.service.js';
import { validateIdentifier } from '../utils/custom-identifier-validation.js';
import type { ClearOIDCUserDataResult } from '../oidc/interfaces/interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type {
  PendingMfaUser,
  AddAccountIntent,
  RecoveryAttempt,
  OIDCSocialContext,
  SocialRegisterData,
  SocialPasswordSetup,
  SocialContactData,
  SecondaryEmailVerification,
} from '../types/session-data.js';

@injectable()
export class AuthController implements IAuthController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ActivityService) private readonly activity: IActivityService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.RedirectAuthority)
    private readonly redirectAuthority: IRedirectAuthority,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.PasswordUtils) private readonly passwordUtils: IPasswordUtils,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.RecoveryUtils) private readonly recoveryUtils: IRecoveryUtils,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.RecoveryService)
    private readonly recoveryService: IRecoveryService,
    @inject(TYPES.SmsService) private readonly smsService: SmsService,
    @inject(TYPES.WebAuthnService)
    private readonly webauthnService: IWebAuthnService,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils
  ) {}

  private getAppTitle() {
    return this.config().application.title;
  }

  private config() {
    return this.configManager.getConfig();
  }

  /**
   * Get custom identifier fields from config
   */
  private getCustomIdentifierFields() {
    return this.userService.getCustomIdentifierFields();
  }

  /**
   * Get social login behavior configuration
   */
  getSocialBehaviorConfig = () => ({
    existingUserNoIntegration:
      this.config().features.social_providers.behavior
        .existing_user_no_integration,
    noUserAccount:
      this.config().features.social_providers.behavior.no_user_account,
    missingContactInfo:
      this.config().features.social_providers.behavior.missing_contact_info,
    requirePasswordOnRegistration:
      this.config().features.social_providers.behavior
        .require_password_on_registration,
    allowMultipleProviders:
      this.config().features.social_providers.behavior.options
        .allow_multiple_providers,
    autoVerifyEmail:
      this.config().features.social_providers.behavior.options
        .auto_verify_email,
    showHelpfulErrors:
      this.config().features.social_providers.behavior.options
        .show_helpful_errors,
    maxProvidersPerUser:
      this.config().features.social_providers.behavior.options
        .max_providers_per_user,
  });

  public login = async (req: Request, res: Response): Promise<void> => {
    let stepMessage =
      this.sessionManager.get<string>(req, 'stepMessage') ||
      (req.query.step_message as string) ||
      '';

    if (this.sessionManager.get(req, 'stepMessage')) {
      this.sessionManager.remove(req, 'stepMessage');
    }

    const continueUrl =
      (req.query.continue as string) || (req.query.redirectTo as string) || '';
    const prompt = (req.query.prompt as string) || '';

    const intent = (req.query.intent as string) || '';

    if (continueUrl) {
      this.logger.info('LOGIN: Attempting to store redirect intent', {
        continueUrl,
        originalUrl: req.originalUrl,
        sessionId: req.session?.id || 'no-session',
        prompt,
      });

      const stored = await this.redirectAuthority.storeIntent(
        req,
        continueUrl,
        'login'
      );

      this.logger.info('LOGIN: Redirect intent storage result', {
        continueUrl,
        stored,
        sessionId: req.session?.id || 'no-session',
      });
    } else {
      this.logger.info('LOGIN: No continue URL provided', {
        query: req.query,
        originalUrl: req.originalUrl,
        sessionId: req.session?.id || 'no-session',
      });
    }

    if (intent === 'add-account') {
      stepMessage = 'Select a method to add an account';
    }

    if (stepMessage) {
      this.sessionManager.set(req, 'stepMessage', stepMessage);
    }

    const socialProviders = {
      enabled: this.socialLoginManager.getAvailableProviders(),
    };

    res.render(this.viewResolver.views.home.index, {
      title: `Sign In - ${this.getAppTitle()}`,
      message: `Welcome to ${this.getAppTitle()}!`,
      stepMessage: stepMessage.trim(),
      continueUrl,
      prompt,
      socialProviders,
    });
  };

  public processLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, phone, login, password, remember_me } = req.body;

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      // Support both old separate fields and new unified 'login' field
      const identifier = email || phone || login;
      const loginIdentifier = identifier || 'unknown';

      this.activity.info('login_attempt', 'Login attempt', null, {
        ip_address: deviceInfos.ip,
        user_agent: deviceInfos.user_agent,
        device_infos: deviceInfos,
        actor: {
          username: loginIdentifier,
          actor_type: 'anonymous',
        },
        target: {
          target_type: 'none',
        },
      });

      let user;
      const configuredLoginMethods =
        this.config().security.authentication.login.login_methods;

      if (email) {
        // Older login forms POST `email` directly instead of using the
        // unified `login` field below. Kept for backwards compatibility
        // with embedded login UIs that haven't migrated yet.
        user = await this.authService.loginWithEmail(email, password);
      } else if (phone) {
        // Same as above for `phone` — explicit phone-number forms.
        user = await this.authService.loginWithPhoneNumber(phone, password);
      } else if (login) {
        // Unified login field - auto-detect or use explicit login_method
        const detectedMethod = this.oidcUtils.detectIdentifierType(login);

        // Enforce configured login methods
        const loginMethodLabel =
          typeof detectedMethod === 'string'
            ? detectedMethod
            : 'custom_identifier';
        const isMethodAllowed = configuredLoginMethods.some(
          (method: string) => method === loginMethodLabel
        );
        if (!isMethodAllowed) {
          this.sessionManager
            .flash(req)
            .error('This login method is not available.');
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
          );
        }

        if (detectedMethod === 'email') {
          user = await this.authService.loginWithEmail(login, password);
        } else if (detectedMethod === 'phone') {
          user = await this.authService.loginWithPhoneNumber(login, password);
        } else {
          // Custom identifier
          user = await this.authService.loginWithCustomIdentifier(
            detectedMethod.slot as 1 | 2 | 3,
            login,
            password
          );
        }
      } else {
        this.activity.failed(
          'login_failed',
          'Login failed: No identifier provided',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: loginIdentifier,
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error('Please provide an email, phone number, or identifier.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      if (!user) {
        this.activity.failed(
          'login_failed',
          'Login failed: Invalid credentials',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: loginIdentifier,
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error('Invalid credentials. Please try again.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      if (this.mfaUtils.isMfaEnabled(user)) {
        this.activity.info('mfa_required', 'MFA required for user', user, {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'none',
          },
        });

        const continueUrl =
          (req.query.continue as string) || (req.body.continue as string);

        const enabledMethodsObject =
          this.mfaUtils.getEnabledMethodsObject(user);
        const preferred_method = this.mfaUtils.getPreferredMethod(user);
        const needsSelection = this.mfaUtils.needsMethodSelection(user);

        this.sessionManager.set(req, 'pendingMfaUser', {
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
          picture: user.picture || '',
          roles: user.roles || ['user'],
          is_admin:
            user.roles &&
            (user.roles.includes('admin') || user.roles.includes('superadmin')),
          last_used: Date.now(),
          mfa_method: preferred_method,
          enabled_methods: enabledMethodsObject,
          remember_me,
          continue_url: continueUrl,
        });

        if (needsSelection) {
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_select}`
          );
        }

        if (preferred_method === 'email') {
          try {
            const otpResult = this.mfaUtils.generateEmailOtp(600);
            await this.userService.setEmailOtp(
              user.username,
              otpResult.code,
              600
            );

            await this.notificationService.sendTemplatedEmail(
              user.email ?? '',
              `Your ${this.getAppTitle()} login code`,
              'email/mail.njk',
              {
                title: `Your ${this.getAppTitle()} login code`,
                content: `<p>Your one-time code to finish the login process is <strong>${otpResult.code}</strong>. It expires in 10 minutes.</p>
                  <p>For your security, never share this code with anyone. If you did not request this code, please ignore this email.</p>`,
                username:
                  `${user.given_name || ''} ${user.family_name || ''}`.trim(),
              }
            );

            this.logger.info('Email MFA code sent', {
              username: user.username,
            });
          } catch (err) {
            this.logger.error(err as Error, {
              username: user.username,
              context: 'email_mfa_code_send_failed',
            });
            this.sessionManager
              .flash(req)
              .error('Failed to send verification code. Please try again.');
            return res.redirect(
              `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
            );
          }

          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
          );
        } else if (preferred_method === 'webauthn') {
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_webauthn}`
          );
        } else {
          // TOTP - redirect to standard MFA verify page
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
          );
        }
      }

      const addAccountIntent = this.sessionManager.get<AddAccountIntent>(
        req,
        'addAccountIntent'
      );

      const newUserAccount = {
        id: user._id?.toString() || '',
        username: user.username,
        email: user.email,
        email_verified: user.email_verified || false,
        phone_number: user.phone_number || '',
        phone_number_verified: user.phone_number_verified || false,
        given_name: user.given_name || '',
        family_name: user.family_name || '',
        full_name: `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        picture: user.picture || '',
        roles: user.roles || ['user'],
        is_admin:
          user.roles &&
          (user.roles.includes('admin') || user.roles.includes('superadmin')),
        last_used: Date.now(),
      };

      if (addAccountIntent && addAccountIntent.addingAccount) {
        const addResult = this.sessionManager.addAuthenticatedUser(
          req,
          newUserAccount,
          true
        );

        if (!addResult.success) {
          const reason =
            addResult.reason === 'max_limit_reached'
              ? 'Maximum number of accounts per session reached.'
              : 'This account is already signed in.';

          this.activity.warning(
            'account_add_failed',
            `Failed to add account - ${addResult.reason}`,
            user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: user,
              target: {
                target_type: 'session',
              },
            }
          );
          this.sessionManager.flash(req).info(reason);
        } else {
          this.activity.success(
            'account_added',
            'Account added to session',
            user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: user,
              target: {
                target_type: 'session',
              },
            }
          );
        }

        this.sessionManager.remove(req, 'addAccountIntent');

        this.logger.info('User added account to existing session', {
          username: user.username,
          id: user._id,
        });

        const returnUrl =
          addAccountIntent.returnUrl ||
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;
        return res.redirect(returnUrl);
      } else {
        const redirectUrl = this.redirectAuthority.getIntent(
          req,
          'login',
          false
        );

        const continueUrl =
          (req.query.continue as string) || (req.body.continue as string);

        if (continueUrl) {
          try {
            await this.sessionManager.enforceSessionLimit(
              newUserAccount.username,
              req.session?.id
            );
          } catch (err) {
            this.logger.error(err as Error, {
              context:
                'Failed to enforce session limit during OIDC continue flow',
            });
          }

          const addResult = this.sessionManager.addAuthenticatedUser(
            req,
            newUserAccount,
            true
          );

          if (!addResult.success) {
            const reason =
              addResult.reason === 'max_limit_reached'
                ? 'Maximum number of accounts per session reached.'
                : 'This account is already signed in.';

            this.activity.warning(
              'account_add_failed',
              `Failed to add account from OIDC flow - ${addResult.reason}`,
              user,
              {
                ip_address: deviceInfos.ip,
                user_agent: deviceInfos.user_agent,
                device_infos: deviceInfos,
                actor: user,
                target: {
                  target_type: 'session',
                },
              }
            );
            this.sessionManager.flash(req).info(reason);
          } else {
            this.activity.success(
              'account_added',
              'Account added from OIDC flow',
              user,
              {
                ip_address: deviceInfos.ip,
                user_agent: deviceInfos.user_agent,
                device_infos: deviceInfos,
                actor: user,
                target: {
                  target_type: 'session',
                },
              }
            );
            this.sessionManager
              .flash(req)
              .success('Account added successfully.');
          }

          this.logger.info('User added account from OIDC continue flow', {
            username: user.username,
            id: user._id,
            continueUrl,
          });

          this.redirectAuthority
            .redirect(res)
            .to(continueUrl)
            .or(
              `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
            );
          return;
        } else if (redirectUrl) {
          // This is from stored login redirect intent
          // Consume the redirect intent now that we're using it
          // getLoginIntent(req, true);
          this.redirectAuthority.getIntent(req, 'login', true);

          this.activity.success(
            'login_success',
            'User logged in successfully with redirect',
            user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: user,
              target: {
                target_type: 'none',
              },
            }
          );

          this.logger.info(
            'User logged in successfully, redirecting to stored intent',
            {
              username: user.username,
              id: user._id,
              redirectUrl,
            }
          );

          // Regenerate session ID to prevent session fixation attacks
          try {
            await this.sessionManager.regenerate(req);
          } catch (err) {
            this.logger.error(err as Error, {
              context: 'Failed to regenerate session during login',
            });
          }

          this.sessionManager.setAuthenticated(req, {
            currentActiveLoggedUser: newUserAccount,
          });

          try {
            await this.sessionManager.enforceSessionLimit(
              newUserAccount.username,
              req.session?.id
            );
          } catch (err) {
            this.logger.error(err as Error, {
              context: 'Failed to enforce session limit during login',
            });
          }

          try {
            const sessionConfig =
              this.config().security?.authentication?.session;
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
            });
          }

          const finalRedirectUrl = this.redirectAuthority.buildRedirectUrl(
            redirectUrl,
            {
              email: user.email ?? '',
              status: 'authenticated',
            }
          );

          this.redirectAuthority
            .redirect(res)
            .to(finalRedirectUrl)
            .or(
              `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
            );
          return;
        } else {
          // Regenerate session ID to prevent session fixation attacks
          try {
            await this.sessionManager.regenerate(req);
          } catch (err) {
            this.logger.error(err as Error, {
              context: 'Failed to regenerate session during login',
            });
          }

          // Normal login - set up session for authenticated user
          this.sessionManager.setAuthenticated(req, {
            currentActiveLoggedUser: newUserAccount,
          });

          try {
            await this.sessionManager.enforceSessionLimit(
              newUserAccount.username,
              req.session?.id
            );
          } catch (err) {
            this.logger.error(err as Error, {
              context: 'Failed to enforce session limit during login',
            });
          }

          try {
            const sessionConfig =
              this.config().security?.authentication?.session;
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
            });
          }

          this.activity.success(
            'login_success',
            'User logged in successfully',
            user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: user,
              target: {
                target_type: 'none',
              },
            }
          );

          this.logger.info('User logged in successfully', {
            username: user.username,
            id: user._id,
          });

          return res.redirect(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during login.';
      this.logger.error(error as Error, { context: 'login_error' });

      // Flash error message and redirect back to login page
      this.sessionManager.flash(req).error(errorMessage);
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }
  };

  /**
   * Renders the registration page
   */
  public register = async (req: Request, res: Response): Promise<void> => {
    const passwordPolicy = this.userService.getPasswordPolicy();

    const registrationConfig = {
      signupMethods:
        this.config().security.authentication.signup.signup_methods,
      requireEmailVerification:
        this.config().security.authentication.signup.require_email_verification,
      requirePhoneVerification:
        this.config().security.authentication.signup.require_phone_verification,
      autoApproval: {
        enabled:
          this.config().security.authentication.signup.auto_approval.enabled,
        domainsWhitelist:
          this.config().security.authentication.signup.auto_approval
            .domains_whitelist,
      },
    };

    const continueUrl =
      (req.query.continue as string) || (req.query.redirectTo as string) || '';
    if (continueUrl) {
      this.logger.info('REGISTRATION: Attempting to store redirect intent', {
        continueUrl,
        originalUrl: req.originalUrl,
        sessionId: req.session?.id || 'no-session',
      });

      const stored = await this.redirectAuthority.storeIntent(
        req,
        continueUrl,
        'register'
      );

      this.logger.info('REGISTRATION: Redirect intent storage result', {
        continueUrl,
        stored,
        sessionId: req.session?.id || 'no-session',
      });
    } else {
      this.logger.info('REGISTRATION: No continue URL provided', {
        query: req.query,
        originalUrl: req.originalUrl,
        sessionId: req.session?.id || 'no-session',
      });
    }

    const prefilledEmail = (req.query.email as string) || '';

    const stepMessage = (req.query.step_message as string) || '';

    const contactChannels = this.config().security.authentication.signup
      .contact_channels || {
      require_at_least_one: true,
      email: { enabled: true, required: false },
      phone: { enabled: true, required: false },
    };

    res.render(this.viewResolver.views.auth.register, {
      title: `Register - ${this.getAppTitle()}`,
      message: 'Register',
      passwordPolicy,
      registrationConfig,
      contactChannels,
      prefilledEmail: prefilledEmail.trim(),
      stepMessage: stepMessage.trim(),
    });
  };

  /**
   * Processes user registration form submission
   */
  public processRegister = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const { fullname, email, phone, password } = req.body;
    const deviceInfos =
      this.clientDeviceInfoManager.getClientInfoFromRequest(req);

    const contactChannels = this.config().security.authentication.signup
      .contact_channels || {
      require_at_least_one: true,
      email: { enabled: true, required: false },
      phone: { enabled: true, required: false },
      full_name: { enabled: true, required: true },
    };

    const registrationConfig = {
      signupMethods:
        this.config().security.authentication.signup.signup_methods,
      requireEmailVerification:
        this.config().security.authentication.signup.require_email_verification,
      requirePhoneVerification:
        this.config().security.authentication.signup.require_phone_verification,
      autoApproval: {
        enabled:
          this.config().security.authentication.signup.auto_approval.enabled,
        domainsWhitelist:
          this.config().security.authentication.signup.auto_approval
            .domains_whitelist,
      },
    };

    const redirectUrl = this.redirectAuthority.getIntent(
      req,
      'register',
      false
    ); // Don't consume yet

    const stepMessage =
      (req.query.step_message as string) || req.body.step_message || '';

    this.logger.info(
      'REGISTRATION: Processing registration with redirect check',
      {
        redirectUrl: redirectUrl || 'none',
        sessionId: req.session?.id || 'no-session',
        hasSession: !!req.session,
        email: email || 'none',
        autoApprovalEnabled: registrationConfig.autoApproval.enabled,
        domainsWhitelist: registrationConfig.autoApproval.domainsWhitelist,
      }
    );

    try {
      const hasEmail = email && email.trim().length > 0;
      const hasPhone = phone && phone.trim().length > 0;
      const ciFields = this.getCustomIdentifierFields();
      const hasCustomIdentifier = ciFields.some(f =>
        req.body[`custom_identifier_${f.slot}`]?.trim()
      );

      const hasValidCredentials: boolean =
        registrationConfig.signupMethods.some((cred: string) => {
          if (cred.includes('email') && hasEmail) return true;
          if (cred.includes('phone') && hasPhone) return true;
          if (cred.includes('custom_identifier') && hasCustomIdentifier)
            return true;
          return false;
        });

      if (!hasValidCredentials) {
        const requiredCreds = registrationConfig.signupMethods
          .map((cred: string) =>
            cred.includes('email')
              ? 'email'
              : cred.includes('phone')
                ? 'phone number'
                : cred
          )
          .join(' or ');

        this.activity.failed(
          'registration_failed',
          `Registration failed: Missing required credentials (${requiredCreds})`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: email || phone || 'unknown',
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error(`Please provide a valid ${requiredCreds}.`);
        return res.render(this.viewResolver.views.auth.register, {
          title: `Register - ${this.getAppTitle()}`,
          message: 'Register',
          passwordPolicy: this.userService.getPasswordPolicy(),
          registrationConfig,
          contactChannels,
          prefilledEmail: email || '', // Preserve form data
          stepMessage: stepMessage.trim(),
        });
      }

      const passwordValidation = this.userService.validatePassword(password);
      if (!passwordValidation.isValid) {
        this.activity.failed(
          'registration_failed',
          `Registration failed: Password requirements not met - ${passwordValidation.messages.join(', ')}`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: email || phone || 'unknown',
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error(
            `Password requirements not met: ${passwordValidation.messages.join(
              ', '
            )}`
          );
        return res.render(this.viewResolver.views.auth.register, {
          title: `Register - ${this.getAppTitle()}`,
          message: 'Register',
          passwordPolicy: this.userService.getPasswordPolicy(),
          registrationConfig,
          contactChannels,
          prefilledEmail: email || '', // Preserve form data
          stepMessage: stepMessage.trim(),
        });
      }

      // Enforce contact channel requirements server-side
      const contactChannelErrors: string[] = [];
      if (
        contactChannels.full_name?.required &&
        (!fullname || !fullname.trim())
      ) {
        contactChannelErrors.push('Full name is required');
      }
      if (contactChannels.email?.required && !hasEmail) {
        contactChannelErrors.push('Email is required');
      }
      if (contactChannels.phone?.required && !hasPhone) {
        contactChannelErrors.push('Phone number is required');
      }
      if (contactChannels.require_at_least_one && !hasEmail && !hasPhone) {
        contactChannelErrors.push(
          'At least one contact method (email or phone) is required'
        );
      }

      if (contactChannelErrors.length > 0) {
        this.activity.failed(
          'registration_failed',
          `Registration failed: ${contactChannelErrors.join(', ')}`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: email || phone || 'unknown',
              actor_type: 'anonymous',
            },
            target: {
              target_type: 'none',
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error(`${contactChannelErrors.join('. ')}.`);
        return res.render(this.viewResolver.views.auth.register, {
          title: `Register - ${this.getAppTitle()}`,
          message: 'Register',
          passwordPolicy: this.userService.getPasswordPolicy(),
          registrationConfig,
          contactChannels,
          prefilledEmail: email || '',
          stepMessage: stepMessage.trim(),
        });
      }

      // Validate custom identifier fields
      const ciConfig = this.config().security.authentication.custom_identifiers;
      if (ciConfig?.enabled && ciFields.length > 0) {
        for (const field of ciFields) {
          // Skip admin_only fields during registration
          if (field.edit_policy === 'admin_only') continue;

          const fieldValue =
            (
              req.body[`custom_identifier_${field.slot}`] as string | undefined
            )?.trim() || '';

          if (field.required_for_registration && !fieldValue) {
            this.sessionManager.flash(req).error(`${field.name} is required.`);
            return res.render(this.viewResolver.views.auth.register, {
              title: `Register - ${this.getAppTitle()}`,
              message: 'Register',
              passwordPolicy: this.userService.getPasswordPolicy(),
              registrationConfig,
              prefilledEmail: email || '',
              stepMessage: stepMessage.trim(),
            });
          }

          if (fieldValue) {
            // Validate format
            if (!validateIdentifier(fieldValue, field)) {
              this.sessionManager
                .flash(req)
                .error(`Invalid ${field.name} format.`);
              return res.render(this.viewResolver.views.auth.register, {
                title: `Register - ${this.getAppTitle()}`,
                message: 'Register',
                passwordPolicy: this.userService.getPasswordPolicy(),
                registrationConfig,
                prefilledEmail: email || '',
                stepMessage: stepMessage.trim(),
              });
            }

            // Check uniqueness
            const normalizedValue = field.case_sensitive
              ? fieldValue
              : fieldValue.toLowerCase();
            const isAvailable =
              await this.userService.isCustomIdentifierAvailable(
                field.slot,
                normalizedValue
              );
            if (!isAvailable) {
              this.sessionManager
                .flash(req)
                .error(`This ${field.name} is already registered.`);
              return res.render(this.viewResolver.views.auth.register, {
                title: `Register - ${this.getAppTitle()}`,
                message: 'Register',
                passwordPolicy: this.userService.getPasswordPolicy(),
                registrationConfig,
                prefilledEmail: email || '',
                stepMessage: stepMessage.trim(),
              });
            }
          }
        }
      }

      const nameParts = fullname ? fullname.trim().split(' ') : [];
      const given_name = nameParts[0] || '';
      // Family name is everything after the first name
      const family_name =
        nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      const userData: AuthUserData = {
        email: email || undefined,
        phone_number: phone || undefined,
        password,
        given_name,
        family_name,
        register_with: email ? 'email' : 'phone_number',
      };
      // Add custom identifier values from form
      for (const field of ciFields) {
        if (field.edit_policy === 'admin_only') continue;
        const val = (
          req.body[`custom_identifier_${field.slot}`] as string | undefined
        )?.trim();
        if (val) {
          const slotKey = `custom_identifier_${field.slot}` as keyof Pick<
            AuthUserData,
            | 'custom_identifier_1'
            | 'custom_identifier_2'
            | 'custom_identifier_3'
          >;
          userData[slotKey] = field.case_sensitive ? val : val.toLowerCase();
        }
      }

      const user = await this.authService.registerUser(userData);

      this.activity.success(
        'registration_success',
        'User registered successfully',
        user,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'none',
          },
        }
      );

      this.logger.info('User registered successfully', {
        username: user.username,
        id: user._id,
        email: user.email,
        autoApprovalEnabled: registrationConfig.autoApproval.enabled,
      });

      let isAutoApproved = false;
      if (
        registrationConfig.autoApproval.enabled &&
        user.email &&
        registrationConfig.autoApproval.domainsWhitelist.length > 0
      ) {
        const emailDomain = user.email.split('@')[1]?.toLowerCase();
        isAutoApproved = Boolean(
          emailDomain &&
          registrationConfig.autoApproval.domainsWhitelist.some(
            (domain: string) => {
              // Support both exact domain match and wildcard patterns
              if (domain.startsWith('*.')) {
                const wildcardDomain = domain.substring(2);
                return (
                  emailDomain === wildcardDomain ||
                  emailDomain.endsWith(`.${wildcardDomain}`)
                );
              }
              return emailDomain === domain.toLowerCase();
            }
          )
        );

        if (isAutoApproved) {
          this.logger.info('User auto-approved based on email domain', {
            username: user.username,
            email: user.email,
            domain: emailDomain,
            whitelistedDomains:
              registrationConfig.autoApproval.domainsWhitelist,
          });
        }
      }

      // Regenerate session ID to prevent session fixation attacks after registration
      try {
        await this.sessionManager.regenerate(req);
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to regenerate session after registration',
        });
      }

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: {
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
          picture: user.picture || '',
          roles: user.roles || ['user'],
          is_admin:
            user.roles &&
            (user.roles.includes('admin') || user.roles.includes('superadmin')),
          last_used: Date.now(),
          zoneinfo: user.zoneinfo || 'UTC',
          locale: user.locale || 'en',
        },
      });

      // CRITICAL: If redirect URL exists, immediately redirect - do NOT show verification page
      if (redirectUrl) {
        // Consume the redirect intent now that we're using it
        // getRegistrationIntent(req, true);
        this.redirectAuthority.getIntent(req, 'register', true);

        let emailVerificationStatus = 'registered';
        if (
          email &&
          !user.email_verified &&
          registrationConfig.requireEmailVerification
        ) {
          emailVerificationStatus = 'verification_pending';

          (async () => {
            try {
              const { verificationToken } =
                await this.authService.generateEmailVerificationToken(
                  user._id as string
                );
              const verificationUrl = `${this.config().deployment.url}${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.verify_email}?token=${verificationToken}`;

              await this.notificationService.sendVerification(
                {
                  email: user.email,
                  username: user.given_name || user.username,
                  locale: user.locale,
                },
                verificationUrl
              );

              this.logger.info(
                'Verification email sent after registration (background)',
                {
                  email: user.email,
                  userId: user._id,
                }
              );
            } catch (verificationError) {
              this.logger.error(verificationError as Error, {
                email: user.email,
                userId: user._id,
                context: 'verification_email_background_failed',
              });
            }
          })();
        }

        const finalRedirectUrl = this.redirectAuthority.buildRedirectUrl(
          redirectUrl,
          {
            email: user.email ?? '',
            status: emailVerificationStatus,
            autoApproved: isAutoApproved.toString(),
          }
        );

        this.logger.info(
          'IMMEDIATE REDIRECT: User being redirected to intended destination',
          {
            userId: user._id,
            originalRedirectUrl: redirectUrl,
            finalRedirectUrl,
            emailVerificationStatus,
            isAutoApproved,
            reason: 'External redirect takes priority over verification page',
          }
        );

        // IMMEDIATE REDIRECT - No verification page shown
        this.redirectAuthority
          .redirect(res)
          .to(finalRedirectUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      }

      // No redirect URL - handle internal flow with email verification
      if (
        email &&
        !user.email_verified &&
        registrationConfig.requireEmailVerification
      ) {
        try {
          const { verificationToken } =
            await this.authService.generateEmailVerificationToken(
              user._id as string
            );
          const verificationUrl = `${this.config().deployment.url}${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.verify_email}?token=${verificationToken}`;

          await this.notificationService.sendVerification(
            {
              email: user.email,
              username: user.given_name || user.username,
              locale: user.locale,
            },
            verificationUrl
          );

          this.logger.info(
            'Verification email sent after registration (internal flow)',
            {
              email: user.email,
              userId: user._id,
            }
          );

          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}?status=pending`
          );
        } catch (verificationError) {
          this.logger.error(verificationError as Error, {
            email: user.email,
            context: 'verification_email_internal_failed',
          });

          // If email sending fails, still show verification page with error context
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}?status=pending`
          );
        }
      } else {
        // No email verification needed or auto-approved - go to dashboard
        if (isAutoApproved) {
          this.sessionManager
            .flash(req)
            .success('Account created and approved automatically!');
        }
        return res.redirect(
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during registration.';
      this.logger.error(error as Error, {
        context: 'registration_error',
        redirectUrl: redirectUrl ? 'present' : 'none',
      });

      this.sessionManager.flash(req).error(errorMessage);

      // Re-render registration form with preserved form data
      return res.render(this.viewResolver.views.auth.register, {
        title: `Register - ${this.getAppTitle()}`,
        message: 'Register',
        passwordPolicy: this.userService.getPasswordPolicy(),
        registrationConfig,
        contactChannels,
        prefilledEmail: email || '', // Preserve form data on error
        stepMessage: stepMessage.trim(),
      });
    }
  };

  /**
   * Renders the reset password page with a token
   */
  public resetPassword = (req: Request, res: Response): void => {
    const token = req.query.token as string;

    if (!token) {
      this.sessionManager
        .flash(req)
        .error(
          'Invalid or missing reset token. Please request a new password reset link.'
        );
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.forgot_password}`
      );
    }

    const passwordPolicy = this.userService.getPasswordPolicy();

    res.render(this.viewResolver.views.auth.reset_password, {
      title: `Reset Password - ${this.getAppTitle()}`,
      token,
      passwordPolicy,
    });
  };

  /**
   * Processes the reset password form submission
   */
  public processResetPassword = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { token, password, 'confirm-password': confirmPassword } = req.body;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      if (!token) {
        this.sessionManager.flash(req).error('Invalid or missing reset token.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.forgot_password}`
        );
      }

      if (password !== confirmPassword) {
        this.sessionManager
          .flash(req)
          .error('Passwords do not match. Please try again.');
        return res.render(this.viewResolver.views.auth.reset_password, {
          title: `Reset Password - ${this.getAppTitle()}`,
          token,
          passwordPolicy: this.userService.getPasswordPolicy(),
        });
      }

      const passwordValidation = this.userService.validatePassword(password);
      if (!passwordValidation.isValid) {
        this.sessionManager
          .flash(req)
          .error(
            `Password requirements not met: ${passwordValidation.messages.join(
              ', '
            )}`
          );
        return res.render(this.viewResolver.views.auth.reset_password, {
          title: `Reset Password - ${this.getAppTitle()}`,
          token,
          passwordPolicy: this.userService.getPasswordPolicy(),
        });
      }

      const user = await this.authService.resetPassword(token, password);

      this.logger.info('Password reset successfully', {
        username: user.username,
        id: user._id,
      });

      this.activity.success(
        'password_reset_success',
        'Password reset successfully',
        user,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'none',
          },
        }
      );

      // Invalidate ALL sessions — user is not authenticated, nothing to preserve
      try {
        const revokedCount =
          await this.oidcAdapter.session.revokeAllSessionsExcept(
            user.username,
            '' // Revoke all — no current session to exclude
          );
        if (revokedCount > 0) {
          this.logger.info('Revoked sessions after password reset', {
            username: user.username,
            revokedCount,
          });
        }
      } catch (sessionError) {
        this.logger.error(sessionError as Error, {
          context: 'session_revocation_after_reset_failed',
          username: user.username,
        });
      }

      try {
        await this.notificationService.sendTemplatedEmail(
          user.email ?? '',
          `Your ${this.getAppTitle()} password has been reset`,
          'email/mail.njk',
          {
            title: `Your ${this.getAppTitle()} password has been reset`,
            content: `
              <p>Hello ${user.given_name || user.username},</p>
              <p>Your password has been successfully reset. If you did not request this change, please contact support immediately.</p>
              <p><strong>Account:</strong> ${user.email}</p>
              <p><strong>Reset time:</strong> ${new Date().toLocaleString()}</p>
              <p>For security reasons, we recommend logging in and changing your password if you did not initiate this reset or Contact us immediately.</p>
            `,
            username:
              `${user.given_name || ''} ${user.family_name || ''}`.trim(),
          }
        );

        this.logger.info('Password reset notification email sent', {
          username: user.username,
          email: user.email,
        });
      } catch (emailError) {
        this.logger.error(emailError as Error, {
          username: user.username,
          email: user.email,
          context: 'password_reset_notification_failed',
        });
        // Don't fail the password reset if email fails
      }

      this.sessionManager
        .flash(req)
        .success(
          'Your password has been reset successfully. You can now log in with your new password.'
        );
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred.';
      this.logger.error(error as Error, { context: 'password_reset_error' });

      this.sessionManager.flash(req).error(errorMessage);
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.forgot_password}`
      );
    }
  };

  /**
   * Renders the forgot password page
   */
  public forgotPassword = (req: Request, res: Response): void => {
    res.render(this.viewResolver.views.auth.forgot_password, {
      title: `Forgot Password - ${this.getAppTitle()}`,
    });
  };

  /**
   * Processes the forgot password form submission
   */
  public processForgotPassword = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email || !this.authService.isValidEmailAddress(email)) {
        this.sessionManager
          .flash(req)
          .error('Please enter a valid email address.');
        return res.render(this.viewResolver.views.auth.forgot_password, {
          title: `Forgot Password - ${this.getAppTitle()}`,
        });
      }

      try {
        const { user, resetToken } =
          await this.authService.generatePasswordResetToken(email);

        const resetUrl = `${this.config().deployment.url}${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.reset_password}?token=${resetToken}`;

        // This allows sending to recovery email if that's what was submitted
        await this.notificationService.sendPasswordReset(
          {
            email,
            username: user.given_name || user.username,
            locale: user.locale,
          },
          resetUrl
        );

        this.logger.info('Password reset email sent', { email });
      } catch (error) {
        // We don't want to reveal whether the email exists in our system
        // So we'll just log the error but still show success message
        this.logger.error(error as Error, {
          email,
          context: 'password_reset_token_generation_failed',
        });
      }

      // Always show success message to prevent email enumeration
      this.sessionManager
        .flash(req)
        .success(
          "If an account with that email exists, we've sent a password reset link. Please check your inbox."
        );
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'forgot_password_error' });

      this.sessionManager
        .flash(req)
        .error(
          'An error occurred while processing your request. Please try again later.'
        );
      return res.render(this.viewResolver.views.auth.forgot_password, {
        title: `Forgot Password - ${this.getAppTitle()}`,
      });
    }
  };

  /**
   * Renders the account selection page for OIDC/OAuth flow
   */
  public accountSelect = (req: Request, res: Response): void => {
    const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);

    if (
      !authenticatedUsers ||
      (!authenticatedUsers.active && authenticatedUsers.others.length === 0)
    ) {
      // No authenticated users, redirect to login
      this.sessionManager.flash(req).error('Please log in to continue.');

      const interactionUid = req.query.interaction_uid as string;
      if (interactionUid) {
        const oidcUrl = `${this.config().oidc.path}/interaction/${interactionUid}`;
        this.redirectAuthority
          .redirect(res)
          .withOptions({ allowLocal: true, requireHttps: false })
          .to(oidcUrl)
          .or(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
          );
        return;
      }

      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }

    const accounts = [];

    if (authenticatedUsers.active) {
      accounts.push({
        id: authenticatedUsers.active.id,
        name:
          authenticatedUsers.active.full_name ||
          authenticatedUsers.active.username,
        email: authenticatedUsers.active.email || '',
        avatar: authenticatedUsers.active.picture || '',
        initials: (() => {
          const firstName = authenticatedUsers.active.given_name || '';
          const lastName = authenticatedUsers.active.family_name || '';
          if (firstName || lastName) {
            return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
          }
          return authenticatedUsers.active.username
            ? authenticatedUsers.active.username.substring(0, 2).toUpperCase()
            : 'U';
        })(),
        is_active: true,
      });
    }

    authenticatedUsers.others.forEach((account: any) => {
      accounts.push({
        id: account.id,
        name: account.full_name || account.username,
        email: account.email || '',
        avatar: account.picture || '',
        initials: (() => {
          const firstName = account.given_name || '';
          const lastName = account.family_name || '';
          if (firstName || lastName) {
            return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
          }
          return account.username
            ? account.username.substring(0, 2).toUpperCase()
            : 'U';
        })(),
        is_active: false,
      });
    });

    const clientName =
      (req.query.client_name as string) || this.config().branding.companyName;
    const clientLogo =
      (req.query.client_logo as string) || this.config().branding.logo;
    const interactionUid = req.query.interaction_uid as string;

    res.render(this.viewResolver.views.auth.account_select, {
      title: `Select Account - ${this.getAppTitle()}`,
      message: 'Select Account',
      clientName,
      clientLogo,
      accounts,
      interactionUid, // Pass interaction UID to template
    });
  };

  /**
   * Handles continuing authentication with a selected account
   * Used when user selects an account from the account selection page
   */
  public continueWithAccount = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { account_id } = req.query;
      const { interaction_uid } = req.query; // For OIDC interactions

      if (!account_id || typeof account_id !== 'string') {
        this.sessionManager.flash(req).error('Invalid account selection.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_select}`
        );
      }

      const switchResult = this.sessionManager.switchUser(req, account_id);

      if (!switchResult.success) {
        if (switchResult.reason === 'reauth_required') {
          this.sessionManager
            .flash(req)
            .info('Please re-enter your password to switch accounts.');
          const loginUrl = `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`;
          return res.redirect(`${loginUrl}?switch_to=${account_id}`);
        }

        this.sessionManager
          .flash(req)
          .error('The selected account is no longer available.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_select}`
        );
      }

      const activeUser = this.sessionManager.getActiveUser(req);
      if (!activeUser) {
        this.sessionManager.flash(req).error('Account not found.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      this.logger.info('User switched to account', {
        newActiveUser: activeUser.username,
        accountId: account_id,
      });

      if (interaction_uid) {
        const oidcUrl = `${this.config().oidc.path}/interaction/${interaction_uid}`;
        this.redirectAuthority
          .redirect(res)
          .withOptions({ allowLocal: true, requireHttps: false })
          .to(oidcUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      }

      // Regular account switch - redirect to dashboard
      return res.redirect(
        `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'continue_with_account_error',
      });
      this.sessionManager
        .flash(req)
        .error('An error occurred while switching accounts.');
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_select}`
      );
    }
  };

  /**
   * Renders the multi-factor authentication page
   */
  public multiFactor = (req: Request, res: Response): void => {
    const mfaMethod = req.query.method || 'app';

    const userData = this.sessionManager.getActiveUser(req);

    if (!userData) {
      this.sessionManager.flash(req).error('Please log in to continue.');
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }

    let maskedPhone = null;
    let maskedEmail = null;

    // Note: phone_number is not stored in session, would need to fetch from database if needed
    if (mfaMethod === 'sms') {
      maskedPhone = 'Phone not available in session';
    } else if (mfaMethod === 'email' && userData.email) {
      maskedEmail = this.mfaUtils.maskEmail(userData.email);
    }

    const requestId = Date.now().toString();
    this.sessionManager.set(req, 'mfaRequestId', requestId);

    res.render(this.viewResolver.views.auth.multi_factor, {
      title: `Two-Factor Authentication - ${this.getAppTitle()}`,
      mfaMethod,
      maskedPhone,
      maskedEmail,
      requestId,
      userName: userData.full_name || userData.username,
    });
  };

  /**
   * Renders the MFA verification page for standard login flow
   */
  public mfaVerify = (req: Request, res: Response): void => {
    const pendingUser =
      this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
      this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

    if (!pendingUser) {
      this.sessionManager
        .flash(req)
        .error('No pending MFA verification found. Please login again.');
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }

    let maskedEmail = null;
    if (pendingUser.email) {
      maskedEmail = this.mfaUtils.maskEmail(pendingUser.email);
    }

    const isSocialLogin =
      this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser') !==
      null;
    const provider = pendingUser.provider;

    res.render(this.viewResolver.views.auth.mfa_verify, {
      title: `Two-Factor Authentication - ${this.getAppTitle()}`,
      user: pendingUser,
      maskedEmail,
      isSocialLogin,
      provider,
    });
  };

  /**
   * Processes MFA verification for standard login flow
   */
  public processMfaVerify = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { code } = req.body;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        this.sessionManager
          .flash(req)
          .error('No pending MFA verification found. Please login again.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      if (!code || code.trim().length === 0) {
        this.sessionManager
          .flash(req)
          .error('Please enter the verification code.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
        );
      }

      let verified = false;
      try {
        if (pendingUser.mfa_method === 'totp') {
          verified = await this.authService.verifyTotp(
            pendingUser.username,
            code.trim()
          );
        } else if (pendingUser.mfa_method === 'email') {
          verified = await this.userService.verifyEmailOtp(
            pendingUser.username,
            code.trim()
          );
        } else if (pendingUser.mfa_method === 'webauthn') {
          // WebAuthn uses a separate verification flow - redirect to the proper page
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_webauthn}`
          );
        } else {
          this.logger.warn(
            'MFA verification attempted for unsupported method',
            {
              username: pendingUser.username,
              method: pendingUser.mfa_method,
            }
          );
          verified = false;
        }
      } catch (err) {
        const error = err as Error;
        this.logger.error(error, {
          username: pendingUser.username,
          context: 'mfa_verification_error',
        });
        verified = false;
      }

      if (!verified) {
        this.activity.failed(
          'mfa_verification_failed',
          'MFA verification failed',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: pendingUser.username,
              actor_type: 'user',
            },
            target: {
              target_type: 'none',
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error('Invalid or expired verification code. Please try again.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
        );
      }

      // MFA verification successful - complete the login
      const newUserAccount = {
        id: pendingUser.id,
        username: pendingUser.username,
        email: pendingUser.email,
        email_verified: pendingUser.email_verified,
        given_name: pendingUser.given_name,
        family_name: pendingUser.family_name,
        full_name: pendingUser.full_name,
        picture: pendingUser.picture,
        roles: pendingUser.roles,
        is_admin: pendingUser.is_admin,
        last_used: Date.now(),
      };

      const isSocialLogin =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser') !==
        null;
      const provider = pendingUser.provider;

      this.activity.success(
        'mfa_verification_success',
        `MFA verification successful${isSocialLogin ? ` via ${provider}` : ''}`,
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: pendingUser.username,
            actor_type: 'user',
          },
          target: {
            target_type: 'none',
          },
        }
      );

      // Regenerate session ID to prevent session fixation attacks after MFA
      try {
        await this.sessionManager.regenerate(req);
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to regenerate session after MFA verification',
        });
      }

      this.sessionManager.addAuthenticatedUser(req, newUserAccount, true);

      this.sessionManager.remove(req, 'pendingMfaUser');
      this.sessionManager.remove(req, 'pendingSocialMfaUser');

      this.logger.info('MFA verification successful', {
        username: pendingUser.username,
      });

      const addAccountIntent = this.sessionManager.get<AddAccountIntent>(
        req,
        'addAccountIntent'
      );
      if (addAccountIntent && addAccountIntent.addingAccount) {
        this.sessionManager.remove(req, 'addAccountIntent');

        const returnUrl =
          addAccountIntent.returnUrl ||
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;
        return res.redirect(returnUrl);
      }

      const redirectUrl = this.redirectAuthority.getIntent(req, 'login', false); // Don't consume yet

      const continueUrl =
        pendingUser.continue_url ||
        (req.query.continue as string) ||
        (req.body.continue as string);
      if (continueUrl) {
        // This is from OIDC "Use another account" or social login - redirect back to continue flow
        this.logger.info(
          'MFA verification successful, redirecting to continue flow',
          {
            username: pendingUser.username,
            continueUrl,
            isSocialLogin,
            provider,
          }
        );
        this.redirectAuthority
          .redirect(res)
          .to(continueUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      } else if (redirectUrl) {
        // This is from stored login redirect intent
        // Consume the redirect intent now that we're using it
        // getLoginIntent(req, true);
        this.redirectAuthority.getIntent(req, 'login', true);

        this.logger.info(
          'MFA verification successful, redirecting to stored intent',
          {
            username: pendingUser.username,
            redirectUrl,
          }
        );

        const finalRedirectUrl = this.redirectAuthority.buildRedirectUrl(
          redirectUrl,
          {
            email: pendingUser.email,
            status: 'authenticated',
          }
        );

        this.redirectAuthority
          .redirect(res)
          .to(finalRedirectUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      }

      // Default redirect to accounts page
      this.sessionManager.flash(req).success('Login successful!');
      res.redirect(
        `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
      );
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'mfa_verification_process_error',
      });
      this.sessionManager
        .flash(req)
        .error('An error occurred during verification. Please try again.');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }
  };

  /**
   * Resends MFA code for email-based MFA
   */
  public resendMfaCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        this.sessionManager
          .flash(req)
          .error('No pending MFA verification found. Please login again.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      if (pendingUser.mfa_method !== 'email') {
        this.sessionManager
          .flash(req)
          .error('Code resend is only available for email verification.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
        );
      }

      const otpResult = this.mfaUtils.generateEmailOtp(600);
      await this.userService.setEmailOtp(
        pendingUser.username,
        otpResult.code,
        600
      );

      await this.notificationService.sendTemplatedEmail(
        pendingUser.email,
        `Your ${this.getAppTitle()} login code`,
        'email/mail.njk',
        {
          title: `Your ${this.getAppTitle()} login code`,
          content: `<p>Your one-time code to finish the login process is <strong>${otpResult.code}</strong>. It expires in 10 minutes.</p>
            <p>For your security, never share this code with anyone. If you did not request this code, please ignore this email.</p>`,
          username:
            `${pendingUser.given_name || ''} ${pendingUser.family_name || ''}`.trim(),
        }
      );

      this.logger.info('MFA code resent', { username: pendingUser.username });

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.info(
        'mfa_code_resent',
        'User requested MFA code resend',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: pendingUser.username,
            email: pendingUser.email,
            full_name:
              `${pendingUser.given_name || ''} ${pendingUser.family_name || ''}`.trim(),
            given_name: pendingUser.given_name,
            family_name: pendingUser.family_name,
            actor_type: 'user',
          },
          target: {
            target_type: 'none',
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success('A new verification code has been sent to your email.');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
      );
    } catch (err) {
      this.logger.error(err as Error, { context: 'mfa_code_resend_failed' });
      this.sessionManager
        .flash(req)
        .error('Failed to send verification code. Please try again.');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
      );
    }
  };

  /**
   * Renders the MFA method selection page for users with multiple MFA methods
   * If only one method is enabled, shows the no-fallback page since the user
   * navigated here (implying their primary method didn't work)
   */
  public mfaSelect = (req: Request, res: Response): void => {
    const pendingUser =
      this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
      this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

    if (!pendingUser) {
      this.sessionManager.flash(req).error('Please login first.');
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }

    const enabledMethods = pendingUser.enabled_methods || {};
    const enabledCount = Object.values(enabledMethods).filter(Boolean).length;

    // If only one method (or none) is enabled, show no-fallback page
    // User is here because their primary method didn't work
    if (enabledCount <= 1) {
      return res.render(this.viewResolver.views.auth.mfa_no_fallback, {
        title: `${req.t('auth.mfa_no_fallback.title')} - ${this.getAppTitle()}`,
      });
    }

    res.render(this.viewResolver.views.auth.mfa_select, {
      title: `${req.t('auth.mfa_select.title')} - ${this.getAppTitle()}`,
      enabledMethods,
    });
  };

  /**
   * Processes MFA method selection and redirects to the appropriate verification page
   */
  public processMfaSelect = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { method } = req.body;
      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        this.sessionManager.flash(req).error('Please login first.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      pendingUser.mfa_method = method;
      this.sessionManager.set(req, 'pendingMfaUser', pendingUser);

      if (method === 'webauthn') {
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_webauthn}`
        );
      }

      // For email method, send the OTP code
      if (method === 'email') {
        const user = await this.userService.findByUsername(
          pendingUser.username
        );
        if (user) {
          const otpResult = this.mfaUtils.generateEmailOtp(600);
          await this.userService.setEmailOtp(
            pendingUser.username,
            otpResult.code,
            600
          );
          await this.notificationService.sendTemplatedEmail(
            user.email ?? '',
            `Your ${this.getAppTitle()} login code`,
            'email/mail.njk',
            {
              title: `Your ${this.getAppTitle()} login code`,
              content: `<p>Your one-time code to finish the login process is <strong>${otpResult.code}</strong>. It expires in 10 minutes.</p>
                <p>For your security, never share this code with anyone. If you did not request this code, please ignore this email.</p>`,
              username:
                `${user.given_name || ''} ${user.family_name || ''}`.trim(),
            }
          );
        }
      }

      // For TOTP or email, redirect to standard MFA verify page
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
      );
    } catch (err) {
      this.logger.error(err as Error, { context: 'mfa_select_failed' });
      this.sessionManager
        .flash(req)
        .error('Failed to process selection. Please try again.');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_select}`
      );
    }
  };

  /**
   * Renders the WebAuthn MFA verification page
   */
  public mfaWebAuthn = (req: Request, res: Response): void => {
    const pendingUser =
      this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
      this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

    if (!pendingUser) {
      this.sessionManager.flash(req).error('Please login first.');
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }

    res.render(this.viewResolver.views.auth.mfa_webauthn, {
      title: `Passkey Verification - ${this.getAppTitle()}`,
      user: { ...pendingUser, mfa_method: 'webauthn' },
    });
  };

  /**
   * Gets WebAuthn authentication options for MFA
   */
  public mfaWebAuthnOptions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const credentials = await this.webauthnService.getCredentials(
        pendingUser.username
      );

      // Use WebAuthn service to get authentication options
      const options = await this.webauthnService.generateAuthenticationOptions(
        pendingUser.username,
        credentials
      );

      if (!options) {
        res.status(500).json({ error: 'WebAuthn not configured' });
        return;
      }

      this.sessionManager.set(req, 'webauthnChallenge', options.challenge);

      res.json(options);
    } catch (err) {
      this.logger.error(err as Error, { context: 'webauthn_options_failed' });
      res.status(500).json({ error: 'Failed to generate options' });
    }
  };

  /**
   * Processes WebAuthn MFA verification
   */
  public processMfaWebAuthn = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const pendingUser =
        this.sessionManager.get<PendingMfaUser>(req, 'pendingMfaUser') ||
        this.sessionManager.get<PendingMfaUser>(req, 'pendingSocialMfaUser');

      if (!pendingUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const challenge = this.sessionManager.get<string>(
        req,
        'webauthnChallenge'
      );
      if (!challenge) {
        res.status(400).json({ error: 'No challenge found' });
        return;
      }

      const storedCredentials = await this.webauthnService.getCredentials(
        pendingUser.username
      );
      const credential = req.body.credential;
      if (!credential) {
        res.status(400).json({ error: 'Credential is required' });
        return;
      }

      const matchingCredential = storedCredentials.find(
        c => c.credential_id === credential.id
      );
      if (!matchingCredential) {
        res.status(400).json({ error: 'Credential not found' });
        return;
      }

      const origin = `${this.config().deployment.url}`;
      const result = await this.webauthnService.verifyAuthentication(
        matchingCredential,
        credential,
        challenge,
        origin
      );

      if (!result?.verified) {
        res.status(401).json({ error: 'Verification failed' });
        return;
      }

      this.sessionManager.set(req, 'webauthnChallenge', null);

      const newUserAccount = {
        id: pendingUser.id,
        username: pendingUser.username,
        email: pendingUser.email,
        email_verified: pendingUser.email_verified,
        given_name: pendingUser.given_name,
        family_name: pendingUser.family_name,
        full_name: pendingUser.full_name,
        picture: pendingUser.picture,
        roles: pendingUser.roles,
        is_admin: pendingUser.is_admin,
        last_used: Date.now(),
      };

      // Regenerate session to prevent fixation
      try {
        await this.sessionManager.regenerate(req);
      } catch (regenErr) {
        this.logger.error(regenErr as Error, {
          context: 'Failed to regenerate session after WebAuthn MFA',
        });
      }

      this.sessionManager.addAuthenticatedUser(req, newUserAccount, true);

      this.sessionManager.remove(req, 'pendingMfaUser');
      this.sessionManager.remove(req, 'pendingSocialMfaUser');

      const continueUrl = pendingUser.continue_url;
      const redirectUrl =
        continueUrl ||
        `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;

      res.json({ ok: true, redirectUrl });
    } catch (err) {
      this.logger.error(err as Error, { context: 'webauthn_verify_failed' });
      res.status(500).json({ error: 'Verification failed' });
    }
  };

  /**
   * Renders the email verification page with different states
   * - status=pending: Shows instructions to check email
   * - otherwise: Shows form to request verification email
   */
  public emailVerification = (req: Request, res: Response): void => {
    const status = req.query.status || 'request';

    const userData = this.sessionManager.getActiveUser(req);
    const userEmail = userData?.email || '';

    res.render(this.viewResolver.views.auth.email_verification, {
      title: `Verify Email - ${this.getAppTitle()}`,
      status,
      userEmail,
    });
  };

  /**
   * Processes the request for a new verification email
   */
  public requestEmailVerification = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email || !this.authService.isValidEmailAddress(email)) {
        this.sessionManager
          .flash(req)
          .error('Please enter a valid email address.');
        return res.render(this.viewResolver.views.auth.email_verification, {
          title: `Verify Email - ${this.getAppTitle()}`,
        });
      }

      try {
        const user = await this.userService.findByEmail(email);

        if (user) {
          if (user.email_verified) {
            this.sessionManager
              .flash(req)
              .info('Your email is already verified. You can now log in.');
            return res.redirect(
              `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
            );
          }

          const { verificationToken } =
            await this.authService.generateEmailVerificationToken(
              user._id as string
            );

          const verificationUrl = `${this.config().deployment.url}${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.verify_email}?token=${verificationToken}`;

          await this.notificationService.sendVerification(
            {
              email: user.email,
              username: user.given_name || user.username,
              locale: user.locale,
            },
            verificationUrl
          );

          this.logger.info('Verification email sent', { email });
        } else {
          this.logger.info(
            'Email verification requested for non-existent user',
            {
              email,
            }
          );
        }

        // Always show success message to prevent email enumeration
        this.sessionManager
          .flash(req)
          .success(
            "If your email is registered with us, we've sent a verification link. Please check your inbox."
          );
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}?status=pending`
        );
      } catch (error) {
        this.logger.error('Error sending verification email', { email, error });

        // Generic success message to prevent email enumeration
        this.sessionManager
          .flash(req)
          .success(
            "If your email is registered with us, we've sent a verification link. Please check your inbox."
          );
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}?status=pending`
        );
      }
    } catch (error) {
      this.logger.error('Email verification request error', { error });

      this.sessionManager
        .flash(req)
        .error(
          'An error occurred while processing your request. Please try again later.'
        );
      return res.render(this.viewResolver.views.auth.email_verification, {
        title: `Verify Email - ${this.getAppTitle()}`,
      });
    }
  };

  /**
   * Processes the resend of verification email for authenticated users
   */
  public resendEmailVerification = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      if (!(await this.sessionManager.isAuthenticated(req))) {
        this.sessionManager
          .flash(req)
          .error('You must be logged in to resend verification email.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      const currentUser = this.sessionManager.getActiveUser(req);

      if (!currentUser || !currentUser.id) {
        this.sessionManager
          .flash(req)
          .error('User information not found in session.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      const user = await this.userService.findOne({ _id: currentUser.id });

      if (!user) {
        this.sessionManager.flash(req).error('User not found.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      if (user.email_verified) {
        this.sessionManager.flash(req).info('Your email is already verified.');
        return res.redirect(
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
        );
      }

      const { verificationToken } =
        await this.authService.generateEmailVerificationToken(
          user._id as string
        );

      const verificationUrl = `${this.config().deployment.url}${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.verify_email}?token=${verificationToken}`;

      await this.notificationService.sendVerification(
        {
          email: user.email,
          username: user.given_name || user.username,
          locale: user.locale,
        },
        verificationUrl
      );

      this.logger.info('Verification email resent', {
        userId: user._id,
        email: user.email,
      });

      this.sessionManager
        .flash(req)
        .success('Verification email has been sent. Please check your inbox.');
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}?status=pending`
      );
    } catch (error) {
      this.logger.error('Resend verification email error', { error });

      this.sessionManager
        .flash(req)
        .error(
          'An error occurred while resending the verification email. Please try again later.'
        );
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}?status=pending`
      );
    }
  };

  /**
   * Verifies the user's email using the token from the verification link
   */
  public verifyEmail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== 'string') {
        this.sessionManager.flash(req).error('Invalid verification token.');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}`
        );
      }

      const user = await this.authService.verifyEmail(token);

      this.logger.info('Email verified successfully', {
        userId: user._id,
        email: user.email,
      });

      if (await this.sessionManager.isAuthenticated(req)) {
        const currentUser = this.sessionManager.getActiveUser(req);
        const authenticatedUsers =
          this.sessionManager.getAuthenticatedUsers(req);

        if (currentUser && currentUser.id === user._id?.toString()) {
          currentUser.email_verified = true;
          currentUser.last_used = Date.now();

          if (authenticatedUsers) {
            authenticatedUsers.active = currentUser;
            this.sessionManager.set(
              req,
              'authenticatedUsers',
              authenticatedUsers
            );
            this.logger.debug(
              'Updated email_verified status in session for active user',
              {
                username: currentUser.username,
              }
            );
          }
        } else if (authenticatedUsers) {
          const otherUserIndex = authenticatedUsers.others.findIndex(
            (acc: any) =>
              acc.id === user._id?.toString() || acc.username === user.username
          );

          if (otherUserIndex >= 0) {
            authenticatedUsers.others[otherUserIndex].email_verified = true;
            authenticatedUsers.others[otherUserIndex].last_used = Date.now();
            this.sessionManager.set(
              req,
              'authenticatedUsers',
              authenticatedUsers
            );
            this.logger.debug(
              'Updated email_verified status in session for other user',
              {
                username: user.username,
              }
            );
          }
        }
      }

      const isAuthenticated = await this.sessionManager.isAuthenticated(req);
      const nextUrl = isAuthenticated
        ? `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
        : `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`;

      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification_success}?email=${encodeURIComponent(user.email ?? '')}&name=${encodeURIComponent(user.given_name || user.username)}&next=${nextUrl}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred.';
      this.logger.error('Email verification error', { error });

      this.sessionManager
        .flash(req)
        .error(
          errorMessage === 'Invalid or expired token'
            ? 'Your verification link has expired or is invalid. Please request a new one.'
            : 'An error occurred during email verification. Please try again later.'
        );

      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.email_verification}`
      );
    }
  };

  /**
   * Show account recovery page
   */
  public accountRecovery = (req: Request, res: Response): void => {
    res.render(this.viewResolver.views.auth.account_recovery, {
      title: `${req.t('auth.account_recovery_page.title')} - ${this.getAppTitle()}`,
      error: null,
      success: null,
      identifier: null,
      authentication: {
        customIdentifiers: this.getCustomIdentifierFields().filter(
          f => f.usable_for_login
        ),
      },
    });
  };

  /**
   * Process account recovery request - find user and redirect to method selection
   */
  public processAccountRecovery = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const config = this.config();
    const renderError = (error: string, identifier?: string) => {
      return res.render(this.viewResolver.views.auth.account_recovery, {
        title: `${req.t('auth.account_recovery_page.title')} - ${this.getAppTitle()}`,
        error,
        success: null,
        identifier,
        authentication: {
          customIdentifiers: this.getCustomIdentifierFields().filter(
            f => f.usable_for_login
          ),
        },
      });
    };

    try {
      const { identifier } = req.body;

      if (!identifier || !identifier.trim()) {
        return renderError('Please enter your email, phone, or username');
      }

      const trimmedIdentifier = identifier.trim();
      const identifierType =
        this.oidcUtils.detectIdentifierType(trimmedIdentifier);

      let user = null;

      if (identifierType === 'email') {
        user = await this.userService.findByEmail(trimmedIdentifier);
      } else if (identifierType === 'phone') {
        const cleanPhone = trimmedIdentifier.replace(/[\s\-().]/g, '');
        user = await this.userService.findByPhoneNumber(cleanPhone);
      }

      // If not found by email/phone, try username
      if (!user) {
        user = await this.userService.findByUsername(trimmedIdentifier);
      }

      // If still not found, try custom identifier fields
      if (!user) {
        const loginableFields = this.getCustomIdentifierFields().filter(
          f => f.usable_for_login
        );
        for (const field of loginableFields) {
          const lookupValue = field.case_sensitive
            ? trimmedIdentifier
            : trimmedIdentifier.toLowerCase();
          user = await this.userService.findByCustomIdentifier(
            field.slot,
            lookupValue
          );
          if (user) break;
        }
      }

      // Don't reveal if user exists - show generic message
      if (!user) {
        return renderError(
          'If an account exists with this identifier, recovery options will be shown.',
          trimmedIdentifier
        );
      }

      const availableMethods = await this.recoveryService.getAvailableMethods(
        user._id!.toString()
      );

      const methodPriority = [
        'backup_codes',
        'secondary_email',
        'security_questions',
        'sms',
      ];
      const available = availableMethods
        .filter(m => m.available)
        .sort(
          (a, b) =>
            methodPriority.indexOf(a.method) - methodPriority.indexOf(b.method)
        );

      if (available.length === 0) {
        return renderError(
          'No recovery methods are configured for this account. Please contact support.',
          trimmedIdentifier
        );
      }

      let maskedIdentifier = '';
      if (user.email) {
        const [localPart, domain] = user.email.split('@');
        maskedIdentifier = `${localPart.slice(0, 2)}***@${domain}`;
      } else if (user.username) {
        maskedIdentifier = `${user.username.slice(0, 2)}***`;
      }

      this.sessionManager.set(req, 'recoveryAttempt', {
        userId: user._id!.toString(),
        username: user.username,
        maskedIdentifier,
        availableMethods: available,
        timestamp: Date.now(),
      });

      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.recovery_method_select}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'process_account_recovery_failed',
      });
      return renderError('An error occurred. Please try again.');
    }
  };

  /**
   * Show recovery method selection page
   */
  public recoveryMethodSelect = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );

    if (!recoveryAttempt || !recoveryAttempt.availableMethods) {
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
      );
    }

    res.render(this.viewResolver.views.auth.recovery_method_select, {
      title: `${req.t('auth.recovery_method_select.title')} - ${this.getAppTitle()}`,
      maskedIdentifier: recoveryAttempt.maskedIdentifier,
      availableMethods: recoveryAttempt.availableMethods,
      error: null,
    });
  };

  /**
   * Process recovery method selection
   */
  public processRecoveryMethodSelect = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const config = this.config();
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );

    if (!recoveryAttempt || !recoveryAttempt.availableMethods) {
      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
      );
    }

    const { method } = req.body;

    const selectedMethod = recoveryAttempt.availableMethods.find(
      (m: { method: string; available: boolean }) =>
        m.method === method && m.available
    );

    if (!selectedMethod) {
      return res.render(this.viewResolver.views.auth.recovery_method_select, {
        title: `${req.t('auth.recovery_method_select.title')} - ${this.getAppTitle()}`,
        maskedIdentifier: recoveryAttempt.maskedIdentifier,
        availableMethods: recoveryAttempt.availableMethods,
        error: 'Selected recovery method is not available',
      });
    }

    this.sessionManager.set(req, 'recoveryAttempt', {
      ...recoveryAttempt,
      method,
      methodDetails: selectedMethod.details,
    });

    const authRoutes = config.deployment.routes.auth_routes;
    const authBase = config.deployment.routes.auth;

    switch (method) {
      case 'backup_codes':
        return res.redirect(`${authBase}${authRoutes.recovery_backup_codes}`);
      case 'secondary_email':
        return res.redirect(
          `${authBase}${authRoutes.recovery_secondary_email}`
        );
      case 'security_questions':
        return res.redirect(
          `${authBase}${authRoutes.recovery_security_questions}`
        );
      case 'sms':
        return res.redirect(`${authBase}${authRoutes.recovery_sms}`);
      default:
        return res.render(this.viewResolver.views.auth.recovery_method_select, {
          title: `${req.t('auth.recovery_method_select.title')} - ${this.getAppTitle()}`,
          maskedIdentifier: recoveryAttempt.maskedIdentifier,
          availableMethods: recoveryAttempt.availableMethods,
          error: 'Invalid recovery method selected',
        });
    }
  };

  /**
   * Show security questions recovery page
   */
  public recoverySecurityQuestions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const config = this.config();
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );

    if (!recoveryAttempt || recoveryAttempt.method !== 'security_questions') {
      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
      );
    }

    // Get user's security questions (keys only, not answers)
    const user = await this.userService.findById(recoveryAttempt.userId);
    if (!user || !user.recovery?.security_questions?.questions) {
      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
      );
    }

    const lockoutStatus =
      this.recoveryUtils.checkSecurityQuestionsLockout(user);

    const questions = user.recovery.security_questions.questions.map(q => ({
      id: q.id,
      question_key: q.question_key,
    }));

    res.render(this.viewResolver.views.auth.recovery_security_questions, {
      title: `${req.t('auth.recovery_security_questions.title')} - ${this.getAppTitle()}`,
      questions,
      lockout: {
        locked: lockoutStatus.locked,
        minutesRemaining: lockoutStatus.minutesRemaining,
        remainingAttempts: lockoutStatus.remainingAttempts,
      },
      error: null,
    });
  };

  /**
   * Process security questions verification
   */
  public processRecoverySecurityQuestions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const config = this.config();

    try {
      const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
        req,
        'recoveryAttempt'
      );
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      if (!recoveryAttempt || recoveryAttempt.method !== 'security_questions') {
        return res.redirect(
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
        );
      }

      const { answers, questionIds } = req.body;

      const user = await this.userService.findById(recoveryAttempt.userId);
      if (!user || !user.recovery?.security_questions?.questions) {
        return res.redirect(
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
        );
      }

      const answersMap = new Map<string, string>();
      if (Array.isArray(questionIds) && Array.isArray(answers)) {
        for (let i = 0; i < questionIds.length; i++) {
          if (answers[i]) {
            answersMap.set(questionIds[i], answers[i]);
          }
        }
      }

      const result = await this.recoveryService.verifySecurityQuestions(
        user,
        answersMap,
        {
          ip: deviceInfos.ip,
          userAgent: deviceInfos.user_agent,
        }
      );

      if (!result.success) {
        const updatedUser = await this.userService.findById(
          recoveryAttempt.userId
        );
        const lockoutStatus = updatedUser
          ? this.recoveryUtils.checkSecurityQuestionsLockout(updatedUser)
          : { locked: false, remainingAttempts: 0 };

        const questions = user.recovery.security_questions.questions.map(q => ({
          id: q.id,
          question_key: q.question_key,
        }));

        return res.render(
          this.viewResolver.views.auth.recovery_security_questions,
          {
            title: `${req.t('auth.recovery_security_questions.title')} - ${this.getAppTitle()}`,
            questions,
            lockout: {
              locked: lockoutStatus.locked,
              minutesRemaining: lockoutStatus.minutesRemaining,
              remainingAttempts: lockoutStatus.remainingAttempts,
            },
            error: result.error || 'Incorrect answers. Please try again.',
          }
        );
      }

      // Success - clear recovery session and authenticate user
      this.sessionManager.remove(req, 'recoveryAttempt');

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: {
          id: user._id!.toString(),
          username: user.username,
          email: user.email,
          given_name: user.given_name,
          family_name: user.family_name,
          full_name: user.name,
          picture: user.picture,
          is_admin: (user as any).is_admin || false,
          last_used: Date.now(),
          zoneinfo: user.zoneinfo || 'UTC',
          locale: user.locale || 'en',
        },
      });

      this.sessionManager
        .flash(req)
        .success(
          'Account recovered successfully! It is crucial to change your password immediately or enforce security options for your account.'
        );
      return res.redirect(
        `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'process_recovery_security_questions_failed',
      });

      const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
        req,
        'recoveryAttempt'
      );
      if (recoveryAttempt?.userId) {
        const user = await this.userService.findById(recoveryAttempt.userId);
        if (user?.recovery?.security_questions?.questions) {
          const questions = user.recovery.security_questions.questions.map(
            q => ({
              id: q.id,
              question_key: q.question_key,
            })
          );

          return res.render(
            this.viewResolver.views.auth.recovery_security_questions,
            {
              title: `${req.t('auth.recovery_security_questions.title')} - ${this.getAppTitle()}`,
              questions,
              lockout: { locked: false, remainingAttempts: 0 },
              error: 'An error occurred. Please try again.',
            }
          );
        }
      }

      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
      );
    }
  };

  /**
   * Show SMS recovery page
   */
  public recoverySms = async (req: Request, res: Response): Promise<void> => {
    const config = this.config();
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );

    if (!recoveryAttempt || recoveryAttempt.method !== 'sms') {
      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
      );
    }

    const maskedPhone = recoveryAttempt.methodDetails?.maskedPhone || '***';

    res.render(this.viewResolver.views.auth.recovery_sms, {
      title: `${req.t('auth.recovery_sms.title')} - ${this.getAppTitle()}`,
      maskedPhone,
      codeSent: false,
      retryAfter: null,
      error: null,
      success: null,
    });
  };

  /**
   * Process SMS recovery - send code or verify
   */
  public processRecoverySms = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const config = this.config();
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );
    const deviceInfos =
      this.clientDeviceInfoManager.getClientInfoFromRequest(req);

    if (!recoveryAttempt || recoveryAttempt.method !== 'sms') {
      return res.redirect(
        `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.account_recovery}`
      );
    }

    const { action } = req.body;
    const maskedPhone = recoveryAttempt.methodDetails?.maskedPhone || '***';

    if (action === 'send_code') {
      const user = await this.userService.findById(recoveryAttempt.userId);
      if (!user || !user.phone_number) {
        return res.render(this.viewResolver.views.auth.recovery_sms, {
          title: `${req.t('auth.recovery_sms.title')} - ${this.getAppTitle()}`,
          maskedPhone,
          codeSent: false,
          retryAfter: null,
          error: 'Phone number not available for this account',
          success: null,
        });
      }

      const { code, hash, expiresAt } =
        this.recoveryUtils.generateSmsVerificationCode();

      const smsResult = await this.smsService.sendRecoveryCode(
        user.phone_number,
        code,
        deviceInfos.ip
      );

      if (!smsResult.success) {
        return res.render(this.viewResolver.views.auth.recovery_sms, {
          title: `${req.t('auth.recovery_sms.title')} - ${this.getAppTitle()}`,
          maskedPhone,
          codeSent: false,
          retryAfter: smsResult.retryAfter || null,
          error: smsResult.error || 'Failed to send SMS. Please try again.',
          success: null,
        });
      }

      await this.userService.updateById(user._id!.toString(), {
        recovery: {
          ...user.recovery,
          enabled: user.recovery?.enabled ?? false,
          methods: user.recovery?.methods ?? [],
          sms: {
            ...user.recovery?.sms,
            phone_number: user.recovery?.sms?.phone_number || '',
            verified: user.recovery?.sms?.verified || false,
            verification_code: hash,
            verification_expires: expiresAt,
          },
        },
      });

      this.sessionManager.set(req, 'recoveryAttempt', {
        ...recoveryAttempt,
        smsSent: true,
        smsExpiresAt: expiresAt.toISOString(),
      });

      return res.render(this.viewResolver.views.auth.recovery_sms, {
        title: `${req.t('auth.recovery_sms.title')} - ${this.getAppTitle()}`,
        maskedPhone,
        codeSent: true,
        retryAfter: null,
        error: null,
        success: 'Verification code sent successfully',
      });
    }

    return res.render(this.viewResolver.views.auth.recovery_sms, {
      title: `${req.t('auth.recovery_sms.title')} - ${this.getAppTitle()}`,
      maskedPhone,
      codeSent: false,
      retryAfter: null,
      error: 'Invalid action',
      success: null,
    });
  };

  /**
   * Show backup codes recovery page
   */
  public recoveryBackupCodes = (req: Request, res: Response): void => {
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );

    if (!recoveryAttempt) {
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
      );
    }

    res.render(this.viewResolver.views.auth.recovery_backup_codes, {
      title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
      username: recoveryAttempt.username,
      error: null,
    });
  };

  /**
   * Process backup codes recovery
   */
  public processRecoveryBackupCodes = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { code } = req.body;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
        req,
        'recoveryAttempt'
      );

      if (!recoveryAttempt) {
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
        );
      }

      if (!code) {
        return res.render(this.viewResolver.views.auth.recovery_backup_codes, {
          title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
          username: recoveryAttempt.username,
          error: 'Backup code is required',
        });
      }

      const user = await this.userService.findById(recoveryAttempt.userId);
      if (!user || !user.recovery?.backup_codes) {
        return res.render(this.viewResolver.views.auth.recovery_backup_codes, {
          title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
          username: recoveryAttempt.username,
          error: 'No backup codes found for this account',
        });
      }

      const lockoutStatus = this.recoveryUtils.checkRecoveryLockout(user);
      if (lockoutStatus.locked) {
        this.activity.failed(
          'recovery_attempt_blocked',
          'Recovery attempt blocked due to lockout',
          user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: user,
            target: { target_type: 'none' },
            metadata: {
              method: 'backup_codes',
              lockedUntil: lockoutStatus.lockedUntil,
              minutesRemaining: lockoutStatus.minutesRemaining,
            },
          }
        );
        return res.render(this.viewResolver.views.auth.recovery_backup_codes, {
          title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
          username: recoveryAttempt.username,
          error: `Too many failed attempts. Please try again in ${lockoutStatus.minutesRemaining} minutes.`,
        });
      }

      const verificationResult = await this.recoveryUtils.verifyUserBackupCode(
        user,
        code
      );

      if (!verificationResult.valid) {
        const failedAttemptResult =
          this.recoveryUtils.recordFailedRecoveryAttempt(user);

        await this.userService.updateById(user._id!, {
          recovery: {
            ...user.recovery,
            lockout: user.recovery.lockout,
          },
        });

        this.activity.failed(
          'recovery_attempt_failed',
          'Failed backup code recovery attempt',
          user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: user,
            target: {
              target_type: 'none',
            },
            metadata: {
              method: 'backup_codes',
              error: verificationResult.error || 'Invalid backup code',
              failedAttempts: failedAttemptResult.failedAttempts,
              locked: failedAttemptResult.locked,
            },
          }
        );

        if (failedAttemptResult.locked) {
          this.activity.warning(
            'recovery_lockout_triggered',
            'User locked out due to too many failed recovery attempts',
            user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: user,
              target: { target_type: 'none' },
              metadata: {
                method: 'backup_codes',
                failedAttempts: failedAttemptResult.failedAttempts,
                lockedUntil: failedAttemptResult.lockedUntil,
              },
            }
          );
        }

        const { maxAttempts } = this.recoveryUtils.getLockoutConfig();
        const remainingAttempts =
          maxAttempts - failedAttemptResult.failedAttempts;

        let errorMessage = verificationResult.error || 'Invalid backup code';
        if (failedAttemptResult.locked) {
          const minutesRemaining = Math.ceil(
            (failedAttemptResult.lockedUntil!.getTime() - Date.now()) /
              (1000 * 60)
          );
          errorMessage = `Too many failed attempts. Please try again in ${minutesRemaining} minutes.`;
        } else if (remainingAttempts <= 2) {
          errorMessage += ` (${remainingAttempts} attempts remaining)`;
        }

        return res.render(this.viewResolver.views.auth.recovery_backup_codes, {
          title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
          username: recoveryAttempt.username,
          error: errorMessage,
        });
      }

      if (!verificationResult.matchedCode) {
        this.logger.error('No matched code returned from verification', {
          username: user.username,
          userId: user._id,
        });
        return res.render(this.viewResolver.views.auth.recovery_backup_codes, {
          title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
          username: recoveryAttempt.username,
          error: 'Verification failed. Please try again.',
        });
      }

      const updatedCodes = user.recovery.backup_codes.codes.filter(
        c => c !== verificationResult.matchedCode
      );

      this.recoveryUtils.clearRecoveryLockout(user);
      this.recoveryUtils.setLastRecoveredAt(user);

      await this.userService.updateById(user._id!, {
        recovery: {
          ...user.recovery,
          backup_codes: {
            ...user.recovery.backup_codes,
            codes: updatedCodes,
          },
          lockout: user.recovery.lockout, // Cleared lockout
          last_recovered_at: user.recovery.last_recovered_at, // Cooldown timestamp
        },
      });

      this.activity.success(
        'account_recovery_successful',
        'User successfully recovered account using backup code',
        user,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'none',
          },
        }
      );

      this.notificationService
        .sendSecurityAlert(
          { email: user.email, username: user.username },
          'account_recovered',
          {
            method: 'backup_codes',
            timestamp: new Date().toISOString(),
            ip: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
          }
        )
        .catch(err => {
          this.logger.error('Failed to send recovery notification email', {
            userId: user._id,
            error: err,
          });
        });

      const remainingCodesCount = updatedCodes.length;
      if (remainingCodesCount <= 2) {
        const settingsUrl = `${this.config().deployment.url}${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.settings}#recovery`;
        this.notificationService
          .sendBackupCodeWarning(
            { email: user.email, username: user.username, locale: user.locale },
            remainingCodesCount,
            settingsUrl
          )
          .catch(err => {
            this.logger.error('Failed to send backup code warning email', {
              userId: user._id,
              remainingCodes: remainingCodesCount,
              error: err,
            });
          });
      }

      this.sessionManager.remove(req, 'recoveryAttempt');

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: {
          id: user._id!.toString(),
          username: user.username,
          email: user.email,
          given_name: user.given_name,
          family_name: user.family_name,
          full_name: user.name,
          picture: user.picture,
          is_admin: (user as any).is_admin || false,
          last_used: Date.now(),
          zoneinfo: user.zoneinfo || 'UTC',
          locale: user.locale || 'en',
        },
      });

      this.sessionManager
        .flash(req)
        .success(
          'Account recovered successfully! It is crucial to change your password immediately or enforce security options for your account.'
        );
      res.redirect(
        `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'process_recovery_backup_codes_failed',
      });
      const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
        req,
        'recoveryAttempt'
      );
      res.render(this.viewResolver.views.auth.recovery_backup_codes, {
        title: `${req.t('auth.recovery_backup_codes.title')} - ${this.getAppTitle()}`,
        username: recoveryAttempt?.username || 'Unknown',
        error: 'An error occurred. Please try again.',
      });
    }
  };

  /**
   * Show secondary email recovery page
   */
  public recoverySecondaryEmail = (req: Request, res: Response): void => {
    const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
      req,
      'recoveryAttempt'
    );

    if (!recoveryAttempt) {
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
      );
    }

    res.render(this.viewResolver.views.auth.recovery_secondary_email, {
      title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
      username: recoveryAttempt.username,
      error: null,
    });
  };

  /**
   * Process secondary email recovery
   */
  public processRecoverySecondaryEmail = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { email } = req.body;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
        req,
        'recoveryAttempt'
      );

      if (!recoveryAttempt) {
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
        );
      }

      if (!email || !email.includes('@')) {
        return res.render(
          this.viewResolver.views.auth.recovery_secondary_email,
          {
            title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
            username: recoveryAttempt.username,
            error: 'Valid email address is required',
          }
        );
      }

      const user = await this.userService.findById(recoveryAttempt.userId);
      if (!user || !user.recovery?.secondary_email) {
        return res.render(
          this.viewResolver.views.auth.recovery_secondary_email,
          {
            title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
            username: recoveryAttempt.username,
            error: 'No secondary email found for this account',
          }
        );
      }

      if (
        user.recovery.secondary_email.email.toLowerCase() !==
        email.toLowerCase()
      ) {
        this.activity.failed(
          'recovery_attempt_failed',
          'Failed secondary email recovery attempt - email mismatch',
          user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: user,
            target: {
              target_type: 'none',
            },
            metadata: {
              method: 'secondary_email',
              error:
                'Email address does not match the registered secondary email',
            },
          }
        );
        return res.render(
          this.viewResolver.views.auth.recovery_secondary_email,
          {
            title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
            username: recoveryAttempt.username,
            error:
              'Email address does not match the registered secondary email',
          }
        );
      }

      if (!user.recovery.secondary_email.verified) {
        this.activity.failed(
          'recovery_attempt_failed',
          'Failed secondary email recovery attempt - email not verified',
          user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: user,
            target: {
              target_type: 'none',
            },
            metadata: {
              method: 'secondary_email',
              error: 'Secondary email is not verified',
            },
          }
        );
        return res.render(
          this.viewResolver.views.auth.recovery_secondary_email,
          {
            title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
            username: recoveryAttempt.username,
            error: 'Secondary email is not verified. Please contact support.',
          }
        );
      }

      const verificationCode = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      this.sessionManager.set(req, 'secondaryEmailVerification', {
        code: verificationCode,
        expiresAt,
        userId: user._id,
      });

      try {
        await this.notificationService.sendTemplatedEmail(
          email,
          `Account Recovery Verification Code - ${this.getAppTitle()}`,
          'email/mail.njk',
          {
            title: `Account Recovery Verification Code`,
            content: `
              <p>Hello ${user.given_name || user.username},</p>
              <p>You've requested to recover your ${this.getAppTitle()} account using your secondary email.</p>
              <p>Your verification code is: <strong style="font-size: 24px; letter-spacing: 2px;">${verificationCode}</strong></p>
              <p>This code will expire in 15 minutes.</p>
              <p>If you didn't request this, please ignore this email and secure your account.</p>
            `,
            username:
              `${user.given_name || ''} ${user.family_name || ''}`.trim(),
          }
        );

        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.recovery_verify_code}`
        );
      } catch (emailError) {
        this.logger.error('Failed to send recovery verification email', {
          username: user.username,
          email,
          error: emailError,
        });
        return res.render(
          this.viewResolver.views.auth.recovery_secondary_email,
          {
            title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
            username: recoveryAttempt.username,
            error: 'Failed to send verification email. Please try again.',
          }
        );
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'process_recovery_secondary_email_failed',
      });
      const recoveryAttempt = this.sessionManager.get<RecoveryAttempt>(
        req,
        'recoveryAttempt'
      );
      res.render(this.viewResolver.views.auth.recovery_secondary_email, {
        title: `${req.t('auth.recovery_secondary_email.title')} - ${this.getAppTitle()}`,
        username: recoveryAttempt?.username || 'Unknown',
        error: 'An error occurred. Please try again.',
      });
    }
  };

  /**
   * Show verification code page for secondary email recovery
   */
  public recoveryVerifyCode = (req: Request, res: Response): void => {
    const verification = this.sessionManager.get<SecondaryEmailVerification>(
      req,
      'secondaryEmailVerification'
    );

    if (!verification) {
      return res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
      );
    }

    res.render(this.viewResolver.views.auth.recovery_verify_code, {
      title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
      error: null,
    });
  };

  /**
   * Process verification code for secondary email recovery
   */
  public processRecoveryVerifyCode = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { code } = req.body;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      const verification = this.sessionManager.get<SecondaryEmailVerification>(
        req,
        'secondaryEmailVerification'
      );

      if (!verification) {
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.account_recovery}`
        );
      }

      if (!code) {
        return res.render(this.viewResolver.views.auth.recovery_verify_code, {
          title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
          error: 'Verification code is required',
        });
      }

      if (verification.expiresAt < new Date()) {
        const expiredUser = await this.userService.findById(
          verification.userId
        );
        if (expiredUser) {
          this.activity.failed(
            'recovery_attempt_failed',
            'Recovery verification code expired',
            expiredUser,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: expiredUser,
              target: {
                target_type: 'none',
              },
              metadata: {
                method: 'secondary_email_verification',
                error: 'Verification code expired',
              },
            }
          );
        }
        this.sessionManager.remove(req, 'secondaryEmailVerification');
        return res.render(this.viewResolver.views.auth.recovery_verify_code, {
          title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
          error: 'Verification code has expired. Please try again.',
        });
      }

      const userForLockout = await this.userService.findById(
        verification.userId
      );

      if (userForLockout) {
        const lockoutStatus =
          this.recoveryUtils.checkRecoveryLockout(userForLockout);
        if (lockoutStatus.locked) {
          this.activity.failed(
            'recovery_attempt_blocked',
            'Recovery attempt blocked due to lockout',
            userForLockout,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: userForLockout,
              target: { target_type: 'none' },
              metadata: {
                method: 'secondary_email_verification',
                lockedUntil: lockoutStatus.lockedUntil,
                minutesRemaining: lockoutStatus.minutesRemaining,
              },
            }
          );
          return res.render(this.viewResolver.views.auth.recovery_verify_code, {
            title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
            error: `Too many failed attempts. Please try again in ${lockoutStatus.minutesRemaining} minutes.`,
          });
        }
      }

      if (code !== verification.code) {
        if (userForLockout) {
          const failedAttemptResult =
            this.recoveryUtils.recordFailedRecoveryAttempt(userForLockout);

          await this.userService.updateById(userForLockout._id!, {
            recovery: {
              ...userForLockout.recovery,
              enabled: userForLockout.recovery?.enabled ?? false,
              methods: userForLockout.recovery?.methods ?? [],
              lockout: userForLockout.recovery?.lockout,
            },
          });

          this.activity.failed(
            'recovery_attempt_failed',
            'Invalid recovery verification code',
            userForLockout,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: userForLockout,
              target: {
                target_type: 'none',
              },
              metadata: {
                method: 'secondary_email_verification',
                error: 'Invalid verification code',
                failedAttempts: failedAttemptResult.failedAttempts,
                locked: failedAttemptResult.locked,
              },
            }
          );

          if (failedAttemptResult.locked) {
            this.activity.warning(
              'recovery_lockout_triggered',
              'User locked out due to too many failed recovery attempts',
              userForLockout,
              {
                ip_address: deviceInfos.ip,
                user_agent: deviceInfos.user_agent,
                device_infos: deviceInfos,
                actor: userForLockout,
                target: { target_type: 'none' },
                metadata: {
                  method: 'secondary_email_verification',
                  failedAttempts: failedAttemptResult.failedAttempts,
                  lockedUntil: failedAttemptResult.lockedUntil,
                },
              }
            );
          }

          const { maxAttempts } = this.recoveryUtils.getLockoutConfig();
          const remainingAttempts =
            maxAttempts - failedAttemptResult.failedAttempts;

          let errorMessage = 'Invalid verification code';
          if (failedAttemptResult.locked) {
            const minutesRemaining = Math.ceil(
              (failedAttemptResult.lockedUntil!.getTime() - Date.now()) /
                (1000 * 60)
            );
            errorMessage = `Too many failed attempts. Please try again in ${minutesRemaining} minutes.`;
          } else if (remainingAttempts <= 2) {
            errorMessage += ` (${remainingAttempts} attempts remaining)`;
          }

          return res.render(this.viewResolver.views.auth.recovery_verify_code, {
            title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
            error: errorMessage,
          });
        }

        return res.render(this.viewResolver.views.auth.recovery_verify_code, {
          title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
          error: 'Invalid verification code',
        });
      }

      const user = await this.userService.findById(verification.userId);
      if (!user) {
        return res.render(this.viewResolver.views.auth.recovery_verify_code, {
          title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
          error: 'User not found',
        });
      }

      this.recoveryUtils.clearRecoveryLockout(user);
      this.recoveryUtils.setLastRecoveredAt(user);
      if (user.recovery) {
        await this.userService.updateById(user._id!, {
          recovery: {
            ...user.recovery,
            lockout: user.recovery.lockout, // Cleared lockout
            last_recovered_at: user.recovery.last_recovered_at, // Cooldown timestamp
          },
        });
      }

      this.activity.success(
        'account_recovery_successful',
        'User successfully recovered account using secondary email',
        user,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'none',
          },
        }
      );

      this.notificationService
        .sendSecurityAlert(
          { email: user.email, username: user.username },
          'account_recovered',
          {
            method: 'secondary_email',
            timestamp: new Date().toISOString(),
            ip: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
          }
        )
        .catch(err => {
          this.logger.error('Failed to send recovery notification email', {
            userId: user._id,
            error: err,
          });
        });

      this.sessionManager.remove(req, 'secondaryEmailVerification');

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: {
          id: user._id!.toString(),
          username: user.username,
          email: user.email,
          given_name: user.given_name,
          family_name: user.family_name,
          full_name: user.name,
          picture: user.picture,
          is_admin: (user as any).is_admin || false,
          last_used: Date.now(),
          zoneinfo: user.zoneinfo || 'UTC',
          locale: user.locale || 'en',
        },
      });

      this.sessionManager
        .flash(req)
        .success(
          'Account recovered successfully! It is crucial to change your password immediately or enforce security options for your account.'
        );
      res.redirect(
        `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'process_recovery_verify_code_failed',
      });
      res.render(this.viewResolver.views.auth.recovery_verify_code, {
        title: `${req.t('auth.recovery_verify_code.title')} - ${this.getAppTitle()}`,
        error: 'An error occurred. Please try again.',
      });
    }
  };

  /**
   * Renders the email verification success page
   */
  public emailVerificationSuccess = (req: Request, res: Response): void => {
    const email = req.query.email || '';
    const accountName = req.query.name || '';

    const showExtraInfo = req.query.info === 'true';
    const showSecondaryAction = req.query.secondary === 'true';

    let accountInitials = '';
    if (accountName) {
      accountInitials = accountName
        .toString()
        .split(' ')
        .map(name => name.charAt(0).toUpperCase())
        .slice(0, 2)
        .join('');
    }

    res.render(this.viewResolver.views.auth.email_verification_success, {
      title: `Email Verified - ${this.getAppTitle()}`,
      email,
      accountName,
      accountInitials,
      showExtraInfo,
      showSecondaryAction,
      nextUrl:
        req.query.next ||
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`,
    });
  };

  /**
   * Renders the logout confirmation page or handles logout process
   */
  public logout = async (req: Request, res: Response): Promise<void> => {
    const confirmed = req.method === 'POST' || req.query.confirmed === 'true';
    const deviceInfos =
      this.clientDeviceInfoManager.getClientInfoFromRequest(req);

    const logoutType = req.query.type || req.body?.type || 'single'; // 'single' or 'all'
    const accountId = req.query.account_id || req.body?.account_id; // For single account logout
    const redirectUri =
      req.query.redirect_uri ||
      req.body?.redirect_uri ||
      `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`;
    const cancelUrl =
      req.query.cancel_url ||
      `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;

    const userData = this.sessionManager.getActiveUser(req);
    const allAuthenticatedUsers =
      this.sessionManager.getAuthenticatedUsers(req);

    if (!userData && !confirmed) {
      // No session to logout from — validate the redirect target before honoring it.
      const safeLoginFallback = `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`;
      this.redirectAuthority
        .redirect(res)
        .to(typeof redirectUri === 'string' ? redirectUri : undefined)
        .or(safeLoginFallback);
      return;
    }

    const sessionInfo = userData
      ? {
          name: userData.full_name || userData.username,
          email: userData.email || '',
          initials: (() => {
            const firstName = userData.given_name || '';
            const lastName = userData.family_name || '';
            if (firstName || lastName) {
              return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
            }
            return userData.username
              ? userData.username.substring(0, 2).toUpperCase()
              : 'U';
          })(),
        }
      : null;

    const accounts = [];

    const totalAccounts = allAuthenticatedUsers
      ? (allAuthenticatedUsers.active ? 1 : 0) +
        allAuthenticatedUsers.others.length
      : 0;

    // hasMultipleAccounts should be true only when there are 2 or more accounts
    const hasMultipleAccounts = totalAccounts > 1;

    if (hasMultipleAccounts && allAuthenticatedUsers) {
      if (allAuthenticatedUsers.active) {
        accounts.push({
          id: allAuthenticatedUsers.active.id,
          name:
            allAuthenticatedUsers.active.full_name ||
            allAuthenticatedUsers.active.username,
          email: allAuthenticatedUsers.active.email || '',
          avatar: allAuthenticatedUsers.active.picture || '',
          initials: (() => {
            const firstName = allAuthenticatedUsers.active.given_name || '';
            const lastName = allAuthenticatedUsers.active.family_name || '';
            if (firstName || lastName) {
              return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
            }
            return allAuthenticatedUsers.active.username
              ? allAuthenticatedUsers.active.username
                  .substring(0, 2)
                  .toUpperCase()
              : 'U';
          })(),
          is_active: true,
        });
      }

      allAuthenticatedUsers.others.forEach((account: any) => {
        accounts.push({
          id: account.id,
          name: account.full_name || account.username,
          email: account.email || '',
          avatar: account.picture || '',
          initials: (() => {
            const firstName = account.given_name || '';
            const lastName = account.family_name || '';
            if (firstName || lastName) {
              return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
            }
            return account.username
              ? account.username.substring(0, 2).toUpperCase()
              : 'U';
          })(),
          is_active: false,
        });
      });
    }

    // If confirmed, handle the logout
    if (confirmed) {
      try {
        if (logoutType === 'all') {
          const allUsers = this.sessionManager.getAuthenticatedUsers(req);
          const accountIds: string[] = [];

          if (allUsers) {
            if (allUsers.active) accountIds.push(allUsers.active.username);
            allUsers.others.forEach(user => accountIds.push(user.username));
          }

          if (allUsers) {
            if (allUsers.active) {
              this.activity.info(
                'logout_all',
                'User logged out from all accounts',
                allUsers.active,
                {
                  ip_address: deviceInfos.ip,
                  user_agent: deviceInfos.user_agent,
                  device_infos: deviceInfos,
                  actor: allUsers.active,
                  target: {
                    target_type: 'session',
                  },
                }
              );
            }
            allUsers.others.forEach((user: any) => {
              this.activity.info(
                'logout_all',
                'User logged out from all accounts',
                user,
                {
                  ip_address: deviceInfos.ip,
                  user_agent: deviceInfos.user_agent,
                  device_infos: deviceInfos,
                  actor: user,
                  target: {
                    target_type: 'session',
                  },
                }
              );
            });
          }

          this.sessionManager.clearAuthenticationData(req);

          await this.sessionManager.destroy(req);

          for (const accountId of accountIds) {
            try {
              await this.logoutOIDC(accountId);
              this.logger.info(`Cleared OIDC data for account: ${accountId}`);
            } catch (oidcError) {
              this.logger.error(
                `Error clearing OIDC data for account: ${accountId}`,
                { error: oidcError }
              );
              // Continue with other accounts even if one fails
            }
          }

          this.logger.info('User logged out from all accounts', {
            totalAccounts: accounts.length,
            activeUser: userData?.username,
            activeUserId: userData?.id,
          });

          // Set headers to prevent caching of logout page
          res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          });

          return res.render(this.viewResolver.views.auth.logout, {
            title: `Signed Out - ${this.getAppTitle()}`,
            confirmed: true,
            logoutType: 'all',
            accountCount: accounts.length,
            redirectUri,
          });
        } else if (logoutType === 'single' && accountId) {
          // Logout from specific account
          const removedAccount = accounts.find(acc => acc.id === accountId);

          const allUsers = this.sessionManager.getAuthenticatedUsers(req);
          const isOnlyAccount =
            allUsers &&
            ((allUsers.active && allUsers.others.length === 0) ||
              (!allUsers.active && allUsers.others.length === 1));

          if (isOnlyAccount) {
            // This is the only account - destroy entire session
            const username = removedAccount?.name || accountId;

            this.activity.info(
              'logout_single',
              'User logged out from only account',
              null,
              {
                ip_address: deviceInfos.ip,
                user_agent: deviceInfos.user_agent,
                device_infos: deviceInfos,
                actor: {
                  username,
                  actor_type: 'user',
                },
                target: {
                  target_type: 'session',
                },
              }
            );

            this.sessionManager.clearAuthenticationData(req);

            await this.sessionManager.destroy(req);

            try {
              await this.logoutOIDC(username);
              this.logger.info(`Cleared OIDC data for account: ${username}`);
            } catch (oidcError) {
              this.logger.error(
                `Error clearing OIDC data for account: ${username}`,
                { error: oidcError }
              );
              // Continue with logout even if OIDC cleanup fails
            }

            this.logger.info('User logged out from only account', {
              removedAccount: removedAccount?.name || accountId,
              removedAccountId: accountId,
            });

            // Set headers to prevent caching of logout page
            res.set({
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            });

            return res.render(this.viewResolver.views.auth.logout, {
              title: `Signed Out - ${this.getAppTitle()}`,
              confirmed: true,
              logoutType: 'single',
              accountName: removedAccount?.name || 'Account',
              redirectUri,
            });
          } else {
            // Multiple accounts - remove specific account (also revokes OIDC grants)
            const removeSuccess =
              await this.sessionManager.removeAuthenticatedUser(req, accountId);

            if (removeSuccess) {
              const username = removedAccount?.name || accountId;

              try {
                await this.logoutOIDC(username);
                this.logger.info(`Cleared OIDC data for account: ${username}`);
              } catch (oidcError) {
                this.logger.error(
                  `Error clearing OIDC data for account: ${username}`,
                  { error: oidcError }
                );
                // Continue with logout even if OIDC cleanup fails
              }

              this.logger.info('User logged out from specific account', {
                removedAccount: removedAccount?.name || accountId,
                removedAccountId: accountId,
                remainingAccounts: accounts.length - 1,
              });

              const remainingUsers =
                this.sessionManager.getAuthenticatedUsers(req);
              if (
                !remainingUsers ||
                (!remainingUsers.active && remainingUsers.others.length === 0)
              ) {
                // No accounts left - redirect to home
                return res.render(this.viewResolver.views.auth.logout, {
                  title: `Signed Out - ${this.getAppTitle()}`,
                  confirmed: true,
                  logoutType: 'single',
                  accountName: removedAccount?.name || 'Account',
                  redirectUri,
                });
              } else {
                // Still have accounts - redirect to account management
                this.sessionManager
                  .flash(req)
                  .success(
                    `Signed out from ${removedAccount?.name || 'account'} successfully.`
                  );
                return res.redirect(
                  `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
                );
              }
            } else {
              // Failed to remove account
              this.sessionManager
                .flash(req)
                .error('Failed to sign out from the selected account.');
              const dashboardFallback = `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;
              this.redirectAuthority
                .redirect(res)
                .to(typeof cancelUrl === 'string' ? cancelUrl : undefined)
                .or(dashboardFallback);
              return;
            }
          }
        } else {
          // Default single account logout (current active user)
          if (!hasMultipleAccounts) {
            const username = userData?.username;

            this.sessionManager.clearAuthenticationData(req);

            // Only one account - destroy session
            await this.sessionManager.destroy(req);

            if (username) {
              try {
                await this.logoutOIDC(username);
                this.logger.info(`Cleared OIDC data for account: ${username}`);
              } catch (oidcError) {
                this.logger.error(
                  `Error clearing OIDC data for account: ${username}`,
                  { error: oidcError }
                );
                // Continue with logout even if OIDC cleanup fails
              }
            }

            this.logger.info('User logged out successfully', {
              username: userData?.username,
              id: userData?.id,
            });

            // Set headers to prevent caching of logout page
            res.set({
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            });

            return res.render(this.viewResolver.views.auth.logout, {
              title: `Signed Out - ${this.getAppTitle()}`,
              confirmed: true,
              logoutType: 'single',
              accountName: sessionInfo?.name,
              redirectUri,
            });
          } else {
            // Multiple accounts - remove current active account (also revokes OIDC grants)
            const removeSuccess =
              await this.sessionManager.removeAuthenticatedUser(
                req,
                userData!.id
              );

            if (removeSuccess) {
              if (userData?.username) {
                try {
                  await this.logoutOIDC(userData.username);
                  this.logger.info(
                    `Cleared OIDC data for account: ${userData.username}`
                  );
                } catch (oidcError) {
                  this.logger.error(
                    `Error clearing OIDC data for account: ${userData.username}`,
                    { error: oidcError }
                  );
                  // Continue with logout even if OIDC cleanup fails
                }
              }

              this.logger.info('User logged out from active account', {
                username: userData?.username,
                id: userData?.id,
                remainingAccounts: accounts.length - 1,
              });

              const remainingUsers =
                this.sessionManager.getAuthenticatedUsers(req);
              if (
                !remainingUsers ||
                (!remainingUsers.active && remainingUsers.others.length === 0)
              ) {
                return res.render(this.viewResolver.views.auth.logout, {
                  title: `Signed Out - ${this.getAppTitle()}`,
                  confirmed: true,
                  logoutType: 'single',
                  accountName: sessionInfo?.name,
                  redirectUri,
                });
              } else {
                // Still have accounts - redirect to account management
                this.sessionManager
                  .flash(req)
                  .success('Signed out from your account successfully.');
                return res.redirect(
                  `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
                );
              }
            } else {
              // Failed to remove account
              this.sessionManager.flash(req).error('Failed to sign out.');
              const dashboardFallback = `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;
              this.redirectAuthority
                .redirect(res)
                .to(typeof cancelUrl === 'string' ? cancelUrl : undefined)
                .or(dashboardFallback);
              return;
            }
          }
        }
      } catch (error) {
        this.logger.error('Error during logout', {
          error,
          logoutType,
          accountId,
        });

        // Still try to show success page
        return res.render(this.viewResolver.views.auth.logout, {
          title: `Signed Out - ${this.getAppTitle()}`,
          confirmed: true,
          logoutType,
          redirectUri,
        });
      }
    } else {
      res.render(this.viewResolver.views.auth.logout, {
        title: `Sign Out - ${this.getAppTitle()}`,
        confirmed: false,
        sessionInfo,
        accounts: hasMultipleAccounts ? accounts : null,
        hasMultipleAccounts,
        redirectUri,
        cancelUrl,
      });
    }
  };

  /**
   * Initiate social login with a specific provider
   */
  public socialLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;

      if (!this.socialLoginManager.isProviderAvailable(provider)) {
        this.sessionManager
          .flash(req)
          .error(`${provider} login is not available`);
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      const continueUrl =
        (req.query.continue as string) ||
        (req.query.redirectTo as string) ||
        '';
      if (continueUrl) {
        await this.redirectAuthority.storeIntent(
          req,
          continueUrl,
          'social_login'
        );
      }

      const authUrl = await this.socialLoginManager.getAuthorizationUrl(
        provider,
        req
      );
      res.redirect(authUrl);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_login_initiation_failed',
        provider: req.params.provider,
      });

      this.sessionManager.flash(req).error('Failed to initiate social login');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
      );
    }
  };

  /**
   * Initiate social registration with a specific provider
   */
  public socialRegister = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;

      this.logger.info(`Initiating social registration for ${provider}`, {
        provider,
        query: req.query,
        hasSession: !!req.session,
      });

      if (!this.socialLoginManager.isProviderAvailable(provider)) {
        this.logger.warn(
          `Provider ${provider} is not available for registration`
        );
        this.sessionManager
          .flash(req)
          .error(`${provider} registration is not available`);
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const continueUrl =
        (req.query.continue as string) ||
        (req.query.redirectTo as string) ||
        '';
      if (continueUrl) {
        this.logger.info(`Storing continue URL for social registration`, {
          provider,
          continueUrl,
        });
        await this.redirectAuthority.storeIntent(
          req,
          continueUrl,
          'social_register'
        );
      }

      // Strict allowlist so the computed key cannot fall outside SocialProvider.
      const KNOWN_SOCIAL_PROVIDERS = [
        'google',
        'github',
        'facebook',
        'linkedin',
        'twitter',
        'microsoft',
        'apple',
      ] as const;
      if (!KNOWN_SOCIAL_PROVIDERS.includes(provider as never)) {
        this.logger.warn(`Rejected unknown social provider: ${provider}`);
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }
      const safeProvider = provider as (typeof KNOWN_SOCIAL_PROVIDERS)[number];
      this.sessionManager.set(req, 'socialRegister', {
        ...(this.sessionManager.get<SocialRegisterData>(
          req,
          'socialRegister'
        ) || ({} as SocialRegisterData)),
        [safeProvider]: {
          intent: 'register',
          timestamp: Date.now(),
        },
      });

      this.logger.info(`Social registration intent stored for ${provider}`, {
        provider,
        timestamp: Date.now(),
      });

      const authUrl = await this.socialLoginManager.getAuthorizationUrl(
        provider,
        req
      );
      this.logger.info(
        `Redirecting to authorization URL for ${provider} registration`,
        {
          provider,
          authUrl,
        }
      );

      res.redirect(authUrl);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_register_initiation_failed',
        provider: req.params.provider,
      });

      this.sessionManager
        .flash(req)
        .error('Failed to initiate social registration');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
      );
    }
  };

  /**
   * Handle social login/register callback
   */
  public socialCallback = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      const oidcContext = this.sessionManager.get<OIDCSocialContext>(
        req,
        'oidcSocialContext'
      );
      if (oidcContext) {
        const sessionAge = Date.now() - oidcContext.timestamp;
        if (sessionAge <= 10 * 60 * 1000) {
          this.logger.info(
            `Redirecting OIDC social callback for ${provider} to OIDC handler`,
            {
              provider,
              uid: oidcContext.uid,
              client_id: oidcContext.client_id,
              sessionAge,
            }
          );

          const oidcPath = this.config().oidc.path;
          const queryString = new URLSearchParams(
            req.query as Record<string, string>
          ).toString();
          const oidcCallbackUrl = `${oidcPath}/social/${provider}/callback${queryString ? `?${queryString}` : ''}`;

          return res.redirect(oidcCallbackUrl);
        } else {
          // OIDC context expired, clean it up and continue with regular flow
          this.logger.warn(`OIDC social context expired for ${provider}`, {
            provider,
            sessionAge,
            uid: oidcContext.uid,
          });
          this.sessionManager.remove(req, 'oidcSocialContext');
        }
      }

      this.logger.info(`Handling regular social callback for ${provider}`, {
        provider,
        query: req.query,
        hasSession: !!req.session,
      });

      if (!this.socialLoginManager.isProviderAvailable(provider)) {
        this.logger.warn(`Provider ${provider} is not available for callback`);
        this.sessionManager.flash(req).error(`${provider} is not available`);
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
        );
      }

      this.logger.info(
        `Calling social login manager handleCallback for ${provider}`
      );
      const result = await this.socialLoginManager.handleCallback(
        provider,
        req
      );

      this.logger.info(`Social callback result for ${provider}`, {
        provider,
        success: result.success,
        hasUser: !!result.user,
        hasIntegration: !!result.integration,
        requiresLinking: result.requiresLinking,
        error: result.error,
      });

      if (!result.success) {
        if (result.requiresLinking) {
          const socialConfig = this.getSocialBehaviorConfig();

          this.logger.info(`Callback requires linking for ${provider}`, {
            provider,
            error: result.error,
          });

          const socialRegister =
            this.sessionManager.get<SocialRegisterData>(
              req,
              'socialRegister'
            ) || ({} as SocialRegisterData);
          const isRegistration =
            socialRegister[provider]?.intent === 'register';

          this.logger.info(`Checking registration intent for ${provider}`, {
            provider,
            isRegistration,
            socialRegisterData: socialRegister[provider],
          });

          if (isRegistration) {
            this.logger.info(`Handling social registration for ${provider}`);
            // For registration, we need to create a new user account
            return this.handleSocialRegistration(req, res, provider, result);
          } else {
            // For login attempts, check if registration is allowed
            if (socialConfig.noUserAccount === 'allow_registration') {
              this.logger.info(
                `Allowing registration for ${provider} login attempt`
              );
              return this.handleSocialRegistration(req, res, provider, result);
            } else {
              // For login attempts, don't handle missing contact info
              // Missing contact info should only be handled during registration
              this.logger.info(
                `Rendering login required page for ${provider} - requires linking`
              );
              // Render error page instead of redirecting
              const errorMessage = socialConfig.showHelpfulErrors
                ? result.error ||
                  'Please log in first to link your social account'
                : 'Authentication failed. Please try again.';

              return res.render(this.viewResolver.views.auth.social_callback, {
                title: `Login Required - ${this.getAppTitle()}`,
                provider,
                error: errorMessage,
                redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`,
              });
            }
          }
        }

        this.logger.error(`Social authentication failed for ${provider}`, {
          provider,
          error: result.error,
        });
        // Render error page instead of redirecting
        return res.render(this.viewResolver.views.auth.social_callback, {
          title: `Social Authentication Error - ${this.getAppTitle()}`,
          provider,
          error: result.error || 'Social authentication failed',
          redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`,
        });
      }

      if (!result.user) {
        this.logger.error(
          `No user found after social authentication for ${provider}`,
          {
            provider,
            result,
          }
        );
        // Render error page instead of redirecting
        return res.render(this.viewResolver.views.auth.social_callback, {
          title: `User Not Found - ${this.getAppTitle()}`,
          provider,
          error: 'User not found after social authentication',
          redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`,
        });
      }

      if (this.mfaUtils.isMfaEnabled(result.user)) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.info(
          'social_mfa_required',
          `MFA required for social login user via ${provider}`,
          result.user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: result.user,
            target: {
              target_type: 'none',
            },
          }
        );

        const continueUrl =
          (req.query.continue as string) ||
          (req.query.redirectTo as string) ||
          this.redirectAuthority.getIntent(req, 'social_login', false) ||
          this.redirectAuthority.getIntent(req, 'social_register', false);

        const enabledMethodsObject = this.mfaUtils.getEnabledMethodsObject(
          result.user
        );
        const preferred_method = this.mfaUtils.getPreferredMethod(result.user);
        const needsSelection = this.mfaUtils.needsMethodSelection(result.user);

        this.sessionManager.set(req, 'pendingSocialMfaUser', {
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
          mfa_method: preferred_method,
          enabled_methods: enabledMethodsObject,
          provider,
          continue_url: continueUrl,
        });

        // If multiple MFA methods, redirect to selection page
        if (needsSelection) {
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_select}`
          );
        }

        if (preferred_method === 'email') {
          try {
            const otpResult = this.mfaUtils.generateEmailOtp(600);
            await this.userService.setEmailOtp(
              result.user.username,
              otpResult.code,
              600
            );

            await this.notificationService.sendTemplatedEmail(
              result.user.email ?? '',
              `Your ${this.getAppTitle()} login code`,
              'email/mail.njk',
              {
                title: `Your ${this.getAppTitle()} login code`,
                content: `<p>Your one-time code to finish the login process is <strong>${otpResult.code}</strong>. It expires in 10 minutes.</p>
                  <p>For your security, never share this code with anyone. If you did not request this code, please ignore this email.</p>`,
                username:
                  `${result.user.given_name || ''} ${result.user.family_name || ''}`.trim(),
              }
            );

            this.logger.info('Social login email MFA code sent', {
              username: result.user.username,
              provider,
            });
          } catch (err) {
            this.logger.error(err as Error, {
              username: result.user.username,
              provider,
              context: 'social_email_mfa_code_send_failed',
            });
            this.sessionManager
              .flash(req)
              .error('Failed to send verification code. Please try again.');
            return res.redirect(
              `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`
            );
          }
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
          );
        } else if (preferred_method === 'webauthn') {
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_webauthn}`
          );
        }

        // Default: TOTP - redirect to MFA verification page
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.mfa_verify}`
        );
      }

      const newUserAccount = {
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
      };

      const addAccountIntent = this.sessionManager.get<AddAccountIntent>(
        req,
        'addAccountIntent'
      );

      if (addAccountIntent && addAccountIntent.addingAccount) {
        const addResult = this.sessionManager.addAuthenticatedUser(
          req,
          newUserAccount,
          true
        );

        if (!addResult.success) {
          const reason =
            addResult.reason === 'max_limit_reached'
              ? 'Maximum number of accounts per session reached.'
              : 'This account is already signed in.';
          this.sessionManager.flash(req).info(reason);
        } else {
          this.activity.success(
            'social_account_added',
            `Social account (${provider}) added to session`,
            result.user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: result.user,
              target: {
                target_type: 'session',
              },
            }
          );
        }

        this.sessionManager.remove(req, 'addAccountIntent');
        const returnUrl =
          addAccountIntent.returnUrl ||
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`;
        return res.redirect(returnUrl);
      }

      const redirectUrl =
        this.redirectAuthority.getIntent(req, 'social_login', false) ||
        this.redirectAuthority.getIntent(req, 'social_register', false);
      const continueUrl =
        (req.query.continue as string) || (req.query.redirectTo as string);

      if (continueUrl) {
        // Regenerate session ID to prevent session fixation attacks
        try {
          await this.sessionManager.regenerate(req);
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to regenerate session during social login',
            provider,
          });
        }

        const addResult = this.sessionManager.addAuthenticatedUser(
          req,
          newUserAccount,
          true
        );

        if (!addResult.success) {
          const reason =
            addResult.reason === 'max_limit_reached'
              ? 'Maximum number of accounts per session reached.'
              : 'This account is already signed in.';
          this.sessionManager.flash(req).info(reason);
        } else {
          this.activity.success(
            'social_account_added_from_oidc',
            `Social account (${provider}) added from OIDC flow`,
            result.user,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: result.user,
              target: {
                target_type: 'session',
              },
            }
          );
        }

        this.redirectAuthority
          .redirect(res)
          .to(continueUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      } else if (redirectUrl) {
        // Regenerate session ID to prevent session fixation attacks
        try {
          await this.sessionManager.regenerate(req);
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to regenerate session during social login',
            provider,
          });
        }

        this.redirectAuthority.getIntent(req, 'social_login', true);
        this.redirectAuthority.getIntent(req, 'social_register', true);

        this.activity.success(
          'social_login_success',
          `User logged in with ${provider}`,
          result.user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: result.user,
            target: {
              target_type: 'none',
            },
          }
        );

        this.sessionManager.setAuthenticated(req, {
          currentActiveLoggedUser: newUserAccount,
        });

        const finalRedirectUrl = this.redirectAuthority.buildRedirectUrl(
          redirectUrl,
          {
            email: result.user.email ?? '',
            status: 'authenticated',
            provider,
          }
        );

        this.redirectAuthority
          .redirect(res)
          .to(finalRedirectUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      } else {
        // Regenerate session ID to prevent session fixation attacks
        try {
          await this.sessionManager.regenerate(req);
        } catch (err) {
          this.logger.error(err as Error, {
            context: 'Failed to regenerate session during social login',
            provider,
          });
        }

        // Normal social login - redirect directly to dashboard
        this.sessionManager.setAuthenticated(req, {
          currentActiveLoggedUser: newUserAccount,
        });

        this.activity.success(
          'social_login_success',
          `User logged in with ${provider}`,
          result.user,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: result.user,
            target: {
              target_type: 'none',
            },
          }
        );

        return res.redirect(
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
        );
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_callback_failed',
        provider: req.params.provider,
      });

      return res.render(this.viewResolver.views.auth.social_callback, {
        title: `Social Authentication Error - ${this.getAppTitle()}`,
        provider: req.params.provider,
        error: 'An unexpected error occurred during social authentication',
        redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`,
      });
    }
  };

  /**
   * Handle social registration when user doesn't exist
   */
  private async handleSocialRegistration(
    req: Request,
    res: Response,
    provider: SocialProvider,
    result: any
  ): Promise<void> {
    try {
      const socialConfig = this.getSocialBehaviorConfig();
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.logger.info(`Handling social registration for ${provider}`, {
        provider,
        result: {
          success: result.success,
          requiresLinking: result.requiresLinking,
          error: result.error,
          hasExistingIntegration: !!result.existingIntegration,
        },
      });

      const providerData = result.providerData;
      if (!providerData) {
        this.logger.error(
          `No provider data available for ${provider} registration`,
          {
            provider,
            result,
          }
        );

        return res.render(this.viewResolver.views.auth.social_callback, {
          title: `Social Registration Error - ${this.getAppTitle()}`,
          provider,
          error: 'Failed to retrieve user information from social provider',
          redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`,
        });
      }

      if (!providerData.email && !providerData.phone_number) {
        if (socialConfig.missingContactInfo === 'reject_login') {
          return res.render(this.viewResolver.views.auth.social_callback, {
            title: `Social Registration Error - ${this.getAppTitle()}`,
            provider,
            error: `${provider} account must have an email address or phone number to register`,
            redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`,
          });
        } else if (socialConfig.missingContactInfo === 'redirect_to_form') {
          this.sessionManager.set(req, 'socialRegistrationPending', {
            provider,
            providerData,
            tokens: result.tokens,
            timestamp: Date.now(),
          });

          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }
      }

      const existingUser = await this.userService.findByEmailIncludingDisabled(
        providerData.email
      );
      if (existingUser) {
        this.logger.info(
          `User already exists with email ${providerData.email}, redirecting to login`,
          {
            provider,
            email: providerData.email,
          }
        );

        const errorMessage = socialConfig.showHelpfulErrors
          ? `An account with email ${providerData.email} already exists. Please log in first, then link your ${provider} account.`
          : `Account already exists with this email address.`;

        return res.render(this.viewResolver.views.auth.social_callback, {
          title: `Account Already Exists - ${this.getAppTitle()}`,
          provider,
          error: errorMessage,
          redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.login}`,
        });
      }

      const userData = {
        email: providerData.email,
        given_name: providerData.given_name || '',
        family_name: providerData.family_name || '',
        picture: providerData.picture || '',
        email_verified: socialConfig.autoVerifyEmail
          ? providerData.email_verified || true
          : false,
        auth_provider: provider, // Set to specific provider (github, google, etc.)
        register_with: provider, // Track which provider was used for registration
        account_enabled: !socialConfig.requirePasswordOnRegistration, // Disable account if password is required
      };

      this.logger.info(
        `Creating new user account for ${provider} registration`,
        {
          provider,
          email: providerData.email,
          userData,
        }
      );

      const newUser =
        await this.userService.createUserWithGeneratedUsername(userData);

      this.logger.info(
        `User created successfully for ${provider} registration`,
        {
          provider,
          userId: newUser._id,
          email: newUser.email,
          username: newUser.username,
        }
      );

      this.logger.info(`Creating social integration for ${provider}`, {
        provider,
        userId: newUser._id,
        providerData,
        hasTokens: !!result.tokens,
      });

      let socialIntegration;
      try {
        socialIntegration = await this.socialLoginManager.linkToUser(
          provider,
          newUser._id as string,
          providerData,
          result.tokens
        );

        this.logger.info(
          `Social integration created successfully for ${provider}`,
          {
            provider,
            userId: newUser._id,
            integrationId: socialIntegration._id,
          }
        );
      } catch (integrationError) {
        this.logger.error(
          `Failed to create social integration for ${provider}`,
          {
            provider,
            userId: newUser._id,
            error: (integrationError as Error).message,
            stack: (integrationError as Error).stack,
          }
        );
        throw integrationError;
      }

      this.logger.info(`Social registration successful for ${provider}`, {
        provider,
        userId: newUser._id,
        email: newUser.email,
        integrationId: socialIntegration._id,
      });

      if (socialConfig.requirePasswordOnRegistration) {
        this.sessionManager.set(req, 'socialPasswordSetup', {
          userId: newUser._id,
          provider,
          providerData,
          tokens: result.tokens,
          integrationId: socialIntegration._id,
          timestamp: Date.now(),
        });

        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_password_setup}?provider=${provider}`
        );
      }

      const newUserAccount = {
        id: newUser._id?.toString() || '',
        username: newUser.username,
        email: newUser.email,
        email_verified: newUser.email_verified || false,
        given_name: newUser.given_name || '',
        family_name: newUser.family_name || '',
        full_name:
          `${newUser.given_name || ''} ${newUser.family_name || ''}`.trim(),
        picture: newUser.picture || '',
        roles: newUser.roles || ['user'],
        is_admin:
          newUser.roles &&
          (newUser.roles.includes('admin') ||
            newUser.roles.includes('superadmin')),
        last_used: Date.now(),
      };

      // Regenerate session ID to prevent session fixation attacks
      try {
        await this.sessionManager.regenerate(req);
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to regenerate session during social registration',
          provider,
        });
      }

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: newUserAccount,
      });

      this.activity.success(
        'social_registration_success',
        `User registered with ${provider}`,
        newUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: newUser,
          target: {
            target_type: 'none',
          },
        }
      );

      const redirectUrl = this.redirectAuthority.getIntent(
        req,
        'social_register',
        false
      );
      const continueUrl =
        (req.query.continue as string) || (req.query.redirectTo as string);

      if (continueUrl) {
        this.redirectAuthority
          .redirect(res)
          .to(continueUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      } else if (redirectUrl) {
        this.redirectAuthority.getIntent(req, 'social_register', true);

        const finalRedirectUrl = this.redirectAuthority.buildRedirectUrl(
          redirectUrl,
          {
            email: newUser.email ?? '',
            status: 'registered',
            provider,
          }
        );

        this.redirectAuthority
          .redirect(res)
          .to(finalRedirectUrl)
          .or(
            `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
          );
        return;
      } else {
        return res.redirect(
          `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
        );
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_registration_handling_failed',
        provider,
      });

      // Render error page instead of redirecting
      return res.render(this.viewResolver.views.auth.social_callback, {
        title: `Social Registration Error - ${this.getAppTitle()}`,
        provider,
        error: 'Registration failed. Please try again or contact support.',
        redirectUrl: `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`,
      });
    }
  }

  /**
   * Social password setup page - when require_password_on_registration is true
   */
  public socialPasswordSetup = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { provider } = req.query;
      const socialPasswordData = this.sessionManager.get<SocialPasswordSetup>(
        req,
        'socialPasswordSetup'
      );

      if (!socialPasswordData || !provider) {
        this.sessionManager
          .flash(req)
          .error('Invalid social password setup session');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const sessionAge = Date.now() - socialPasswordData.timestamp;
      if (sessionAge > 30 * 60 * 1000) {
        this.sessionManager
          .flash(req)
          .error('Social password setup session has expired');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const passwordPolicy = this.userService.getPasswordPolicy();

      res.render(this.viewResolver.views.auth.social_password_setup, {
        title: `Complete Registration - ${this.getAppTitle()}`,
        provider,
        passwordPolicy,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_password_setup_page_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to load password setup page');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
      );
    }
  };

  /**
   * Process social password setup
   */
  public processSocialPasswordSetup = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { password, confirmPassword } = req.body;
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      const { provider } = req.query;
      const socialPasswordData = this.sessionManager.get<SocialPasswordSetup>(
        req,
        'socialPasswordSetup'
      );

      if (!socialPasswordData || !provider) {
        this.sessionManager
          .flash(req)
          .error('Invalid social password setup session');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const sessionAge = Date.now() - socialPasswordData.timestamp;
      if (sessionAge > 30 * 60 * 1000) {
        this.sessionManager
          .flash(req)
          .error('Social password setup session has expired');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      if (!password || !confirmPassword) {
        this.sessionManager
          .flash(req)
          .error('Password and confirmation are required');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_password_setup}?provider=${provider}`
        );
      }

      if (password !== confirmPassword) {
        this.sessionManager
          .flash(req)
          .error('Password and confirmation do not match');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_password_setup}?provider=${provider}`
        );
      }

      const validation = this.userService.validatePassword(password);
      if (!validation.isValid) {
        this.sessionManager
          .flash(req)
          .error(
            `Password requirements not met: ${validation.messages.join(', ')}`
          );
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_password_setup}?provider=${provider}`
        );
      }

      await this.userService.updateById(socialPasswordData.userId, {
        password: await this.passwordUtils.hashPassword(password),
        account_enabled: true, // Enable account after password is set
      });

      this.sessionManager.remove(req, 'socialPasswordSetup');

      const user = await this.userService.findById(socialPasswordData.userId);
      if (!user) {
        this.sessionManager.flash(req).error('User not found');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const newUserAccount = {
        id: user._id?.toString() || '',
        username: user.username,
        email: user.email,
        email_verified: user.email_verified || false,
        given_name: user.given_name || '',
        family_name: user.family_name || '',
        full_name: `${user.given_name || ''} ${user.family_name || ''}`.trim(),
        picture: user.picture || '',
        roles: user.roles || ['user'],
        is_admin: user.roles?.includes('admin') || false,
        last_used: Date.now(),
      };

      // Regenerate session ID to prevent session fixation attacks
      try {
        await this.sessionManager.regenerate(req);
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'Failed to regenerate session during social password setup',
          provider,
        });
      }

      this.sessionManager.setAuthenticated(req, {
        currentActiveLoggedUser: newUserAccount,
      });

      this.activity.success(
        'social_registration_completed',
        `User completed social registration with ${provider} and set password`,
        user,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'none',
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(
          `Registration completed successfully! Welcome to ${this.getAppTitle()}`
        );
      res.redirect(
        `${this.config().deployment.routes.accounts}${this.config().deployment.routes.account_routes.dashboard}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_password_setup_failed',
      });
      this.sessionManager.flash(req).error('Failed to complete password setup');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
      );
    }
  };

  /**
   * Social contact info completion page - when missing_contact_info is redirect_to_form
   */
  public socialContactInfo = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { provider } = req.query;
      // Only handle registration pending sessions (login doesn't need contact info)
      const socialContactData = this.sessionManager.get<SocialContactData>(
        req,
        'socialRegistrationPending'
      );

      if (!socialContactData || !provider) {
        this.sessionManager
          .flash(req)
          .error('Invalid social contact info session');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const sessionAge = Date.now() - socialContactData.timestamp;
      if (sessionAge > 30 * 60 * 1000) {
        this.sessionManager
          .flash(req)
          .error('Social contact info session has expired');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const contactChannels = this.config().security.authentication.signup
        .contact_channels || {
        email: { enabled: true, required: true },
        phone: { enabled: false, required: false },
        require_at_least_one: true,
      };

      res.render(this.viewResolver.views.auth.social_contact_info, {
        title: `Complete Registration - ${this.getAppTitle()}`,
        provider,
        providerData: socialContactData.providerData,
        isLogin: false, // Always false since this is only for registration
        contactChannels,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_contact_info_page_failed',
      });
      this.sessionManager.flash(req).error('Failed to load contact info page');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
      );
    }
  };

  /**
   * Process social contact info completion
   */
  public processSocialContactInfo = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { email, phone_number } = req.body;
      const { provider } = req.query;
      const socialContactData = this.sessionManager.get<SocialContactData>(
        req,
        'socialRegistrationPending'
      );

      if (!socialContactData || !provider) {
        this.sessionManager
          .flash(req)
          .error('Invalid social contact info session');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      const sessionAge = Date.now() - socialContactData.timestamp;
      if (sessionAge > 30 * 60 * 1000) {
        this.sessionManager
          .flash(req)
          .error('Social contact info session has expired');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
        );
      }

      if (!email && !phone_number) {
        this.sessionManager
          .flash(req)
          .error('Email address or phone number is required');
        return res.redirect(
          `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
        );
      }

      if (email) {
        // Limit input length to prevent ReDoS attacks
        if (email.length > 254) {
          this.sessionManager.flash(req).error('Email address is too long');
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }

        // Use a more efficient email regex that avoids catastrophic backtracking
        const emailRegex =
          /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        if (!emailRegex.test(email)) {
          this.sessionManager
            .flash(req)
            .error('Please enter a valid email address');
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }

        const existingUserByEmail =
          await this.userService.findByEmailIncludingDisabled(email);
        if (existingUserByEmail) {
          this.sessionManager
            .flash(req)
            .error(
              'An account with this email address already exists. Please use a different email or log in with your existing account.'
            );
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }
      }

      if (phone_number) {
        // Limit input length to prevent ReDoS attacks
        if (phone_number.length > 20) {
          this.sessionManager.flash(req).error('Phone number is too long');
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }

        const cleanPhone = phone_number.replace(/[\s\-()]/g, '');

        // Use a more efficient phone regex that avoids catastrophic backtracking
        const phoneRegex = /^\+?[1-9]\d{0,14}$/;
        if (!phoneRegex.test(cleanPhone)) {
          this.sessionManager
            .flash(req)
            .error('Please enter a valid phone number');
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }

        const existingUserByPhone =
          await this.userService.findByPhoneNumberIncludingDisabled(
            phone_number
          );
        if (existingUserByPhone) {
          this.sessionManager
            .flash(req)
            .error(
              'An account with this phone number already exists. Please use a different phone number or log in with your existing account.'
            );
          return res.redirect(
            `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.social_contact_info}?provider=${provider}`
          );
        }
      }

      const updatedProviderData = {
        ...socialContactData.providerData,
        email: email || socialContactData.providerData.email,
        phone_number:
          phone_number || socialContactData.providerData.phone_number,
      };

      this.sessionManager.remove(req, 'socialRegistrationPending');

      // Continue with social registration using updated provider data
      const result = {
        success: false,
        requiresLinking: true,
        providerData: updatedProviderData,
        tokens: socialContactData.tokens,
      };

      return this.handleSocialRegistration(
        req,
        res,
        provider as SocialProvider,
        result
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'social_contact_info_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to complete contact information');
      res.redirect(
        `${this.config().deployment.routes.auth}${this.config().deployment.routes.auth_routes.register}`
      );
    }
  };

  /**
   * Sync a logout action with the oidc session
   *
   * @param accountId The account id (username) to logout from
   */
  private async logoutOIDC(
    accountId: string
  ): Promise<ClearOIDCUserDataResult> {
    if (!accountId) {
      throw new Error('accountId is required');
    }

    try {
      this.logger.info(`Starting OIDC logout process for user: ${accountId}`);

      const sessions =
        await this.oidcAdapter.session.findByAccountId(accountId);
      const sessionIds = sessions.map(
        (session: any) => session._id || session.jti
      );

      this.logger.info(
        `Found ${sessionIds.length} sessions for user: ${accountId}`
      );

      const [
        sessionsResult,
        grantsResult,
        accessTokensResult,
        refreshTokensResult,
        interactionsResult,
      ] = await Promise.all([
        this.oidcAdapter.session.deleteSessionsByIds(sessionIds),
        this.oidcAdapter.grant.deleteGrantsByAccountId(accountId),
        this.oidcAdapter.accessToken.deleteByAccountId(accountId),
        this.oidcAdapter.refreshToken.deleteByAccountId(accountId),
        this.oidcAdapter.interaction.deleteByAccountId(accountId),
      ]);

      const asCount = (r: void | { deletedCount: number }) =>
        r && typeof r === 'object' ? r.deletedCount : 0;

      const result: ClearOIDCUserDataResult = {
        success: true,
        accountId,
        sessions: asCount(sessionsResult),
        grants: asCount(grantsResult),
        accessTokens: asCount(accessTokensResult),
        refreshTokens: asCount(refreshTokensResult),
        interactions: asCount(interactionsResult),
      };

      this.logger.info(
        `Successfully completed OIDC logout for user: ${accountId}`,
        {
          sessions: result.sessions,
          grants: result.grants,
          accessTokens: result.accessTokens,
          refreshTokens: result.refreshTokens,
          interactions: result.interactions,
        }
      );

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error during OIDC logout for user: ${accountId}`,
      });
      throw error;
    }
  }
}
