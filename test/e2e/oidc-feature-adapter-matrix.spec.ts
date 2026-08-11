import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { expect, test, type Browser, type Page } from '@playwright/test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  customFetch,
  discovery,
  initiateDeviceAuthorization,
  pollDeviceAuthorizationGrant,
  useCodeIdTokenResponseType,
} from 'openid-client';

import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import { createLoopbackTenantFetch } from './support/loopback-tenant-fetch.js';

const CUSTOM_OIDC_PATH = '/connect';
const RP_ORIGIN = 'http://127.0.0.1:19189';
const DEVICE_CLIENT_ID = 'parako-feature-matrix-device';
const M2M_CLIENT_ID = 'parako-feature-matrix-m2m';
// gitleaks:allow -- deterministic credential for an isolated E2E client.
const M2M_CLIENT_SECRET = 'parako-feature-matrix-m2m-secret';
const IMPLICIT_CLIENT_ID = 'parako-feature-matrix-implicit';
const HYBRID_CLIENT_ID = 'parako-feature-matrix-hybrid';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const POSTGRESQL_URL = requireE2ePostgresqlUrl();

interface MatrixRuntime {
  origin: string;
  stop(): Promise<void>;
}

interface StartedCell {
  issuer: string;
  runtime: MatrixRuntime;
}

interface CellOptions {
  browser: Browser;
  start(config: Record<string, unknown>): Promise<StartedCell>;
}

let callbackServer: Server | undefined;

function clients() {
  return [
    {
      client_id: DEVICE_CLIENT_ID,
      client_name: 'Parako feature-matrix device',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: [DEVICE_GRANT],
      response_types: [],
      scope: 'openid profile email',
    },
    {
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      client_name: 'Parako feature-matrix machine client',
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['client_credentials'],
      response_types: [],
      scope: '',
    },
    {
      client_id: IMPLICIT_CLIENT_ID,
      client_name: 'Parako feature-matrix ID token RP',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['implicit'],
      response_types: ['id_token'],
      redirect_uris: [`${RP_ORIGIN}/implicit/callback`],
      scope: 'openid profile email',
    },
    {
      client_id: HYBRID_CLIENT_ID,
      client_name: 'Parako feature-matrix hybrid RP',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'implicit'],
      response_types: ['code id_token'],
      redirect_uris: [`${RP_ORIGIN}/hybrid/callback`],
      scope: 'openid profile email',
      require_pkce: true,
    },
  ];
}

function enabledConfig() {
  return {
    oidc: { path: CUSTOM_OIDC_PATH },
    features: {
      oidc: {
        device_flow: {
          enabled: true,
          charset: 'base-20',
          mask: '****-****',
        },
      },
    },
  };
}

function disabledConfig() {
  return {
    oidc: { path: CUSTOM_OIDC_PATH },
    features: {
      oidc: {
        device_flow: {
          enabled: false,
          charset: 'digits',
          mask: '***-*-***',
        },
        client_credentials: { enabled: false },
        token_revocation: { enabled: false },
        token_introspection: { enabled: false },
        jwt_introspection: { enabled: false },
        userinfo_endpoint: { enabled: false },
        resource_indicators: { enabled: false },
        rp_initiated_logout: { enabled: false },
        backchannel_logout: { enabled: false },
        dynamic_client_registration: { enabled: false },
        client_registration_management: { enabled: false },
        encryption: { enabled: false },
        jwt_response_modes: { enabled: false },
        jwt_userinfo: { enabled: false },
        request_objects: { enabled: false },
      },
    },
  };
}

function authorizationUrl(
  issuer: string,
  parameters: Record<string, string>
): string {
  const url = new URL(`${issuer}/authorize`);
  url.search = new URLSearchParams(parameters).toString();
  return url.href;
}

async function registerUser(page: Page, origin: string) {
  const suffix = randomUUID();
  const email = `feature-matrix-${suffix}@example.test`;
  const password = 'Feature-Matrix!7';

  await page.goto(`${origin}/auth/register`);
  await page.locator('#fullname').fill('Feature Matrix User');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  return { email, password };
}

