import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { UserService } from '../../services/user.service.js';
import { ActivityService } from '../../services/activity.service.js';
import { AuthService } from '../../services/auth.service.js';
import { SocialIntegrationService } from '../../services/social-integration.service.js';
import { SettingsService } from '../../services/settings.service.js';
import { TenantSettingsOverrideService } from '../../services/tenant-settings-override.service.js';
import { I18nService } from '../../services/i18n.service.js';
import { GeolocationService } from '../../services/geolocation.service.js';
import { IPReputationService } from '../../services/ip-reputation.service.js';
import { NotificationService } from '../../services/notification.service.js';
import { SmsService } from '../../services/sms.service.js';
import { RecoveryService } from '../../services/recovery.service.js';
import { WebAuthnService } from '../../services/webauthn.service.js';
import { DataTransferService } from '../../services/data-transfer/data-transfer.service.js';
import type { IDataTransferService } from '../interfaces/data-transfer-service.interface.js';
import type { IRecoveryService } from '../interfaces/recovery-service.interface.js';
import type { IGeolocationService } from '../interfaces/geolocation-service.interface.js';
import type { IIPReputationService } from '../interfaces/ip-reputation-service.interface.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { IWebAuthnService } from '../interfaces/webauthn-service.interface.js';

import EmailUtils from '../../utils/email.js';
import ViewResolver from '../../utils/view-resolver.js';
import SessionManager, { FlashManager } from '../../utils/session.js';
import RedirectAuthority from '../../utils/redirect-authority.js';
import RecoveryUtils from '../../utils/recovery.js';
import PasswordUtils from '../../utils/password.js';
import MfaUtils from '../../utils/mfa.js';
import FileSystemUtils from '../../utils/filesystem.js';
import ConfigFileReader from '../../utils/config-file-reader.js';
import CookieManager from '../../utils/cookies.js';
import ClientDeviceInfoManager from '../../utils/client-info.js';
import ClientRegistryManager from '../../utils/client-registry-config.js';
import { AppLogger } from '../../observability/logs/logger.js';
import { MetricsService } from '../../observability/metrics/metrics.service.js';
import type { IMetricsService } from '../interfaces/metrics-service.interface.js';

import { GitHubSocialLogin } from '../../integration/github-social-login.js';
import { GoogleSocialLogin } from '../../integration/google-social-login.js';
import { MicrosoftSocialLogin } from '../../integration/microsoft-social-login.js';
import { LinkedInSocialLogin } from '../../integration/linkedin-social-login.js';
import { FacebookSocialLogin } from '../../integration/facebook-social-login.js';
import { SocialLoginManager } from '../../integration/social-login-manager.js';

// Import Redis Pub/Sub
import { RedisPubSubService } from '../../services/redis-pubsub.service.js';
import type { IRedisPubSubService } from '../interfaces/redis-pubsub-service.interface.js';

import { OpsTenantMiddleware } from '../../middlewares/ops-tenant.middleware.js';
import { OpsSocialCallbackService } from '../../services/ops-social-callback.service.js';

import {
  SocialTier1CompletionService,
  type ISocialTier1CompletionService,
} from '../../services/social-tier1-completion.service.js';

import { PlatformTenantMiddleware } from '../../middlewares/platform-tenant.middleware.js';
import {
  PlatformAdminService,
  type IPlatformAdminService,
} from '../../services/platform-admin.service.js';
import { PlatformAdminController } from '../../controllers/admin/platform.controller.js';

