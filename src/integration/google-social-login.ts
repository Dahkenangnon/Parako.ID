import { Request } from 'express';
import * as client from 'openid-client';
import { injectable, inject } from 'inversify';
import {
  BaseOidcSocialLogin,
  mapOidcTokenData,
  type OidcProviderConfig,
  type OidcTokenResponse,
} from './base-oidc-social-login.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
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
export class GoogleSocialLogin extends BaseOidcSocialLogin {
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

  private async initializeGoogleClient(): Promise<void> {
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
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(normalizedError, {
        context: 'google_oidc_client_init_failed',
        provider: 'google',
      });
      throw new Error('Failed to initialize Google OpenID Connect client');
    }
  }

  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      this.logger.info('Starting Google OpenID Connect callback handling', {
        provider: 'google',
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        hasError: !!req.query.error,
        hasSession: !!req.session,
      });

      const stateVerification = this.verifyOAuthState(req);
      if (!stateVerification.isValid) {
        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: stateVerification.error!,
        };
      }

      const callbackError = this.getVerifiedOAuthCallbackError(req);
      if (callbackError) {
        this.cleanupSocialLoginSession(req);
        return { success: false, error: callbackError };
      }

      if (!this.remoteConfig) {
        await this.initializeGoogleClient();
      }

      const providerSessionData = stateVerification.sessionData!;

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
        const normalizedError =
          callbackError instanceof Error
            ? callbackError
            : new Error(String(callbackError));
        const technicalError = normalizedError.message;
        this.logger.error(normalizedError, {
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

      if (
        typeof tokenSet.access_token !== 'string' ||
        tokenSet.access_token.trim().length === 0
      ) {
        throw new Error(
          'Google token response did not include an access token'
        );
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
          tokenSet.access_token,
          new URL('https://www.googleapis.com/oauth2/v2/userinfo'),
          'GET'
        );

        if (!userInfoResponse.ok) {
          throw new Error(
            `Google userinfo request failed: ${userInfoResponse.status} ${userInfoResponse.statusText}`
          );
        }

        userInfo = await userInfoResponse.json();
      } catch (userInfoError) {
        const normalizedError =
          userInfoError instanceof Error
            ? userInfoError
            : new Error(String(userInfoError));
        const technicalError = normalizedError.message;
        this.logger.error(normalizedError, {
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
      const result = await this.handleUserIntegration(
        mappedProviderData,
        mappedTokens,
        req
      );
      this.cleanupSocialLoginSession(req);
      return result;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      const technicalError = normalizedError.message;
      this.logger.error(normalizedError, {
        context: 'google_oidc_callback_failed',
        provider: 'google',
        errorName: normalizedError.name,
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
        scopes: providerConfig.scopes,
      });

      return redirectTo.href;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(normalizedError, {
        context: 'google_oidc_authorization_url_failed',
        provider: 'google',
      });
      throw new Error('Failed to generate Google authorization URL');
    }
  }

  mapProviderUserData(userInfo: any): ProviderUserData {
    const rawSubject = userInfo?.sub ?? userInfo?.id;
    const subject = typeof rawSubject === 'string' ? rawSubject.trim() : '';
    if (!subject) {
      throw new Error('Google user info did not include a subject identifier');
    }

    return {
      sub: subject,
      email: userInfo.email,
      email_verified:
        userInfo.email_verified === true || userInfo.verified_email === true,
      name: userInfo.name,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      picture: userInfo.picture,
      locale: userInfo.locale,
      provider_username: userInfo.email?.split('@')[0],
      raw_data: {
        id: subject,
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

  mapTokenData(tokenSet: OidcTokenResponse): TokenData {
    return mapOidcTokenData(tokenSet);
  }

  /** https://developers.google.com/identity/protocols/oauth2/web-server#offline */
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
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(normalizedError, {
        context: 'google_token_refresh_failed',
        integrationId,
      });
      return null;
    }
  }

  /** https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke */
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
      throw new Error(
        `Google token revocation failed: ${response.status} ${response.statusText}`
      );
    }

    this.logger.info('Google token revoked successfully', {
      provider: this.provider,
    });
  }
}
