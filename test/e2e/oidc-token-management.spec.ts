import { expect, test } from '@playwright/test';
import {
  allowInsecureRequests,
  ClientSecretBasic,
  clientCredentialsGrant,
  discovery,
} from 'openid-client';

const ISSUER = new URL('http://127.0.0.1:19007/oidc/v1');
const CLIENT_ID = 'parako-browser-e2e-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const CLIENT_SECRET = 'parako-browser-e2e-m2m-secret';
const RESOURCE = 'urn:parako:api:v1';
const SCOPE = 'parako:stats:read';

test('uses a resource-scoped client credentials JWT at the Management API', async () => {
  const configuration = await discovery(
    ISSUER,
    CLIENT_ID,
    { client_secret: CLIENT_SECRET },
    ClientSecretBasic(CLIENT_SECRET),
    { execute: [allowInsecureRequests] }
  );
  allowInsecureRequests(configuration);

  const tokens = await clientCredentialsGrant(configuration, {
    resource: RESOURCE,
    scope: SCOPE,
  });
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.token_type.toLowerCase()).toBe('bearer');

  const protectedResponse = await fetch(
    'http://127.0.0.1:19007/api/v1/stats/health',
    { headers: { authorization: `Bearer ${tokens.access_token}` } }
  );
  expect(protectedResponse.status).toBe(200);
  expect(await protectedResponse.json()).toMatchObject({
    data: { status: 'healthy' },
  });

  const introspectionResponse = await fetch(
    'http://127.0.0.1:19007/oidc/v1/token/introspection',
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
