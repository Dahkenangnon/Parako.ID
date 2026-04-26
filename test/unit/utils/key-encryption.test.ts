import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  deriveKeyFromSecret,
  encryptJWK,
  decryptJWK,
  isEncryptedJWK,
} from '../../../src/utils/key-encryption';

describe('key-encryption', () => {
  const testSecret =
    'a-very-long-secret-that-is-at-least-32-characters-long-for-testing';

  describe('deriveKeyFromSecret', () => {
    it('should derive a 32-byte key from a secret', () => {
      const key = deriveKeyFromSecret(testSecret);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive the same key for the same secret', () => {
      const key1 = deriveKeyFromSecret(testSecret);
      const key2 = deriveKeyFromSecret(testSecret);
      expect(key1.equals(key2)).toBe(true);
    });

    it('should derive different keys for different secrets', () => {
      const key1 = deriveKeyFromSecret(testSecret);
      const key2 = deriveKeyFromSecret(`${testSecret}-different`);
      expect(key1.equals(key2)).toBe(false);
    });

    it('should throw if secret is too short', () => {
      expect(() => deriveKeyFromSecret('short')).toThrow(
        'at least 32 characters'
      );
    });

    it('should throw if secret is empty', () => {
      expect(() => deriveKeyFromSecret('')).toThrow('at least 32 characters');
    });
  });

  describe('encryptJWK / decryptJWK', () => {
    const derivedKey = deriveKeyFromSecret(testSecret);

    const sampleJWK: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
      y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
      d: 'jpsQnnGQmL-YBIffS1BSyVKhrlRhskJBQ',
    };

    it('should encrypt and decrypt a JWK round-trip', () => {
      const encrypted = encryptJWK(sampleJWK, derivedKey);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.startsWith('ENCRYPTED:v1:')).toBe(true);

      const decrypted = decryptJWK(encrypted, derivedKey);
      expect(decrypted).toEqual(sampleJWK);
    });

    it('should produce different ciphertext each time (random IV)', () => {
      const enc1 = encryptJWK(sampleJWK, derivedKey);
      const enc2 = encryptJWK(sampleJWK, derivedKey);
      expect(enc1).not.toBe(enc2);
    });

    it('should fail to decrypt with wrong key', () => {
      const encrypted = encryptJWK(sampleJWK, derivedKey);
      const wrongKey = randomBytes(32);
      expect(() => decryptJWK(encrypted, wrongKey)).toThrow();
    });
  });

  describe('isEncryptedJWK', () => {
    it('should return true for encrypted strings', () => {
      const derivedKey = deriveKeyFromSecret(testSecret);
      const encrypted = encryptJWK({ kty: 'EC' }, derivedKey);
      expect(isEncryptedJWK(encrypted)).toBe(true);
    });

    it('should return false for plain strings', () => {
      expect(isEncryptedJWK('not-encrypted')).toBe(false);
    });

    it('should return false for non-strings', () => {
      expect(isEncryptedJWK(123)).toBe(false);
      expect(isEncryptedJWK(null)).toBe(false);
      expect(isEncryptedJWK(undefined)).toBe(false);
      expect(isEncryptedJWK({})).toBe(false);
    });
  });
});
