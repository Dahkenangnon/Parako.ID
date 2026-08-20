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
export class MicrosoftSocialLogin extends BaseOidcSocialLogin {
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
      'microsoft'
    );
  }

  private async initializeMicrosoftClient(): Promise<void> {
    try {
      const providerConfig = this.getDefaultProviderConfig<OidcProviderConfig>(
        this.provider
      );

      this.logger.info('Initializing Microsoft OpenID Connect client', {
        provider: 'microsoft',
        redirectUri: providerConfig.redirect_uri,
        discoveryUrl: providerConfig.discovery_url,
      });

      // Use the discovery API with Microsoft's well-known endpoint
      // Default: https://login.microsoftonline.com/common/v2.0
      const discoveryUrl = new URL(
        providerConfig.discovery_url ||
          'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration'
      );
      const issuerUrl = discoveryUrl.href.includes('.well-known')
        ? new URL(discoveryUrl.href.split('/.well-known')[0])
        : discoveryUrl;

      this.remoteConfig = await client.discovery(
        issuerUrl,
        providerConfig.client_id,
        providerConfig.client_secret
      );

      this.logger.info(
        'Microsoft OpenID Connect client initialized successfully',
        {
          provider: 'microsoft',
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
        context: 'microsoft_oidc_client_init_failed',
        provider: 'microsoft',
      });
      throw new Error('Failed to initialize Microsoft OpenID Connect client');
    }
  }

  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      this.logger.info('Starting Microsoft OpenID Connect callback handling', {
        provider: 'microsoft',
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
        await this.initializeMicrosoftClient();
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
          context: 'microsoft_oidc_callback_exchange_failed',
          provider: 'microsoft',
          hasCode: !!req.query.code,
          hasState: !!req.query.state,
          technicalError,
        });

        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: getUserFriendlyError('microsoft', technicalError),
        };
      }

      if (
        typeof tokenSet.access_token !== 'string' ||
        tokenSet.access_token.trim().length === 0
      ) {
        throw new Error(
          'Microsoft token response did not include an access token'
        );
      }

      this.logger.info('Microsoft token exchange successful', {
        provider: 'microsoft',
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
          new URL('https://graph.microsoft.com/oidc/userinfo'),
          'GET'
        );

        if (!userInfoResponse.ok) {
          throw new Error(
            `Microsoft userinfo request failed: ${userInfoResponse.status} ${userInfoResponse.statusText}`
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
          context: 'microsoft_oidc_userinfo_failed',
          provider: 'microsoft',
          hasAccessToken: !!tokenSet.access_token,
          technicalError,
        });

        this.cleanupSocialLoginSession(req);
        return {
          success: false,
          error: getUserFriendlyError('microsoft', technicalError),
        };
      }

      this.logger.info('Microsoft user info retrieved', {
        provider: 'microsoft',
        hasEmail: !!userInfo.email,
        hasName: !!userInfo.name,
        hasSub: !!userInfo.sub,
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
        context: 'microsoft_oidc_callback_failed',
        provider: 'microsoft',
        errorName: normalizedError.name,
        errorMessage: technicalError,
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        errorParam: req.query.error,
        errorDescription: req.query.error_description,
      });

      this.cleanupSocialLoginSession(req);
      return {
        success: false,
        error: getUserFriendlyError('microsoft', technicalError),
      };
    }
  }

  public async getAuthorizationUrl(req: Request): Promise<string> {
    try {
      if (!this.remoteConfig) {
        await this.initializeMicrosoftClient();
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
        response_mode: 'query',
      };

      const redirectTo = client.buildAuthorizationUrl(
        this.remoteConfig!,
        parameters
      );

      this.logger.info('Generated Microsoft OpenID Connect authorization URL', {
        provider: 'microsoft',
        scopes: providerConfig.scopes,
      });

      return redirectTo.href;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(normalizedError, {
        context: 'microsoft_oidc_authorization_url_failed',
        provider: 'microsoft',
      });
      throw new Error('Failed to generate Microsoft authorization URL');
    }
  }

  mapProviderUserData(userInfo: any): ProviderUserData {
    const subject =
      typeof userInfo?.sub === 'string' ? userInfo.sub.trim() : '';
    if (!subject) {
      throw new Error(
        'Microsoft user info did not include a subject identifier'
      );
    }

    return {
      sub: subject,
      email: userInfo.email,
      email_verified: userInfo.email_verified === true,
      name: userInfo.name,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      picture: userInfo.picture,
      locale: userInfo.locale,
      // Use preferred_username (UPN format for work accounts, email for personal)
      provider_username:
        userInfo.preferred_username || userInfo.email?.split('@')[0],
      raw_data: {
        oid: userInfo.oid, // Object ID in Azure AD
        tid: userInfo.tid, // Tenant ID
        preferred_username: userInfo.preferred_username,
      },
    };
  }

  mapTokenData(tokenSet: OidcTokenResponse): TokenData {
    return mapOidcTokenData(tokenSet);
  }

  /** https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#refresh-the-access-token */
  public async refreshToken(integrationId: string): Promise<TokenData | null> {
    try {
      if (!this.remoteConfig) {
        await this.initializeMicrosoftClient();
      }

      const integration =
        await this.socialIntegrationService.findById(integrationId);
      if (!integration?.tokens?.refresh_token) {
        this.logger.warn(
          'No refresh token available for Microsoft integration',
          {
            integrationId,
          }
        );
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

      this.logger.info('Microsoft token refreshed successfully', {
        integrationId,
        hasNewAccessToken: !!newTokens.access_token,
        hasNewRefreshToken: !!newTokens.refresh_token,
      });

      return newTokens;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(normalizedError, {
        context: 'microsoft_token_refresh_failed',
        integrationId,
      });
      return null;
    }
  }

  /** Microsoft v2.0 has no revocation endpoint; users revoke access at https://account.live.com/consent/Manage */
  protected async revokeToken(_accessToken: string): Promise<void> {
    // Microsoft v2.0 doesn't support programmatic token revocation
    this.logger.warn(
      'Microsoft does not support programmatic token revocation. ' +
        'Users should revoke access at https://account.live.com/consent/Manage',
      { provider: this.provider }
    );
  }
}
