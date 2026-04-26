import { Request } from 'express';
import {
  type ISocialIntegration,
  type ProviderUserData,
  type TokenData,
} from '../../types/social-integration.js';
import { type IUser } from '../../types/user.js';

/**
 * Social login result
 */
export interface SocialLoginResult {
  success: boolean;
  user?: IUser;
  integration?: ISocialIntegration;
  error?: string;
  requiresLinking?: boolean;
  existingIntegration?: ISocialIntegration;
  providerData?: ProviderUserData;
  tokens?: TokenData;
}

/**
 * Interface for base social login service
 * Defines the contract for social login operations
 */
export interface IBaseSocialLogin {
  /**
   * Generate the OAuth authorization URL for the social login flow
   * Must be implemented by subclasses
   */
  getAuthorizationUrl(req: Request): Promise<string>;

  /**
   * Handle the OAuth callback from the social provider
   * Must be implemented by subclasses
   */
  handleCallback(req: Request): Promise<SocialLoginResult>;

  /**
   * Link a social integration to an existing user account
   */
  linkToUser(
    userId: string,
    providerData: ProviderUserData,
    tokens: TokenData
  ): Promise<ISocialIntegration>;

  /**
   * Unlink a social integration from a user account
   */
  unlinkFromUser(userId: string): Promise<void>;

  /**
   * Get user's social integrations
   */
  getSocialIntegrations(userId: string): Promise<ISocialIntegration[]>;

  /**
   * Refresh expired access token using refresh token
   * Optional - only providers that support token refresh implement this
   * @param integrationId - The integration ID to refresh tokens for
   * @returns New token data or null if refresh not supported/failed
   */
  refreshToken?(integrationId: string): Promise<TokenData | null>;

  /**
   * Complete a Tier 1 (external) social auth flow with pre-fetched user data.
   *
   * Used by the Tier 1 completion handler after the token exchange and
   * profile fetch have already occurred outside the provider class.
   */
  completeExternalAuth(
    providerData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ): Promise<SocialLoginResult>;
}
