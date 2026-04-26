import { Request } from 'express';
import * as client from 'openid-client';
import { injectable, inject } from 'inversify';
import {
  BaseOidcSocialLogin,
  OidcProviderConfig,
} from './base-oidc-social-login.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IGoogleSocialLogin } from '../di/interfaces/google-social-login.interface.js';
import { TYPES } from '../di/types.js';
import {
  type ProviderUserData,
  type TokenData,
} from '../types/social-integration.js';
import type { SocialLoginResult } from '../di/interfaces/base-social-login.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';
import { getUserFriendlyError } from './social-login-errors.js';

@injectable()
export class GoogleSocialLogin
  extends BaseOidcSocialLogin
  implements IGoogleSocialLogin
{
  private remoteConfig?: client.Configuration;

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
      'google'
    );
  }

  /**
   * Initialize Google OpenID Connect client using the new discovery API
   */
  private async initializeGoogleClient(): Promise<void> {
    if (this.remoteConfig) {
      return;
    }

    try {
      const providerConfig = this.getDefaultProviderConfig<OidcProviderConfig>(
        this.provider
      );

      this.logger.info('Initializing Google OpenID Connect client', {
        provider: 'google',
        redirectUri: providerConfig.redirect_uri,
      });

      // Use the new discovery API
      this.remoteConfig = await client.discovery(
        new URL('https://accounts.google.com'),
        providerConfig.client_id,
        providerConfig.client_secret
      );

      this.logger.info(
        'Google OpenID Connect client initialized successfully',
        {
          provider: 'google',
          issuer: this.remoteConfig.serverMetadata().issuer,
          hasConfig: !!this.remoteConfig,
          supportedScopes: this.remoteConfig.serverMetadata().scopesSupported,
          supportedClaims: this.remoteConfig.serverMetadata().claimsSupported,
        }
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'google_oidc_client_init_failed',
        provider: 'google',
      });
      throw new Error('Failed to initialize Google OpenID Connect client');
    }
  }

  /**
   * Handle Google OpenID Connect callback
   */
  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      this.logger.info('Starting Google OpenID Connect callback handling', {
        provider: 'google',
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        hasError: !!req.query.error,
        hasSession: !!req.session,
      });

      if (!this.remoteConfig) {
        await this.initializeGoogleClient();
      }

      const stateVerification = this.verifyOAuthState(req);
      if (!stateVerification.isValid) {
        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: stateVerification.error!,
        };
      }

      const providerSessionData = stateVerification.sessionData!;

      // Additional validation for required parameters
      if (!req.query.code) {
        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: 'Authorization code is missing from callback',
        };
      }

      const getCurrentUrl = () => {
        const protocol = req.get('x-forwarded-proto') || req.protocol;
        const host = req.get('x-forwarded-host') || req.get('host');
        return new URL(req.originalUrl, `${protocol}://${host}`);
      };

      // Exchange authorization code for tokens using the new API
      let tokenSet: client.TokenEndpointResponse;
      try {
        tokenSet = await client.authorizationCodeGrant(
          this.remoteConfig!,
          getCurrentUrl(),
          {
            pkceCodeVerifier: providerSessionData.codeVerifier,
            expectedState: providerSessionData.state,
          }
        );
      } catch (callbackError) {
        const technicalError = (callbackError as Error).message;
        this.logger.error(callbackError as Error, {
          context: 'google_oidc_callback_exchange_failed',
          provider: 'google',
          hasCode: !!req.query.code,
          hasState: !!req.query.state,
          technicalError,
        });

        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: getUserFriendlyError('google', technicalError),
        };
      }

      this.logger.info('Google token exchange successful', {
        provider: 'google',
        hasAccessToken: !!tokenSet.access_token,
        hasIdToken: !!tokenSet.id_token,
        hasRefreshToken: !!tokenSet.refresh_token,
        tokenType: tokenSet.token_type,
        expiresAt: tokenSet.expires_at,
        scope: tokenSet.scope,
      });

      let userInfo;
      try {
        const userInfoResponse = await client.fetchProtectedResource(
          this.remoteConfig!,
          tokenSet.access_token!,
          new URL('https://www.googleapis.com/oauth2/v2/userinfo'),
          'GET'
        );

        userInfo = await userInfoResponse.json();
      } catch (userInfoError) {
        const technicalError = (userInfoError as Error).message;
        this.logger.error(userInfoError as Error, {
          context: 'google_oidc_userinfo_failed',
          provider: 'google',
          hasAccessToken: !!tokenSet.access_token,
          technicalError,
        });

        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: getUserFriendlyError('google', technicalError),
        };
      }

      this.logger.info('Google user info retrieved', {
        provider: 'google',
        hasEmail: !!userInfo.email,
        hasName: !!userInfo.name,
        hasSub: !!userInfo.sub,
        emailVerified: userInfo.email_verified,
      });

      const mappedProviderData = this.mapProviderUserData(userInfo);
      const mappedTokens = this.mapTokenData(tokenSet);

      // Use common user integration handling
      return this.handleUserIntegration(mappedProviderData, mappedTokens, req);
    } catch (error) {
      const technicalError = (error as Error).message;
      this.logger.error(error as Error, {
        context: 'google_oidc_callback_failed',
        provider: 'google',
        errorName: (error as Error).name,
        errorMessage: technicalError,
        // Redact sensitive query params - don't log the authorization code
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        errorParam: req.query.error,
        errorDescription: req.query.error_description,
      });

      this.cleanupSocialLoginSession(req);
      return {
        success: false,
        error: getUserFriendlyError('google', technicalError),
      };
    }
  }

  /**
   * Generate Google OpenID Connect authorization URL
   */
  public async getAuthorizationUrl(req: Request): Promise<string> {
    try {
      if (!this.remoteConfig) {
        await this.initializeGoogleClient();
      }

      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge =
        await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();

      this.sessionManager.set(req, 'socialLogin', {
        ...this.sessionManager.get(req, 'socialLogin', {}),
        [this.provider]: {
          state,
          codeVerifier,
          timestamp: Date.now(),
        },
      });

      const providerConfig = this.getDefaultProviderConfig<OidcProviderConfig>(
        this.provider
      );
      const parameters: Record<string, string> = {
        redirect_uri: providerConfig.redirect_uri,
        scope: providerConfig.scopes.join(' '),
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'consent', // Force consent screen to get refresh token
        access_type: 'offline', // Request refresh token
      };

      const redirectTo = client.buildAuthorizationUrl(
        this.remoteConfig!,
        parameters
      );

      this.logger.info('Generated Google OpenID Connect authorization URL', {
        provider: 'google',
        state,
        codeVerifier: `${codeVerifier.substring(0, 8)}...`, // Log partial for debugging
        url: redirectTo.href,
        scopes: providerConfig.scopes,
      });

      return redirectTo.href;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'google_oidc_authorization_url_failed',
        provider: 'google',
      });
      throw new Error('Failed to generate Google authorization URL');
    }
  }

  /**
   * Map Google OpenID Connect user info to our standard format
   */
  mapProviderUserData(userInfo: any): ProviderUserData {
    return {
      sub: userInfo.sub || userInfo.id,
      email: userInfo.email,
      email_verified:
        userInfo.email_verified || userInfo.verified_email || false,
      name: userInfo.name,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      picture: userInfo.picture,
      locale: userInfo.locale,
      provider_username: userInfo.email?.split('@')[0],
      raw_data: {
        id: userInfo.sub || userInfo.id,
        email_verified: userInfo.email_verified || userInfo.verified_email,
        hd: userInfo.hd, // Hosted domain (for Google Workspace)
        link: userInfo.link,
        gender: userInfo.gender,
        birthdate: userInfo.birthdate,
        phone_number: userInfo.phone_number,
        address: userInfo.address,
        verified_email: userInfo.verified_email, // Keep for backward compatibility
      },
    };
  }

  /**
   * Map Google OpenID Connect tokens to our standard format
   */
  mapTokenData(tokenSet: any): TokenData {
    return {
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      id_token: tokenSet.id_token,
      token_type: tokenSet.token_type || 'Bearer',
      expires_at: tokenSet.expires_at
        ? new Date(tokenSet.expires_at * 1000)
        : undefined,
      scope: tokenSet.scope,
    };
  }

  /**
   * Refresh Google OAuth token using refresh token
   * https://developers.google.com/identity/protocols/oauth2/web-server#offline
   */
  public async refreshToken(integrationId: string): Promise<TokenData | null> {
    try {
      if (!this.remoteConfig) {
        await this.initializeGoogleClient();
      }

      const integration =
        await this.socialIntegrationService.findById(integrationId);
      if (!integration?.tokens?.refresh_token) {
        this.logger.warn('No refresh token available for Google integration', {
          integrationId,
        });
        return null;
      }

      // Use the openid-client refreshTokenGrant
      const tokenSet = await client.refreshTokenGrant(
        this.remoteConfig!,
        integration.tokens.refresh_token
      );

      const newTokens = this.mapTokenData(tokenSet);

      await this.socialIntegrationService.updateTokens(
        integrationId,
        newTokens
      );

      this.logger.info('Google token refreshed successfully', {
        integrationId,
        hasNewAccessToken: !!newTokens.access_token,
        hasNewRefreshToken: !!newTokens.refresh_token,
      });

      return newTokens;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'google_token_refresh_failed',
        integrationId,
      });
      return null;
    }
  }

  /**
   * Revoke Google OAuth token
   * https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
   */
  protected async revokeToken(accessToken: string): Promise<void> {
    const revokeUrl = 'https://oauth2.googleapis.com/revoke';
    const params = new URLSearchParams({ token: accessToken });

    const response = await fetch(`${revokeUrl}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google token revocation failed: ${response.status} - ${errorText}`
      );
    }

    this.logger.info('Google token revoked successfully', {
      provider: this.provider,
    });
  }
}
