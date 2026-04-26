import * as client from 'openid-client';
import { injectable, inject } from 'inversify';
import { BaseSocialLogin } from './base-social-login.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import { TYPES } from '../di/types.js';
import { type SocialProvider } from '../types/social-integration.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';

/**
 * Configuration for OIDC social login providers
 */
export interface OidcProviderConfig {
  client_id: string;
  client_secret: string;
  discovery_url: string;
  scopes: string[];
  redirect_uri: string;
}

/**
 * Abstract base class for OIDC social login providers (Google, Microsoft, Okta, etc.)
 */
@injectable()
export abstract class BaseOidcSocialLogin extends BaseSocialLogin {
  protected oidcProviderConfig?: client.Configuration;
  protected isOidcInitialized = false;

  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.SessionManager) sessionManager: ISessionManager,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.SocialIntegrationService)
    socialIntegrationService: ISocialIntegrationService,
    provider: SocialProvider
  ) {
    super(
      logger,
      configManager,
      sessionManager,
      userService,
      socialIntegrationService,
      provider
    );
  }
}
