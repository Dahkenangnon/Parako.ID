import { describe, expect, it } from 'vitest';

import PKCE from '../../../src/oidc/specs/pkce.js';

function createPkce(enabled: boolean, required = false) {
  return PKCE({
    getConfig: () => ({
      features: { oidc: { pkce: { enabled, required } } },
    }),
  } as never);
}

function createContext(route = 'authorization', fapiProfile?: string) {
  return {
    oidc: {
      route,
      params: fapiProfile ? { fapi_profile: fapiProfile } : {},
    },
  };
}

function createClient(clientAuthMethod: string, fapiProfile?: string) {
  return { clientAuthMethod, fapiProfile };
}

describe('OIDC PKCE policy', () => {
  it('does not require PKCE when the feature is disabled', () => {
    const policy = createPkce(false, true);

    expect(
      policy.required(
        createContext('pushed_authorization_request', '2.0') as never,
        createClient('none', '2.0') as never
      )
    ).toBe(false);
  });

  it('requires PKCE for every client when configured globally', () => {
    const policy = createPkce(true, true);

    expect(
      policy.required(
        createContext() as never,
        createClient('client_secret_basic') as never
      )
    ).toBe(true);
  });

  it('requires PKCE for public clients', () => {
    const policy = createPkce(true);

    expect(
      policy.required(createContext() as never, createClient('none') as never)
    ).toBe(true);
  });

  it.each([
    ['client metadata', createClient('private_key_jwt', '2.0'), undefined],
    ['authorization request parameter', createClient('private_key_jwt'), '2.0'],
  ])('requires PKCE for FAPI 2.0 from %s', (_source, client, profile) => {
    const policy = createPkce(true);

    expect(
      policy.required(
        createContext('authorization', profile) as never,
        client as never
      )
    ).toBe(true);
  });

  it('requires PKCE for FAPI 1.0 Advanced pushed authorization requests', () => {
    const policy = createPkce(true);

    expect(
      policy.required(
        createContext('pushed_authorization_request') as never,
        createClient('private_key_jwt', '1.0 Final') as never
      )
    ).toBe(true);
  });

  it.each([
    ['a confidential non-FAPI client', createContext(), undefined],
    ['a non-PAR FAPI 1.0 client', createContext('authorization'), '1.0 Final'],
    [
      'an unsupported FAPI profile',
      createContext('pushed_authorization_request'),
      '1.0',
    ],
  ])('does not force PKCE for %s', (_case, context, profile) => {
    const policy = createPkce(true);

    expect(
      policy.required(
        context as never,
        createClient('client_secret_basic', profile) as never
      )
    ).toBe(false);
  });
});