import { IUserService } from '../interfaces/user-service.interface.js';
import { IActivityService } from '../interfaces/activity-service.interface.js';
import { IAuthService } from '../interfaces/auth-service.interface.js';
import { ISocialIntegrationService } from '../interfaces/social-integration-service.interface.js';
import { ISettingsService } from '../interfaces/settings-service.interface.js';
import type { ITenantSettingsOverrideService } from '../interfaces/tenant-settings-override-service.interface.js';
import { II18nService } from '../interfaces/i18n-service.interface.js';
import { IEmailService } from '../interfaces/email-service.interface.js';
import { IViewResolver } from '../interfaces/view-resolver.interface.js';
import { ISessionManager } from '../interfaces/session-manager.interface.js';
import { IFlashManager } from '../interfaces/flash-manager.interface.js';
import { IRedirectAuthority } from '../interfaces/redirect-authority.interface.js';
import { IRecoveryUtils } from '../interfaces/recovery-utils.interface.js';
import { IPasswordUtils } from '../interfaces/password-utils.interface.js';
import { IMfaUtils } from '../interfaces/mfa-utils.interface.js';
import { IFileSystemUtils } from '../interfaces/file-system-utils.interface.js';
import { IConfigFileReader } from '../interfaces/config-file-reader.interface.js';
import { ICookieManager } from '../interfaces/cookie-manager.interface.js';
import { IClientDeviceInfoManager } from '../interfaces/client-device-info-manager.interface.js';
import { IClientRegistryManager } from '../interfaces/client-registry-manager.interface.js';
import { ILogger } from '../interfaces/logger.interface.js';
import { IGitHubSocialLogin } from '../interfaces/github-social-login.interface.js';
import { IGoogleSocialLogin } from '../interfaces/google-social-login.interface.js';
import { IMicrosoftSocialLogin } from '../interfaces/microsoft-social-login.interface.js';
import { ILinkedInSocialLogin } from '../interfaces/linkedin-social-login.interface.js';
import { IFacebookSocialLogin } from '../interfaces/facebook-social-login.interface.js';
import { ISocialLoginManager } from '../interfaces/social-login-manager.interface.js';

