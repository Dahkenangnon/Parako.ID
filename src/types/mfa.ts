/**
 * MFA method types supported by the system
 */
export type MfaMethod = 'totp' | 'sms' | 'email' | 'webauthn';

/**
 * Update object for enabling/disabling MFA methods
 * Uses MongoDB dot notation for partial updates
 */
export interface MfaMethodUpdate {
  [key: string]: boolean | string | Date | undefined;
}

/**
 * TOTP verification result
 */
export interface TotpVerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Email OTP generation result
 */
export interface EmailOtpResult {
  code: string;
  hash: string;
  expiresAt: Date;
}

/**
 * QR Code generation result
 */
export interface QrCodeResult {
  otpauth: string;
  qrDataUri: string;
}

/**
 * MFA setup result
 */
export interface MfaSetupResult {
  secret: string;
  qrCode: QrCodeResult;
  backup_codes?: string[];
}
