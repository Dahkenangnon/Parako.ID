import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { AuthController } from '../../controllers/auth.controller.js';
import { AccountsController } from '../../controllers/account.controller.js';
import { AdminActivitiesController } from '../../controllers/admin/activity.controller.js';
import { AdminUsersController } from '../../controllers/admin/user.controller.js';
import { AdminOidcClientController } from '../../controllers/admin/oidc-client.controller.js';
import { AdminUserGrantsController } from '../../controllers/admin/grant.controller.js';
import { AdminHomeController } from '../../controllers/admin/home.controller.js';
import { AdminSessionsController } from '../../controllers/admin/session.controller.js';
import { AdminSettingsController } from '../../controllers/admin/settings.controller.js';
import { WebAuthnController } from '../../controllers/webauthn.controller.js';
import { AdminJwksController } from '../../controllers/admin/jwks.controller.js';
import { AdminConfigurationController } from '../../controllers/admin/configuration.controller.js';
import { AdminDataTransferController } from '../../controllers/admin/data-transfer.controller.js';

import { IAuthController } from '../interfaces/auth-controller.interface.js';
import { IAccountController } from '../interfaces/account-controller.interface.js';
import { IAdminActivitiesController } from '../interfaces/admin-activities-controller.interface.js';
import { IAdminUsersController } from '../interfaces/admin-users-controller.interface.js';
import { IAdminOidcClientController } from '../interfaces/admin-oidc-client-controller.interface.js';
import { IAdminUserGrantsController } from '../interfaces/admin-user-grants-controller.interface.js';
import { IAdminHomeController } from '../interfaces/admin-home-controller.interface.js';
import { IAdminSessionsController } from '../interfaces/admin-sessions-controller.interface.js';
import { IAdminSettingsController } from '../interfaces/admin-settings-controller.interface.js';
import { IWebAuthnController } from '../interfaces/webauthn-controller.interface.js';
import { IAdminJwksController } from '../interfaces/admin-jwks-controller.interface.js';
import type { IAdminConfigurationController } from '../interfaces/admin-configuration-controller.interface.js';
import type { IAdminDataTransferController } from '../interfaces/admin-data-transfer-controller.interface.js';
import type { ILogger } from '../interfaces/logger.interface.js';
import type { IAuthService } from '../interfaces/auth-service.interface.js';
import type { IUserService } from '../interfaces/user-service.interface.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';
import type { IRecoveryUtils } from '../interfaces/recovery-utils.interface.js';
import type { IMfaUtils } from '../interfaces/mfa-utils.interface.js';
import type { ISocialLoginManager } from '../interfaces/social-login-manager.interface.js';
import type { ISocialIntegrationService } from '../interfaces/social-integration-service.interface.js';
import type { IUploadMiddleware } from '../interfaces/upload-middleware.interface.js';
import type { IEmailService } from '../interfaces/email-service.interface.js';
import type { ISettingsService } from '../interfaces/settings-service.interface.js';
import type { IOIDCAdapterBridge } from '../interfaces/oidc-adapter-bridge.interface.js';
import type { ISessionManager } from '../interfaces/session-manager.interface.js';
import type { PhoneVerificationServiceDependencies } from '../../services/phone-verification.service.js';
import {
  createAccountControllerOperationModules,
  createAdminSettingsControllerOperationModules,
  createAuthControllerOperationModules,
  type AccountControllerOperationModules,
  type AdminSettingsControllerOperationModules,
  type AuthControllerOperationModules,
} from '../factories/controller-operations.factory.js';

