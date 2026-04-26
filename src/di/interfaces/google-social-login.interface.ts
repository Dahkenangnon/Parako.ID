import { Request } from 'express';
import type { SocialLoginResult } from './base-social-login.interface.js';

/**
 * Interface for Google social login service
 * Defines the contract for Google OIDC social login operations
 */
export interface IGoogleSocialLogin {
  /**
   * Generate Google OIDC authorization URL
   * @param req - Express request object
   * @returns Promise that resolves to the authorization URL
   */
  getAuthorizationUrl(req: Request): Promise<string>;

  /**
   * Handle Google OIDC callback
   * @param req - Express request object
   * @returns Promise that resolves to the social login result
   */
  handleCallback(req: Request): Promise<SocialLoginResult>;

  /**
   * Map Google user info to our standard format
   * @param userInfo - Raw user info from Google API
   * @returns Mapped provider user data
   */
  mapProviderUserData(userInfo: any): any;

  /**
   * Map Google token response to our standard format
   * @param tokenSet - Raw token set from Google
   * @returns Mapped token data
   */
  mapTokenData(tokenSet: any): any;
}
