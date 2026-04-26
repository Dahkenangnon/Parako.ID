import { Request } from 'express';
import type { SocialLoginResult } from './base-social-login.interface.js';

/**
 * Interface for GitHub social login service
 * Defines the contract for GitHub OAuth2 social login operations
 */
export interface IGitHubSocialLogin {
  /**
   * Generate GitHub OAuth2 authorization URL
   * @param req - Express request object
   * @returns Promise that resolves to the authorization URL
   */
  getAuthorizationUrl(req: Request): Promise<string>;

  /**
   * Handle GitHub OAuth2 callback
   * @param req - Express request object
   * @returns Promise that resolves to the social login result
   */
  handleCallback(req: Request): Promise<SocialLoginResult>;

  /**
   * Map GitHub user info to our standard format
   * @param userInfo - Raw user info from GitHub API
   * @returns Mapped provider user data
   */
  mapProviderUserData(userInfo: any): any;

  /**
   * Map GitHub token response to our standard format
   * @param tokenResponse - Raw token response from GitHub
   * @returns Mapped token data
   */
  mapTokenData(tokenResponse: any): any;
}
