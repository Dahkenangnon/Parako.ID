import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type {
  WebAuthnCredential,
  WebAuthnConfig,
  WebAuthnRegistrationResult,
  WebAuthnAuthenticationResult,
  PasskeyInfo,
} from '../../types/webauthn.js';

/**
 * Interface for WebAuthnService - handles WebAuthn (passkey) operations
 */
export interface IWebAuthnService {
  /**
   * Get WebAuthn configuration from application settings
   */
  getConfig(): WebAuthnConfig;

  /**
   * Check if WebAuthn is enabled in configuration
   */
  isEnabled(): boolean;

  /**
   * Generate registration options for a new passkey
   * @param userId - Unique user identifier (username)
   * @param userName - Display name for the user
   * @param userDisplayName - Human-readable display name
   * @param existingCredentialIds - IDs of existing credentials to exclude
   */
  generateRegistrationOptions(
    userId: string,
    userName: string,
    userDisplayName: string,
    existingCredentialIds?: string[]
  ): Promise<PublicKeyCredentialCreationOptionsJSON>;

  /**
   * Verify registration response and create credential object
   * @param userId - User identifier
   * @param response - Registration response from browser
   * @param expectedChallenge - Challenge that was sent to the browser
   * @param expectedOrigin - Expected origin URL
   */
  verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    expectedChallenge: string,
    expectedOrigin: string
  ): Promise<WebAuthnRegistrationResult>;

  /**
   * Generate authentication options for a user
   * @param userId - User identifier
   * @param credentials - User's registered credentials
   */
  generateAuthenticationOptions(
    userId: string,
    credentials: WebAuthnCredential[]
  ): Promise<PublicKeyCredentialRequestOptionsJSON>;

  /**
   * Verify authentication response
   * @param credential - The credential being used
   * @param response - Authentication response from browser
   * @param expectedChallenge - Challenge that was sent to the browser
   * @param expectedOrigin - Expected origin URL
   */
  verifyAuthentication(
    credential: WebAuthnCredential,
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    expectedOrigin: string
  ): Promise<WebAuthnAuthenticationResult>;

  /**
   * Add a new credential to user's account
   * @param username - User's username
   * @param credential - Credential to add
   */
  addCredential(
    username: string,
    credential: WebAuthnCredential
  ): Promise<void>;

  /**
   * Remove a credential from user's account
   * @param username - User's username
   * @param credentialId - ID of credential to remove
   */
  removeCredential(username: string, credentialId: string): Promise<boolean>;

  /**
   * Rename a credential
   * @param username - User's username
   * @param credentialId - ID of credential to rename
   * @param newName - New friendly name
   */
  renameCredential(
    username: string,
    credentialId: string,
    newName: string
  ): Promise<boolean>;

  /**
   * Get all credentials for a user
   * @param username - User's username
   */
  getCredentials(username: string): Promise<WebAuthnCredential[]>;

  /**
   * Get passkey info for display (without sensitive data)
   * @param username - User's username
   */
  getPasskeyInfo(username: string): Promise<PasskeyInfo[]>;

  /**
   * Update credential counter after successful authentication
   * @param username - User's username
   * @param credentialId - ID of credential to update
   * @param newCounter - New counter value
   */
  updateCredentialCounter(
    username: string,
    credentialId: string,
    newCounter: number
  ): Promise<void>;

  /**
   * Update credential last used timestamp
   * @param username - User's username
   * @param credentialId - ID of credential to update
   */
  updateCredentialLastUsed(
    username: string,
    credentialId: string
  ): Promise<void>;

  /**
   * Find a credential by its ID across all users (for discoverable credentials)
   * @param credentialId - Base64URL encoded credential ID
   */
  findCredentialById(
    credentialId: string
  ): Promise<{ username: string; credential: WebAuthnCredential } | null>;

  /**
   * Check if user has reached maximum allowed credentials
   * @param username - User's username
   */
  hasReachedMaxCredentials(username: string): Promise<boolean>;

  /**
   * Enable WebAuthn MFA for a user
   * @param username - User's username
   */
  enableWebAuthnMfa(username: string): Promise<void>;

  /**
   * Disable WebAuthn MFA for a user (removes all credentials)
   * @param username - User's username
   */
  disableWebAuthnMfa(username: string): Promise<void>;

  /**
   * Generate a default friendly name for a credential based on user agent
   * @param userAgent - Browser user agent string
   * @param authenticatorAttachment - Platform or cross-platform
   */
  generateDefaultCredentialName(
    userAgent: string,
    authenticatorAttachment?: 'platform' | 'cross-platform'
  ): string;
}
