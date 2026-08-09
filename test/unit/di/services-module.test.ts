import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';

import { servicesModule } from '../../../src/di/modules/services.module.js';
import { TYPES } from '../../../src/di/types.js';

describe('servicesModule', () => {
  it('registers the complete public service graph', () => {
    const container = new Container();

    container.load(servicesModule);

    const serviceIdentifiers = [
      TYPES.Logger,
      TYPES.MetricsService,
      TYPES.RedisPubSubService,
      TYPES.EmailService,
      TYPES.NotificationService,
      TYPES.SmsService,
      TYPES.ViewResolver,
      TYPES.PasswordUtils,
      TYPES.MfaUtils,
      TYPES.FileSystemUtils,
      TYPES.ConfigFileReader,
      TYPES.CookieManager,
      TYPES.ClientDeviceInfoManager,
      TYPES.ClientRegistryManager,
      TYPES.UserService,
      TYPES.ActivityService,
      TYPES.AuthService,
      TYPES.SocialIntegrationService,
      TYPES.SettingsService,
      TYPES.TenantSettingsOverrideService,
      TYPES.I18nService,
      TYPES.GeolocationService,
      TYPES.IPReputationService,
      TYPES.WebAuthnService,
      TYPES.DataTransferService,
      TYPES.SessionManager,
      TYPES.FlashManager,
      TYPES.RedirectAuthority,
      TYPES.RecoveryUtils,
      TYPES.RecoveryService,
      TYPES.GitHubSocialLogin,
      TYPES.GoogleSocialLogin,
      TYPES.MicrosoftSocialLogin,
      TYPES.LinkedInSocialLogin,
      TYPES.FacebookSocialLogin,
      TYPES.SocialLoginManager,
      TYPES.OpsTenantMiddleware,
      TYPES.OpsSocialCallbackService,
      TYPES.SocialTier1CompletionService,
      TYPES.PlatformTenantMiddleware,
      TYPES.PlatformAdminService,
      TYPES.PlatformAdminController,
    ];

    expect(
      serviceIdentifiers.every(identifier => container.isBound(identifier))
    ).toBe(true);
  });

  it('reuses singleton utility instances across resolutions', () => {
    const container = new Container();

    container.load(servicesModule);

    expect(container.get(TYPES.PasswordUtils)).toBe(
      container.get(TYPES.PasswordUtils)
    );
  });

  it('creates a new transient business service for each resolution', () => {
    const container = new Container();
    container.bind(TYPES.ConfigManager).toConstantValue({} as never);
    container.bind(TYPES.UserRepository).toConstantValue({} as never);
    container.load(servicesModule);
    container.rebind(TYPES.Logger).toConstantValue({} as never);

    expect(container.get(TYPES.AuthService)).not.toBe(
      container.get(TYPES.AuthService)
    );
  });
});
