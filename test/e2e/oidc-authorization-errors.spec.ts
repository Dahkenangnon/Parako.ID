import { expect, test } from '@playwright/test';

import { createLoopbackTenantFetch } from './support/loopback-tenant-fetch.js';
import { IDP_ORIGIN } from './support/management-api.js';

const RP_CALLBACK = 'http://127.0.0.1:19010/callback';
const CLIENT_ID = 'parako-browser-e2e-rp';
const nodeFetch = createLoopbackTenantFetch(IDP_ORIGIN);

function authorizationUrl(overrides: Record<string, string>) {
  const url = new URL('/oidc/v1/authorize', IDP_ORIGIN);
  const parameters = {
    client_id: CLIENT_ID,
    redirect_uri: RP_CALLBACK,
    response_type: 'code',
    scope: 'openid',
    state: 'negative-e2e-state',
    ...overrides,
  };
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  return url.href;
}

test('renders a styled local error for an unknown client', async () => {
  const response = await nodeFetch(
    authorizationUrl({ client_id: 'unknown-e2e-client' }),
    { redirect: 'manual' }
  );

  expect(response.status).toBe(400);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('content-type')).toContain('text/html');
  const body = await response.text();
  expect(body).toContain('rel="stylesheet"');
  expect(body).not.toContain('An Unknown error occurred!');
  expect(body).toContain('Authentication Error');
  expect(body).toContain('client is invalid');
});

test('never redirects an invalid redirect URI', async () => {
  const response = await nodeFetch(
    authorizationUrl({ redirect_uri: 'https://attacker.example/callback' }),
    { redirect: 'manual' }
  );

  expect(response.status).toBe(400);
  expect(response.headers.get('location')).toBeNull();
  expect(await response.text()).not.toContain('attacker.example');
});

test('returns a safe client error when required PKCE is missing', async () => {
  const response = await nodeFetch(authorizationUrl({}), {
    redirect: 'manual',
  });

  expect(response.status).toBe(303);
  const location = new URL(response.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(RP_CALLBACK);
  expect(location.searchParams.get('error')).toBe('invalid_request');
  expect(location.searchParams.get('state')).toBe('negative-e2e-state');
  expect(location.searchParams.has('code')).toBe(false);
});

test('rejects an unsupported response type without issuing credentials', async () => {
  const response = await nodeFetch(
    authorizationUrl({
      response_type: 'token',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
    }),
    { redirect: 'manual' }
  );

  expect(response.status).toBe(303);
  const location = new URL(response.headers.get('location')!);
  const fragment = new URLSearchParams(location.hash.slice(1));
  expect(location.origin + location.pathname).toBe(RP_CALLBACK);
  expect(fragment.get('error')).toBe('unsupported_response_type');
  expect(fragment.get('state')).toBe('negative-e2e-state');
  expect(fragment.has('access_token')).toBe(false);
  expect(fragment.has('code')).toBe(false);
});
