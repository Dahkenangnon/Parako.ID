import { expect, test } from '@playwright/test';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

import { startMongoMultiTenantParakoInstance } from './support/parako-instance.mjs';

const CLIENT_ID = 'parako-multi-tenant-e2e-m2m';
const RESOURCE = 'urn:parako:api:v1';
const SCOPE = 'parako:stats:read';

function client(secret: string) {
  return {
    client_id: CLIENT_ID,
    client_secret: secret,
    client_name: 'Parako multi-tenant E2E M2M client',
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['client_credentials'],
    response_types: [],
    scope: '',
    allowedResources: [RESOURCE],
    resourcesScopes: SCOPE,
  };
}

async function getClientCredentialsToken(issuer: string, secret: string) {
  const response = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: RESOURCE,
      scope: SCOPE,
    }),
  });
  return { response, body: await response.json() };
}

test('isolates issuers, clients, signing keys, tokens, and API access between tenants', async () => {
  const port = 19112;
  // gitleaks:allow -- deterministic credentials for isolated local E2E tenants.
  const acmeSecret = 'acme-multi-tenant-client-secret-long-enough';
  // gitleaks:allow -- deterministic credentials for isolated local E2E tenants.
  const globexSecret = 'globex-multi-tenant-client-secret-long-enough';
  const acmeTokenTtl = 41;
  const globexTokenTtl = 59;
  const instance = await startMongoMultiTenantParakoInstance({
    port,
    tenants: [
      { slug: 'acme', display_name: 'Acme' },
      { slug: 'globex', display_name: 'Globex' },
    ],
    clients: [
      { tenantId: 'acme', client: client(acmeSecret) },
      { tenantId: 'globex', client: client(globexSecret) },
    ],
    overrides: [
      {
        tenantId: 'acme',
        value: {
          oidc: {
            discovery: {
              service_documentation: 'https://docs.example.test/acme',
            },
            token_ttl: { client_credentials: acmeTokenTtl },
          },
        },
      },
      {
        tenantId: 'globex',
        value: {
          oidc: {
            discovery: {
              service_documentation: 'https://docs.example.test/globex',
            },
            token_ttl: { client_credentials: globexTokenTtl },
          },
        },
      },
    ],
    config: { oidc: { token_ttl: { client_credentials: 120 } } },
  });

  try {
    const acmeIssuer = instance.issuer('acme');
    const globexIssuer = instance.issuer('globex');
    const [acmeDiscovery, globexDiscovery] = await Promise.all(
      [acmeIssuer, globexIssuer].map(issuer =>
        fetch(`${issuer}/.well-known/openid-configuration`).then(response =>
          response.json()
        )
      )
    );
    expect(acmeDiscovery.issuer).toBe(acmeIssuer);
    expect(globexDiscovery.issuer).toBe(globexIssuer);
    expect(acmeDiscovery.service_documentation).toBe(
      'https://docs.example.test/acme'
    );
    expect(globexDiscovery.service_documentation).toBe(
      'https://docs.example.test/globex'
    );

    const [acmeGrant, globexGrant] = await Promise.all([
      getClientCredentialsToken(acmeIssuer, acmeSecret),
      getClientCredentialsToken(globexIssuer, globexSecret),
    ]);
    expect(acmeGrant.response.status).toBe(200);
    expect(globexGrant.response.status).toBe(200);
    expect(acmeGrant.body.access_token).toEqual(expect.any(String));
    expect(globexGrant.body.access_token).toEqual(expect.any(String));

    const crossTenantAuthentication = await getClientCredentialsToken(
      acmeIssuer,
      globexSecret
    );
    expect(crossTenantAuthentication.response.status).toBe(401);
    expect(crossTenantAuthentication.body.error).toBe('invalid_client');

    const [acmeJwks, globexJwks] = await Promise.all([
      fetch(acmeDiscovery.jwks_uri).then(response => response.json()),
      fetch(globexDiscovery.jwks_uri).then(response => response.json()),
    ]);
    const acmeToken = await jwtVerify(
      acmeGrant.body.access_token,
      createLocalJWKSet(acmeJwks),
      {
        issuer: acmeIssuer,
        audience: RESOURCE,
      }
    );
    const globexToken = await jwtVerify(
      globexGrant.body.access_token,
      createLocalJWKSet(globexJwks),
      {
        issuer: globexIssuer,
        audience: RESOURCE,
      }
    );
    expect(acmeToken.payload.exp! - acmeToken.payload.iat!).toBe(acmeTokenTtl);
    expect(globexToken.payload.exp! - globexToken.payload.iat!).toBe(
      globexTokenTtl
    );
    expect(decodeProtectedHeader(acmeGrant.body.access_token).kid).not.toBe(
      decodeProtectedHeader(globexGrant.body.access_token).kid
    );
    await expect(
      jwtVerify(acmeGrant.body.access_token, createLocalJWKSet(globexJwks))
    ).rejects.toThrow();

    const acmeApiResponse = await fetch(
      `http://acme.parako.localhost:${port}/api/v1/stats/health`,
      { headers: { authorization: `Bearer ${acmeGrant.body.access_token}` } }
    );
    expect(acmeApiResponse.status).toBe(200);

    const crossTenantApiResponse = await fetch(
      `http://globex.parako.localhost:${port}/api/v1/stats/health`,
      { headers: { authorization: `Bearer ${acmeGrant.body.access_token}` } }
    );
    expect(crossTenantApiResponse.status).toBe(401);
  } finally {
    await instance.stop();
  }
});
