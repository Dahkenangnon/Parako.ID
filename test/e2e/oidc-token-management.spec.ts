import { expect, test } from '@playwright/test';
import {
  allowInsecureRequests,
  ClientSecretBasic,
  clientCredentialsGrant,
  customFetch,
  discovery,
  type CustomFetch,
} from 'openid-client';

import { createLoopbackTenantFetch } from './support/loopback-tenant-fetch.js';
import { IDP_ORIGIN } from './support/management-api.js';

const ISSUER = new URL(`${IDP_ORIGIN}/oidc/v1`);
const CLIENT_ID = 'parako-browser-e2e-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const CLIENT_SECRET = 'parako-browser-e2e-m2m-secret';
const RESOURCE = 'urn:parako:api:v1';
const SCOPE = 'parako:stats:read';
const nodeFetch = createLoopbackTenantFetch(IDP_ORIGIN);

test('uses a resource-scoped client credentials JWT at the Management API', async () => {
  const configuration = await discovery(
    ISSUER,
    CLIENT_ID,
    { client_secret: CLIENT_SECRET },
    ClientSecretBasic(CLIENT_SECRET),
    {
      execute: [allowInsecureRequests],
      [customFetch]: nodeFetch as CustomFetch,
    }
  );
  allowInsecureRequests(configuration);

  const tokens = await clientCredentialsGrant(configuration, {
    resource: RESOURCE,
    scope: SCOPE,
  });
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.token_type.toLowerCase()).toBe('bearer');

  const protectedResponse = await nodeFetch(
    `${IDP_ORIGIN}/api/v1/stats/health`,
    {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }
  );
  expect(protectedResponse.status).toBe(200);
  expect(await protectedResponse.json()).toMatchObject({
    data: { status: 'healthy' },
  });

  const introspectionResponse = await nodeFetch(
    `${IDP_ORIGIN}/oidc/v1/token/introspection`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: tokens.access_token! }),
    }
  );
  expect(introspectionResponse.status).toBe(400);
  expect(await introspectionResponse.json()).toMatchObject({
    error: 'unsupported_token_type',
  });
});