async function completeInteraction(
  page: Page,
  credentials: { email: string; password: string },
  callbackPath: string
) {
  const login = page.locator('#login');
  if (await login.isVisible()) {
    await login.fill(credentials.email);
    await page.locator('#password').fill(credentials.password);
    await page
      .locator('#login-form')
      .getByRole('button', { name: /sign in/i })
      .click();
  }

  const callbackPrefix = `${RP_ORIGIN}${callbackPath}`;
  const consent = page.locator('#consent-submit-btn');
  await expect
    .poll(
      async () =>
        page.url().startsWith(callbackPrefix) || (await consent.isVisible())
    )
    .toBe(true);
  if (!page.url().startsWith(callbackPrefix)) await consent.click();
  await expect(page).toHaveURL(new RegExp(`^${callbackPrefix}`));
}

async function runEnabledProfile({ browser, start }: CellOptions) {
  const { issuer, runtime } = await start(enabledConfig());
  const fetchImplementation = createLoopbackTenantFetch(new URL(issuer).origin);
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    const origin = new URL(issuer).origin;
    const metadataResponse = await fetchImplementation(
      `${issuer}/.well-known/openid-configuration`
    );
    expect(metadataResponse.status).toBe(200);
    const metadata = (await metadataResponse.json()) as Record<string, any>;
    expect(metadata).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      device_authorization_endpoint: `${issuer}/device/auth`,
    });
    expect(metadata.grant_types_supported).toContain(DEVICE_GRANT);
    expect(metadata.response_types_supported).toEqual(
      expect.arrayContaining(['id_token', 'code id_token'])
    );
    expect(
      (
        await fetchImplementation(
          `${origin}/oidc/v1/.well-known/openid-configuration`
        )
      ).status
    ).toBe(404);

    const credentials = await registerUser(page, origin);
    const deviceConfiguration = await discovery(
      new URL(issuer),
      DEVICE_CLIENT_ID,
      { token_endpoint_auth_method: 'none' },
      undefined,
      { execute: [allowInsecureRequests], [customFetch]: fetchImplementation }
    );
    const deviceAuthorization = await initiateDeviceAuthorization(
      deviceConfiguration,
      { scope: 'openid profile email' }
    );
    // oidc-provider's base-20 alphabet deliberately excludes ambiguous glyphs.
    expect(deviceAuthorization.user_code).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/
    );
    const tokenResult = pollDeviceAuthorizationGrant(
      deviceConfiguration,
      deviceAuthorization
    );

    await page.goto(
      deviceAuthorization.verification_uri_complete ??
        deviceAuthorization.verification_uri
    );
    await page.getByRole('button', { name: 'Continue' }).click();
    const deviceLogin = page.locator('#login');
    if (await deviceLogin.isVisible()) {
      await deviceLogin.fill(credentials.email);
      await page.locator('#password').fill(credentials.password);
      await page
        .locator('#login-form')
        .getByRole('button', { name: /sign in/i })
        .click();
    }
    await expect(page.locator('#consent-submit-btn')).toBeVisible();
    await page.locator('#consent-submit-btn').click();
    await expect(page.getByText('Authorization Successful!')).toBeVisible();
    const deviceTokens = await tokenResult;
    expect(deviceTokens.access_token).toEqual(expect.any(String));
    expect(deviceTokens.id_token).toEqual(expect.any(String));

    const jwks = await fetchImplementation(metadata.jwks_uri).then(response =>
      response.json()
    );
    const keySet = createLocalJWKSet(jwks);
    const implicitState = randomBytes(24).toString('base64url');
    const implicitNonce = randomBytes(24).toString('base64url');
    await page.goto(
      authorizationUrl(issuer, {
        client_id: IMPLICIT_CLIENT_ID,
        redirect_uri: `${RP_ORIGIN}/implicit/callback`,
        response_type: 'id_token',
        scope: 'openid profile email',
        state: implicitState,
        nonce: implicitNonce,
      })
    );
    await completeInteraction(page, credentials, '/implicit/callback');
    const implicitParameters = new URLSearchParams(
      new URL(page.url()).hash.slice(1)
    );
    expect(implicitParameters.get('state')).toBe(implicitState);
    expect(implicitParameters.has('access_token')).toBe(false);
    const implicitToken = implicitParameters.get('id_token');
    expect(implicitToken).toEqual(expect.any(String));
    const implicitClaims = await jwtVerify(implicitToken!, keySet, {
      issuer,
      audience: IMPLICIT_CLIENT_ID,
    });
    expect(implicitClaims.payload.nonce).toBe(implicitNonce);
    expect(implicitClaims.payload.sub).toEqual(expect.any(String));

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const hybridState = randomBytes(24).toString('base64url');
    const hybridNonce = randomBytes(24).toString('base64url');
    await page.goto(
      authorizationUrl(issuer, {
        client_id: HYBRID_CLIENT_ID,
        redirect_uri: `${RP_ORIGIN}/hybrid/callback`,
        response_type: 'code id_token',
        scope: 'openid profile email',
        state: hybridState,
        nonce: hybridNonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
    );
    await completeInteraction(page, credentials, '/hybrid/callback');
    const hybridCallback = new URL(page.url());
    const hybridParameters = new URLSearchParams(hybridCallback.hash.slice(1));
    expect(hybridParameters.get('state')).toBe(hybridState);
    expect(hybridParameters.get('code')).toEqual(expect.any(String));
    expect(hybridParameters.get('id_token')).toEqual(expect.any(String));

    const hybridConfiguration = await discovery(
      new URL(issuer),
      HYBRID_CLIENT_ID,
      {
        redirect_uris: [`${RP_ORIGIN}/hybrid/callback`],
        response_types: ['code id_token'],
        token_endpoint_auth_method: 'none',
      },
      undefined,
      {
        execute: [allowInsecureRequests, useCodeIdTokenResponseType],
        [customFetch]: fetchImplementation,
      }
    );
    const hybridTokens = await authorizationCodeGrant(
      hybridConfiguration,
      hybridCallback,
      {
        pkceCodeVerifier: verifier,
        expectedState: hybridState,
        expectedNonce: hybridNonce,
      }
    );
    expect(hybridTokens.access_token).toEqual(expect.any(String));
    expect(hybridTokens.id_token).toEqual(expect.any(String));
    expect(hybridTokens.claims()?.sub).toBe(implicitClaims.payload.sub);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await runtime.stop();
  }
}

