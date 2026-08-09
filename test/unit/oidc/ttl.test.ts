import { describe, expect, it, vi } from 'vitest';

import TTL from '../../../src/oidc/specs/ttl.js';

const tokenTtl = {
  access_token: 3_600,
  authorization_code: 600,
  backchannel_auth: 300,
  client_credentials: 900,
  device_code: 600,
  grant: 3_600,
  id_token: 3_600,
  interaction: 3_600,
  refresh_token: 86_400,
  session: 86_400,
};

function createTtl() {
  const logger = { error: vi.fn() };
  const ttl = TTL(
    {
      getConfig: () => ({ oidc: { token_ttl: tokenTtl } }),
    } as never,
    logger as never
  );

  return { logger, ttl };
}

describe('OIDC TTL policy', () => {
  it('exposes every configured static artifact lifetime unchanged', () => {
    const { ttl } = createTtl();

    expect({
      AuthorizationCode: ttl.AuthorizationCode,
      DeviceCode: ttl.DeviceCode,
      Grant: ttl.Grant,
      IdToken: ttl.IdToken,
      Interaction: ttl.Interaction,
      Session: ttl.Session,
    }).toEqual({
      AuthorizationCode: tokenTtl.authorization_code,
      DeviceCode: tokenTtl.device_code,
      Grant: tokenTtl.grant,
      IdToken: tokenTtl.id_token,
      Interaction: tokenTtl.interaction,
      Session: tokenTtl.session,
    });
  });

  it('uses global defaults when no scoped TTL override exists', () => {
    const { ttl } = createTtl();

    expect(ttl.AccessToken({} as never, {} as never, undefined as never)).toBe(
      tokenTtl.access_token
    );
    expect(
      ttl.BackchannelAuthenticationRequest(
        {} as never,
        {} as never,
        {} as never
      )
    ).toBe(tokenTtl.backchannel_auth);
    expect(ttl.ClientCredentials({} as never, {} as never, {} as never)).toBe(
      tokenTtl.client_credentials
    );
    expect(ttl.RefreshToken({} as never, {} as never, {} as never)).toBe(
      tokenTtl.refresh_token
    );
  });

  it('uses a resource server access-token lifetime when configured', () => {
    const { logger, ttl } = createTtl();

    const result = ttl.AccessToken(
      {} as never,
      { resourceServer: { accessTokenTTL: 1_200 } } as never,
      {} as never
    );

    expect(result).toBe(1_200);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([-1, 0, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid resource-server access-token lifetime %s',
    accessTokenTTL => {
      const { ttl } = createTtl();

      const result = ttl.AccessToken(
        {} as never,
        { resourceServer: { accessTokenTTL } } as never,
        {} as never
      );

      expect(result).toBe(tokenTtl.access_token);
    }
  );

  it('uses a valid per-client access-token lifetime when no resource override exists', () => {
    const { ttl } = createTtl();

    const result = ttl.AccessToken(
      {} as never,
      {} as never,
      {
        ttl: { AccessToken: 1_800 },
      } as never
    );

    expect(result).toBe(1_800);
  });

  it.each([-1, 0, Number.POSITIVE_INFINITY, Number.NaN, '1800', null])(
    'rejects invalid per-client access-token lifetime %s',
    accessTokenTtl => {
      const { ttl } = createTtl();

      const result = ttl.AccessToken(
        {} as never,
        {} as never,
        {
          ttl: { AccessToken: accessTokenTtl },
        } as never
      );

      expect(result).toBe(tokenTtl.access_token);
    }
  );

  it.each([new Error('resource lookup failed'), 'resource lookup failed'])(
    'falls back and logs when access-token TTL resolution throws %s',
    thrownValue => {
      const { logger, ttl } = createTtl();
      const token = Object.defineProperty({}, 'resourceServer', {
        get() {
          throw thrownValue;
        },
      });

      const result = ttl.AccessToken({} as never, token as never, {} as never);

      expect(result).toBe(tokenTtl.access_token);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Error in AccessTokenTTL: resource lookup failed',
      });
    }
  );

  it.each([
    ['120', 120],
    ['600', tokenTtl.backchannel_auth],
  ])(
    'honors requested CIBA expiry %s up to the configured maximum',
    (requestedExpiry, expected) => {
      const { ttl } = createTtl();

      const result = ttl.BackchannelAuthenticationRequest(
        { oidc: { params: { requested_expiry: requestedExpiry } } } as never,
        {} as never,
        {} as never
      );

      expect(result).toBe(expected);
    }
  );

  it.each(['120seconds', '1.5', '0', '-1', 'Infinity'])(
    'rejects malformed CIBA requested expiry %j',
    requestedExpiry => {
      const { ttl } = createTtl();

      const result = ttl.BackchannelAuthenticationRequest(
        { oidc: { params: { requested_expiry: requestedExpiry } } } as never,
        {} as never,
        { ttl: { BackchannelAuthenticationRequest: 200 } } as never
      );

      expect(result).toBe(200);
    }
  );

  it('uses a valid per-client CIBA lifetime when no expiry was requested', () => {
    const { ttl } = createTtl();

    const result = ttl.BackchannelAuthenticationRequest(
      {} as never,
      {} as never,
      { ttl: { BackchannelAuthenticationRequest: 200 } } as never
    );

    expect(result).toBe(200);
  });

  it.each([new Error('parameter lookup failed'), 'parameter lookup failed'])(
    'falls back and logs when CIBA TTL resolution throws %s',
    thrownValue => {
      const { logger, ttl } = createTtl();
      const context = Object.defineProperty({}, 'oidc', {
        get() {
          throw thrownValue;
        },
      });

      const result = ttl.BackchannelAuthenticationRequest(
        context as never,
        {} as never,
        {} as never
      );

      expect(result).toBe(tokenTtl.backchannel_auth);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context:
          'Error in BackchannelAuthenticationRequestTTL: parameter lookup failed',
      });
    }
  );

  it('uses a resource server client-credentials lifetime when configured', () => {
    const { ttl } = createTtl();

    const result = ttl.ClientCredentials(
      {} as never,
      { resourceServer: { accessTokenTTL: 450 } } as never,
      {} as never
    );

    expect(result).toBe(450);
  });

  it.each([-1, 0, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid resource-server client-credentials lifetime %s',
    accessTokenTTL => {
      const { ttl } = createTtl();

      const result = ttl.ClientCredentials(
        {} as never,
        { resourceServer: { accessTokenTTL } } as never,
        { ttl: { ClientCredentials: 600 } } as never
      );

      expect(result).toBe(600);
    }
  );

  it('uses a valid per-client client-credentials lifetime', () => {
    const { ttl } = createTtl();

    const result = ttl.ClientCredentials(
      {} as never,
      {} as never,
      {
        ttl: { ClientCredentials: 600 },
      } as never
    );

    expect(result).toBe(600);
  });

  it.each([new Error('resource lookup failed'), 'resource lookup failed'])(
    'falls back and logs when client-credentials TTL resolution throws %s',
    thrownValue => {
      const { logger, ttl } = createTtl();
      const token = Object.defineProperty({}, 'resourceServer', {
        get() {
          throw thrownValue;
        },
      });

      const result = ttl.ClientCredentials(
        {} as never,
        token as never,
        {} as never
      );

      expect(result).toBe(tokenTtl.client_credentials);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Error in ClientCredentialsTTL: resource lookup failed',
      });
    }
  );

  it('preserves the remaining lifetime of a rotated public SPA refresh token', () => {
    const { ttl } = createTtl();

    const result = ttl.RefreshToken(
      {
        oidc: { entities: { RotatedRefreshToken: { remainingTTL: 7_200 } } },
      } as never,
      { isSenderConstrained: vi.fn().mockReturnValue(false) } as never,
      { applicationType: 'web', clientAuthMethod: 'none' } as never
    );

    expect(result).toBe(7_200);
  });

  it.each([-1, 0, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid rotated refresh-token remaining lifetime %s',
    remainingTTL => {
      const { ttl } = createTtl();

      const result = ttl.RefreshToken(
        {
          oidc: { entities: { RotatedRefreshToken: { remainingTTL } } },
        } as never,
        { isSenderConstrained: vi.fn().mockReturnValue(false) } as never,
        {
          applicationType: 'web',
          clientAuthMethod: 'none',
          ttl: { RefreshToken: 43_200 },
        } as never
      );

      expect(result).toBe(43_200);
    }
  );

  it.each([
    [
      'there is no rotated token',
      {},
      { isSenderConstrained: vi.fn().mockReturnValue(false) },
      { applicationType: 'web', clientAuthMethod: 'none' },
    ],
    [
      'the client is native',
      { oidc: { entities: { RotatedRefreshToken: { remainingTTL: 7_200 } } } },
      { isSenderConstrained: vi.fn().mockReturnValue(false) },
      { applicationType: 'native', clientAuthMethod: 'none' },
    ],
    [
      'the client authenticates',
      { oidc: { entities: { RotatedRefreshToken: { remainingTTL: 7_200 } } } },
      { isSenderConstrained: vi.fn().mockReturnValue(false) },
      { applicationType: 'web', clientAuthMethod: 'client_secret_basic' },
    ],
    [
      'the token is unavailable',
      { oidc: { entities: { RotatedRefreshToken: { remainingTTL: 7_200 } } } },
      undefined,
      { applicationType: 'web', clientAuthMethod: 'none' },
    ],
    [
      'the token cannot report sender constraint',
      { oidc: { entities: { RotatedRefreshToken: { remainingTTL: 7_200 } } } },
      {},
      { applicationType: 'web', clientAuthMethod: 'none' },
    ],
    [
      'the token is sender constrained',
      { oidc: { entities: { RotatedRefreshToken: { remainingTTL: 7_200 } } } },
      { isSenderConstrained: vi.fn().mockReturnValue(true) },
      { applicationType: 'web', clientAuthMethod: 'none' },
    ],
  ])(
    'uses the client refresh-token lifetime when %s',
    (_case, context, token, client) => {
      const { ttl } = createTtl();

      const result = ttl.RefreshToken(
        context as never,
        token as never,
        {
          ...client,
          ttl: { RefreshToken: 43_200 },
        } as never
      );

      expect(result).toBe(43_200);
    }
  );

  it.each([new Error('entity lookup failed'), 'entity lookup failed'])(
    'falls back and logs when refresh-token TTL resolution throws %s',
    thrownValue => {
      const { logger, ttl } = createTtl();
      const context = Object.defineProperty({}, 'oidc', {
        get() {
          throw thrownValue;
        },
      });

      const result = ttl.RefreshToken(
        context as never,
        {} as never,
        {} as never
      );

      expect(result).toBe(tokenTtl.refresh_token);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
        context: 'Error in RefreshTokenTTL: entity lookup failed',
      });
    }
  );
});
