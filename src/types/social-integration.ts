import type { IBaseModel } from './base.js';

/**
 * Supported social login providers
 */
export type SocialProvider =
  | 'google'
  | 'github'
  | 'facebook'
  | 'linkedin'
  | 'twitter'
  | 'microsoft'
  | 'apple';

/**
 * Integration method types
 */
export type IntegrationMethod = 'local' | 'oauth' | 'ldap' | SocialProvider;

/**
 * Token data structure for OAuth providers
 */
export interface TokenData {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_at?: Date;
  scope?: string;
}

/**
 * Provider-specific user data
 */
export interface ProviderUserData {
  sub: string;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  phone_number_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  provider_username?: string;
  raw_data?: Record<string, unknown>;
}

/**
 * User integration interface
 */
export interface ISocialIntegration extends IBaseModel {
  user_id: string;
  method: IntegrationMethod;
  provider_sub: string;
  provider_username?: string;
  provider_data: ProviderUserData;
  tokens?: TokenData;
  is_active: boolean;
  last_used?: Date;
  metadata?: {
    created_by: 'user' | 'admin' | 'system';
    linked_at: Date;
    last_sync?: Date;
    sync_errors?: string[];
  };
}

/**
 * Decrypted token data structure (for use after decryption)
 */
export interface DecryptedTokenData {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_at?: Date;
  scope?: string;
}

export interface ISocialIntegrationMethods {
  getDecryptedTokens(): DecryptedTokenData | undefined;
  isTokenExpired(): boolean;
}