export const servicesModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    options.bind<ILogger>(TYPES.Logger).to(AppLogger).inSingletonScope();

    // Prometheus metrics - Singleton (process-level accumulators)
    options
      .bind<IMetricsService>(TYPES.MetricsService)
      .to(MetricsService)
      .inSingletonScope();

    // Redis Pub/Sub event bus - Singleton (shared across all services)
    options
      .bind<IRedisPubSubService>(TYPES.RedisPubSubService)
      .to(RedisPubSubService)
      .inSingletonScope();

    // Utility services - Singleton (stateless, shared)
    options
      .bind<IEmailService>(TYPES.EmailService)
      .to(EmailUtils)
      .inSingletonScope();

    // Notification service - Singleton (wraps EmailService)
    options
      .bind<INotificationService>(TYPES.NotificationService)
      .to(NotificationService)
      .inSingletonScope();

    // SMS service - Singleton (supports Twilio and Nexmo/Vonage)
    options
      .bind<SmsService>(TYPES.SmsService)
      .to(SmsService)
      .inSingletonScope();

    options
      .bind<IViewResolver>(TYPES.ViewResolver)
      .to(ViewResolver)
      .inSingletonScope();

    options
      .bind<IPasswordUtils>(TYPES.PasswordUtils)
      .to(PasswordUtils)
      .inSingletonScope();

    options.bind<IMfaUtils>(TYPES.MfaUtils).to(MfaUtils).inSingletonScope();

    options
      .bind<IFileSystemUtils>(TYPES.FileSystemUtils)
      .to(FileSystemUtils)
      .inSingletonScope();

    options
      .bind<IConfigFileReader>(TYPES.ConfigFileReader)
      .to(ConfigFileReader)
      .inSingletonScope();

    options
      .bind<ICookieManager>(TYPES.CookieManager)
      .to(CookieManager)
      .inSingletonScope();

    options
      .bind<IClientDeviceInfoManager>(TYPES.ClientDeviceInfoManager)
      .to(ClientDeviceInfoManager)
      .inSingletonScope();

    options
      .bind<IClientRegistryManager>(TYPES.ClientRegistryManager)
      .to(ClientRegistryManager)
      .inSingletonScope();

    // Business logic services - Transient (per-request)
    options
      .bind<IUserService>(TYPES.UserService)
      .to(UserService)
      .inTransientScope();

    options
      .bind<IActivityService>(TYPES.ActivityService)
      .to(ActivityService)
      .inTransientScope();

    options
      .bind<IAuthService>(TYPES.AuthService)
      .to(AuthService)
      .inTransientScope();

    options
      .bind<ISocialIntegrationService>(TYPES.SocialIntegrationService)
      .to(SocialIntegrationService)
      .inTransientScope();

    options
      .bind<ISettingsService>(TYPES.SettingsService)
      .to(SettingsService)
      .inTransientScope();

    options
      .bind<ITenantSettingsOverrideService>(TYPES.TenantSettingsOverrideService)
      .to(TenantSettingsOverrideService)
      .inTransientScope();

    options
      .bind<II18nService>(TYPES.I18nService)
      .to(I18nService)
      .inTransientScope();

    // Geolocation and IP reputation services - Singleton (with internal caching)
    options
      .bind<IGeolocationService>(TYPES.GeolocationService)
      .to(GeolocationService)
      .inSingletonScope();

    options
      .bind<IIPReputationService>(TYPES.IPReputationService)
      .to(IPReputationService)
      .inSingletonScope();

    // WebAuthn service - Transient (stateless, per-request)
    options
      .bind<IWebAuthnService>(TYPES.WebAuthnService)
      .to(WebAuthnService)
      .inTransientScope();

    // Data transfer service - Transient (per-request)
    options
      .bind<IDataTransferService>(TYPES.DataTransferService)
      .to(DataTransferService)
      .inTransientScope();

    // Session services - Request scope (per-request lifecycle)
    options
      .bind<ISessionManager>(TYPES.SessionManager)
      .to(SessionManager)
      .inRequestScope();

    options
      .bind<IFlashManager>(TYPES.FlashManager)
      .to(FlashManager)
      .inRequestScope();

    // Other utilities - Transient (lightweight)
    options
      .bind<IRedirectAuthority>(TYPES.RedirectAuthority)
      .to(RedirectAuthority)
      .inTransientScope();

    options
      .bind<IRecoveryUtils>(TYPES.RecoveryUtils)
      .to(RecoveryUtils)
      .inTransientScope();

    // Recovery service - Singleton (orchestrates recovery operations)
    options
      .bind<IRecoveryService>(TYPES.RecoveryService)
      .to(RecoveryService)
      .inSingletonScope();

    // Social login services - Transient (per-request)
    options
      .bind<IGitHubSocialLogin>(TYPES.GitHubSocialLogin)
      .to(GitHubSocialLogin)
      .inTransientScope();

    options
      .bind<IGoogleSocialLogin>(TYPES.GoogleSocialLogin)
      .to(GoogleSocialLogin)
      .inTransientScope();

    options
      .bind<IMicrosoftSocialLogin>(TYPES.MicrosoftSocialLogin)
      .to(MicrosoftSocialLogin)
      .inTransientScope();

    options
      .bind<ILinkedInSocialLogin>(TYPES.LinkedInSocialLogin)
      .to(LinkedInSocialLogin)
      .inTransientScope();

    options
      .bind<IFacebookSocialLogin>(TYPES.FacebookSocialLogin)
      .to(FacebookSocialLogin)
      .inTransientScope();

    options
      .bind<ISocialLoginManager>(TYPES.SocialLoginManager)
      .to(SocialLoginManager)
      .inTransientScope();

    // _ops Infrastructure Gateway - Singleton (stateless)
    options
      .bind<OpsTenantMiddleware>(TYPES.OpsTenantMiddleware)
      .to(OpsTenantMiddleware)
      .inSingletonScope();

    options
      .bind<OpsSocialCallbackService>(TYPES.OpsSocialCallbackService)
      .to(OpsSocialCallbackService)
      .inSingletonScope();

    // Social Tier 1 completion - Singleton (holds lazy Redis connection)
    options
      .bind<ISocialTier1CompletionService>(TYPES.SocialTier1CompletionService)
      .to(SocialTier1CompletionService)
      .inSingletonScope();

    // _platforms Admin Portal
    options
      .bind<PlatformTenantMiddleware>(TYPES.PlatformTenantMiddleware)
      .to(PlatformTenantMiddleware)
      .inSingletonScope();

    options
      .bind<IPlatformAdminService>(TYPES.PlatformAdminService)
      .to(PlatformAdminService)
      .inSingletonScope();

    options
      .bind<PlatformAdminController>(TYPES.PlatformAdminController)
      .to(PlatformAdminController)
      .inSingletonScope();
  }
);
