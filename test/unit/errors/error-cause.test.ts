/**
 * Verifies that error chaining via `Error.cause` (Node ≥16, see
 * https://nodejs.org/api/errors.html) is wired correctly for the encryption
 * helpers. A failure to chain causes silently loses the original stack and
 * makes production triage materially harder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt } from '../../../src/utils/encryption.js';

let originalKey: string | undefined;

beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

describe('encrypt() error chaining', () => {
  it('wraps the underlying error via Error.cause when the key is invalid', () => {
    process.env.ENCRYPTION_KEY = 'not-hex-not-base64-too-short';
    try {
      encrypt('payload');
      throw new Error('expected encrypt() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Encryption failed');
      // Underlying error must be reachable via .cause for log inspectors.
      expect((err as Error).cause).toBeDefined();
      expect((err as Error).cause).not.toBeNull();
    } finally {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    }
  });
});

describe('decrypt() error chaining', () => {
  it('wraps the underlying error via Error.cause on tampered ciphertext', () => {
    const fixture = encrypt('the quick brown fox');
    // Flip a byte in the ciphertext to force a GCM auth failure.
    const tamperedEncrypted = fixture.encrypted.replace(/^./, c =>
      c === '0' ? '1' : '0'
    );

    try {
      decrypt(tamperedEncrypted, fixture.iv, fixture.authTag, fixture.version);
      throw new Error('expected decrypt() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('Decryption failed');
      expect((err as Error).cause).toBeDefined();
      expect((err as Error).cause).not.toBeNull();
    }
  });
});
