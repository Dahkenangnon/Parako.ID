import { Request, Response } from 'express';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IAuthService } from '../di/interfaces/auth-service.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import type { INotificationService } from '../di/interfaces/notification-service.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../di/interfaces/client-device-info-manager.interface.js';
import type { ISocialLoginManager } from '../di/interfaces/social-login-manager.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';
import type { IMfaUtils } from '../di/interfaces/mfa-utils.interface.js';
import type { IRecoveryUtils } from '../di/interfaces/recovery-utils.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { SupportedLanguage } from '../utils/misc.js';
import type { IUploadMiddleware } from '../di/interfaces/upload-middleware.interface.js';
import type { IAccountController } from '../di/interfaces/account-controller.interface.js';
import { TYPES } from '../di/types.js';
import { SessionUserAccount } from '../utils/session.js';
import { validateIdentifier } from '../utils/custom-identifier-validation.js';
import type {
  ProfileUpdateData,
  PasswordChangeData,
} from '../di/interfaces/user-service.interface.js';
import type { RecoveryMethod } from '../utils/recovery.js';
import type { MfaMethod } from '../utils/mfa.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import type { SocialProvider } from '../types/social-integration.js';
import type { IRedirectAuthority } from '../di/interfaces/redirect-authority.interface.js';
import type { IWebAuthnService } from '../di/interfaces/webauthn-service.interface.js';
import { checkPasswordBreach } from '../utils/password-breach.js';
import type { OidcClientData } from '../oidc/adapter/client.interface.js';

/**
 * Maps short locale codes to BCP-47 format for JavaScript's toLocaleString/toLocaleDateString
 */
const getLocaleCode = (locale?: string): string => {
  const localeMap: Record<string, string> = {
    en: 'en-US',
    fr: 'fr-FR',
    es: 'es-ES',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-PT',
    ru: 'ru-RU',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
  };
  return localeMap[locale || 'en'] || 'en-US';
};

