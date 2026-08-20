import { describe, expect, it } from 'vitest';

import { mapOidcTokenData } from '../../../src/integration/base-oidc-social-login.js';

describe('OIDC social token normalization', () => {
  it('maps the common OIDC token response contract', () => {
    expect(
      mapOidcTokenData({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
        token_type: 'DPoP',
        expires_at: 123_456,
        scope: 'openid profile offline_access',
      })
    ).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
      token_type: 'DPoP',
      expires_at: new Date(123_456_000),
      scope: 'openid profile offline_access',
    });
  });

  it.each(['not-a-number', -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores invalid absolute expiry metadata %#',
    expiresAt => {
      expect(
        mapOidcTokenData({
          access_token: 'access-token',
          expires_at: expiresAt,
        })
      ).toEqual({
        access_token: 'access-token',
        refresh_token: undefined,
        id_token: undefined,
        token_type: 'Bearer',
        expires_at: undefined,
        scope: undefined,
      });
    }
  );
});
