import { describe, it, expect } from 'vitest';

import {
  adminOidcClientCreateBodySchema,
  adminOidcClientUpdateBodySchema,
} from '../../../../src/validators/admin/oidc-clients.js';
import {
  adminUserCreateBodySchema,
  adminUserUpdateBodySchema,
} from '../../../../src/validators/admin/users.js';

describe('adminUserCreateBodySchema', () => {
  it('accepts a minimal valid body', () => {
    const result = adminUserCreateBodySchema.parse({
      email: 'a@b.io',
      password: 's3cret',
      given_name: 'Ada',
      family_name: 'Lovelace',
    });
    expect(result.email).toBe('a@b.io');
  });

  it('rejects an empty password (structural only — policy lives in UserService)', () => {
    expect(
      adminUserCreateBodySchema.safeParse({
        email: 'a@b.io',
        password: '',
        given_name: 'Ada',
        family_name: 'Lovelace',
      }).success
    ).toBe(false);
  });

  it('preserves optional profile fields the controller consumes', () => {
    const result = adminUserCreateBodySchema.parse({
      email: 'a@b.io',
      password: 'x',
      given_name: 'A',
      family_name: 'B',
      gender: 'F',
      birthdate: '1990-01-01',
      roles: ['user'],
      account_enabled: 'true',
    } as unknown as Record<string, unknown>);
    expect((result as unknown as { gender: string }).gender).toBe('F');
    expect(
      (result as unknown as { account_enabled: string }).account_enabled
    ).toBe('true');
  });

  it('trims given_name / family_name', () => {
    const result = adminUserCreateBodySchema.parse({
      email: 'a@b.io',
      password: 'x',
      given_name: '  Ada  ',
      family_name: '  Lovelace  ',
    });
    expect(result.given_name).toBe('Ada');
    expect(result.family_name).toBe('Lovelace');
  });
});

describe('adminUserUpdateBodySchema', () => {
  it('accepts a minimal valid body without a password field', () => {
    expect(
      adminUserUpdateBodySchema.parse({
        email: 'a@b.io',
        given_name: 'A',
        family_name: 'B',
      })
    ).toEqual({
      email: 'a@b.io',
      given_name: 'A',
      family_name: 'B',
    });
  });

  it('rejects an empty family_name', () => {
    expect(
      adminUserUpdateBodySchema.safeParse({
        email: 'a@b.io',
        given_name: 'A',
        family_name: '',
      }).success
    ).toBe(false);
  });
});

describe('adminOidcClientCreateBodySchema', () => {
  it('accepts the minimum and preserves any additional fields', () => {
    const result = adminOidcClientCreateBodySchema.parse({
      client_name: 'My App',
      application_type: 'spa',
      redirect_uris: ['https://example.com/cb'],
      scopes: ['openid', 'profile'],
    });
    expect(result.client_name).toBe('My App');
    expect(
      (result as unknown as { redirect_uris: unknown }).redirect_uris
    ).toEqual(['https://example.com/cb']);
  });

  it('rejects an empty client_name', () => {
    expect(
      adminOidcClientCreateBodySchema.safeParse({
        client_name: '',
        application_type: 'web',
      }).success
    ).toBe(false);
  });

  it('rejects application_type outside the allow-list', () => {
    expect(
      adminOidcClientCreateBodySchema.safeParse({
        client_name: 'X',
        application_type: 'iot',
      }).success
    ).toBe(false);
  });
});

describe('adminOidcClientUpdateBodySchema', () => {
  it('accepts the same shape as the create body', () => {
    expect(
      adminOidcClientUpdateBodySchema.parse({
        client_name: 'X',
        application_type: 'web',
      })
    ).toMatchObject({ client_name: 'X', application_type: 'web' });
  });
});
