import { describe, expect, it } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import ClientBasedCORS from '../../../src/oidc/specs/client-based-cors.js';

describe('OIDC client-based CORS policy', () => {
  function createPolicy(enabled = true) {
    const config = getDefaultFullConfig();
    config.features.oidc.client_based_cors = enabled;
    return ClientBasedCORS({ getConfig: () => config } as never);
  }

  const isAllowed = createPolicy();

  it('rejects every cross-origin request when client-based CORS is disabled', () => {
    const disabled = createPolicy(false);

    expect(
      disabled({} as never, 'https://rp.example', {
        redirectUris: ['https://rp.example/callback'],
      } as never)
    ).toBe(false);
  });

  it.each([
    ['https://rp.example', ['https://rp.example/callback']],
    [
      'https://rp.example:8443',
      ['https://other.example/callback', 'https://rp.example:8443/return'],
    ],
    ['http://127.0.0.1:3000', ['http://127.0.0.1:3000/callback?flow=oidc']],
  ])('allows registered web origin %s', (origin, redirectUris) => {
    expect(isAllowed({} as never, origin, { redirectUris } as never)).toBe(
      true
    );
  });

  it.each([
    ['a sibling subdomain', 'https://evil.rp.example'],
    ['a different scheme', 'http://rp.example'],
    ['a different port', 'https://rp.example:8443'],
    ['a lookalike host', 'https://rp.example.evil.test'],
  ])('rejects %s', (_case, origin) => {
    expect(
      isAllowed({} as never, origin, {
        redirectUris: ['https://rp.example/callback'],
      } as never)
    ).toBe(false);
  });

  it('rejects clients without registered redirect URIs', () => {
    expect(isAllowed({} as never, 'https://rp.example', {} as never)).toBe(
      false
    );
  });

  it('fails closed when client metadata contains a malformed redirect URI', () => {
    expect(
      isAllowed({} as never, 'https://rp.example', {
        redirectUris: ['not a URI', 'https://rp.example/callback'],
      } as never)
    ).toBe(false);
  });

  it('does not authorize opaque origins from custom-scheme redirect URIs', () => {
    expect(
      isAllowed({} as never, 'null', {
        redirectUris: ['com.example.app:/oauth/callback'],
      } as never)
    ).toBe(false);
  });
});
