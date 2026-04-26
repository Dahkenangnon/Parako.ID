/**
 * Key Encryption Utility for JWKS Private Keys
 *
 * Derives a 32-byte AES key from the JWT secret (security.secrets.jwt_secret)
 * using HKDF (HMAC-based Key Derivation Function) and uses it to
 * encrypt/decrypt JWK private key material at rest.
 *
 * This provides a dedicated encryption key for JWKS keys separate from the
 * general-purpose ENCRYPTION_KEY environment variable.
 */

import { hkdfSync } from 'node:crypto';
import { encryptWithKey, decryptWithKey, isEncrypted } from './encryption.js';

/** Static salt for HKDF — safe to be public; only the input secret is private. */
const HKDF_SALT = 'parako-jwks-key-encryption';

/** Application-specific info parameter for HKDF key isolation. */
const HKDF_INFO = 'aes-256-gcm-jwks-key';

/**
 * Derive a 32-byte AES key from a secret string using HKDF (RFC 5869).
 *
 * HKDF is the standard for deriving cryptographic keys from high-entropy
 * secrets. Unlike raw SHA-256, HKDF separates the extract and expand
 * phases, producing keys with a strong security proof.
 */
export function deriveKeyFromSecret(secret: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error(
      'Secret must be at least 32 characters for secure key derivation'
    );
  }
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32));
}

/**
 * Encrypt a JWK object for storage
 *
 * @param jwk - The JWK (private key material) to encrypt
 * @param derivedKey - The 32-byte derived AES key
 * @returns Encrypted string in ENCRYPTED:v1:... format
 */
export function encryptJWK(jwk: JsonWebKey, derivedKey: Buffer): string {
  const plaintext = JSON.stringify(jwk);
  return encryptWithKey(plaintext, derivedKey);
}

/**
 * Decrypt an encrypted JWK string back to a JWK object
 *
 * @param encrypted - The encrypted string (ENCRYPTED:v1:... format)
 * @param derivedKey - The 32-byte derived AES key
 * @returns The decrypted JWK object
 */
export function decryptJWK(encrypted: string, derivedKey: Buffer): JsonWebKey {
  const plaintext = decryptWithKey(encrypted, derivedKey);
  return JSON.parse(plaintext) as JsonWebKey;
}

/**
 * Check if a value is an encrypted JWK (has ENCRYPTED: prefix)
 */
export function isEncryptedJWK(value: unknown): value is string {
  return typeof value === 'string' && isEncrypted(value);
}