export const controllersModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    options
      .bind<AuthControllerOperationModules>(
        TYPES.AuthControllerOperationModules
      )
      .toDynamicValue(context =>
        createAuthControllerOperationModules({
          logger: context.get<ILogger>(TYPES.Logger),
          authService: context.get<IAuthService>(TYPES.AuthService),
          userService: context.get<IUserService>(TYPES.UserService),
          notificationService: context.get<INotificationService>(
            TYPES.NotificationService
          ),
          configManager: context.get<IConfigManager>(TYPES.ConfigManager),
          oidcAdapter: context.get<IOIDCAdapterBridge>(TYPES.OIDCAdapterBridge),
          smsService: context.get<
            Pick<PhoneVerificationServiceDependencies, 'sendVerificationCode'>
          >(TYPES.SmsService),
        })
      )
      .inTransientScope();

    options
      .bind<AccountControllerOperationModules>(
        TYPES.AccountControllerOperationModules
      )
      .toDynamicValue(context =>
        createAccountControllerOperationModules({
          logger: context.get<ILogger>(TYPES.Logger),
          userService: context.get<IUserService>(TYPES.UserService),
          recoveryUtils: context.get<IRecoveryUtils>(TYPES.RecoveryUtils),
          socialIntegrationService: context.get<ISocialIntegrationService>(
            TYPES.SocialIntegrationService
          ),
          socialLoginManager: context.get<ISocialLoginManager>(
            TYPES.SocialLoginManager
          ),
          mfaUtils: context.get<IMfaUtils>(TYPES.MfaUtils),
          configManager: context.get<IConfigManager>(TYPES.ConfigManager),
          uploadMiddleware: context.get<IUploadMiddleware>(
            TYPES.UploadMiddleware
          ),
          sessionManager: context.get<ISessionManager>(TYPES.SessionManager),
        })
      )
      .inTransientScope();

    options
      .bind<AdminSettingsControllerOperationModules>(
        TYPES.AdminSettingsControllerOperationModules
      )
      .toDynamicValue(context =>
        createAdminSettingsControllerOperationModules({
          configManager: context.get<IConfigManager>(TYPES.ConfigManager),
          emailService: context.get<IEmailService>(TYPES.EmailService),
          settingsService: context.get<ISettingsService>(TYPES.SettingsService),
          uploadMiddleware: context.get<IUploadMiddleware>(
            TYPES.UploadMiddleware
          ),
          logger: context.get<ILogger>(TYPES.Logger),
        })
      )
      .inTransientScope();

    // All controllers - Transient (per-request, fresh instance)
    options
      .bind<IAuthController>(TYPES.AuthController)
      .to(AuthController)
      .inTransientScope();

    options
      .bind<IAccountController>(TYPES.AccountController)
      .to(AccountsController)
      .inTransientScope();

    options
      .bind<IAdminActivitiesController>(TYPES.AdminActivitiesController)
      .to(AdminActivitiesController)
      .inTransientScope();

    options
      .bind<IAdminUsersController>(TYPES.AdminUsersController)
      .to(AdminUsersController)
      .inTransientScope();

    options
      .bind<IAdminOidcClientController>(TYPES.AdminOidcClientsController)
      .to(AdminOidcClientController)
      .inTransientScope();

    options
      .bind<IAdminUserGrantsController>(TYPES.AdminUserGrantsController)
      .to(AdminUserGrantsController)
      .inTransientScope();

    options
      .bind<IAdminHomeController>(TYPES.AdminHomeController)
      .to(AdminHomeController)
      .inTransientScope();

    options
      .bind<IAdminSessionsController>(TYPES.AdminSessionsController)
      .to(AdminSessionsController)
      .inTransientScope();

    options
      .bind<IAdminSettingsController>(TYPES.AdminSettingsController)
      .to(AdminSettingsController)
      .inTransientScope();

    options
      .bind<IWebAuthnController>(TYPES.WebAuthnController)
      .to(WebAuthnController)
      .inTransientScope();

    options
      .bind<IAdminJwksController>(TYPES.AdminJwksController)
      .to(AdminJwksController)
      .inTransientScope();

    options
      .bind<IAdminConfigurationController>(TYPES.AdminConfigurationController)
      .to(AdminConfigurationController)
      .inTransientScope();

    options
      .bind<IAdminDataTransferController>(TYPES.AdminDataTransferController)
      .to(AdminDataTransferController)
      .inTransientScope();
  }
);
