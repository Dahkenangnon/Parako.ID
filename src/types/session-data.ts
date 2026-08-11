import type {
  ProviderUserData,
  SocialProvider,
  TokenData,
} from './social-integration.js';

/**
 * Type for pending MFA user stored in session
 * Stored under keys: 'pendingMfaUser', 'pendingSocialMfaUser'
 */
export interface PendingMfaUser {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  phone_number?: string;
  phone_number_verified?: boolean;
  given_name?: string;
  family_name?: string;
  full_name?: string;
  picture?: string;
  roles: string[];
  is_admin: boolean;
  mfa_method?: string;
  provider?: string;
  enabled_methods?: Record<string, boolean>;
  continue_url?: string;
}

/**
 * Type for add account intent stored in session
 * Stored under key: 'addAccountIntent'
 */
export interface AddAccountIntent {
  addingAccount: boolean;
  returnUrl?: string;
}

/**
 * Explicit request to link a social provider to the active local account.
 * Stored under key: 'linkSocialAccountIntent'
 */
export interface LinkSocialAccountIntent {
  provider: SocialProvider;
  returnUrl: string;
}

/**
 * Type for recovery attempt stored in session
 * Stored under key: 'recoveryAttempt'
 */
export interface RecoveryAttempt {
  userId: string;
  username: string;
  maskedIdentifier?: string;
  availableMethods?: Array<{
    method: string;
    available: boolean;
    details?: Record<string, any>;
  }>;
  method?: string;
  methodDetails?: Record<string, any>;
  smsSent?: boolean;
  smsExpiresAt?: string;
}

/**
 * Type for OIDC social context stored in session
 * Stored under key: 'oidcSocialContext'
 */
export interface OIDCSocialContext {
  timestamp: number;
  uid: string;
  client_id: string;
}

/**
 * OIDC interaction resumed after a user proves possession of their phone.
 * Stored under key: 'phoneVerificationOidcContinuation'
 */
export interface PhoneVerificationOIDCContinuation {
  interactionUid: string;
  createdAt: number;
}

/**
 * Type for social register intent stored in session
 * Stored under key: 'socialRegister'
 */
export type SocialRegisterData = Record<
  SocialProvider,
  {
    intent: string;
    timestamp: number;
  }
>;

/**
 * Type for social password setup stored in session
 * Stored under key: 'socialPasswordSetup'
 */
export interface SocialPasswordSetup {
  userId: string;
  provider: SocialProvider;
  providerData?: ProviderUserData;
  tokens?: TokenData;
  integrationId?: string;
  timestamp: number;
}

/**
 * Type for social contact data stored in session
 * Stored under key: 'socialRegistrationPending'
 */
export interface SocialContactData {
  provider: SocialProvider;
  timestamp: number;
  providerData: ProviderUserData;
  tokens?: TokenData;
}

/**
 * Type for secondary email verification stored in session
 * Stored under key: 'secondaryEmailVerification'
 */
export interface SecondaryEmailVerification {
  code: string;
  expiresAt: Date;
  userId: string;
}