async function runDisabledProfile(start: CellOptions['start']): Promise<void> {
  const { issuer, runtime } = await start(disabledConfig());
  const fetchImplementation = createLoopbackTenantFetch(new URL(issuer).origin);
  try {
    const metadataResponse = await fetchImplementation(
      `${issuer}/.well-known/openid-configuration`
    );
    expect(metadataResponse.status).toBe(200);
    const metadata = (await metadataResponse.json()) as Record<string, any>;
    expect(metadata).not.toHaveProperty('device_authorization_endpoint');
    expect(metadata).not.toHaveProperty('end_session_endpoint');
    expect(metadata).not.toHaveProperty('registration_endpoint');
    expect(metadata).not.toHaveProperty('userinfo_endpoint');
    expect(metadata).not.toHaveProperty('introspection_endpoint');
    expect(metadata).not.toHaveProperty('revocation_endpoint');
    expect(metadata).not.toHaveProperty('backchannel_logout_supported');
    expect(metadata).not.toHaveProperty('backchannel_logout_session_supported');
    expect(metadata).not.toHaveProperty('request_parameter_supported');
    expect(metadata).not.toHaveProperty(
      'id_token_encryption_alg_values_supported'
    );
    expect(metadata).not.toHaveProperty(
      'userinfo_signing_alg_values_supported'
    );
    expect(metadata.grant_types_supported).not.toContain(DEVICE_GRANT);
    expect(metadata.grant_types_supported).not.toContain('client_credentials');
    expect(metadata.response_modes_supported).not.toEqual(
      expect.arrayContaining([
        'jwt',
        'query.jwt',
        'fragment.jwt',
        'form_post.jwt',
      ])
    );

    const disabledRoutes = [
      { path: '/device/auth', method: 'POST' },
      { path: '/userinfo', method: 'GET' },
      { path: '/register-rp', method: 'POST' },
      { path: '/token/introspection', method: 'POST' },
      { path: '/token/revocation', method: 'POST' },
      { path: '/session/end', method: 'GET' },
    ] as const;
    for (const route of disabledRoutes) {
      const response = await fetchImplementation(`${issuer}${route.path}`, {
        method: route.method,
        redirect: 'manual',
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(404);
    }

    const deviceResponse = await fetchImplementation(`${issuer}/device/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DEVICE_CLIENT_ID,
        scope: 'openid',
      }),
      redirect: 'manual',
    });
    expect(deviceResponse.status).toBe(404);

    const clientCredentialsResponse = await fetchImplementation(
      `${issuer}/token`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${M2M_CLIENT_ID}:${M2M_CLIENT_SECRET}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      }
    );
    expect(clientCredentialsResponse.status).toBe(400);
    await expect(clientCredentialsResponse.json()).resolves.toMatchObject({
      // oidc-provider removes the disabled grant from its allowed client
      // metadata, so a persisted legacy client fails before grant dispatch.
      error: 'invalid_client_metadata',
    });
  } finally {
    await runtime.stop();
  }
}

async function runCell(options: CellOptions): Promise<void> {
  await runEnabledProfile(options);
  await runDisabledProfile(options.start);
}

test.beforeAll(async () => {
  callbackServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Temporary RP callback</title>');
  });
  callbackServer.listen(19189, '127.0.0.1');
  await once(callbackServer, 'listening');
});

test.afterAll(async () => {
  if (!callbackServer?.listening) return;
  callbackServer.close();
  await once(callbackServer, 'close');
});

test.describe('OIDC feature and configuration adapter matrix', () => {
  test('SQLite single tenant', async ({ browser }) => {
    let invocation = 0;
    await runCell({
      browser,
      async start(config) {
        const port = invocation++ === 0 ? 19180 : 19200;
        const runtime = await startParakoInstance({
          port,
          config,
          clients: clients(),
        });
        return { issuer: runtime.issuer, runtime };
      },
    });
  });

  test('MongoDB single tenant', async ({ browser }) => {
    let invocation = 0;
    await runCell({
      browser,
      async start(config) {
        const runtime = await startMongoSingleTenantParakoInstance({
          port: invocation++ === 0 ? 19181 : 19201,
          config,
          clients: clients().map(client => ({
            tenantId: 'default',
            client,
          })),
        });
        return { issuer: runtime.issuer, runtime };
      },
    });
  });

  test('MongoDB multi tenant', async ({ browser }) => {
    const tenant = 'feature-matrix';
    let invocation = 0;
    await runCell({
      browser,
      async start(config) {
        const port = invocation++ === 0 ? 19182 : 19202;
        const runtime = await startMongoMultiTenantParakoInstance({
          port,
          config,
          tenants: [{ slug: tenant, display_name: 'Feature Matrix' }],
          clients: clients().map(client => ({ tenantId: tenant, client })),
        });
        return { issuer: runtime.issuer(tenant), runtime };
      },
    });
  });

  test('PostgreSQL single tenant', async ({ browser }) => {
    let invocation = 0;
    await runCell({
      browser,
      async start(config) {
        const runtime = await startPostgresqlParakoInstance({
          port: invocation++ === 0 ? 19183 : 19203,
          postgresqlUrl: POSTGRESQL_URL!,
          multiTenancy: false,
          config,
          clients: clients().map(client => ({
            tenantId: 'default',
            client,
          })),
        });
        return { issuer: runtime.issuer('default'), runtime };
      },
    });
  });

  test('PostgreSQL multi tenant', async ({ browser }) => {
    const tenant = 'feature-matrix';
    let invocation = 0;
    await runCell({
      browser,
      async start(config) {
        const runtime = await startPostgresqlParakoInstance({
          port: invocation++ === 0 ? 19184 : 19204,
          postgresqlUrl: POSTGRESQL_URL!,
          multiTenancy: true,
          config,
          tenants: [{ slug: tenant, display_name: 'Feature Matrix' }],
          clients: clients().map(client => ({ tenantId: tenant, client })),
        });
        return { issuer: runtime.issuer(tenant), runtime };
      },
    });
  });
});
