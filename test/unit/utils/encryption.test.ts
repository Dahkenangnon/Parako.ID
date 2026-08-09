import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decrypt,
  decryptValue,
  EncryptionInfo,
  encrypt,
  encryptValue,
  ensureDecrypted,
  ensureEncrypted,
  generateEncryptionKey,
  isEncrypted,
  parseEncrypted,
  serializeEncrypted,
} from '../../../src/utils/encryption.js';

const validIv = '00'.repeat(12);
const validAuthTag = '11'.repeat(16);
const validCiphertext = 'aa';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('environment-backed encryption', () => {
  it.each([
    ['hex', 'ab'.repeat(32)],
    ['base64', Buffer.alloc(32, 7).toString('base64')],
    ['raw', 'a'.repeat(32)],
  ])('round-trips data using a %s key', (_format, key) => {
    vi.stubEnv('ENCRYPTION_KEY', key);

    const first = encrypt('sensitive value');
    const second = encrypt('sensitive value');

    expect(first).toMatchObject({
      version: 1,
      iv: expect.stringMatching(/^[0-9a-f]{24}$/),
      authTag: expect.stringMatching(/^[0-9a-f]{32}$/),
      encrypted: expect.stringMatching(/^[0-9a-f]+$/),
    });
    expect(first.iv).not.toBe(second.iv);
    expect(
      decrypt(first.encrypted, first.iv, first.authTag, first.version)
    ).toBe('sensitive value');
  });

  it.each([
    ['an unset key', undefined],
    ['an invalid raw key length', 'too-short'],
    ['invalid base64 of the expected encoded length', '!'.repeat(44)],
    ['64 non-hex characters', 'z'.repeat(64)],
  ])('rejects %s', (_description, key) => {
    if (key === undefined) {
      vi.stubEnv('ENCRYPTION_KEY', '');
    } else {
      vi.stubEnv('ENCRYPTION_KEY', key);
    }

    expect(() => encrypt('value')).toThrow('Encryption failed');
  });

  it.each([[''], [null]])('rejects invalid plaintext %j', value => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));

    expect(() => encrypt(value as string)).toThrow(
      'Plaintext must be a non-empty string'
    );
  });

  it.each([
    ['', validIv, validAuthTag],
    [validCiphertext, '', validAuthTag],
    [validCiphertext, validIv, ''],
  ])('rejects missing decryption components', (ciphertext, iv, authTag) => {
    expect(() => decrypt(ciphertext, iv, authTag, 1)).toThrow(
      'Encrypted data, IV, and auth tag are required'
    );
  });

  it('warns but decrypts data carrying a different version', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const encrypted = encrypt('legacy value');

    expect(
      decrypt(encrypted.encrypted, encrypted.iv, encrypted.authTag, 2)
    ).toBe('legacy value');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('version 2, current version is 1')
    );
  });

  it('reports authenticated-decryption failure and preserves its cause', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    const encrypted = encrypt('sensitive value');

    try {
      decrypt(
        encrypted.encrypted,
        encrypted.iv,
        '00'.repeat(16),
        encrypted.version
      );
      expect.unreachable('tampered ciphertext must not decrypt');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'Decryption failed — possible data tampering or wrong encryption key'
      );
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });
});

