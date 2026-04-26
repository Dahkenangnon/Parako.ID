import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptWithKey,
  decryptWithKey,
  isEncrypted,
} from '../../../src/utils/encryption';

describe('encryptWithKey / decryptWithKey', () => {
  const key = randomBytes(32);

  it('should encrypt and decrypt a string round-trip', () => {
    const plaintext = 'hello world secret data';
    const encrypted = encryptWithKey(plaintext, key);

    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted.startsWith('ENCRYPTED:v1:')).toBe(true);

    const decrypted = decryptWithKey(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'test data';
    const enc1 = encryptWithKey(plaintext, key);
    const enc2 = encryptWithKey(plaintext, key);
    expect(enc1).not.toBe(enc2);
  });

  it('should fail to decrypt with wrong key', () => {
    const encrypted = encryptWithKey('secret', key);
    const wrongKey = randomBytes(32);
    expect(() => decryptWithKey(encrypted, wrongKey)).toThrow();
  });

  it('should throw for empty plaintext', () => {
    expect(() => encryptWithKey('', key)).toThrow(
      'Plaintext must be a non-empty string'
    );
  });

  it('should throw for wrong key length', () => {
    expect(() => encryptWithKey('test', randomBytes(16))).toThrow(
      'Key must be 32 bytes'
    );
    expect(() =>
      decryptWithKey('ENCRYPTED:v1:aaa:bbb:ccc', randomBytes(16))
    ).toThrow('Key must be 32 bytes');
  });

  it('should handle unicode content', () => {
    const plaintext = '{"key": "value with émojis 🔑 and accents éàü"}';
    const encrypted = encryptWithKey(plaintext, key);
    const decrypted = decryptWithKey(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('should handle large payloads', () => {
    const plaintext = 'x'.repeat(10000);
    const encrypted = encryptWithKey(plaintext, key);
    const decrypted = decryptWithKey(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });
});
