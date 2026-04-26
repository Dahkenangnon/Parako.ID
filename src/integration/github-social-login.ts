import { Request } from 'express';
import * as client from 'openid-client';
import { injectable, inject } from 'inversify';
import {
  BaseOAuth2SocialLogin,
  OAuth2ProviderConfig,
} from './base-oauth2-social-login.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';
import type { IGitHubSocialLogin } from '../di/interfaces/github-social-login.interface.js';
import { TYPES } from '../di/types.js';
import {
  type ProviderUserData,
  type TokenData,
} from '../types/social-integration.js';
import { type SocialLoginResult } from '../di/interfaces/base-social-login.interface.js';
import {
  getUserFriendlyError,
  getHttpStatusErrorMessage,
} from './social-login-errors.js';

/**
 * GitHub Social Login implementation (OAuth2-only)
 * Follows GitHub's OAuth2 flow as documented at:
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 */
@injectable()
export class GitHubSocialLogin
  extends BaseOAuth2SocialLogin
  implements IGitHubSocialLogin
{
  constructor(
    @inject(TYPES.Logger) logger: ILogger,
    @inject(TYPES.ConfigManager) configManager: IConfigManager,
    @inject(TYPES.SessionManager) sessionManager: ISessionManager,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.SocialIntegrationService)
    socialIntegrationService: ISocialIntegrationService
  ) {
    super(
      logger,
      configManager,
      sessionManager,
      userService,
      socialIntegrationService,
      'github'
    );
  }

  /**
   * Generate GitHub OAuth2 authorization URL using openid-client utilities
   */
  public async getAuthorizationUrl(req: Request): Promise<string> {
    // Use openid-client's built-in PKCE and state generation
    const state = client.randomState();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    const providerConfig = this.getDefaultProviderConfig<OAuth2ProviderConfig>(
      this.provider
    );
    this.sessionManager.set(req, 'socialLogin', {
      ...this.sessionManager.get(req, 'socialLogin', {}),
      [this.provider]: {
        codeVerifier,
        state,
        timestamp: Date.now(),
      },
    });

    const params = new URLSearchParams({
      client_id: providerConfig.client_id,
      redirect_uri: providerConfig.redirect_uri,
      scope: providerConfig.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${providerConfig.authorization_endpoint}?${params.toString()}`;

    this.logger.info(`Generated GitHub OAuth2 authorization URL`, {
      provider: this.provider,
    });

    return authorizationUrl;
  }

  /**
   * Handle GitHub OAuth2 callback
   */
  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      const stateVerification = this.verifyOAuthState(req);
      if (!stateVerification.isValid) {
        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: stateVerification.error!,
        };
      }

      const providerSessionData = stateVerification.sessionData!;
      const { code } = req.query;

      // Exchange authorization code for access tokens
      const tokenResponse = await this.exchangeCodeForTokens(
        code as string,
        providerSessionData.codeVerifier
      );

      const providerUserInfo = await this.fetchUserInfo(
        tokenResponse.access_token
      );

      const mappedProviderData = this.mapProviderUserData(providerUserInfo);
      const tokens = this.mapTokenData(tokenResponse);

      // Use common user integration handling
      return this.handleUserIntegration(mappedProviderData, tokens, req);
    } catch (error) {
      const technicalError = (error as Error).message;
      this.logger.error(error as Error, {
        context: `github_oauth2_callback_failed`,
        provider: this.provider,
        technicalError,
      });

      this.cleanupSocialLoginSession(req);
      return {
        success: false,
        error: getUserFriendlyError('github', technicalError),
      };
    }
  }

  /**
   * Exchange authorization code for access tokens
   */
  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string
  ): Promise<any> {
    const providerConfig = this.getDefaultProviderConfig<OAuth2ProviderConfig>(
      this.provider
    );

    const params = new URLSearchParams({
      client_id: providerConfig.client_id,
      client_secret: providerConfig.client_secret,
      code,
      redirect_uri: providerConfig.redirect_uri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(providerConfig.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'parako-id/1.0.0',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`GitHub token exchange failed`, {
        provider: this.provider,
        status: response.status,
        statusText: response.statusText,
        technicalError: errorText,
      });
      throw new Error(
        getHttpStatusErrorMessage(
          'github',
          response.status,
          response.statusText
        )
      );
    }

    return response.json();
  }

  /**
   * Fetch user info from GitHub API
   */
  private async fetchUserInfo(accessToken: string): Promise<any> {
    // First, get basic user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'parako-id/1.0.0',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userResponse.ok) {
      throw new Error(
        getHttpStatusErrorMessage(
          'github',
          userResponse.status,
          userResponse.statusText
        )
      );
    }

    const userInfo = await userResponse.json();

    // If email is not public, try to get it from user/emails endpoint
    if (!userInfo.email) {
      try {
        const emailsResponse = await fetch(
          'https://api.github.com/user/emails',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'User-Agent': 'parako-id/1.0.0',
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        if (emailsResponse.ok) {
          const emails = await emailsResponse.json();

          const primaryEmail = emails.find((email: any) => email.primary);
          if (primaryEmail) {
            userInfo.email = primaryEmail.email;
            userInfo.email_verified = primaryEmail.verified;
          } else {
            const verifiedEmail = emails.find((email: any) => email.verified);
            if (verifiedEmail) {
              userInfo.email = verifiedEmail.email;
              userInfo.email_verified = verifiedEmail.verified;
            } else if (emails.length > 0) {
              // Use the first email if no verified email
              userInfo.email = emails[0].email;
              userInfo.email_verified = emails[0].verified;
            }
          }
        }
      } catch (error) {
        // If email fetch fails, continue without email
        this.logger.warn('Failed to fetch GitHub user emails', {
          provider: this.provider,
          error: (error as Error).message,
        });
      }
    }

    return userInfo;
  }

  /**
   * Map GitHub user info to our standard format
   */
  mapProviderUserData(userInfo: any): ProviderUserData {
    return {
      sub: String(userInfo.id),
      email: userInfo.email || '',
      email_verified: userInfo.email_verified || false,
      given_name: userInfo.name?.split(' ')[0] || userInfo.login,
      family_name: userInfo.name?.split(' ').slice(1).join(' ') || '',
      picture: userInfo.avatar_url,
      locale: userInfo.location || 'en',
      provider_username: userInfo.login,
    };
  }

  /**
   * Map GitHub token response to our standard format
   */
  mapTokenData(tokenResponse: any): TokenData {
    return {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token, // GitHub usually doesn't provide refresh tokens
      id_token: undefined, // GitHub doesn't provide ID tokens
      token_type: tokenResponse.token_type || 'Bearer',
      expires_at: tokenResponse.expires_at
        ? new Date(tokenResponse.expires_at * 1000)
        : undefined,
      scope: tokenResponse.scope,
    };
  }

  /**
   * Revoke GitHub OAuth token
   * https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token
   */
  protected async revokeToken(accessToken: string): Promise<void> {
    const providerConfig = this.getDefaultProviderConfig<OAuth2ProviderConfig>(
      this.provider
    );

    // GitHub uses Basic auth with client_id:client_secret
    const credentials = Buffer.from(
      `${providerConfig.client_id}:${providerConfig.client_secret}`
    ).toString('base64');

    const response = await fetch(
      `https://api.github.com/applications/${providerConfig.client_id}/token`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'parako-id/1.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      }
    );

    // GitHub returns 204 No Content on success
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `GitHub token revocation failed: ${response.status} - ${errorText}`
      );
    }

    this.logger.info('GitHub token revoked successfully', {
      provider: this.provider,
    });
  }
}
