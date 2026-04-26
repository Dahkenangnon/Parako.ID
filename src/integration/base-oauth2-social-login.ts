import { injectable, inject, unmanaged } from 'inversify';
import { BaseSocialLogin } from './base-social-login.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';
import { TYPES } from '../di/types.js';
import { type SocialProvider } from '../types/social-integration.js';

export interface OAuth2ProviderConfig {
  client_id: string;
  client_secret: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  redirect_uri: string;
  scopes: string[];
}

@injectable()
export abstract class BaseOAuth2SocialLogin extends BaseSocialLogin {
  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.SessionManager) sessionManager: ISessionManager,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.SocialIntegrationService)
    socialIntegrationService: ISocialIntegrationService,
    @unmanaged() provider: SocialProvider
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
