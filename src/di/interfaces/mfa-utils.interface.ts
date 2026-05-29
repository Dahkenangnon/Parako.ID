import type { IUser } from '../../types/user.js';
import {
  MfaMethod,
  MfaMethodUpdate,
  TotpVerificationResult,
  EmailOtpResult,
  MfaSetupResult,
} from '../../utils/mfa.js';

/**
 * Interface for MFA utils service
 * Defines the contract for multi-factor authentication operations
 */
export interface IMfaUtils {
  /**
   * Hash algorithm used for email OTP
   */
  readonly HASH_ALGORITHM: string;

  /**
   * Email OTP code length
   */
  readonly EMAIL_OTP_LENGTH: number;

  /**
   * Generate a new TOTP secret
   * @returns TOTP secret string
   */
  generateTotpSecret(): string;

  /**
   * Generate TOTP URI for QR code
   * @param accountName - Account name for the TOTP
   * @param secret - TOTP secret
   * @param issuer - Issuer name
   * @returns TOTP URI string
   */
  generateTotpUri(accountName: string, secret: string, issuer: string): string;

  /**
   * Generate QR code data URI from TOTP URI
   * @param otpauth - TOTP URI
   * @returns QR code data URI
   */
  generateQrCode(otpauth: string): Promise<string>;

  /**
   * Complete MFA setup with secret generation and QR code
   * @param accountName - Account name for the TOTP
   * @param issuer - Issuer name
   * @returns MFA setup result with secret and QR code
   */
  setupTotp(accountName: string, issuer: string): Promise<MfaSetupResult>;

  /**
   * Verify TOTP code
   * @param code - TOTP code to verify
   * @param secret - TOTP secret
   * @returns TOTP verification result
   */
  verifyTotpCode(code: string, secret: string): TotpVerificationResult;

  /**
   * Validate TOTP code format
   * @param code - Code to validate
   * @returns Validation result with sanitized code
   */
  validateTotpCodeFormat(code: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  };

  /**
   * Generate email OTP code
   * @param ttlSeconds - Time to live in seconds (default: 600)
   * @returns Email OTP result with code, hash, and expiration
   */
  generateEmailOtp(ttlSeconds?: number): EmailOtpResult;

  /**
   * Verify email OTP code
   * @param code - Code to verify
   * @param storedHash - Stored hash to compare against
   * @param expiresAt - Expiration date
   * @returns TOTP verification result
   */
  verifyEmailOtp(
    code: string,
    storedHash: string,
    expiresAt: Date
  ): TotpVerificationResult;

  /**
   * Check if user has MFA enabled
   * @param user - User object to check
   * @returns True if MFA is enabled
   */
  isMfaEnabled(user: IUser): boolean;

  /**
   * Check if user has TOTP enabled
   * @param user - User object to check
   * @returns True if TOTP is enabled
   */
  isTotpEnabled(user: IUser): boolean;

  /**
   * Check if user has a pending TOTP setup (secret stored but not yet verified)
   * @param user - User object to check
   * @returns True if TOTP secret exists but totp.enabled is false
   */
  isTotpPendingSetup(user: IUser): boolean;

  /**
   * Check if user has a pending email MFA setup (OTP hash stored but email not yet enabled)
   * @param user - User object to check
   * @returns True if email OTP hash exists, hasn't expired, and email.enabled is false
   */
  isEmailMfaPendingSetup(user: IUser): boolean;

  /**
   * Check if user has email MFA enabled
   * @param user - User object to check
   * @returns True if email MFA is enabled
   */
  isEmailMfaEnabled(user: IUser): boolean;

  /**
   * Check if user has WebAuthn MFA enabled
   * @param user - User object to check
   * @returns True if WebAuthn is enabled and has credentials
   */
  isWebAuthnEnabled(user: IUser): boolean;

  /**
   * Get all enabled MFA methods for a user (multi-method schema)
   * @param user - User object to check
   * @returns Array of enabled method names
   */
  getEnabledMethods(user: IUser): MfaMethod[];

  /**
   * Check if user needs MFA method selection (has 2+ methods enabled)
   * @param user - User object to check
   * @returns True if user has multiple MFA methods enabled
   */
  needsMethodSelection(user: IUser): boolean;

  /**
   * Get enabled methods as an object for template rendering
   * @param user - User object to check
   * @returns Object with boolean flags for each method
   */
  getEnabledMethodsObject(user: IUser): {
    totp: boolean;
    email: boolean;
    webauthn: boolean;
  };

  /**
   * Get user's preferred MFA method, or first available if not set
   * @param user - User object to check
   * @returns Preferred MFA method or null
   */
  getPreferredMethod(user: IUser): MfaMethod | null;

  /**
   * Get user's TOTP secret (multi-method schema)
   * @param user - User object to check
   * @returns TOTP secret or undefined
   */
  getUserTotpSecret(user: IUser): string | undefined;

  /**
   * Get update object for enabling a specific MFA method (multi-method schema)
   * @param method - MFA method to enable
   * @param data - Optional data (e.g., secret for TOTP)
   * @returns MongoDB dot notation update object
   */
  getEnableMethodUpdate(
    method: 'totp' | 'email' | 'webauthn',
    data?: { secret?: string }
  ): MfaMethodUpdate;

  /**
   * Get update object for disabling a specific MFA method (multi-method schema)
   * @param method - MFA method to disable
   * @returns MongoDB dot notation update object
   */
  getDisableMethodUpdate(
    method: 'totp' | 'email' | 'webauthn'
  ): MfaMethodUpdate;

  /**
   * Check if any MFA method is still enabled after disabling one
   * @param user - User object to check
   * @param excludeMethod - Method to exclude from check
   * @returns True if any method is still enabled
   */
  hasAnyMethodEnabled(
    user: IUser,
    excludeMethod?: 'totp' | 'email' | 'webauthn'
  ): boolean;

  /**
   * Get update object for completely disabling MFA (all methods)
   * @returns MongoDB dot notation update object
   */
  getDisableAllMfaUpdate(): MfaMethodUpdate;

  /**
   * Mask email address for display
   * @param email - Email address to mask
   * @returns Masked email address
   */
  maskEmail(email: string): string;

  /**
   * Mask phone number for display
   * @param phoneNumber - Phone number to mask
   * @returns Masked phone number
   */
  maskPhoneNumber(phoneNumber: string): string;

  /**
   * Get MFA configuration from environment/config
   * @returns MFA configuration from config
   */
  getMfaConfig(): {
    enabled: boolean;
    methods: {
      totp: { enabled: boolean; issuer: string };
      sms: { enabled: boolean };
      email: { enabled: boolean };
      webauthn: { enabled: boolean };
    };
  };

  /**
   * Validate MFA method is supported
   * @param method - MFA method to validate
   * @returns True if method is supported
   */
  isMethodSupported(method: MfaMethod): boolean;

  /**
   * Get available MFA methods based on configuration
   * @returns Array of available MFA methods
   */
  getAvailableMethods(): MfaMethod[];
}
