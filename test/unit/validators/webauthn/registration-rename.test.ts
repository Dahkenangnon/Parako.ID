import { describe, it, expect } from 'vitest';

import { webauthnVerifyRegistrationBodySchema } from '../../../../src/validators/webauthn/registration.js';
import {
  webauthnRenameCredentialBodySchema,
  webauthnRenameCredentialParamsSchema,
} from '../../../../src/validators/webauthn/rename.js';

describe('webauthnVerifyRegistrationBodySchema', () => {
  it('accepts a credential object plus optional friendly_name', () => {
    expect(
      webauthnVerifyRegistrationBodySchema.parse({
        credential: { id: 'abc', response: { clientDataJSON: 'x' } },
        friendly_name: 'iPhone',
      }).friendly_name
    ).toBe('iPhone');
  });

  it('accepts a credential without a friendly_name', () => {
    const result = webauthnVerifyRegistrationBodySchema.parse({
      credential: { id: 'abc' },
    });
    expect(result.friendly_name).toBeUndefined();
  });

  it('rejects a missing credential', () => {
    expect(
      webauthnVerifyRegistrationBodySchema.safeParse({
        friendly_name: 'iPhone',
      }).success
    ).toBe(false);
  });

  it('rejects a credential that is not an object', () => {
    expect(
      webauthnVerifyRegistrationBodySchema.safeParse({
        credential: 'string-not-object',
      }).success
    ).toBe(false);
  });

  it('rejects friendly_name over 100 characters', () => {
    expect(
      webauthnVerifyRegistrationBodySchema.safeParse({
        credential: {},
        friendly_name: 'x'.repeat(101),
      }).success
    ).toBe(false);
  });
});

describe('webauthnRenameCredentialParamsSchema', () => {
  it('accepts a non-empty credentialId', () => {
    expect(
      webauthnRenameCredentialParamsSchema.parse({ credentialId: 'cred-1' })
        .credentialId
    ).toBe('cred-1');
  });

  it('rejects an empty credentialId', () => {
    expect(
      webauthnRenameCredentialParamsSchema.safeParse({ credentialId: '' })
        .success
    ).toBe(false);
  });
});

describe('webauthnRenameCredentialBodySchema', () => {
  it('trims and accepts a friendlyName', () => {
    expect(
      webauthnRenameCredentialBodySchema.parse({ friendlyName: '  Yubikey  ' })
        .friendlyName
    ).toBe('Yubikey');
  });

  it('rejects an empty friendlyName', () => {
    expect(
      webauthnRenameCredentialBodySchema.safeParse({ friendlyName: '' }).success
    ).toBe(false);
  });

  it('rejects friendlyName over 100 characters', () => {
    expect(
      webauthnRenameCredentialBodySchema.safeParse({
        friendlyName: 'x'.repeat(101),
      }).success
    ).toBe(false);
  });
});
