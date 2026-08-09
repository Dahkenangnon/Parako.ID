import { describe, expect, it } from 'vitest';

import { deriveTenantIssuerUrl } from '../../../src/multi-tenancy/tenant-issuer.js';

describe('tenant issuer derivation', () => {
  it('uses an explicit tenant issuer verbatim', () => {
    expect(
      deriveTenantIssuerUrl(
        'acme',
        {
          issuer_url: 'https://identity.acme.test/custom',
          domain: 'ignored.acme.test',
        },
        'https://parako.test',
        '/oidc/v1'
      )
    ).toBe('https://identity.acme.test/custom');
  });

  it.each([
    ['https://parako.test', 'auth.acme.test', 'https://auth.acme.test/oidc'],
    ['http://localhost:9007', 'auth.local', 'http://auth.local/oidc'],
  ])(
    'uses the deployment protocol for a custom tenant domain %#',
    (deploymentUrl, domain, expected) => {
      expect(
        deriveTenantIssuerUrl(
          'acme',
          { issuer_url: undefined, domain },
          deploymentUrl,
          '/oidc'
        )
      ).toBe(expected);
    }
  );

  it.each([
    ['https://parako.test/', 'https://acme.parako.test/oidc/v1'],
    ['http://localhost:9007/', 'http://acme.localhost:9007/oidc/v1'],
  ])(
    'normalizes a trailing deployment slash for subdomain issuers %#',
    (deploymentUrl, expected) => {
      expect(
        deriveTenantIssuerUrl(
          'acme',
          { issuer_url: undefined, domain: undefined },
          deploymentUrl,
          '/oidc/v1'
        )
      ).toBe(expected);
    }
  );
});