@injectable()
export class AccountsController implements IAccountController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.ActivityService) private readonly activity: IActivityService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.SocialIntegrationService)
    private readonly socialIntegrationService: ISocialIntegrationService,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.RecoveryUtils) private readonly recoveryUtils: IRecoveryUtils,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.UploadMiddleware)
    private readonly uploadMiddleware: IUploadMiddleware,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.RedirectAuthority)
    private readonly redirectAuthority: IRedirectAuthority,
    @inject(TYPES.WebAuthnService)
    private readonly webauthnService: IWebAuthnService
  ) {}

  private getAppTitle() {
    return this.configManager.getConfig().application.title;
  }

  /**
   * Resolve a user picture value to a displayable URL.
   * External HTTP(S) URLs pass through; storage keys get resolved
   * to signed `/media/file/...` URLs.
   */
  private resolvePictureUrl(picture: string | undefined | null): string {
    if (!picture) return '';
    const resolved = this.uploadMiddleware.getFileUrl(picture);
    return typeof resolved === 'string' ? resolved : picture;
  }

  private async getUnifiedClientInfo(
    clientId: string
  ): Promise<OidcClientData | null> {
    try {
      const adapterClient =
        await this.oidcAdapter.client.findClientById(clientId);
      if (adapterClient) return adapterClient;

      try {
        const rawClient = await this.oidcAdapter.client.find(clientId);
        if (rawClient) {
          return {
            client_id: clientId,
            client_name: (rawClient as any).client_name || clientId,
            application_type: (rawClient as any).application_type || 'web',
            logo_uri: (rawClient as any).logo_uri,
            client_uri: (rawClient as any).client_uri,
          } as OidcClientData;
        }
      } catch {
        // Not found in raw adapter either
      }

      return null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_unified_client_info_failed',
        clientId,
      });
      return null;
    }
  }
  public myAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const userSessions = await this.oidcAdapter.session.findByAccountId(
        userData.username
      );
      const activeSessionsCount = userSessions ? userSessions.length : 0;

      const userGrants = await this.oidcAdapter.grant.findGrantsByAccountId(
        userData.username
      );
      const connectedAppsCount = userGrants
        ? new Set(userGrants.map(grant => grant.payload.clientId as string))
            .size
        : 0;

      const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);
      const totalAccounts = authenticatedUsers
        ? 1 + authenticatedUsers.others.length
        : 1;

      const lastActivity = await this.activity.getLastActivityInfoFormatted(
        userData.id,
        userData.username,
        {
          language: (userData.locale || 'en') as SupportedLanguage,
          timezone: userData.zoneinfo || 'UTC',
          serverTimezone: true,
          useRelativeTime: true,
        }
      );

      res.render(this.viewResolver.views.accounts.my_account, {
        title: 'My Account',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
          mfa: currentUser.mfa,
          phone_number: currentUser.phone_number,
          phone_number_verified: currentUser.phone_number_verified,
          activeSessions: `${activeSessionsCount} device${activeSessionsCount !== 1 ? 's' : ''}`,
          connectedApps: `${connectedAppsCount} application${connectedAppsCount !== 1 ? 's' : ''}`,
        },
        mfaConfig: this.mfaUtils.getMfaConfig(),
        totalAccounts,
        lastActivity,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'my_account_page_load_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to load account information');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public settings = async (_req: Request, res: Response): Promise<void> => {
    res.redirect(
      `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_profile}`
    );
  };

  /**
   * Helper: get active user or redirect to login
   */
  private getActiveUserOrRedirect(
    req: Request,
    res: Response
  ): SessionUserAccount | null {
    const userData = this.sessionManager.getActiveUser(req);
    if (!userData) {
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
      return null;
    }
    return userData;
  }

  public settingsProfile = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.getActiveUserOrRedirect(req, res);
      if (!userData) return;

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const ciFields = this.userService.getCustomIdentifierFields();
      // Filter fields by edit policy - show all except admin_only to regular users
      const visibleCiFields = ciFields.filter(
        f => f.edit_policy !== 'admin_only'
      );

      res.render(this.viewResolver.views.accounts.settings_profile, {
        title: 'Account Settings - Profile',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
          custom_identifier_1: currentUser.custom_identifier_1,
          custom_identifier_2: currentUser.custom_identifier_2,
          custom_identifier_3: currentUser.custom_identifier_3,
        },
        customIdentifierFields: visibleCiFields,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_profile_page_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public settingsPreferences = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.getActiveUserOrRedirect(req, res);
      if (!userData) return;

      res.render(this.viewResolver.views.accounts.settings_preferences, {
        title: 'Account Settings - Preferences',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_preferences_page_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public settingsNotifications = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.getActiveUserOrRedirect(req, res);
      if (!userData) return;

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const config = this.configManager.getConfig();

      res.render(this.viewResolver.views.accounts.settings_notifications, {
        title: 'Account Settings - Notifications',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
          phone_number: currentUser.phone_number,
          phone_number_verified: currentUser.phone_number_verified,
          notification_preferences: currentUser.notification_preferences,
          recovery: currentUser.recovery,
        },
        notificationConfig: config.notifications,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_notifications_page_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public settingsSecurity = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.getActiveUserOrRedirect(req, res);
      if (!userData) return;

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const passwordPolicy = this.userService.getPasswordPolicy();

      const integrations = await this.socialIntegrationService.findByUser(
        userData.id
      );
      const linkedProviders = new Set(
        integrations.map(integration => integration.method)
      );
      const hasPassword =
        currentUser.password && currentUser.password.trim() !== '';

      res.render(this.viewResolver.views.accounts.settings_security, {
        title: 'Account Settings - Security',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
          mfa: currentUser.mfa,
        },
        mfaConfig: this.mfaUtils.getMfaConfig(),
        passwordPolicy,
        hasPassword,
        isSpecialPasswordCase: !hasPassword && linkedProviders.size === 1,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_security_page_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public settingsRecovery = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.getActiveUserOrRedirect(req, res);
      if (!userData) return;

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const recoveryConfig = this.recoveryUtils.getRecoveryConfig();

      res.render(this.viewResolver.views.accounts.settings_recovery, {
        title: 'Account Settings - Recovery',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
          recovery: currentUser.recovery,
        },
        recoveryConfig,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_recovery_page_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public settingsSocial = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.getActiveUserOrRedirect(req, res);
      if (!userData) return;

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const integrations = await this.socialIntegrationService.findByUser(
        userData.id
      );
      const availableProviders =
        this.socialLoginManager.getAvailableProviders();

      const linkedProviders = new Set(
        integrations.map(integration => integration.method)
      );

      const hasPassword =
        currentUser.password && currentUser.password.trim() !== '';

      const socialProviders = availableProviders.map(provider => ({
        provider,
        isLinked: linkedProviders.has(provider),
        integration:
          integrations.find(integration => integration.method === provider) ||
          null,
        isAvailable: this.socialLoginManager.isProviderAvailable(provider),
        canUnlink: !(
          linkedProviders.size === 1 &&
          linkedProviders.has(provider) &&
          !hasPassword
        ),
      }));

      res.render(this.viewResolver.views.accounts.settings_social, {
        title: 'Account Settings - Social Accounts',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
        },
        socialProviders,
        hasPassword,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'settings_social_page_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load settings');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
      );
    }
  };

  public updateNotificationPreferences = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const config = this.configManager.getConfig();

      if (!config.notifications?.defaults?.allow_user_preferences) {
        this.sessionManager
          .flash(req)
          .error('Notification preferences cannot be changed');
        res.redirect(
          `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_notifications}`
        );
        return;
      }

      const {
        preferred_channel,
        security_alerts,
        new_session_alerts,
        marketing,
      } = req.body;

      const notificationPreferences = {
        preferred_channel: preferred_channel || 'auto',
        security_alerts: security_alerts === 'on',
        new_session_alerts: new_session_alerts === 'on',
        marketing: marketing === 'on',
      };

      await this.userService.updateNotificationPreferences(
        userData.id,
        notificationPreferences
      );

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'notification_preferences_updated',
        'User updated notification preferences',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'user',
            entity_data: {
              changes: notificationPreferences,
            },
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success('Notification preferences updated successfully');
      res.redirect(
        `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_notifications}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'notification_preferences_update_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to update notification preferences');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_notifications}`
      );
    }
  };

  public updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const { firstname, lastname, phone } = req.body;
      const file = req.file;

      const profileData: ProfileUpdateData = {};

      if (firstname && firstname.trim()) {
        profileData.given_name = firstname.trim();
      }
      if (lastname && lastname.trim()) {
        profileData.family_name = lastname.trim();
      }
      if (firstname && lastname) {
        profileData.name = `${firstname.trim()} ${lastname.trim()}`;
      } else if (firstname) {
        profileData.name = firstname.trim();
      } else if (lastname) {
        profileData.name = lastname.trim();
      }

      if (phone !== undefined) {
        profileData.phone_number = phone.trim() || '';
      }

      if (file) {
        const storageKey = await this.uploadMiddleware.storeFile(
          file,
          'avatars'
        );
        profileData.picture = storageKey;

        if (userData.picture) {
          await this.uploadMiddleware.deleteFile(userData.picture);
        }
      }

      const config = this.configManager.getConfig();
      const ciFields = this.userService.getCustomIdentifierFields();

      // Fetch fresh user from DB for accurate set_once checks
      const dbUser = await this.userService.findById(userData.id);
      if (!dbUser) {
        this.sessionManager.flash(req).error('User not found');
        return res.redirect(
          `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}`
        );
      }

      // Process custom identifier fields per edit policy
      for (const field of ciFields) {
        // Only process editable/full/set_once fields (not admin_only)
        if (field.edit_policy === 'admin_only') continue;

        const formValue = req.body[`custom_identifier_${field.slot}`];
        if (formValue === undefined) continue;

        const trimmedValue = formValue.trim();
        const currentValue = this.userService.getCustomIdentifier(
          dbUser,
          field.slot
        );

        // set_once: skip if already has a value
        if (field.edit_policy === 'set_once' && currentValue) continue;

        if (trimmedValue) {
          // Validate format
          if (!validateIdentifier(trimmedValue, field)) {
            this.sessionManager
              .flash(req)
              .error(`Invalid ${field.name || 'identifier'} format`);
            res.redirect(
              `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_profile}`
            );
            return;
          }

          // Normalize case
          const normalizedValue = field.case_sensitive
            ? trimmedValue
            : trimmedValue.toLowerCase();

          // Check uniqueness
          const isAvailable =
            await this.userService.isCustomIdentifierAvailable(
              field.slot,
              normalizedValue,
              userData.id
            );
          if (!isAvailable) {
            this.sessionManager
              .flash(req)
              .error(`This ${field.name || 'identifier'} is already in use`);
            res.redirect(
              `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.settings_profile}`
            );
            return;
          }

          await this.userService.setCustomIdentifier(
            userData.id,
            field.slot,
            normalizedValue
          );
        } else if (field.edit_policy === 'full') {
          // Only 'full' policy allows removal
          await this.userService.removeCustomIdentifier(
            userData.id,
            field.slot
          );
        }
      }

      const updatedUser = await this.userService.updateProfile(
        userData.id,
        profileData
      );

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'profile_updated',
        'User updated their profile',
        updatedUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: updatedUser,
          target: {
            target_type: 'none',
          },
        }
      );

      const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);

      if (authenticatedUsers && authenticatedUsers.active) {
        authenticatedUsers.active = {
          ...authenticatedUsers.active,
          given_name:
            updatedUser.given_name || authenticatedUsers.active.given_name,
          family_name:
            updatedUser.family_name || authenticatedUsers.active.family_name,
          full_name: updatedUser.name || authenticatedUsers.active.full_name,
          picture: updatedUser.picture || authenticatedUsers.active.picture,
          last_used: Date.now(),
        };

        this.sessionManager.set(req, 'authenticatedUsers', authenticatedUsers);

        this.logger.info(
          `Updated session for user ${userData.username} after profile update`
        );
      } else {
        const updatedUserAccount = {
          ...userData,
          given_name: updatedUser.given_name || userData.given_name,
          family_name: updatedUser.family_name || userData.family_name,
          full_name: updatedUser.name || userData.full_name,
          picture: updatedUser.picture || userData.picture,
          last_used: Date.now(),
        };

        this.sessionManager.setAuthenticated(req, {
          currentActiveLoggedUser: updatedUserAccount,
        });
      }

      this.sessionManager.flash(req).success('Profile updated successfully');

      this.logger.info(`User ${userData.username} updated their profile`);

      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_profile}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'profile_update_failed' });
      this.sessionManager
        .flash(req)
        .error('Failed to update profile. Please try again.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_profile}`
      );
    }
  };

  public changePassword = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData: SessionUserAccount | undefined =
        this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const { currentPassword, newPassword, confirmPassword } = req.body;

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      const cooldownResult =
        this.recoveryUtils.checkRecoveryCooldown(currentUser);
      if (cooldownResult.inCooldown) {
        this.sessionManager
          .flash(req)
          .error(
            `For security, password changes are restricted for ${cooldownResult.hoursRemaining} hour(s) after account recovery.`
          );
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      const hasPassword =
        currentUser.password && currentUser.password.trim() !== '';

      const integrations = await this.socialIntegrationService.findByUser(
        userData.id
      );
      const linkedProviders = integrations.map(
        integration => integration.method
      );

      const isSpecialCase = !hasPassword && linkedProviders.length === 1;

      if (isSpecialCase) {
        // Special case: allow setting password without current password
        if (!newPassword || !confirmPassword) {
          this.sessionManager
            .flash(req)
            .error('New password and confirmation are required');
          res.redirect(
            `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
          );
          return;
        }
      } else {
        // Normal case: require all fields including current password
        if (!currentPassword || !newPassword || !confirmPassword) {
          this.sessionManager
            .flash(req)
            .error('All password fields are required');
          res.redirect(
            `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
          );
          return;
        }
      }

      if (newPassword !== confirmPassword) {
        this.sessionManager
          .flash(req)
          .error('New password and confirmation do not match');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      const validation = this.userService.validatePassword(newPassword);
      if (!validation.isValid) {
        this.sessionManager
          .flash(req)
          .error(
            `Password requirements not met: ${validation.messages.join(', ')}`
          );
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      // Check password against known breaches (HIBP)
      const breachConfig =
        this.configManager.getConfig().security?.authentication
          ?.password_breach_detection;
      if (breachConfig?.enabled && breachConfig.check_on_password_change) {
        try {
          const breachResult = await checkPasswordBreach(
            newPassword,
            breachConfig.api_timeout_ms
          );
          if (
            breachResult.breached &&
            breachResult.count >= (breachConfig.min_breach_count ?? 1)
          ) {
            this.sessionManager
              .flash(req)
              .error(
                `This password has appeared in ${breachResult.count} known data breaches and cannot be used. Please choose a different password.`
              );
            res.redirect(
              `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
            );
            return;
          }
        } catch (breachError) {
          if ((breachError as Error).message?.includes('data breaches')) {
            this.sessionManager
              .flash(req)
              .error((breachError as Error).message);
            res.redirect(
              `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
            );
            return;
          }
          this.logger.warn(
            'Password breach check failed during password change (allowing change)',
            { error: (breachError as Error).message }
          );
        }
      }

      const passwordData: PasswordChangeData = {
        currentPassword: isSpecialCase ? undefined : currentPassword,
        newPassword,
      };

      await this.userService.changePassword(userData.id, passwordData);

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'password_changed',
        'User changed their password',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'none',
          },
        }
      );

      // Security: Invalidate all other sessions after password change
      // This prevents attackers who may have compromised credentials from
      // maintaining access after the password is changed
      try {
        const currentSessionId = req.session?.id;
        if (currentSessionId) {
          const revokedCount =
            await this.oidcAdapter.session.revokeAllSessionsExcept(
              userData.username,
              currentSessionId
            );
          if (revokedCount > 0) {
            this.logger.info('Revoked sessions after password change', {
              username: userData.username,
              revokedCount,
            });
            this.activity.info(
              'sessions_revoked_password_change',
              `Revoked ${revokedCount} other sessions after password change`,
              null,
              {
                ip_address: deviceInfos.ip,
                user_agent: deviceInfos.user_agent,
                device_infos: deviceInfos,
                actor: {
                  username: userData.username,
                  email: userData.email,
                  actor_type: 'user',
                },
                target: {
                  target_type: 'session',
                  entity_data: { revokedCount },
                },
              }
            );
          }

          await this.sessionManager.regenerate(req);
        }
      } catch (sessionError) {
        this.logger.error(sessionError as Error, {
          context: 'Failed to revoke sessions after password change',
          username: userData.username,
        });
        // Don't fail the password change if session revocation fails
      }

      try {
        await this.notificationService.sendTemplatedEmail(
          userData.email as string,
          `Your ${this.getAppTitle()} password has been changed`,
          'email/mail.njk',
          {
            title: `Your ${this.getAppTitle()} password has been changed`,
            content: `
              <p>Hello ${userData.given_name || userData.email},</p>
              <p>Your password has been successfully changed. If you did not make this change, please contact support immediately.</p>
              <p><strong>Account:</strong> ${userData.email}</p>
              <p><strong>Change time:</strong> ${new Date().toLocaleString(getLocaleCode(userData.locale), { timeZone: userData.zoneinfo || 'UTC', dateStyle: 'medium', timeStyle: 'short' })}</p>
              <p><strong>IP Address:</strong> ${req.ip || req.socket?.remoteAddress || 'Unknown'}</p>
              <p><strong>Browser:</strong> ${req.get('User-Agent') || 'Unknown'}</p>
              <p>If this was not you, please secure your account immediately.</p>
            `,
            username:
              `${userData.given_name || ''} ${userData.family_name || ''}`.trim(),
          }
        );

        this.logger.info('Password change notification email sent', {
          username: userData.username,
          email: userData.email,
        });
      } catch (emailError) {
        this.logger.error('Failed to send password change notification email', {
          username: userData.username,
          email: userData.email,
          error: emailError,
        });
        // Don't fail the password change if email fails
      }

      this.sessionManager.flash(req).success('Password changed successfully');

      this.logger.info(`User ${userData.username} changed their password`);

      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'password_change_failed' });
      this.sessionManager
        .flash(req)
        .error('Failed to change password. Please try again.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  public removeAvatar = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      if (userData.picture) {
        await this.uploadMiddleware.deleteFile(userData.picture);
      }

      await this.userService.removeAvatar(userData.id);

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'avatar_removed',
        'User removed their avatar',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'none',
          },
        }
      );

      const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);

      if (authenticatedUsers && authenticatedUsers.active) {
        authenticatedUsers.active = {
          ...authenticatedUsers.active,
          picture: '',
          last_used: Date.now(),
        };

        this.sessionManager.set(req, 'authenticatedUsers', authenticatedUsers);

        this.logger.info(
          `Updated session for user ${userData.username} after avatar removal`
        );
      } else {
        const updatedUserAccount = {
          ...userData,
          picture: '',
          last_used: Date.now(),
        };

        this.sessionManager.setAuthenticated(req, {
          currentActiveLoggedUser: updatedUserAccount,
        });
      }

      this.logger.info(`User ${userData.username} removed their avatar`);

      res.json({ success: true, message: 'Avatar removed successfully' });
    } catch (error) {
      this.logger.error(error as Error, { context: 'avatar_removal_failed' });
      res.status(500).json({ error: 'Failed to remove avatar' });
    }
  };

  public enableMfa = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const securityUrl = `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`;
      const mfaConfig = this.mfaUtils.getMfaConfig();
      if (!mfaConfig.enabled) {
        this.sessionManager
          .flash(req)
          .error('Two-factor authentication is not available.');
        return res.redirect(securityUrl);
      }

      const method = (req.query.method as string) || 'totp';

      if (!this.mfaUtils.isMethodSupported(method as MfaMethod)) {
        this.sessionManager
          .flash(req)
          .error('This authentication method is not available.');
        return res.redirect(securityUrl);
      }

      if (method === 'email') {
        // Phase 1: Generate OTP and send verification email — do NOT enable MFA yet
        const { code } = await this.userService.initiateEmailMfaSetup(
          userData.username,
          600
        );

        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        await this.notificationService.sendOtp(
          {
            email: userData.email,
            username: userData.username,
            locale: userData.locale,
          },
          code,
          {
            deviceInfo: deviceInfos.user_agent || 'Unknown Device',
            ip: deviceInfos.ip || 'unknown',
          }
        );

        this.activity.info(
          'email_mfa_setup_initiated',
          'User initiated email MFA setup',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
            },
          }
        );

        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.setup_mfa}?method=email`
        );
      }

      const secret = this.mfaUtils.generateTotpSecret();
      await this.userService.initiateMfaTotpSetup(userData.username, secret);

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.info(
        'mfa_setup_initiated',
        'User initiated TOTP MFA setup',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
          },
        }
      );

      return res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.setup_mfa}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'enable_mfa_failed' });
      this.sessionManager.flash(req).error('Failed to enable 2FA.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  public disableMfa = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (currentUser) {
        const cooldownResult =
          this.recoveryUtils.checkRecoveryCooldown(currentUser);
        if (cooldownResult.inCooldown) {
          this.sessionManager
            .flash(req)
            .error(
              `For security, MFA changes are restricted for ${cooldownResult.hoursRemaining} hour(s) after account recovery.`
            );
          res.redirect(
            `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
          );
          return;
        }
      }

      const methodParam = req.query.method as string | undefined;
      const method =
        methodParam === 'totp' ||
        methodParam === 'email' ||
        methodParam === 'webauthn'
          ? methodParam
          : undefined;

      await this.userService.disableMfa(userData.username, method);

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'mfa_disabled',
        `User disabled ${method || 'all'} MFA`,
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
          },
          metadata: {
            method: method || 'all',
          },
        }
      );

      this.notificationService
        .sendSecurityAlert(
          {
            email: userData.email,
            username: userData.username,
            locale: userData.locale,
          },
          'mfa_disabled',
          {
            method: method || 'all',
            timestamp: new Date().toISOString(),
            ip: deviceInfos.ip,
            userAgent: deviceInfos.user_agent,
          }
        )
        .catch(err =>
          this.logger.error(err as Error, {
            context: 'mfa_disabled_notification_failed',
          })
        );

      const methodName = method
        ? method === 'totp'
          ? 'Authenticator App'
          : method === 'email'
            ? 'Email'
            : 'Passkey'
        : 'Two-factor authentication';
      this.sessionManager.flash(req).success(`${methodName} MFA disabled.`);
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'disable_mfa_failed' });
      this.sessionManager.flash(req).error('Failed to disable MFA.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  public setupMfaPage = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const securityUrl = `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`;
      const mfaConfig = this.mfaUtils.getMfaConfig();
      if (!mfaConfig.enabled) {
        this.sessionManager
          .flash(req)
          .error('Two-factor authentication is not available.');
        return res.redirect(securityUrl);
      }

      const user = await this.userService.findByUsername(userData.username);
      if (!user) {
        return res.redirect(securityUrl);
      }

      const method = (req.query.method as string) || 'totp';

      if (!this.mfaUtils.isMethodSupported(method as MfaMethod)) {
        this.sessionManager
          .flash(req)
          .error('This authentication method is not available.');
        return res.redirect(securityUrl);
      }

      if (method === 'email') {
        if (!this.mfaUtils.isEmailMfaPendingSetup(user)) {
          return res.redirect(securityUrl);
        }

        const maskedEmail = this.mfaUtils.maskEmail(
          user.email || userData.email || ''
        );

        return res.render(this.viewResolver.views.auth.setup_mfa, {
          title: 'Verify Your Email',
          method: 'email',
          maskedEmail,
          cancelUrl: securityUrl,
        });
      }

      // Default: TOTP setup
      if (!this.mfaUtils.isTotpPendingSetup(user)) {
        return res.redirect(securityUrl);
      }

      const totpSecret = this.mfaUtils.getUserTotpSecret(user);
      if (!totpSecret) {
        return res.redirect(securityUrl);
      }

      const otpauth = this.mfaUtils.generateTotpUri(
        user.email || user.username,
        totpSecret,
        'Parako.ID'
      );
      const qrDataUri = await this.mfaUtils.generateQrCode(otpauth);

      res.render(this.viewResolver.views.auth.setup_mfa, {
        title: 'Setup 2FA',
        method: 'totp',
        qrDataUri,
        cancelUrl: securityUrl,
      });
    } catch (err) {
      this.logger.error(err as Error, { context: 'setup_mfa_page_error' });
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  public verifySetupMfa = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const code = ((req.body.code as string) || '').trim();
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const method = (req.query.method as string) || 'totp';
      const securityUrl = `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`;

      const mfaConfig = this.mfaUtils.getMfaConfig();
      if (!mfaConfig.enabled) {
        this.sessionManager
          .flash(req)
          .error('Two-factor authentication is not available.');
        return res.redirect(securityUrl);
      }
      if (!this.mfaUtils.isMethodSupported(method as MfaMethod)) {
        this.sessionManager
          .flash(req)
          .error('This authentication method is not available.');
        return res.redirect(securityUrl);
      }
      const setupMfaUrl = `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.setup_mfa}`;

      if (method === 'email') {
        // Phase 2: Verify the email OTP code, then enable email MFA
        const ok = await this.userService.verifyEmailMfaSetupCode(
          userData.username,
          code
        );
        if (!ok) {
          this.sessionManager
            .flash(req)
            .error('Invalid code, please try again');
          return res.redirect(`${setupMfaUrl}?method=email`);
        }

        await this.userService.enableMfaEmail(userData.username);

        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'mfa_verified_enabled',
          'User verified and enabled email MFA',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
            },
          }
        );

        this.notificationService
          .sendSecurityAlert(
            {
              email: userData.email,
              username: userData.username,
              locale: userData.locale,
            },
            'mfa_enabled',
            {
              method: 'email',
              timestamp: new Date().toISOString(),
              ip: deviceInfos.ip,
              userAgent: deviceInfos.user_agent,
            }
          )
          .catch(err =>
            this.logger.error(err as Error, {
              context: 'mfa_enabled_notification_failed',
            })
          );

        this.sessionManager
          .flash(req)
          .success('Email-based 2FA enabled successfully');

        const user = await this.userService.findByUsername(userData.username);
        const hasBackupCodes =
          user?.recovery?.backup_codes?.codes &&
          user.recovery.backup_codes.codes.length > 0;

        if (hasBackupCodes) {
          return res.redirect(securityUrl);
        }

        const backupCodeResult = await this.recoveryUtils.generateBackupCodes();

        await this.userService.updateById(userData.id, {
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: {
              codes: backupCodeResult.hashedCodes,
              generated_at: backupCodeResult.generatedAt,
              expires_at: backupCodeResult.expiresAt,
            },
          },
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');

        return res.render(this.viewResolver.views.auth.recovery_codes_display, {
          title: 'Recovery Codes',
          backup_codes: backupCodeResult.codes,
          continueUrl: securityUrl,
        });
      }

      // Default: TOTP verification
      const ok = await this.userService.verifyTotpSetupCode(
        userData.username,
        code
      );
      if (!ok) {
        this.sessionManager.flash(req).error('Invalid code, please try again');
        return res.redirect(setupMfaUrl);
      }

      const user = await this.userService.findByUsername(userData.username);
      if (!user) {
        this.sessionManager.flash(req).error('User not found');
        return res.redirect(setupMfaUrl);
      }

      const enableTotpSecret = this.mfaUtils.getUserTotpSecret(user);
      if (!enableTotpSecret) {
        this.sessionManager.flash(req).error('TOTP secret not found');
        return res.redirect(setupMfaUrl);
      }

      await this.userService.enableMfaTotp(userData.username, enableTotpSecret);

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'mfa_verified_enabled',
        'User verified and enabled TOTP MFA',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
          },
        }
      );

      this.notificationService
        .sendSecurityAlert(
          {
            email: userData.email,
            username: userData.username,
            locale: userData.locale,
          },
          'mfa_enabled',
          {
            method: 'totp',
            timestamp: new Date().toISOString(),
            ip: deviceInfos.ip,
            userAgent: deviceInfos.user_agent,
          }
        )
        .catch(err =>
          this.logger.error(err as Error, {
            context: 'mfa_enabled_notification_failed',
          })
        );

      this.sessionManager
        .flash(req)
        .success('Two-factor authentication enabled');

      const updatedUser = await this.userService.findByUsername(
        userData.username
      );
      const hasBackupCodes =
        updatedUser?.recovery?.backup_codes?.codes &&
        updatedUser.recovery.backup_codes.codes.length > 0;

      if (hasBackupCodes) {
        res.redirect(securityUrl);
      } else {
        const backupCodeResult = await this.recoveryUtils.generateBackupCodes();

        await this.userService.updateById(userData.id, {
          recovery: {
            enabled: true,
            methods: ['backup_codes'],
            backup_codes: {
              codes: backupCodeResult.hashedCodes,
              generated_at: backupCodeResult.generatedAt,
              expires_at: backupCodeResult.expiresAt,
            },
          },
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');

        res.render(this.viewResolver.views.auth.recovery_codes_display, {
          title: 'Recovery Codes',
          backup_codes: backupCodeResult.codes,
          continueUrl: securityUrl,
        });
      }
    } catch (err) {
      this.logger.error(err as Error, { context: 'verify_setup_mfa_error' });
      this.sessionManager.flash(req).error('Failed to enable 2FA');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  /**
   * Display the passkeys management page
   */
  public passkeysPage = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      if (!this.mfaUtils.getMfaConfig().enabled) {
        this.sessionManager
          .flash(req)
          .error('Two-factor authentication is not available.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      if (!this.webauthnService.isEnabled()) {
        this.sessionManager
          .flash(req)
          .error('Passkeys are not enabled on this server.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      res.render(this.viewResolver.views.accounts.passkeys, {
        title: 'Passkeys',
      });
    } catch (err) {
      this.logger.error(err as Error, { context: 'passkeys_page_error' });
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  /**
   * Display the WebAuthn setup page
   */
  public setupWebAuthnPage = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      if (!this.mfaUtils.getMfaConfig().enabled) {
        this.sessionManager
          .flash(req)
          .error('Two-factor authentication is not available.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      if (!this.webauthnService.isEnabled()) {
        this.sessionManager
          .flash(req)
          .error('Passkeys are not enabled on this server.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
        );
        return;
      }

      res.render(this.viewResolver.views.auth.setup_webauthn, {
        title: 'Setup Passkey',
        cancelUrl: `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`,
      });
    } catch (err) {
      this.logger.error(err as Error, { context: 'setup_webauthn_page_error' });
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_security}`
      );
    }
  };

  public apps = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const userGrants = await this.oidcAdapter.grant.findGrantsByAccountId(
        userData.username
      );

      if (!userGrants || userGrants.length === 0) {
        res.render(this.viewResolver.views.accounts.apps, {
          title: 'Connected Applications',
          connectedApps: [],
        });
        return;
      }

      const grantsByClient = new Map<string, any[]>();
      const clientIds = new Set<string>();

      for (const grant of userGrants) {
        const clientId = grant.payload.clientId as string;
        if (!clientId) continue;

        clientIds.add(clientId);
        if (!grantsByClient.has(clientId)) {
          grantsByClient.set(clientId, []);
        }
        grantsByClient.get(clientId)!.push(grant);
      }

      const now = Date.now();
      const formatLastUsed = (timestamp: number | null): string => {
        if (!timestamp) return 'Recently';
        const diff = now - timestamp;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor(diff / (1000 * 60));

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0)
          return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        return 'Just now';
      };

      const userTimezone = userData.zoneinfo || 'UTC';
      const userLocale = getLocaleCode(userData.locale);

      const formatApprovedOn = (timestamp: number | null): string => {
        if (!timestamp) return 'Unknown';
        return new Date(timestamp).toLocaleDateString(userLocale, {
          timeZone: userTimezone,
        });
      };

      const connectedApps = await Promise.all(
        Array.from(clientIds).map(async clientId => {
          const clientGrants = grantsByClient.get(clientId) || [];

          let latestActivity: number | null = null;
          let earliestApproval: number | null = null;
          const scopesSet = new Set<string>();

          for (const grant of clientGrants) {
            const payload = grant.payload as any;

            if (payload.iat) {
              const issuedAt = payload.iat * 1000;
              if (!latestActivity || issuedAt > latestActivity) {
                latestActivity = issuedAt;
              }
              if (!earliestApproval || issuedAt < earliestApproval) {
                earliestApproval = issuedAt;
              }
            }

            if (
              payload.openid?.scope &&
              typeof payload.openid.scope === 'string'
            ) {
              const scopeArray = payload.openid.scope.split(' ');
              for (const scope of scopeArray) {
                const trimmedScope = scope.trim();
                if (trimmedScope) scopesSet.add(trimmedScope);
              }
            }

            if (payload.resources && typeof payload.resources === 'object') {
              const resources = payload.resources as Record<string, any>;
              for (const scope of Object.values(resources)) {
                if (scope && typeof scope === 'string') {
                  const scopeArray = scope.split(' ');
                  for (const s of scopeArray) {
                    const trimmedScope = s.trim();
                    if (trimmedScope) scopesSet.add(trimmedScope);
                  }
                }
              }
            }
          }

          const unifiedClient = await this.getUnifiedClientInfo(clientId);

          let clientInfo = {
            id: clientId,
            name: `Application ${clientId}`,
            developer: 'Unknown Developer',
            logo: null as string | null,
            last_used: formatLastUsed(latestActivity),
            approved_on: formatApprovedOn(earliestApproval),
          };

          if (unifiedClient) {
            let developer = 'Unknown Developer';
            if (unifiedClient.client_uri) {
              try {
                developer = new URL(unifiedClient.client_uri).hostname;
              } catch {
                this.logger.debug('Invalid client URI', {
                  clientId,
                  clientUri: unifiedClient.client_uri,
                });
              }
            }

            clientInfo = {
              ...clientInfo,
              name:
                unifiedClient.client_name ||
                unifiedClient.client_id ||
                `Application ${clientId}`,
              developer,
              logo: unifiedClient.logo_uri || null,
              last_used: formatLastUsed(latestActivity),
              approved_on: formatApprovedOn(earliestApproval),
            };
          }

          return {
            ...clientInfo,
            scopes: Array.from(scopesSet),
          };
        })
      );

      res.render(this.viewResolver.views.accounts.apps, {
        title: 'Connected Applications',
        connectedApps,
      });
    } catch (error) {
      this.logger.error(error as Error, { context: 'apps_load_failed' });
      this.sessionManager
        .flash(req)
        .error('Failed to load connected applications');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`
      );
    }
  };

  /**
   * Renders the active sessions page with both OIDC and Express session data
   */
  public sessions = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const activityService = this.activity;

      const [userSessions, expressSessions] = await Promise.all([
        this.oidcAdapter.session.findByAccountId(userData.username),
        this.sessionManager.findExpressSessionsForUser(userData.username),
      ]);

      const hasOidcSessions = userSessions && userSessions.length > 0;
      const hasExpressSessions = expressSessions && expressSessions.length > 0;

      if (!hasOidcSessions && !hasExpressSessions) {
        res.render(this.viewResolver.views.accounts.sessions, {
          title: 'Active Sessions',
          currentSession: null,
          otherSessions: [],
        });
        return;
      }

      const parseUserAgent = (
        userAgent: string
      ): { browser: string; os: string } => {
        if (!userAgent) return { browser: 'Unknown', os: 'Unknown' };

        const ua = userAgent.toLowerCase();
        let browser = 'Unknown';
        let os = 'Unknown';

        if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
        else if (ua.includes('firefox')) browser = 'Firefox';
        else if (ua.includes('safari') && !ua.includes('chrome'))
          browser = 'Safari';
        else if (ua.includes('edge')) browser = 'Edge';
        else if (ua.includes('opera') || ua.includes('opr/')) browser = 'Opera';
        else if (ua.includes('msie') || ua.includes('trident/'))
          browser = 'Internet Explorer';
        else if (ua.includes('brave')) browser = 'Brave';

        if (ua.includes('windows nt')) {
          if (ua.includes('windows nt 10.0')) os = 'Windows 10/11';
          else if (ua.includes('windows nt 6.3')) os = 'Windows 8.1';
          else if (ua.includes('windows nt 6.2')) os = 'Windows 8';
          else if (ua.includes('windows nt 6.1')) os = 'Windows 7';
          else os = 'Windows';
        } else if (ua.includes('mac os x')) {
          if (ua.includes('iphone')) os = 'iOS';
          else if (ua.includes('ipad')) os = 'iPadOS';
          else os = 'macOS';
        } else if (ua.includes('linux')) {
          if (ua.includes('android')) os = 'Android';
          else os = 'Linux';
        } else if (ua.includes('x11')) os = 'Linux';
        else if (ua.includes('iphone')) os = 'iOS';
        else if (ua.includes('ipad')) os = 'iPadOS';

        return { browser, os };
      };

      const formatTime = (timestampMs: number): string => {
        const now = Date.now();
        const diff = now - timestampMs;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor(diff / (1000 * 60));

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0)
          return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        return 'Just now';
      };

      const userTimezone = userData.zoneinfo || 'UTC';
      const userLocale = getLocaleCode(userData.locale);

      const formatDate = (timestampMs: number): string => {
        const date = new Date(timestampMs);
        return date.toLocaleString(userLocale, {
          timeZone: userTimezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        });
      };

      const getClientInfo = async (clientId: string): Promise<any> => {
        try {
          const unifiedClient = await this.getUnifiedClientInfo(clientId);

          if (unifiedClient) {
            let developer = 'Unknown Developer';
            if (unifiedClient.client_uri) {
              try {
                developer = new URL(unifiedClient.client_uri).hostname;
              } catch {
                this.logger.debug('Invalid client URI', {
                  clientId,
                  clientUri: unifiedClient.client_uri,
                });
              }
            }

            return {
              id: clientId,
              name:
                unifiedClient.client_name ||
                unifiedClient.client_id ||
                'Connected Application',
              developer,
              logo: unifiedClient.logo_uri || null,
            };
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'client_info_load_failed',
            clientId,
          });
        }

        return {
          id: clientId,
          name: 'Connected Application',
          developer: 'Unknown Developer',
          logo: null,
        };
      };

      const allSessions: any[] = [];

      if (hasOidcSessions) {
        const processedOidc = await Promise.all(
          userSessions.map(async oidcSession => {
            const payload = oidcSession.payload as any;
            const loginTime = payload.loginTs || payload.iat;
            const loginTimeMs = loginTime * 1000;

            const sessionActivities =
              await activityService.findActivitiesAroundTime(
                userData.username,
                loginTime,
                300
              );

            let activity = null;
            if (sessionActivities.length > 0) {
              sessionActivities.sort((a, b) => {
                const aTime = new Date(a.timestamp).getTime();
                const bTime = new Date(b.timestamp).getTime();
                return (
                  Math.abs(aTime - loginTimeMs) - Math.abs(bTime - loginTimeMs)
                );
              });
              activity = sessionActivities[0];
            }

            let browser = 'Unknown';
            let os = 'Unknown';
            let ip = 'Unknown';
            let location = 'Unknown';

            if (activity) {
              const parsedUA = parseUserAgent(activity.user_agent || '');
              browser = parsedUA.browser;
              os = parsedUA.os;
              ip = activity.ip_address || 'Unknown';

              if (ip && ip !== 'Unknown' && ip !== '0.0.0.0') {
                location = 'Online';
              }
            }

            const device = `${browser} on ${os}`;

            const clientIds = payload.authorizations
              ? Object.keys(payload.authorizations)
              : [];
            const clients = await Promise.all(
              clientIds.map(clientId => getClientInfo(clientId))
            );

            return {
              id: payload.jti || oidcSession._id,
              sessionType: 'oidc' as const,
              device,
              location,
              startTime: formatDate(loginTimeMs),
              lastActive: formatTime(loginTimeMs),
              lastActiveLabel: 'Login time',
              ip,
              loginTimestamp: loginTimeMs,
              clients,
              amr: payload.amr || [],
              acr: payload.acr || '',
              isCurrentSession: false,
            };
          })
        );
        allSessions.push(...processedOidc);
      }

      if (hasExpressSessions) {
        for (const sessDoc of expressSessions) {
          const sessData = sessDoc.session;
          if (!sessData) continue;

          const metadata = sessData._metadata || {};
          const authTimeMs = sessData.authTime
            ? new Date(sessData.authTime).getTime()
            : Date.now();
          const lastActivityMs = sessData.lastActivity
            ? new Date(sessData.lastActivity).getTime()
            : authTimeMs;

          let browser = 'Unknown';
          let os = 'Unknown';
          if (metadata.browser?.name) {
            browser = metadata.browser.name;
            os = metadata.os?.name || 'Unknown';
          } else if (sessData.userAgent) {
            const parsedUA = parseUserAgent(sessData.userAgent);
            browser = parsedUA.browser;
            os = parsedUA.os;
          }

          const device = `${browser} on ${os}`;
          const ip = sessData.ipAddress || metadata.createdIp || 'Unknown';

          allSessions.push({
            id: sessDoc._id as string,
            sessionType: 'express' as const,
            device,
            location: ip && ip !== 'Unknown' ? 'Online' : 'Unknown',
            startTime: formatDate(authTimeMs),
            lastActive: formatTime(lastActivityMs),
            lastActiveLabel: 'Last active',
            ip,
            loginTimestamp: authTimeMs,
            clients: [],
            amr: [],
            acr: '',
            isCurrentSession: req.sessionID === sessDoc._id,
          });
        }
      }

      allSessions.sort((a, b) => b.loginTimestamp - a.loginTimestamp);

      let currentSession = allSessions.find(s => s.isCurrentSession);

      // If no express session matched (e.g. user only has OIDC sessions), pick the newest
      if (!currentSession && allSessions.length > 0) {
        currentSession = allSessions[0];
        currentSession.isCurrentSession = true;
      }

      const otherSessions = allSessions.filter(s => s !== currentSession);

      res.render(this.viewResolver.views.accounts.sessions, {
        title: 'Active Sessions',
        currentSession,
        otherSessions,
      });
    } catch (error) {
      this.logger.error(error as Error, { context: 'sessions_load_failed' });
      this.sessionManager.flash(req).error('Failed to load active sessions');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`
      );
    }
  };

  /**
   * Switch to another authenticated account
   */
  public switchAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId } = req.body;

      if (!accountId) {
        this.sessionManager.flash(req).error('Account ID is required');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`
        );
      }

      const switchResult = this.sessionManager.switchUser(req, accountId);

      if (!switchResult.success) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        if (switchResult.reason === 'reauth_required') {
          this.sessionManager
            .flash(req)
            .info('Please re-enter your password to switch accounts.');
          const loginUrl = `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`;
          return res.redirect(`${loginUrl}?switch_to=${accountId}`);
        }

        this.activity.failed(
          'account_switch_failed',
          'Failed to switch to account',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: 'unknown',
              actor_type: 'user',
            },
            target: {
              target_type: 'session',
              entity_id: accountId,
            },
          }
        );
        this.sessionManager
          .flash(req)
          .error(
            'Unable to switch to the selected account. Account may no longer be available.'
          );
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`
        );
      }

      const activeUser = this.sessionManager.getActiveUser(req);
      if (activeUser) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'account_switched',
          'User switched to account',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: activeUser.username,
              email: activeUser.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'session',
            },
          }
        );

        this.logger.info(`User switched to account: ${activeUser.username}`, {
          newActiveUser: activeUser.username,
          accountId,
        });
        const displayName =
          activeUser.full_name ||
          `${activeUser.given_name || ''} ${activeUser.family_name || ''}`.trim() ||
          activeUser.username;
        this.sessionManager
          .flash(req)
          .success(`Switched to account: ${displayName}`);
      }

      const fallbackUrl = `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`;
      const redirectUrl = req.body.redirect || req.headers.referer;

      // Use fluent redirect API for secure URL validation
      this.redirectAuthority
        .redirect(res)
        .withOptions({
          allowLocal: true,
          requireHttps: false,
          customValidator: url => {
            // Additional validation: ensure the path starts with allowed routes
            const allowedPaths = [
              this.configManager.getConfig().deployment.routes.accounts,
              this.configManager.getConfig().deployment.routes.auth,
              '/',
            ];
            return allowedPaths.some(path => url.startsWith(path));
          },
        })
        .to(redirectUrl)
        .or(fallbackUrl);
    } catch (error) {
      this.logger.error(error as Error, { context: 'account_switch_failed' });
      this.sessionManager
        .flash(req)
        .error('Failed to switch accounts. Please try again.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`
      );
    }
  };

  /**
   * Add a new account by redirecting to login with account addition intent
   */
  public addAccount = (req: Request, res: Response): void => {
    try {
      this.sessionManager.set(req, 'addAccountIntent', {
        addingAccount: true,
        returnUrl:
          req.headers.referer ||
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`,
        timestamp: Date.now(),
      });

      res.redirect(
        `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}?intent=add-account`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'add_account_initiation_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to initiate account addition. Please try again.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.dashboard}`
      );
    }
  };

  /**
   * Remove an account from the session
   */
  public removeAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId } = req.body;

      if (!accountId) {
        res.status(400).json({
          success: false,
          error: 'Account ID is required',
        });
        return;
      }

      const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);
      if (!authenticatedUsers) {
        res.status(400).json({
          success: false,
          error: 'No authenticated users found',
        });
        return;
      }

      const totalAccounts = 1 + authenticatedUsers.others.length; // active + others
      if (totalAccounts <= 1) {
        res.status(400).json({
          success: false,
          error: 'Cannot remove the only account. Please logout instead.',
        });
        return;
      }

      const removeSuccess = await this.sessionManager.removeAuthenticatedUser(
        req,
        accountId
      );

      if (!removeSuccess) {
        res.status(404).json({
          success: false,
          error: 'Account not found or cannot be removed',
        });
        return;
      }

      this.logger.info(`Account removed from session: ${accountId}`);

      res.json({
        success: true,
        message: 'Account removed successfully',
      });
    } catch (error) {
      this.logger.error(error as Error, { context: 'account_removal_failed' });
      res.status(500).json({
        success: false,
        error: 'Failed to remove account. Please try again.',
      });
      return;
    }
  };

  /**
   * Revoke access to a specific application
   */
  public revokeApp = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const { clientId } = req.body;
      if (!clientId) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.apps}`
        );
        return;
      }

      this.logger.info(
        `Attempting to revoke access for user ${userData.username} and client ${clientId}`
      );

      // First, let's check if there are any grants to revoke
      const existingGrants = await this.oidcAdapter.grant.findGrantsByAccountId(
        userData.username
      );
      const grantsForClient = existingGrants.filter(
        grant => grant.payload.clientId === clientId
      );

      this.logger.info(
        `Found ${grantsForClient.length} existing grants for user ${userData.username} and client ${clientId}`
      );

      let revokedCount = 0;
      for (const grantDoc of grantsForClient) {
        try {
          // Use the jti field as the grant identifier
          const grantId = grantDoc.payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grantDoc._id} has no jti, skipping revocation`
            );
            continue;
          }

          // Use the provider's Grant model to find and revoke the grant
          const grant = await this.oidcAdapter.grant.find(grantId);
          if (grant) {
            await this.oidcAdapter.grant.destroy(grantId);
            revokedCount++;
            this.logger.info(
              `Successfully revoked grant ${grantId} for user ${userData.username} and client ${clientId}`
            );
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'grant_revocation_failed',
            grantId: grantDoc.payload.jti,
          });
          // Continue with other grants even if one fails
        }
      }

      if (revokedCount > 0) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'app_access_revoked',
          'User revoked access to application',
          null,
          {
            client_id: clientId,
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'grant',
              entity_id: clientId,
              entity_name: clientId,
            },
          }
        );

        this.logger.info(
          `User ${userData.username} revoked access to application ${clientId} (${revokedCount} grants)`
        );
        this.sessionManager
          .flash(req)
          .success('Application access revoked successfully');
      } else {
        this.logger.warn(
          `No grants found to revoke for user ${userData.username} and client ${clientId}`
        );
        this.sessionManager
          .flash(req)
          .error('No access found for this application');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'app_access_revocation_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to revoke application access');
    }

    res.redirect(
      `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.apps}`
    );
  };

  /**
   * Revoke access to all applications
   */
  public revokeAllApps = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        this.sessionManager.flash(req).error('Authentication required');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      this.logger.info(
        `Attempting to revoke all access for user ${userData.username}`
      );

      const existingGrants = await this.oidcAdapter.grant.findGrantsByAccountId(
        userData.username
      );

      this.logger.info(
        `Found ${existingGrants.length} existing grants for user ${userData.username} before deletion`
      );

      let revokedCount = 0;
      for (const grantDoc of existingGrants) {
        try {
          // Use the jti field as the grant identifier
          const grantId = grantDoc.payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grantDoc._id} has no jti, skipping revocation`
            );
            continue;
          }

          // Use the provider's Grant model to find and revoke the grant
          const grant = await this.oidcAdapter.grant.find(grantId);
          if (grant) {
            await this.oidcAdapter.grant.destroy(grantId);
            revokedCount++;
            this.logger.info(
              `Successfully revoked grant ${grantId} for user ${userData.username}`
            );
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'grant_revocation_failed',
            grantId: grantDoc.payload.jti,
          });
          // Continue with other grants even if one fails
        }
      }

      if (revokedCount > 0) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'all_apps_access_revoked',
          `User revoked access to all applications (${revokedCount} grants)`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'grant',
              entity_data: {
                revokedCount,
              },
            },
          }
        );

        this.logger.info(
          `User ${userData.username} revoked access to all applications (${revokedCount} grants)`
        );
        this.sessionManager
          .flash(req)
          .success(
            `Successfully revoked access to ${revokedCount} application(s)`
          );
      } else {
        this.sessionManager.flash(req).info('No applications to revoke');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'all_apps_access_revocation_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to revoke all application access');
    }

    res.redirect(
      `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.apps}`
    );
  };

  /**
   * Logout a specific session (supports both OIDC and Express sessions)
   */
  public logoutSession = async (req: Request, res: Response): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const { sessionId, sessionType } = req.body;
      if (!sessionId) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.sessions}`
        );
        return;
      }

      let revoked = false;
      if (sessionType === 'express') {
        revoked = await this.sessionManager.revokeExpressSession(sessionId);
      } else {
        revoked = await this.oidcAdapter.session.revokeSession(sessionId);
      }

      if (revoked) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'session_logout',
          'User logged out from a session',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'session',
              entity_id: sessionId,
              entity_data: { sessionType: sessionType || 'oidc' },
            },
          }
        );

        this.logger.info(
          `User ${userData.username} logged out from ${sessionType || 'oidc'} session ${sessionId}`
        );
        this.sessionManager
          .flash(req)
          .success('Session logged out successfully');
      } else {
        this.sessionManager
          .flash(req)
          .error('Session not found or already expired');
      }
    } catch (error) {
      this.logger.error(error as Error, { context: 'session_logout_failed' });
      this.sessionManager.flash(req).error('Failed to logout session');
    }

    res.redirect(
      `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.sessions}`
    );
  };

  /**
   * Logout all other sessions (except current)
   */
  public logoutAllOtherSessions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const currentSessionId = req.body.currentSessionId;

      if (!currentSessionId) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.sessions}`
        );
        return;
      }

      const oidcRevokedCount =
        await this.oidcAdapter.session.revokeAllSessionsExcept(
          userData.username,
          currentSessionId
        );

      // Also revoke all other Express sessions (excluding the current express session)
      let expressRevokedCount = 0;
      try {
        const expressSessions =
          await this.sessionManager.findExpressSessionsForUser(
            userData.username
          );
        for (const sessDoc of expressSessions) {
          const sessId = sessDoc._id as string;
          if (sessId !== req.sessionID) {
            const revoked =
              await this.sessionManager.revokeExpressSession(sessId);
            if (revoked) expressRevokedCount++;
          }
        }
      } catch (err) {
        this.logger.error(err as Error, {
          context: 'express_sessions_revocation_failed',
        });
      }

      const revokedCount = oidcRevokedCount + expressRevokedCount;

      if (revokedCount > 0) {
        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'all_sessions_logout',
          `User logged out from all other sessions (${revokedCount} sessions)`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'session',
              entity_data: {
                revokedCount,
              },
            },
          }
        );

        this.logger.info(
          `User ${userData.username} logged out from ${revokedCount} other sessions`
        );
        this.sessionManager
          .flash(req)
          .success(`Successfully logged out from ${revokedCount} session(s)`);
      } else {
        this.sessionManager.flash(req).info('No other sessions to logout');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'all_other_sessions_logout_failed',
      });
      this.sessionManager.flash(req).error('Failed to logout other sessions');
    }

    res.redirect(
      `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.sessions}`
    );
  };

  /**
   * Get account switcher data for UI
   */
  public getAccountSwitcherData = (req: Request, res: Response): void => {
    try {
      const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);

      if (!authenticatedUsers) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const config = this.configManager.getConfig();
      const multiAccountEnabled =
        config.security?.authentication?.session_management?.multiple_accounts
          ?.enabled;

      const accounts = [];

      if (authenticatedUsers.active) {
        const activeUser = authenticatedUsers.active;
        accounts.push({
          id: activeUser.id,
          username: activeUser.username,
          email: activeUser.email || '',
          given_name: activeUser.given_name || '',
          family_name: activeUser.family_name || '',
          full_name: activeUser.full_name || '',
          picture: activeUser.picture || '',
          displayName:
            activeUser.full_name ||
            `${activeUser.given_name || ''} ${activeUser.family_name || ''}`.trim() ||
            activeUser.username,
          initials: (() => {
            const firstName = activeUser.given_name || '';
            const lastName = activeUser.family_name || '';
            if (firstName || lastName) {
              return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
            }
            return activeUser.username
              ? activeUser.username.substring(0, 2).toUpperCase()
              : 'U';
          })(),
          isActive: true,
          last_used: activeUser.last_used,
          is_admin: activeUser.is_admin || false,
        });
      }

      // Add other accounts (only if multi-account is enabled)
      if (multiAccountEnabled !== false) {
        authenticatedUsers.others.forEach(account => {
          accounts.push({
            id: account.id,
            username: account.username,
            email: account.email || '',
            given_name: account.given_name || '',
            family_name: account.family_name || '',
            full_name: account.full_name || '',
            picture: account.picture || '',
            displayName:
              account.full_name ||
              `${account.given_name || ''} ${account.family_name || ''}`.trim() ||
              account.username,
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
            isActive: false,
            last_used: account.last_used,
            is_admin: account.is_admin || false,
          });
        });
      }

      res.json({
        success: true,
        accounts,
        totalAccounts: accounts.length,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'account_switcher_data_load_failed',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get account data',
      });
      return;
    }
  };

  /**
   * Link a social account to the current user
   */
  public linkSocialAccount = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;

      if (!this.socialLoginManager.isProviderAvailable(provider)) {
        this.sessionManager.flash(req).error(`${provider} is not available`);
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
        );
      }

      this.sessionManager.set(req, 'linkSocialAccountIntent', {
        provider,
        returnUrl: `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`,
      });

      const authUrl = await this.socialLoginManager.getAuthorizationUrl(
        provider,
        req
      );
      res.redirect(authUrl);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'link_social_account_failed',
        provider: req.params.provider,
      });

      this.sessionManager
        .flash(req)
        .error('Failed to initiate social account linking');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
      );
    }
  };

  /**
   * Unlink a social account from the current user
   */
  public unlinkSocialAccount = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const provider = req.params.provider as SocialProvider;

      const activeUser = this.sessionManager.getActiveUser(req);
      if (!activeUser) {
        this.sessionManager.flash(req).error('User not found in session');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
        );
      }

      const currentUser = await this.userService.findByUsername(
        activeUser.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
        );
      }

      const hasPassword =
        currentUser.password && currentUser.password.trim() !== '';

      const integrations = await this.socialIntegrationService.findByUser(
        activeUser.id
      );
      const linkedProviders = integrations.map(
        integration => integration.method
      );

      if (
        linkedProviders.length === 1 &&
        linkedProviders.includes(provider) &&
        !hasPassword
      ) {
        this.sessionManager
          .flash(req)
          .error(
            'You must set a password before unlinking your only social account. Please change your password first to ensure you can always access your account.'
          );
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
        );
      }

      await this.socialLoginManager.unlinkFromUser(provider, activeUser.id);

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.info(
        'social_account_unlinked',
        `User unlinked ${provider} account`,
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: activeUser.username,
            email: activeUser.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
            entity_name: provider,
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(`${provider} account unlinked successfully`);
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'unlink_social_account_failed',
        provider: req.params.provider,
      });

      this.sessionManager.flash(req).error('Failed to unlink social account');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_social}`
      );
    }
  };

  /**
   * Enable account recovery with backup codes and optional secondary email
   */
  public enableRecovery = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const recoveryUrl = `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`;
      const recoveryConfig = this.recoveryUtils.getRecoveryConfig();
      if (!recoveryConfig.enabled) {
        this.sessionManager
          .flash(req)
          .error('Account recovery is not available.');
        return res.redirect(recoveryUrl);
      }

      const { source, email } = req.body;
      const isFromRecoverySetup = source === 'recovery_setup';
      const method =
        (req.query.method as string) ||
        (isFromRecoverySetup ? 'unified' : 'backup_codes');

      if (isFromRecoverySetup || method === 'unified') {
        const currentUser = await this.userService.findByUsername(
          userData.username
        );
        if (!currentUser) {
          this.sessionManager.flash(req).error('User not found');
          return res.redirect(
            isFromRecoverySetup
              ? `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.recovery_setup}`
              : `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
          );
        }

        // Always generate backup codes
        const backupCodeResult = await this.recoveryUtils.generateBackupCodes();

        const existingRecovery = currentUser.recovery || {
          enabled: false,
          methods: [],
        };
        const existingMethods = (existingRecovery.methods ||
          []) as RecoveryMethod[];

        // Always include backup_codes
        const updatedMethods: RecoveryMethod[] = existingMethods.includes(
          'backup_codes'
        )
          ? existingMethods
          : [...existingMethods, 'backup_codes'];

        let recoveryConfig = {
          ...existingRecovery,
          enabled: true,
          methods: updatedMethods,
          backup_codes: {
            codes: backupCodeResult.hashedCodes, // Store hashed codes in DB
            generated_at: backupCodeResult.generatedAt,
            expires_at: backupCodeResult.expiresAt,
          },
        };

        let emailVerificationSent = false;
        let domainWarning: string | undefined;
        if (email && email.trim() && email.includes('@')) {
          const domainCheck = this.recoveryUtils.checkSecondaryEmailDomain(
            userData.email || '',
            email.trim()
          );
          if (domainCheck.sameDomain) {
            domainWarning = domainCheck.warning;
          }

          const verificationResult =
            this.recoveryUtils.generateSecondaryEmailVerification(email.trim());

          if (!updatedMethods.includes('secondary_email')) {
            updatedMethods.push('secondary_email');
          }

          recoveryConfig = {
            ...recoveryConfig,
            methods: updatedMethods,
            secondary_email: {
              email: verificationResult.email,
              verified: false,
              verification_token: verificationResult.tokenHash,
              verification_expires: verificationResult.expiresAt,
            },
          };

          try {
            await this.notificationService.sendTemplatedEmail(
              verificationResult.email,
              `Verify your recovery email for ${this.getAppTitle()}`,
              'email/mail.njk',
              {
                title: `Verify your recovery email`,
                content: `
                  <p>Hello ${userData.given_name || userData.email},</p>
                  <p>You've added this email as a recovery method for your ${this.getAppTitle()} account.</p>
                  <p>To verify this email address, please click the link below:</p>
                  <p><a href="${`${this.configManager.getConfig().deployment.url}${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.verify_recovery_email}`}?token=${verificationResult.verificationToken}"
                        style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">
                      Verify Recovery Email
                  </a></p>
                  <p>This link will expire in 24 hours.</p>
                  <p>If you didn't request this, please ignore this email.</p>
                `,
                username:
                  `${userData.given_name || ''} ${userData.family_name || ''}`.trim(),
              }
            );

            emailVerificationSent = true;

            const deviceInfos =
              this.clientDeviceInfoManager.getClientInfoFromRequest(req);

            this.activity.info(
              'recovery_email_verification_sent',
              'User initiated secondary email verification during recovery setup',
              null,
              {
                ip_address: deviceInfos.ip,
                user_agent: deviceInfos.user_agent,
                device_infos: deviceInfos,
                actor: {
                  username: userData.username,
                  email: userData.email,
                  actor_type: 'user',
                },
                target: {
                  target_type: 'config',
                },
              }
            );

            this.notificationService
              .sendSecurityAlert(
                {
                  email: userData.email,
                  username: userData.username,
                  locale: userData.locale,
                },
                'secondary_email_added',
                {
                  action:
                    'A secondary recovery email was added to your account',
                  detail:
                    'If you did not initiate this, please secure your account immediately.',
                  timestamp: new Date().toISOString(),
                  ip: deviceInfos.ip,
                  userAgent: deviceInfos.user_agent,
                }
              )
              .catch(err =>
                this.logger.error(err as Error, {
                  context: 'secondary_email_added_notification_failed',
                })
              );
          } catch (emailError) {
            this.logger.error('Failed to send recovery email verification', {
              username: userData.username,
              email: verificationResult.email,
              error: emailError,
            });
            this.sessionManager
              .flash(req)
              .error(
                'Recovery setup completed, but failed to send verification email. You can set up secondary email later in settings.'
              );
          }
        }

        await this.userService.updateById(userData.id, {
          recovery: recoveryConfig,
        });

        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'recovery_setup_completed',
          `User completed recovery setup with backup codes${email ? ' and secondary email' : ''}`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
            },
          }
        );

        this.sessionManager.set(
          req,
          'recoveryBackupCodes',
          backupCodeResult.codes
        );

        if (emailVerificationSent) {
          this.sessionManager
            .flash(req)
            .success(
              'Recovery setup completed! Backup codes generated and verification email sent to your secondary email address.'
            );
        } else if (email && email.trim()) {
          this.sessionManager
            .flash(req)
            .success(
              'Recovery setup completed! Backup codes generated. Please check your email settings if verification email was not received.'
            );
        } else {
          this.sessionManager
            .flash(req)
            .success(
              'Recovery setup completed! Backup codes generated successfully.'
            );
        }

        if (domainWarning) {
          this.sessionManager.flash(req).warning(domainWarning);
        }

        // Always redirect to recovery codes page to show the generated codes
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.recovery_codes}`
        );
      }

      if (method === 'backup_codes') {
        if (!recoveryConfig.methods.backup_codes.enabled) {
          this.sessionManager
            .flash(req)
            .error('Backup codes are not available.');
          return res.redirect(recoveryUrl);
        }

        const currentUser = await this.userService.findByUsername(
          userData.username
        );
        if (!currentUser) {
          this.sessionManager.flash(req).error('User not found');
          return res.redirect(recoveryUrl);
        }

        const backupCodeResult = await this.recoveryUtils.generateBackupCodes();

        const existingRecovery = currentUser.recovery || {
          enabled: false,
          methods: [],
        };
        const existingMethods = (existingRecovery.methods ||
          []) as RecoveryMethod[];
        const updatedMethods: RecoveryMethod[] = existingMethods.includes(
          'backup_codes'
        )
          ? existingMethods
          : [...existingMethods, 'backup_codes'];

        await this.userService.updateById(userData.id, {
          recovery: {
            ...existingRecovery,
            enabled: true,
            methods: updatedMethods,
            backup_codes: {
              codes: backupCodeResult.hashedCodes, // Store hashed codes in DB
              // usedCodes: [],
              generated_at: backupCodeResult.generatedAt,
              expires_at: backupCodeResult.expiresAt,
            },
          },
        });

        const deviceInfos =
          this.clientDeviceInfoManager.getClientInfoFromRequest(req);

        this.activity.success(
          'recovery_enabled',
          'User enabled account recovery with backup codes',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              username: userData.username,
              email: userData.email,
              actor_type: 'user',
            },
            target: {
              target_type: 'config',
            },
          }
        );

        this.sessionManager.set(
          req,
          'recoveryBackupCodes',
          backupCodeResult.codes
        );

        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.recovery_codes}`
        );
      }

      if (method === 'secondary_email') {
        if (!recoveryConfig.methods.secondary_email.enabled) {
          this.sessionManager
            .flash(req)
            .error('Secondary email recovery is not available.');
          return res.redirect(recoveryUrl);
        }

        const { email } = req.body;

        if (!email || !email.includes('@')) {
          this.sessionManager
            .flash(req)
            .error('Valid email address is required');
          return res.redirect(
            `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
          );
        }

        const currentUser = await this.userService.findByUsername(
          userData.username
        );
        if (!currentUser) {
          this.sessionManager.flash(req).error('User not found');
          return res.redirect(
            `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
          );
        }

        const verificationResult =
          this.recoveryUtils.generateSecondaryEmailVerification(email);

        const existingRecovery = currentUser.recovery || {
          enabled: false,
          methods: [],
        };
        const existingMethods = (existingRecovery.methods ||
          []) as RecoveryMethod[];
        const updatedMethods: RecoveryMethod[] = existingMethods.includes(
          'secondary_email'
        )
          ? existingMethods
          : [...existingMethods, 'secondary_email'];

        await this.userService.updateById(userData.id, {
          recovery: {
            ...existingRecovery,
            enabled: true,
            methods: updatedMethods,
            secondary_email: {
              email: verificationResult.email,
              verified: false,
              verification_token: verificationResult.tokenHash,
              verification_expires: verificationResult.expiresAt,
            },
          },
        });

        try {
          await this.notificationService.sendTemplatedEmail(
            verificationResult.email,
            `Verify your recovery email for ${this.getAppTitle()}`,
            'email/mail.njk',
            {
              title: `Verify your recovery email`,
              content: `
                <p>Hello ${userData.given_name || userData.email},</p>
                <p>You've added this email as a recovery method for your ${this.getAppTitle()} account.</p>
                <p>To verify this email address, please click the link below:</p>
                <p><a href="${`${this.configManager.getConfig().deployment.url}${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.verify_recovery_email}`}?token=${verificationResult.verificationToken}"
                      style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">
                    Verify Recovery Email
                </a></p>
                <p>This link will expire in 24 hours.</p>
                <p>If you didn't request this, please ignore this email.</p>
              `,
              username:
                `${userData.given_name || ''} ${userData.family_name || ''}`.trim(),
            }
          );

          const deviceInfos =
            this.clientDeviceInfoManager.getClientInfoFromRequest(req);

          this.activity.info(
            'recovery_email_verification_sent',
            'User initiated secondary email verification',
            null,
            {
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: {
                username: userData.username,
                email: userData.email,
                actor_type: 'user',
              },
              target: {
                target_type: 'config',
              },
            }
          );

          this.notificationService
            .sendSecurityAlert(
              {
                email: userData.email,
                username: userData.username,
                locale: userData.locale,
              },
              'secondary_email_added',
              {
                action: 'A secondary recovery email was added to your account',
                detail:
                  'If you did not initiate this, please secure your account immediately.',
                timestamp: new Date().toISOString(),
                ip: deviceInfos.ip,
                userAgent: deviceInfos.user_agent,
              }
            )
            .catch(err =>
              this.logger.error(err as Error, {
                context: 'secondary_email_added_notification_failed',
              })
            );

          this.sessionManager
            .flash(req)
            .success('Verification email sent to your secondary email address');
        } catch (emailError) {
          this.logger.error('Failed to send recovery email verification', {
            username: userData.username,
            email: verificationResult.email,
            error: emailError,
          });
          this.sessionManager
            .flash(req)
            .error('Failed to send verification email. Please try again.');
        }

        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      this.sessionManager.flash(req).error('Invalid recovery method');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.recovery_setup}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'enable_recovery_failed' });
      this.sessionManager.flash(req).error('Failed to enable account recovery');

      const { source } = req.body;
      const isFromRecoverySetup = source === 'recovery_setup';
      res.redirect(
        isFromRecoverySetup
          ? `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.recovery_setup}`
          : `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Disable specific recovery method
   */
  public disableRecovery = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const method = req.query.method as string;
      if (!method) {
        this.sessionManager.flash(req).error('Recovery method not specified');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser || !currentUser.recovery) {
        this.sessionManager.flash(req).error('No recovery configuration found');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      const existingRecovery = currentUser.recovery;
      const existingMethods = (existingRecovery.methods ||
        []) as RecoveryMethod[];

      const updatedMethods = existingMethods.filter(m => m !== method);

      let updatedRecovery = {
        ...existingRecovery,
        methods: updatedMethods,
      };

      if (method === 'backup_codes') {
        updatedRecovery = {
          ...updatedRecovery,
          backup_codes: undefined,
        };
      } else if (method === 'secondary_email') {
        updatedRecovery = {
          ...updatedRecovery,
          secondary_email: undefined,
        };
      } else if (method === 'security_questions') {
        updatedRecovery = {
          ...updatedRecovery,
          security_questions: undefined,
        };
      }

      if (updatedMethods.length === 0) {
        updatedRecovery = {
          enabled: false,
          methods: [],
        };
      }

      await this.userService.updateById(userData.id, {
        recovery: updatedRecovery,
      });

      // Safely generate method name for display
      const methodNameMap: Record<RecoveryMethod, string> = {
        backup_codes: 'backup codes',
        secondary_email: 'secondary email',
        sms: 'SMS',
        security_questions: 'security questions',
      };
      const methodName = methodNameMap[method as RecoveryMethod] || method;

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'recovery_method_disabled',
        `User disabled ${methodName} recovery method`,
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
            entity_name: methodName,
          },
        }
      );

      // Safely capitalize method name for display
      const capitalizedMethodName =
        methodName.charAt(0).toUpperCase() + methodName.slice(1).toLowerCase();

      this.sessionManager
        .flash(req)
        .success(`${capitalizedMethodName} recovery method disabled`);
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    } catch (error) {
      this.logger.error(error as Error, { context: 'disable_recovery_failed' });
      this.sessionManager.flash(req).error('Failed to disable recovery method');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Display backup codes page (one-time only)
   */
  public showRecoveryCodes = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const backup_codes = this.sessionManager.get(req, 'recoveryBackupCodes');

      if (!backup_codes || !Array.isArray(backup_codes)) {
        this.sessionManager
          .flash(req)
          .error(
            'No backup codes available. Codes can only be viewed once for security reasons.'
          );
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      // Clear the codes from session after displaying (one-time only)
      this.sessionManager.remove(req, 'recoveryBackupCodes');

      // Prevent browser/proxy caching of sensitive recovery codes
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');

      res.render(this.viewResolver.views.accounts.recovery_codes, {
        title: 'Account Recovery Codes',
        backup_codes,
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'show_recovery_codes_failed',
      });
      this.sessionManager.flash(req).error('Failed to load recovery codes');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Verify secondary email for recovery
   */
  public verifyRecoveryEmail = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== 'string') {
        this.sessionManager.flash(req).error('Invalid verification link');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      const user = await this.userService.findByRecoveryToken(token);

      if (!user || !user.recovery?.secondary_email) {
        this.sessionManager
          .flash(req)
          .error('Invalid or expired verification link');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      if (
        !user.recovery.secondary_email.verification_token ||
        !user.recovery.secondary_email.verification_expires
      ) {
        this.sessionManager.flash(req).error('Invalid verification link');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      const verificationResult = this.recoveryUtils.verifySecondaryEmailToken(
        token,
        user.recovery.secondary_email.verification_token,
        user.recovery.secondary_email.verification_expires
      );

      if (!verificationResult.valid) {
        this.sessionManager
          .flash(req)
          .error(verificationResult.error ?? 'Invalid verification link');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      await this.userService.updateById(user.id!, {
        recovery: {
          ...user.recovery,
          secondary_email: {
            ...user.recovery.secondary_email,
            verified: true,
            verification_token: undefined,
            verification_expires: undefined,
          },
        },
      });

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'recovery_email_verified',
        'User verified their recovery email',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: user.username,
            email: user.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
          },
        }
      );

      this.notificationService
        .sendSecurityAlert(
          {
            email: user.email,
            username: user.username,
            locale: user.locale || 'en',
          },
          'secondary_email_verified',
          {
            action: 'Your secondary recovery email has been verified',
            detail: 'This email can now be used for account recovery.',
            timestamp: new Date().toISOString(),
            ip: deviceInfos.ip,
            userAgent: deviceInfos.user_agent,
          }
        )
        .catch(err =>
          this.logger.error(err as Error, {
            context: 'secondary_email_verified_notification_failed',
          })
        );

      this.sessionManager
        .flash(req)
        .success('Recovery email verified successfully');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'verify_recovery_email_failed',
      });
      this.sessionManager.flash(req).error('Failed to verify recovery email');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Regenerate backup codes
   */
  public regenerateBackupCodes = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const recoveryConfig = this.recoveryUtils.getRecoveryConfig();
      if (
        !recoveryConfig.enabled ||
        !recoveryConfig.methods.backup_codes.enabled
      ) {
        this.sessionManager.flash(req).error('Backup codes are not available.');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser || !currentUser.recovery?.enabled) {
        this.sessionManager.flash(req).error('Account recovery is not enabled');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
      }

      const backupCodeResult = await this.recoveryUtils.generateBackupCodes();

      await this.userService.updateById(userData.id, {
        recovery: {
          ...currentUser.recovery,
          backup_codes: {
            codes: backupCodeResult.hashedCodes, // Store hashed codes in DB
            // usedCodes: [],
            generated_at: backupCodeResult.generatedAt,
            expires_at: backupCodeResult.expiresAt,
          },
        },
      });

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.success(
        'backup_codes_regenerated',
        'User regenerated their backup codes',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            username: userData.username,
            email: userData.email,
            actor_type: 'user',
          },
          target: {
            target_type: 'config',
          },
        }
      );

      this.notificationService
        .sendSecurityAlert(
          {
            email: userData.email,
            username: userData.username,
            locale: userData.locale,
          },
          'backup_codes_regenerated',
          {
            action: 'Your backup recovery codes have been regenerated',
            detail: 'All previous backup codes are now invalid',
            timestamp: new Date().toISOString(),
            ip: deviceInfos.ip,
            userAgent: deviceInfos.user_agent,
          }
        )
        .catch(err =>
          this.logger.error(err as Error, {
            context: 'backup_codes_regenerated_notification_failed',
          })
        );

      this.sessionManager.set(
        req,
        'recoveryBackupCodes',
        backupCodeResult.codes
      );

      this.sessionManager.flash(req).success('New backup codes generated');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.recovery_codes}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'regenerate_backup_codes_failed',
      });
      this.sessionManager.flash(req).error('Failed to regenerate backup codes');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Resend email verification for primary email
   */
  public resendEmailVerification = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData || !userData.id) {
        this.sessionManager.flash(req).error('User not found in session');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_notifications}`
        );
      }

      const user = await this.userService.findById(userData.id);
      if (!user) {
        this.sessionManager.flash(req).error('User not found');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_notifications}`
        );
      }

      if (user.email_verified) {
        this.sessionManager.flash(req).info('Your email is already verified');
        return res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_notifications}`
        );
      }

      const { verificationToken } =
        await this.authService.generateEmailVerificationToken(
          user._id as string
        );
      const verificationUrl = `${this.configManager.getConfig().deployment.url}${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.verify_email}?token=${verificationToken}`;

      await this.notificationService.sendVerification(
        { email: user.email, username: user.given_name || user.username },
        verificationUrl
      );

      this.logger.info('Email verification resent', {
        userId: user._id,
        email: user.email,
      });

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activity.info(
        'email_verification_resent',
        'User requested email verification resend',
        user,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: user,
          target: {
            target_type: 'config',
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success('Verification email has been sent. Please check your inbox.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_notifications}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'resend_email_verification_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to send verification email. Please try again later.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_notifications}`
      );
    }
  };

  /**
   * Show recovery setup page after MFA setup
   */
  public showRecoverySetup = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const recoveryConfig = this.recoveryUtils.getRecoveryConfig();
      if (!recoveryConfig.enabled) {
        this.sessionManager
          .flash(req)
          .error('Account recovery is not available.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
        return;
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
        return;
      }

      this.logger.info('Recovery setup page data', {
        username: userData.username,
        mfaEnabled: currentUser.mfa?.enabled,
        enabledMethods: this.mfaUtils.getEnabledMethods(currentUser),
        hasMfaObject: !!currentUser.mfa,
      });

      res.render(this.viewResolver.views.accounts.recovery_setup, {
        title: 'Set Up Account Recovery',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
          mfa: currentUser.mfa,
        },
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'show_recovery_setup_error',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to load recovery setup page');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Show security questions setup page
   */
  public showSecurityQuestionsSetup = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const recoveryConfig = this.recoveryUtils.getRecoveryConfig();
      if (
        !recoveryConfig.enabled ||
        !recoveryConfig.methods.security_questions.enabled
      ) {
        this.sessionManager
          .flash(req)
          .error('Security questions are not available.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
        return;
      }

      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
        return;
      }

      const availableQuestionKeys =
        this.recoveryUtils.getAvailableQuestionKeys();

      const existingQuestions =
        currentUser.recovery?.security_questions?.questions?.map(q => ({
          id: q.id,
          question_key: q.question_key,
        })) || [];

      res.render(this.viewResolver.views.accounts.security_questions_setup, {
        title: 'Set Up Security Questions',
        pageUser: {
          ...userData,
          picture: this.resolvePictureUrl(userData.picture),
        },
        availableQuestionKeys,
        existingQuestions,
        requiredCount: recoveryConfig.methods.security_questions.enabled
          ? 3
          : 0,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'show_security_questions_setup_error',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to load security questions setup page');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    }
  };

  /**
   * Save security questions
   */
  public saveSecurityQuestions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const recoveryConfig = this.recoveryUtils.getRecoveryConfig();
      if (
        !recoveryConfig.enabled ||
        !recoveryConfig.methods.security_questions.enabled
      ) {
        this.sessionManager
          .flash(req)
          .error('Security questions are not available.');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
        return;
      }

      const userData = this.sessionManager.getActiveUser(req);
      if (!userData) {
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.auth}${this.configManager.getConfig().deployment.routes.auth_routes.login}`
        );
        return;
      }

      const currentUser = await this.userService.findByUsername(
        userData.username
      );
      if (!currentUser) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
        );
        return;
      }

      const questions: Array<{ question_key: string; answer: string }> = [];
      for (let i = 1; i <= 10; i++) {
        const questionKey = req.body[`question_${i}`];
        const answer = req.body[`answer_${i}`];
        if (questionKey && answer) {
          questions.push({ question_key: questionKey, answer });
        }
      }

      if (questions.length < 3) {
        this.sessionManager
          .flash(req)
          .error('Please answer at least 3 security questions');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.security_questions_setup}`
        );
        return;
      }

      for (const q of questions) {
        const validation = this.recoveryUtils.validateSecurityAnswer(q.answer);
        if (!validation.valid) {
          this.sessionManager
            .flash(req)
            .error(validation.error || 'Invalid answer');
          res.redirect(
            `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.security_questions_setup}`
          );
          return;
        }
      }

      const setupResult =
        await this.recoveryUtils.setupSecurityQuestions(questions);

      if (!setupResult.valid || !setupResult.questions) {
        this.sessionManager
          .flash(req)
          .error(setupResult.error || 'Failed to setup security questions');
        res.redirect(
          `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.security_questions_setup}`
        );
        return;
      }

      await this.userService.updateWithAssignment(currentUser._id!.toString(), {
        recovery: {
          ...currentUser.recovery,
          enabled: true,
          methods: [
            ...new Set([
              ...(currentUser.recovery?.methods || []),
              'security_questions' as const,
            ]),
          ],
          security_questions: {
            questions: setupResult.questions,
            setup_at: setupResult.setup_at ?? new Date(),
          },
        },
      });

      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      await this.activity.success(
        'security_questions_setup',
        'Security questions configured successfully',
        deviceInfos,
        {
          actor: currentUser,
          target: {
            target_type: 'config',
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success('Security questions have been set up successfully');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.settings_recovery}`
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'save_security_questions_error',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to save security questions. Please try again.');
      res.redirect(
        `${this.configManager.getConfig().deployment.routes.accounts}${this.configManager.getConfig().deployment.routes.account_routes.security_questions_setup}`
      );
    }
  };
}
