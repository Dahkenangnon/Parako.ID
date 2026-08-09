import { expect, test } from '@playwright/test';

const IDP_ORIGIN = 'http://127.0.0.1:19007';
const RP_CALLBACK = 'http://127.0.0.1:19010/callback';
const CLIENT_ID = 'parako-browser-e2e-rp';

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

test('renders a styled local error for an unknown client', async ({
  request,
}) => {
  const response = await request.get(
    authorizationUrl({ client_id: 'unknown-e2e-client' }),
    { maxRedirects: 0 }
  );

  expect(response.status()).toBe(400);
  expect(response.headers().location).toBeUndefined();
  expect(response.headers()['content-type']).toContain('text/html');
  const body = await response.text();
  expect(body).toContain('rel="stylesheet"');
  expect(body).not.toContain('An Unknown error occurred!');
  expect(body).toContain('Authentication Error');
  expect(body).toContain('client is invalid');
});

test('never redirects an invalid redirect URI', async ({ request }) => {
  const response = await request.get(
    authorizationUrl({ redirect_uri: 'https://attacker.example/callback' }),
    { maxRedirects: 0 }
  );

  expect(response.status()).toBe(400);
  expect(response.headers().location).toBeUndefined();
  expect(await response.text()).not.toContain('attacker.example');
});

test('returns a safe client error when required PKCE is missing', async ({
  request,
}) => {
  const response = await request.get(authorizationUrl({}), {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(303);
  const location = new URL(response.headers().location);
  expect(location.origin + location.pathname).toBe(RP_CALLBACK);
  expect(location.searchParams.get('error')).toBe('invalid_request');
  expect(location.searchParams.get('state')).toBe('negative-e2e-state');
  expect(location.searchParams.has('code')).toBe(false);
});

test('rejects an unsupported response type without issuing credentials', async ({
  request,
}) => {
  const response = await request.get(
    authorizationUrl({
      response_type: 'token',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
    }),
    { maxRedirects: 0 }
  );

  expect(response.status()).toBe(303);
  const location = new URL(response.headers().location);
  const fragment = new URLSearchParams(location.hash.slice(1));
  expect(location.origin + location.pathname).toBe(RP_CALLBACK);
  expect(fragment.get('error')).toBe('unsupported_response_type');
  expect(fragment.get('state')).toBe('negative-e2e-state');
  expect(fragment.has('access_token')).toBe(false);
  expect(fragment.has('code')).toBe(false);
});
