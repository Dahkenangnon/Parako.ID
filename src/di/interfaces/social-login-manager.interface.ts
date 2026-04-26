import { Request } from 'express';
import type {
  IBaseSocialLogin,
  SocialLoginResult,
} from './base-social-login.interface.js';
import {
  type SocialProvider,
  type ISocialIntegration,
  type ProviderUserData,
  type TokenData,
} from '../../types/social-integration.js';

/**
 * Interface for social login manager service
 * Defines the contract for managing multiple social login providers
 */
export interface ISocialLoginManager {
  /**
   * Get a specific social login provider
   * @param provider - The social provider name
   * @returns The provider instance or undefined if not available
   */
  getProvider(provider: SocialProvider): IBaseSocialLogin | undefined;

  /**
   * Get all available providers
   * @returns Array of available provider names
   */
  getAvailableProviders(): SocialProvider[];

  /**
   * Check if a provider is available
   * @param provider - The social provider name
   * @returns True if provider is available, false otherwise
   */
  isProviderAvailable(provider: SocialProvider): boolean;

  /**
   * Get authorization URL for a provider
   * @param provider - The social provider name
   * @param req - Express request object
   * @returns Promise that resolves to the authorization URL
   */
  getAuthorizationUrl(provider: SocialProvider, req: Request): Promise<string>;

  /**
   * Handle callback for a provider
   * @param provider - The social provider name
   * @param req - Express request object
   * @returns Promise that resolves to the social login result
   */
  handleCallback(
    provider: SocialProvider,
    req: Request
  ): Promise<SocialLoginResult>;

  /**
   * Link a social integration to a user
   * @param provider - The social provider name
   * @param userId - User ID
   * @param providerData - Provider user data
   * @param tokens - Provider tokens
   * @returns Promise that resolves to the integration
   */
  linkToUser(
    provider: SocialProvider,
    userId: string,
    providerData: ProviderUserData,
    tokens: TokenData
  ): Promise<ISocialIntegration>;

  /**
   * Unlink a social integration from a user
   * @param provider - The social provider name
   * @param userId - User ID
   * @returns Promise that resolves when unlinking is complete
   */
  unlinkFromUser(provider: SocialProvider, userId: string): Promise<void>;

  /**
   * Get user's social integrations
   * @param provider - The social provider name
   * @param userId - User ID
   * @returns Promise that resolves to array of integrations
   */
  getUserIntegrations(
    provider: SocialProvider,
    userId: string
  ): Promise<ISocialIntegration[]>;

  /**
   * Complete a Tier 1 social auth flow with pre-fetched user data.
   * Delegates to the provider's completeExternalAuth() method.
   */
  completeTier1Flow(
    provider: SocialProvider,
    providerData: ProviderUserData,
    tokens: TokenData,
    req: Request
  ): Promise<SocialLoginResult>;
}
