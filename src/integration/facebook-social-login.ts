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
import type { IFacebookSocialLogin } from '../di/interfaces/facebook-social-login.interface.js';
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
 * Facebook Social Login implementation (OAuth2)
 * Follows Facebook's OAuth2 flow as documented at:
 * https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 */
@injectable()
export class FacebookSocialLogin
  extends BaseOAuth2SocialLogin
  implements IFacebookSocialLogin
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
      'facebook'
    );
  }

  /**
   * Generate Facebook OAuth2 authorization URL using PKCE
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
      scope: providerConfig.scopes.join(','), // Facebook uses comma-separated scopes
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${providerConfig.authorization_endpoint}?${params.toString()}`;

    this.logger.info(`Generated Facebook OAuth2 authorization URL`, {
      provider: this.provider,
      scopes: providerConfig.scopes,
    });

    return authorizationUrl;
  }

  /**
   * Handle Facebook OAuth2 callback
   */
  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      this.logger.info('Starting Facebook OAuth2 callback handling', {
        provider: 'facebook',
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

      this.logger.info('Facebook token exchange successful', {
        provider: 'facebook',
        hasAccessToken: !!tokenResponse.access_token,
        expiresIn: tokenResponse.expires_in,
        tokenType: tokenResponse.token_type,
      });

      const providerUserInfo = await this.fetchUserInfo(
        tokenResponse.access_token
      );

      this.logger.info('Facebook user info retrieved', {
        provider: 'facebook',
        hasEmail: !!providerUserInfo.email,
        hasName: !!providerUserInfo.name,
        hasId: !!providerUserInfo.id,
      });

      const mappedProviderData = this.mapProviderUserData(providerUserInfo);
      const tokens = this.mapTokenData(tokenResponse);

      // Use common user integration handling
      return this.handleUserIntegration(mappedProviderData, tokens, req);
    } catch (error) {
      const technicalError = (error as Error).message;
      this.logger.error(error as Error, {
        context: `facebook_oauth2_callback_failed`,
        provider: this.provider,
        technicalError,
      });

      this.cleanupSocialLoginSession(req);
      return {
        success: false,
        error: getUserFriendlyError('facebook', technicalError),
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
      this.logger.error(`Facebook token exchange failed`, {
        provider: this.provider,
        status: response.status,
        statusText: response.statusText,
        technicalError: errorText,
      });
      throw new Error(
        getHttpStatusErrorMessage(
          'facebook',
          response.status,
          response.statusText
        )
      );
    }

    return response.json();
  }

  /**
   * Fetch user info from Facebook Graph API
   * Uses the fields parameter to get specific user data
   */
  private async fetchUserInfo(accessToken: string): Promise<any> {
    const providerConfig = this.getDefaultProviderConfig<OAuth2ProviderConfig>(
      this.provider
    );

    const url = new URL(providerConfig.userinfo_endpoint);
    url.searchParams.set(
      'fields',
      'id,email,name,first_name,last_name,picture'
    );
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(
        getHttpStatusErrorMessage(
          'facebook',
          response.status,
          response.statusText
        )
      );
    }

    return response.json();
  }

  /**
   * Map Facebook user info to our standard format
   */
  mapProviderUserData(userInfo: any): ProviderUserData {
    return {
      sub: userInfo.id,
      email: userInfo.email,
      // Facebook verifies emails, so we can trust this
      email_verified: true,
      name: userInfo.name,
      given_name: userInfo.first_name,
      family_name: userInfo.last_name,
      // Facebook returns picture as nested object
      picture: userInfo.picture?.data?.url || userInfo.picture,
      locale: userInfo.locale,
      // Use id as username since Facebook doesn't expose usernames
      provider_username: userInfo.id,
      raw_data: {
        id: userInfo.id,
        link: userInfo.link,
        gender: userInfo.gender,
        timezone: userInfo.timezone,
        verified: userInfo.verified,
      },
    };
  }

  /**
   * Map Facebook token response to our standard format
   * Note: Facebook doesn't provide refresh tokens through OAuth2
   * For long-lived tokens, use the token exchange endpoint
   */
  mapTokenData(tokenResponse: any): TokenData {
    return {
      access_token: tokenResponse.access_token,
      refresh_token: undefined, // Facebook doesn't provide refresh tokens
      id_token: undefined, // Facebook doesn't provide ID tokens through basic OAuth2
      token_type: tokenResponse.token_type || 'Bearer',
      expires_at: tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined,
      scope: undefined, // Facebook doesn't return scope in token response
    };
  }

  /**
   * Revoke Facebook OAuth token
   * https://developers.facebook.com/docs/facebook-login/permissions/requesting-and-revoking
   */
  protected async revokeToken(accessToken: string): Promise<void> {
    const revokeUrl = 'https://graph.facebook.com/me/permissions';

    const response = await fetch(revokeUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook token revocation failed: ${response.status} - ${errorText}`
      );
    }

    this.logger.info('Facebook token revoked successfully', {
      provider: this.provider,
    });
  }
}
