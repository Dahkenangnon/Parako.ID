import type { IBaseModel } from './base.js';
import type { WebAuthnCredential } from './webauthn.js';

export type Gender = 'M' | 'F';
export type RegisterWith =
  | 'email'
  | 'phone_number'
  | 'github'
  | 'google'
  | 'facebook'
  | 'microsoft'
  | 'linkedin'
  | 'okta'
  | 'twitter'
  | 'apple';
export type AuthProvider =
  | 'local'
  | 'oauth'
  | 'ldap'
  | 'github'
  | 'google'
  | 'facebook'
  | 'microsoft'
  | 'linkedin'
  | 'okta'
  | 'twitter'
  | 'apple';
export const RegisterWithValues = [
  'email',
  'phone_number',
  'github',
  'google',
  'facebook',
  'microsoft',
  'linkedin',
  'okta',
  'twitter',
  'apple',
];
export const AuthProviderValues = [
  'local',
  'oauth',
  'ldap',
  'github',
  'google',
  'facebook',
  'microsoft',
  'linkedin',
  'okta',
  'twitter',
  'apple',
];

/**
 *  These fields are compliant with the Open ID Connect specification
 *
 * @see https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
 */
export interface IUser extends IBaseModel {
  // Business fields (OpenID Standard Claims that business might need to display or usage)
  family_name?: string;
  given_name?: string;
  name?: string;
  nickname?: string;
  middle_name?: string;
  gender: Gender;
  birthdate?: Date;
  phone_number?: string;
  profile?: string;
  website?: string;
  picture?: string;
  email?: string;
  locale?: string;
  country?: string;
  zoneinfo?: string;
  city?: string;
  address?: string;
  street_address?: string;
  region?: string;
  postal_code?: string;
  roles: string[];
  // Custom identifier fields - alternative to email/phone for login
  custom_identifier_1?: string;
  custom_identifier_2?: string;
  custom_identifier_3?: string;

  // Technical fields (Used internally only)
  phone_number_verified: boolean;
  email_verified: boolean;
  sub?: string;
  theme?: 'light' | 'dark';
  sidebar_expanded?: boolean;
  last_login?: Date;
  /**
   * Multi-factor authentication configuration for the user.
   * Supports multiple MFA methods simultaneously (TOTP, Email, WebAuthn).
   * When `enabled === true` the login flow will require the second factor.
   * OIDC `amr` values: 'otp' for TOTP/Email, 'hwk' for WebAuthn.
   */
  mfa?: {
    /** Master toggle for MFA - if false, no MFA is required */
    enabled: boolean;
    /** Individual MFA method configurations */
    methods: {
      totp?: {
        enabled: boolean;
        secret?: string;
        verified_at?: Date;
      };
      email?: {
        enabled: boolean;
        verified_at?: Date;
      };
      webauthn?: {
        enabled: boolean;
        credentials?: WebAuthnCredential[];
        verified_at?: Date;
      };
    };
    /** User's preferred MFA method when multiple are enabled */
    preferred_method?: 'totp' | 'email' | 'webauthn';
    /** Temporary storage for email OTP (hash + expiry) */
    email_otp?: {
      hash: string;
      expires: Date;
    };
  };

  /**
   * Account recovery configuration for the user.
   * Provides backup methods to regain access when primary authentication fails.
   */
  recovery?: {
    enabled: boolean;
    methods: (
      | 'backup_codes'
      | 'secondary_email'
      | 'sms'
      | 'security_questions'
    )[];
    lockout?: {
      locked: boolean;
      locked_until?: Date;
      failed_attempts: number;
      last_failed_at?: Date;
    };
    last_recovered_at?: Date;
    backup_codes?: {
      codes: string[];
      generated_at: Date;
      expires_at: Date;
    };
    secondary_email?: {
      email: string;
      verified: boolean;
      verification_token?: string;
      verification_expires?: Date;
    };
    sms?: {
      phone_number: string;
      verified: boolean;
      verification_code?: string;
      verification_expires?: Date;
    };
    security_questions?: {
      questions: Array<{
        id: string;
        question_key: string; // i18n key (e.g., 'q1', 'q2') from security-questions namespace
        answer_hash: string;
      }>;
      setup_at?: Date;
      last_used_at?: Date;
      failed_attempts?: number;
      last_failed_at?: Date;
      locked_until?: Date;
    };
  };

  username: string;
  password?: string;
  password_hash_algo?: string;
  password_updated_at?: Date;
  password_force_reset?: boolean;
  reset_password_token?: string;
  reset_password_expires?: Date;
  email_verification_token?: string;
  email_verification_expires?: Date;
  blocked_from: string[];
  account_is_anonymized: boolean;
  register_with: RegisterWith;
  auth_provider?: AuthProvider;
  account_enabled?: boolean;

  /**
   * User notification preferences.
   * Controls how the user wants to receive notifications.
   */
  notification_preferences?: {
    preferred_channel: 'email' | 'sms' | 'auto';
    security_alerts: boolean;
    new_session_alerts: boolean;
    marketing: boolean;
  };
}

export type IUserMethods = object;
