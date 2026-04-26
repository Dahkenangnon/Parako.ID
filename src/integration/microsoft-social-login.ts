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
import type { IMicrosoftSocialLogin } from '../di/interfaces/microsoft-social-login.interface.js';
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
export class MicrosoftSocialLogin
  extends BaseOidcSocialLogin
  implements IMicrosoftSocialLogin
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
      'microsoft'
    );
  }

  /**
   * Initialize Microsoft OpenID Connect client using the discovery API
   */
  private async initializeMicrosoftClient(): Promise<void> {
    if (this.remoteConfig) {
      return;
    }

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
      this.logger.error(error as Error, {
        context: 'microsoft_oidc_client_init_failed',
        provider: 'microsoft',
      });
      throw new Error('Failed to initialize Microsoft OpenID Connect client');
    }
  }

  /**
   * Handle Microsoft OpenID Connect callback
   */
  public async handleCallback(req: Request): Promise<SocialLoginResult> {
    try {
      this.logger.info('Starting Microsoft OpenID Connect callback handling', {
        provider: 'microsoft',
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        hasError: !!req.query.error,
        hasSession: !!req.session,
      });

      if (!this.remoteConfig) {
        await this.initializeMicrosoftClient();
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
          tokenSet.access_token!,
          new URL('https://graph.microsoft.com/oidc/userinfo'),
          'GET'
        );

        userInfo = await userInfoResponse.json();
      } catch (userInfoError) {
        const technicalError = (userInfoError as Error).message;
        this.logger.error(userInfoError as Error, {
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
      return this.handleUserIntegration(mappedProviderData, mappedTokens, req);
    } catch (error) {
      const technicalError = (error as Error).message;
      this.logger.error(error as Error, {
        context: 'microsoft_oidc_callback_failed',
        provider: 'microsoft',
        errorName: (error as Error).name,
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

  /**
   * Generate Microsoft OpenID Connect authorization URL
   */
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
        state,
        codeVerifier: `${codeVerifier.substring(0, 8)}...`, // Log partial for debugging
        url: redirectTo.href,
        scopes: providerConfig.scopes,
      });

      return redirectTo.href;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'microsoft_oidc_authorization_url_failed',
        provider: 'microsoft',
      });
      throw new Error('Failed to generate Microsoft authorization URL');
    }
  }

  /**
   * Map Microsoft OpenID Connect user info to our standard format
   */
  mapProviderUserData(userInfo: any): ProviderUserData {
    return {
      sub: userInfo.sub,
      email: userInfo.email,
      // Microsoft verifies emails for personal accounts
      // For work/school accounts, the tenant admin controls this
      email_verified: true,
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

  /**
   * Map Microsoft OpenID Connect tokens to our standard format
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
   * Refresh Microsoft OAuth token using refresh token
   * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#refresh-the-access-token
   */
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
      this.logger.error(error as Error, {
        context: 'microsoft_token_refresh_failed',
        integrationId,
      });
      return null;
    }
  }

  /**
   * Revoke Microsoft OAuth token
   * Note: Microsoft doesn't have a standard revocation endpoint for v2.0
   * Users must revoke access via https://account.live.com/consent/Manage
   */
  protected async revokeToken(_accessToken: string): Promise<void> {
    // Microsoft v2.0 doesn't support programmatic token revocation
    this.logger.warn(
      'Microsoft does not support programmatic token revocation. ' +
        'Users should revoke access at https://account.live.com/consent/Manage',
      { provider: this.provider }
    );
  }
}
