import * as client from 'openid-client';
import { injectable, inject } from 'inversify';
import { BaseSocialLogin } from './base-social-login.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import { TYPES } from '../di/types.js';
import {
  type SocialProvider,
  type TokenData,
} from '../types/social-integration.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';

export interface OidcProviderConfig {
  client_id: string;
  client_secret: string;
  discovery_url: string;
  scopes: string[];
  redirect_uri: string;
}

export interface OidcTokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly token_type?: string;
  readonly expires_at?: unknown;
  readonly scope?: string;
}

export function mapOidcTokenData(tokenSet: OidcTokenResponse): TokenData {
  const expiresAt = tokenSet.expires_at;
  const expiresAtSeconds =
    typeof expiresAt === 'number' &&
    Number.isFinite(expiresAt) &&
    expiresAt >= 0
      ? expiresAt
      : undefined;

  return {
    access_token: tokenSet.access_token,
    refresh_token: tokenSet.refresh_token,
    id_token: tokenSet.id_token,
    token_type: tokenSet.token_type || 'Bearer',
    expires_at:
      expiresAtSeconds === undefined
        ? undefined
        : new Date(expiresAtSeconds * 1000),
    scope: tokenSet.scope,
  };
}

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