describe('parseEncrypted', () => {
  it('parses the canonical encrypted storage format', () => {
    expect(
      parseEncrypted(
        `ENCRYPTED:v1:${validIv}:${validAuthTag}:${validCiphertext}`
      )
    ).toEqual({
      version: 1,
      iv: validIv,
      authTag: validAuthTag,
      encrypted: validCiphertext,
    });
  });

  it.each([
    ['a version with trailing data', 'v1junk'],
    ['version zero', 'v0'],
    ['a negative version', 'v-1'],
  ])('rejects %s', (_description, version) => {
    expect(() =>
      parseEncrypted(
        `ENCRYPTED:${version}:${validIv}:${validAuthTag}:${validCiphertext}`
      )
    ).toThrow('Invalid version format');
  });

  it('rejects version numbers outside the safe integer range', () => {
    expect(() =>
      parseEncrypted(
        `ENCRYPTED:v${'9'.repeat(20)}:${validIv}:${validAuthTag}:${validCiphertext}`
      )
    ).toThrow('Invalid version number');
  });

  it.each([
    ['plain text', 'Value is not in encrypted format'],
    ['ENCRYPTED:v1:only-three-parts', 'Expected 4 parts'],
    [
      `ENCRYPTED:v1:${validIv}:${validAuthTag}:${validCiphertext}:extra`,
      'Expected 4 parts',
    ],
    [
      `ENCRYPTED:1:${validIv}:${validAuthTag}:${validCiphertext}`,
      'Invalid version format',
    ],
  ])('rejects malformed structure %s', (serialized, message) => {
    expect(() => parseEncrypted(serialized)).toThrow(message);
  });

  it.each([
    ['a short IV', '00', validAuthTag, validCiphertext, 'IV'],
    ['a non-hex IV', 'zz'.repeat(12), validAuthTag, validCiphertext, 'IV'],
    ['a short authentication tag', validIv, '11', validCiphertext, 'auth tag'],
    [
      'a non-hex authentication tag',
      validIv,
      'zz'.repeat(16),
      validCiphertext,
      'auth tag',
    ],
    ['an empty ciphertext', validIv, validAuthTag, '', 'ciphertext'],
    ['a non-hex ciphertext', validIv, validAuthTag, 'not-hex', 'ciphertext'],
    ['an odd-length ciphertext', validIv, validAuthTag, 'abc', 'ciphertext'],
  ])(
    'rejects %s',
    (_description, iv, authTag, ciphertext, expectedComponent) => {
      expect(() =>
        parseEncrypted(`ENCRYPTED:v1:${iv}:${authTag}:${ciphertext}`)
      ).toThrow(expectedComponent);
    }
  );
});

describe('ensureEncrypted', () => {
  it('rejects malformed prefixed values instead of treating them as encrypted', () => {
    expect(() => ensureEncrypted('ENCRYPTED:v1:00:11:aa')).toThrow(
      'Invalid IV length'
    );
  });

  it('encrypts plaintext and leaves valid encrypted values unchanged', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));

    const encrypted = ensureEncrypted('plain value');

    expect(isEncrypted(encrypted)).toBe(true);
    expect(ensureEncrypted(encrypted)).toBe(encrypted);
    expect(ensureDecrypted(encrypted)).toBe('plain value');
    expect(ensureDecrypted('plain value')).toBe('plain value');
  });
});

describe('generateEncryptionKey', () => {
  it('generates keys in the supported formats', () => {
    expect(generateEncryptionKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateEncryptionKey('hex')).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(generateEncryptionKey('base64'), 'base64')).toHaveLength(
      32
    );
  });

  it('rejects unsupported runtime formats', () => {
    expect(() => generateEncryptionKey('pem' as never)).toThrow(
      'Unsupported encryption key format: pem'
    );
  });
});

describe('serialization helpers', () => {
  it('serializes, parses, encrypts, and decrypts canonical values', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    const result = encrypt('serialized value');
    const serialized = serializeEncrypted(result);

    expect(parseEncrypted(serialized)).toEqual(result);
    expect(decryptValue(serialized)).toBe('serialized value');
    expect(decryptValue(encryptValue('combined value'))).toBe('combined value');
  });

  it.each([
    ['ENCRYPTED:v1:value', true],
    ['plain value', false],
    ['', false],
    [null, false],
  ])('detects encrypted prefix for %j', (value, expected) => {
    expect(isEncrypted(value as string)).toBe(expected);
  });

  it('publishes the active encryption parameters', () => {
    expect(EncryptionInfo).toEqual({
      algorithm: 'aes-256-gcm',
      keyLength: 32,
      ivLength: 12,
      authTagLength: 16,
      currentVersion: 1,
      prefix: 'ENCRYPTED:',
    });
  });
});
