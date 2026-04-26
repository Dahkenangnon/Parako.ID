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
import type { ILinkedInSocialLogin } from '../di/interfaces/linkedin-social-login.interface.js';
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
 * LinkedIn Social Login implementation (OAuth2 with OIDC profile)
 * Follows LinkedIn's OAuth2 flow as documented at:
 * https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 */
@injectable()
export class LinkedInSocialLogin
  extends BaseOAuth2SocialLogin
  implements ILinkedInSocialLogin
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
      'linkedin'
    );
  }

  /**
   * Generate LinkedIn OAuth2 authorization URL using PKCE
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
      response_type: 'code',
      client_id: providerConfig.client_id,
      redirect_uri: providerConfig.redirect_uri,
      scope: providerConfig.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${providerConfig.authorization_endpoint}?${params.toString()}`;

    this.logger.info(`Generated LinkedIn OAuth2 authorization URL`, {
      provider: this.provider,
      scopes: providerConfig.scopes,
    });

    return authorizationUrl;
  }

  /**
   * Handle LinkedIn OAuth2 callback
   */
  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      this.logger.info('Starting LinkedIn OAuth2 callback handling', {
        provider: 'linkedin',
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        hasError: !!req.query.error,
      });

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

      if (!code) {
        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: 'Authorization code is missing from callback',
        };
      }

      // Exchange authorization code for access tokens
      const tokenResponse = await this.exchangeCodeForTokens(
        code as string,
        providerSessionData.codeVerifier
      );

      this.logger.info('LinkedIn token exchange successful', {
        provider: 'linkedin',
        hasAccessToken: !!tokenResponse.access_token,
        hasIdToken: !!tokenResponse.id_token,
        expiresIn: tokenResponse.expires_in,
      });

      const providerUserInfo = await this.fetchUserInfo(
        tokenResponse.access_token
      );

      this.logger.info('LinkedIn user info retrieved', {
        provider: 'linkedin',
        hasEmail: !!providerUserInfo.email,
        hasName: !!providerUserInfo.name,
        hasSub: !!providerUserInfo.sub,
      });

      const mappedProviderData = this.mapProviderUserData(providerUserInfo);
      const tokens = this.mapTokenData(tokenResponse);

      // Use common user integration handling
      return this.handleUserIntegration(mappedProviderData, tokens, req);
    } catch (error) {
      const technicalError = (error as Error).message;
      this.logger.error(error as Error, {
        context: `linkedin_oauth2_callback_failed`,
        provider: this.provider,
        technicalError,
      });

      this.cleanupSocialLoginSession(req);
      return {
        success: false,
        error: getUserFriendlyError('linkedin', technicalError),
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
      grant_type: 'authorization_code',
      code,
      client_id: providerConfig.client_id,
      client_secret: providerConfig.client_secret,
      redirect_uri: providerConfig.redirect_uri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(providerConfig.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`LinkedIn token exchange failed`, {
        provider: this.provider,
        status: response.status,
        statusText: response.statusText,
        technicalError: errorText,
      });
      throw new Error(
        getHttpStatusErrorMessage(
          'linkedin',
          response.status,
          response.statusText
        )
      );
    }

    return response.json();
  }

  /**
   * Fetch user info from LinkedIn userinfo endpoint
   */
  private async fetchUserInfo(accessToken: string): Promise<any> {
    const providerConfig = this.getDefaultProviderConfig<OAuth2ProviderConfig>(
      this.provider
    );

    const response = await fetch(providerConfig.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        getHttpStatusErrorMessage(
          'linkedin',
          response.status,
          response.statusText
        )
      );
    }

    return response.json();
  }

  /**
   * Map LinkedIn user info to our standard format
   * LinkedIn userinfo follows OIDC standard with some LinkedIn-specific fields
   */
  mapProviderUserData(userInfo: any): ProviderUserData {
    return {
      sub: userInfo.sub,
      email: userInfo.email,
      email_verified: userInfo.email_verified || false,
      name: userInfo.name,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      picture: userInfo.picture,
      locale: userInfo.locale?.language || userInfo.locale,
      // Use email prefix as username since LinkedIn doesn't expose usernames
      provider_username: userInfo.email?.split('@')[0],
      raw_data: {
        sub: userInfo.sub,
        locale: userInfo.locale,
      },
    };
  }

  /**
   * Map LinkedIn token response to our standard format
   */
  mapTokenData(tokenResponse: any): TokenData {
    return {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token, // LinkedIn provides refresh tokens with r_liteprofile
      id_token: tokenResponse.id_token, // LinkedIn returns id_token with openid scope
      token_type: tokenResponse.token_type || 'Bearer',
      expires_at: tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined,
      scope: tokenResponse.scope,
    };
  }

  /**
   * LinkedIn doesn't have a standard token revocation endpoint
   * Users must revoke access via LinkedIn settings
   */
  protected async revokeToken(_accessToken: string): Promise<void> {
    this.logger.warn(
      'LinkedIn does not support programmatic token revocation. ' +
        'Users should revoke access at https://www.linkedin.com/psettings/permitted-services',
      { provider: this.provider }
    );
  }
}
