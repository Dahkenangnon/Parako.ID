import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption Utility for Database Secrets
 *
 * Uses AES-256-GCM encryption algorithm for secure encryption of sensitive data
 * stored in the database. This utility provides version tracking for future key
 * rotation and migration to external KMS (AWS KMS, Google KMS, HashiCorp Vault).
 *
 * Encryption Format: ENCRYPTED:v{version}:{iv}:{authTag}:{ciphertext}
 *
 * Example: ENCRYPTED:v1:a1b2c3d4...:e5f6g7h8...:i9j0k1l2...
 *
 * @module encryption
 */

/**
 * Current encryption version
 * Increment this when changing encryption algorithm or key rotation
 */
const CURRENT_VERSION = 1;

/**
 * Encryption algorithm
 */
const ALGORITHM = 'aes-256-gcm';

/**
 * Encryption key length in bytes (32 bytes = 256 bits)
 */
const KEY_LENGTH = 32;

/**
 * Initialization Vector (IV) length in bytes (12 bytes recommended for GCM)
 */
const IV_LENGTH = 12;

/**
 * Authentication tag length in bytes (16 bytes for GCM)
 */
const AUTH_TAG_LENGTH = 16;

/**
 * Prefix for encrypted values
 */
const ENCRYPTED_PREFIX = 'ENCRYPTED:';

/**
 * Result of encryption operation
 */
export interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
  version: number;
}

/**
 * Get the encryption key from environment variable
 *
 * @returns {Buffer} The encryption key as a Buffer
 * @throws {Error} If ENCRYPTION_KEY is not set or invalid
 */
function getEncryptionKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
        'Please set it in your .env file. ' +
        "Generate a key using: yarn clav setup or node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  // Support both hex and base64 encoded keys
  let keyBuffer: Buffer;

  if (encryptionKey.length === 64 && /^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    keyBuffer = Buffer.from(encryptionKey, 'hex');
  } else if (encryptionKey.length === 44) {
    keyBuffer = Buffer.from(encryptionKey, 'base64');
  } else {
    keyBuffer = Buffer.from(encryptionKey);
  }

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters or 44 base64 characters). ` +
        `Current length: ${keyBuffer.length} bytes. ` +
        "Generate a new key using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  return keyBuffer;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 *
 * @param {string} plaintext - The plaintext string to encrypt
 * @returns {EncryptionResult} Object containing encrypted data, IV, auth tag, and version
 * @throws {Error} If encryption fails or ENCRYPTION_KEY is invalid
 *
 * @example
 * const result = encrypt('my-secret-password');
 * // Returns: {
 * //   encrypted: 'a1b2c3...',
 * //   iv: 'd4e5f6...',
 * //   authTag: 'g7h8i9...',
 * //   version: 1
 * // }
 */
export function encrypt(plaintext: string): EncryptionResult {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a non-empty string');
  }

  try {
    const key = getEncryptionKey();

    // Generate a random IV for each encryption (important for security)
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      version: CURRENT_VERSION,
    };
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Decrypt an encrypted string using AES-256-GCM
 *
 * @param {string} encrypted - The encrypted string (hex encoded)
 * @param {string} iv - The initialization vector (hex encoded)
 * @param {string} authTag - The authentication tag (hex encoded)
 * @param {number} version - The encryption version used
 * @returns {string} The decrypted plaintext
 * @throws {Error} If decryption fails, auth tag is invalid, or ENCRYPTION_KEY is wrong
 *
 * @example
 * const plaintext = decrypt('a1b2c3...', 'd4e5f6...', 'g7h8i9...', 1);
 * // Returns: 'my-secret-password'
 */
export function decrypt(
  encrypted: string,
  iv: string,
  authTag: string,
  version: number
): string {
  if (!encrypted || !iv || !authTag) {
    throw new Error(
      'Encrypted data, IV, and auth tag are required for decryption'
    );
  }

  if (version !== CURRENT_VERSION) {
    // Future: Support multiple versions for key rotation
    // For now, we only support the current version
    console.warn(
      `Decrypting data with version ${version}, current version is ${CURRENT_VERSION}. ` +
        'Consider re-encrypting with the current version.'
    );
  }

  try {
    const key = getEncryptionKey();

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // GCM will throw an error if the auth tag doesn't match (tampering detected)
    throw new Error(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        'This could indicate data tampering or wrong encryption key.'
    );
  }
}

/**
 * Generate a cryptographically secure encryption key
 * This is a utility function for setup scripts and key generation
 *
 * @param {string} format - Output format: 'hex' (default) or 'base64'
 * @returns {string} A random encryption key in the specified format
 *
 * @example
 * const hexKey = generateEncryptionKey();
 * // Returns: 'a1b2c3d4e5f6...' (64 hex characters)
 *
 * const base64Key = generateEncryptionKey('base64');
 * // Returns: 'YWJjZGVm...' (44 base64 characters)
 */
export function generateEncryptionKey(
  format: 'hex' | 'base64' = 'hex'
): string {
  const key = randomBytes(KEY_LENGTH);
  return format === 'base64' ? key.toString('base64') : key.toString('hex');
}

/**
 * Check if a value is encrypted (starts with ENCRYPTED: prefix)
 *
 * @param {string} value - The value to check
 * @returns {boolean} True if the value is encrypted, false otherwise
 *
 * @example
 * isEncrypted('ENCRYPTED:v1:abc123:def456:ghi789'); // true
 * isEncrypted('plain-text-password'); // false
 * isEncrypted(''); // false
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Serialize encrypted data into storage format
 * Format: ENCRYPTED:v{version}:{iv}:{authTag}:{ciphertext}
 *
 * @param {EncryptionResult} result - The encryption result
 * @returns {string} The serialized encrypted string
 *
 * @example
 * const result = encrypt('my-secret');
 * const serialized = serializeEncrypted(result);
 * // Returns: 'ENCRYPTED:v1:abc123:def456:ghi789'
 */
export function serializeEncrypted(result: EncryptionResult): string {
  return `${ENCRYPTED_PREFIX}v${result.version}:${result.iv}:${result.authTag}:${result.encrypted}`;
}

/**
 * Parse a serialized encrypted string back into components
 *
 * @param {string} serialized - The serialized encrypted string
 * @returns {EncryptionResult} The parsed encryption components
 * @throws {Error} If the format is invalid
 *
 * @example
 * const result = parseEncrypted('ENCRYPTED:v1:abc123:def456:ghi789');
 * // Returns: { version: 1, iv: 'abc123', authTag: 'def456', encrypted: 'ghi789' }
 */
export function parseEncrypted(serialized: string): EncryptionResult {
  if (!isEncrypted(serialized)) {
    throw new Error('Value is not in encrypted format');
  }

  const withoutPrefix = serialized.substring(ENCRYPTED_PREFIX.length);
  const parts = withoutPrefix.split(':');

  if (parts.length !== 4) {
    throw new Error(
      `Invalid encrypted format. Expected 4 parts (version:iv:authTag:ciphertext), got ${parts.length}`
    );
  }

  const [versionPart, iv, authTag, encrypted] = parts;

  if (!versionPart.startsWith('v')) {
    throw new Error('Invalid version format. Expected format: v1, v2, etc.');
  }

  const version = parseInt(versionPart.substring(1), 10);
  if (isNaN(version)) {
    throw new Error(`Invalid version number: ${versionPart}`);
  }

  return {
    version,
    iv,
    authTag,
    encrypted,
  };
}

/**
 * Encrypt and serialize a plaintext value in one operation
 * This is a convenience function that combines encrypt() and serializeEncrypted()
 *
 * @param {string} plaintext - The plaintext to encrypt
 * @returns {string} The serialized encrypted string ready for storage
 *
 * @example
 * const encrypted = encryptValue('my-secret-password');
 * // Returns: 'ENCRYPTED:v1:abc123:def456:ghi789'
 */
export function encryptValue(plaintext: string): string {
  const result = encrypt(plaintext);
  return serializeEncrypted(result);
}

/**
 * Parse and decrypt a serialized encrypted value in one operation
 * This is a convenience function that combines parseEncrypted() and decrypt()
 *
 * @param {string} serialized - The serialized encrypted string
 * @returns {string} The decrypted plaintext
 *
 * @example
 * const plaintext = decryptValue('ENCRYPTED:v1:abc123:def456:ghi789');
 * // Returns: 'my-secret-password'
 */
export function decryptValue(serialized: string): string {
  const { encrypted, iv, authTag, version } = parseEncrypted(serialized);
  return decrypt(encrypted, iv, authTag, version);
}

/**
 * Conditionally encrypt a value only if it's not already encrypted
 * Useful for idempotent operations where you're not sure if data is already encrypted
 *
 * @param {string} value - The value to encrypt (if not already encrypted)
 * @returns {string} The encrypted value (or original if already encrypted)
 *
 * @example
 * const encrypted1 = ensureEncrypted('plain-password');
 * // Returns: 'ENCRYPTED:v1:...'
 *
 * const encrypted2 = ensureEncrypted('ENCRYPTED:v1:abc:def:ghi');
 * // Returns: 'ENCRYPTED:v1:abc:def:ghi' (unchanged)
 */
export function ensureEncrypted(value: string): string {
  if (isEncrypted(value)) {
    return value;
  }
  return encryptValue(value);
}

/**
 * Conditionally decrypt a value only if it's encrypted
 * Useful for handling mixed encrypted/plain data during migration
 *
 * @param {string} value - The value to decrypt (if encrypted)
 * @returns {string} The plaintext value
 *
 * @example
 * const plain1 = ensureDecrypted('ENCRYPTED:v1:abc:def:ghi');
 * // Returns: 'my-secret-password'
 *
 * const plain2 = ensureDecrypted('plain-password');
 * // Returns: 'plain-password' (unchanged)
 */
export function ensureDecrypted(value: string): string {
  if (!isEncrypted(value)) {
    return value;
  }
  return decryptValue(value);
}

/**
 * Encrypt a plaintext string using AES-256-GCM with an explicit key buffer.
 * Unlike encrypt(), this does not read from ENCRYPTION_KEY env var.
 *
 * @param plaintext - The plaintext string to encrypt
 * @param key - The 32-byte encryption key
 * @returns The serialized encrypted string (ENCRYPTED:v1:iv:authTag:ciphertext)
 */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a non-empty string');
  }
  if (!key || key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}v${CURRENT_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a serialized encrypted string using AES-256-GCM with an explicit key buffer.
 * Unlike decryptValue(), this does not read from ENCRYPTION_KEY env var.
 *
 * @param serialized - The serialized encrypted string (ENCRYPTED:v1:iv:authTag:ciphertext)
 * @param key - The 32-byte encryption key
 * @returns The decrypted plaintext
 */
export function decryptWithKey(serialized: string, key: Buffer): string {
  if (!key || key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }

  const { encrypted, iv, authTag } = parseEncrypted(serialized);

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encryption utility information and constants
 * Exported for testing and informational purposes
 */
export const EncryptionInfo = {
  algorithm: ALGORITHM,
  keyLength: KEY_LENGTH,
  ivLength: IV_LENGTH,
  authTagLength: AUTH_TAG_LENGTH,
  currentVersion: CURRENT_VERSION,
  prefix: ENCRYPTED_PREFIX,
} as const;
