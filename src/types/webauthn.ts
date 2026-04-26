/**
 * WebAuthn type definitions for passkey authentication
 * Compatible with @simplewebauthn/server credential format
 */

/**
 * Authenticator transport types as defined by W3C WebAuthn spec
 */
export type AuthenticatorTransportType =
  | 'usb'
  | 'ble'
  | 'nfc'
  | 'internal'
  | 'hybrid';

/**
 * Device type indicating whether credential is synced or device-bound
 */
export type CredentialDeviceType = 'singleDevice' | 'multiDevice';

/**
 * WebAuthn credential structure stored in user.mfa.webauthn_creds
 * This format is compatible with @simplewebauthn/server
 */
export interface WebAuthnCredential {
  /** Base64URL encoded credential ID */
  credential_id: string;
  /** Base64URL encoded public key */
  credential_public_key: string;
  /** Signature counter for replay protection - must increment on each use */
  counter: number;
  /** Available transports for this credential */
  transports?: AuthenticatorTransportType[];
  /** Whether this is a single-device or multi-device (synced) credential */
  device_type: CredentialDeviceType;
  /** Whether the credential is backed up (synced across devices) */
  backed_up: boolean;
  /** When the credential was registered */
  created_at: Date;
  /** When the credential was last used for authentication */
  last_used_at?: Date;
  /** User-assigned friendly name for this passkey */
  friendly_name: string;
}

/**
 * Challenge stored temporarily during registration/authentication
 * Should be stored in session with short TTL (5 minutes max)
 */
export interface WebAuthnChallenge {
  /** Base64URL encoded challenge */
  challenge: string;
  /** User identifier (username) */
  userId: string;
  /** Type of WebAuthn operation */
  type: 'registration' | 'authentication';
  /** Challenge expiration timestamp */
  expiresAt: Date;
}

/**
 * WebAuthn configuration from application settings
 */
export interface WebAuthnConfig {
  enabled: boolean;
  rpName: string;
  rpId: string;
  timeout: number;
  attestation: 'none' | 'indirect' | 'direct' | 'enterprise';
  userVerification: 'required' | 'preferred' | 'discouraged';
  authenticatorAttachment?: 'platform' | 'cross-platform';
  residentKey: 'required' | 'preferred' | 'discouraged';
  maxCredentialsPerUser: number;
}

/**
 * Result from credential registration verification
 */
export interface WebAuthnRegistrationResult {
  verified: boolean;
  credential?: WebAuthnCredential;
  error?: string;
}

/**
 * Result from credential authentication verification
 */
export interface WebAuthnAuthenticationResult {
  verified: boolean;
  credentialId?: string;
  newCounter?: number;
  error?: string;
}

/**
 * Passkey info for display in UI (without sensitive data)
 */
export interface PasskeyInfo {
  credential_id: string;
  friendly_name: string;
  device_type: CredentialDeviceType;
  backed_up: boolean;
  created_at: Date;
  last_used_at?: Date;
  transports?: AuthenticatorTransportType[];
}
