import * as argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import { PasswordUtils } from '../../../src/utils/password.js';

function expectCurrentArgon2idHash(hash: string) {
  const [empty, algorithm, version, serializedParameters] = hash.split('$');
  const parameters = Object.fromEntries(
    serializedParameters.split(',').map(entry => entry.split('='))
  );

  expect(empty).toBe('');
  expect(algorithm).toBe('argon2id');
  expect(version).toBe('v=19');
  expect(parameters).toEqual({ m: '19456', p: '1', t: '2' });
}

describe('PasswordUtils', () => {
  const passwords = new PasswordUtils();

  it.each([[''], [null], [undefined], [42]])(
    'rejects an invalid password value: %s',
    async password => {
      await expect(passwords.hashPassword(password as never)).rejects.toThrow(
        'Password must be a non-empty string'
      );
    }
  );

  it('creates salted Argon2id hashes with the configured security parameters', async () => {
    const first = await passwords.hashPassword('correct horse battery staple');
    const second = await passwords.hashPassword('correct horse battery staple');

    expectCurrentArgon2idHash(first);
    expectCurrentArgon2idHash(second);
    expect(second).not.toBe(first);
  });

  it('verifies the correct password without requesting a current hash upgrade', async () => {
    const hash = await passwords.hashPassword('pässword-🔐');

    await expect(
      passwords.verifyPassword('pässword-🔐', hash)
    ).resolves.toEqual({ valid: true, needsUpgrade: false });
  });

  it('rejects an incorrect password without requesting an upgrade', async () => {
    const hash = await passwords.hashPassword('right-password');

    await expect(
      passwords.verifyPassword('wrong-password', hash)
    ).resolves.toEqual({ valid: false, needsUpgrade: false });
  });

  it('reports a valid legacy hash that needs stronger parameters', async () => {
    const legacyHash = await argon2.hash('legacy-password', {
      type: argon2.argon2id,
      memoryCost: 12_288,
      timeCost: 3,
      parallelism: 1,
    });

    await expect(
      passwords.verifyPassword('legacy-password', legacyHash)
    ).resolves.toEqual({ valid: true, needsUpgrade: true });
  });

  it('replaces a valid legacy hash with the current Argon2id parameters', async () => {
    const legacyHash = await argon2.hash('legacy-password', {
      type: argon2.argon2id,
      memoryCost: 12_288,
      timeCost: 3,
      parallelism: 1,
    });

    const upgradedHash = await passwords.rehashIfNeeded(
      'legacy-password',
      legacyHash
    );

    expect(upgradedHash).not.toBeNull();
    expectCurrentArgon2idHash(upgradedHash!);
    await expect(argon2.verify(upgradedHash!, 'legacy-password')).resolves.toBe(
      true
    );
  });

  it('does not replace a current hash', async () => {
    const currentHash = await passwords.hashPassword('current-password');

    await expect(
      passwords.rehashIfNeeded('current-password', currentHash)
    ).resolves.toBeNull();
  });

  it('does not replace a hash when the password is invalid', async () => {
    const currentHash = await passwords.hashPassword('current-password');

    await expect(
      passwords.rehashIfNeeded('wrong-password', currentHash)
    ).resolves.toBeNull();
  });
});
