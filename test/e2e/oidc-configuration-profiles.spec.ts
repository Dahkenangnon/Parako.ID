import { expect, test } from '@playwright/test';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildAuthorizationUrlWithPAR,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  ClientSecretJwt,
  ClientSecretPost,
  clientCredentialsGrant,
  discovery,
  enableDecryptingResponses,
  getDPoPHandle,
  randomNonce,
  randomDPoPKeyPair,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  PrivateKeyJwt,
  useJwtResponseMode,
} from 'openid-client';

import { startParakoInstance } from './support/parako-instance.mjs';

const RP_CLIENT_ID = 'parako-profile-e2e-rp';
const MANAGEMENT_CLIENT_ID = 'parako-profile-e2e-management';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const MANAGEMENT_CLIENT_SECRET = 'parako-profile-e2e-management-secret';
const CONFIDENTIAL_CLIENT_ID = 'parako-profile-e2e-confidential';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const CONFIDENTIAL_CLIENT_SECRET =
  'parako-profile-e2e-confidential-secret-long-enough';
const REQUEST_OBJECT_CLIENT_ID = 'parako-profile-e2e-jar';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const REQUEST_OBJECT_CLIENT_SECRET =
  'parako-profile-e2e-request-object-secret-long-enough';
const JARM_CLIENT_ID = 'parako-profile-e2e-jarm';
const ENCRYPTED_CLIENT_ID = 'parako-profile-e2e-encrypted';

function rpClient(origin: string) {
  return {
    client_id: RP_CLIENT_ID,
    client_name: 'Parako profile E2E RP',
    application_type: 'web',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [`${origin}/callback`],
    scope: 'openid profile email offline_access',
    require_pkce: true,
  };
}

function managementClient() {
  return {
    client_id: MANAGEMENT_CLIENT_ID,
    client_secret: MANAGEMENT_CLIENT_SECRET,
    client_name: 'Parako profile E2E management client',
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['client_credentials'],
    response_types: [],
    scope: '',
    allowedResources: ['urn:parako:api:v1'],
    resourcesScopes: 'parako:registration-tokens:write',
  };
}

function confidentialClient(origin: string) {
  return {
    client_id: CONFIDENTIAL_CLIENT_ID,
    client_secret: CONFIDENTIAL_CLIENT_SECRET,
    client_name: 'Parako profile E2E confidential RP',
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: [`${origin}/confidential/callback`],
    scope: 'openid',
  };
}

function requestObjectClient(origin: string) {
  return {
    client_id: REQUEST_OBJECT_CLIENT_ID,
    client_secret: REQUEST_OBJECT_CLIENT_SECRET,
    client_name: 'Parako profile E2E JAR RP',
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: [`${origin}/jar/callback`],
    scope: 'openid',
    request_object_signing_alg: 'HS256',
  };
}

function jarmClient(origin: string) {
  return {
    client_id: JARM_CLIENT_ID,
    client_name: 'Parako profile E2E JARM RP',
    application_type: 'web',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: [`${origin}/jarm/callback`],
    scope: 'openid',
    require_pkce: true,
    authorization_signed_response_alg: 'RS256',
  };
}

async function encryptedClient(origin: string) {
  const keyId = 'parako-profile-e2e-encryption-key';
  const { privateKey, publicKey } = await generateKeyPair('RSA-OAEP-256', {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);

  return {
    client: {
      client_id: ENCRYPTED_CLIENT_ID,
      client_name: 'Parako profile E2E encrypted RP',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: [`${origin}/encrypted/callback`],
      scope: 'openid',
      require_pkce: true,
      id_token_encrypted_response_alg: 'RSA-OAEP-256',
      id_token_encrypted_response_enc: 'A256GCM',
      jwks: {
        keys: [
          {
            ...publicJwk,
            alg: 'RSA-OAEP-256',
            kid: keyId,
            use: 'enc',
          },
        ],
      },
    },
    decryptionKey: { key: privateKey, kid: keyId },
  };
}

function authorizationUrl(
  issuer: string,
  client: Record<string, any>,
  params: Record<string, string> = {}
) {
  const url = new URL(`${issuer}/authorize`);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: 'code',
    scope: 'openid',
    state: 'configuration-profile-state',
    ...params,
  }).toString();
  return url;
}

async function json(response: Response) {
  const body = await response.json();
  return { response, body };
}

function redirectLocation(response: Response, origin: string) {
  return new URL(response.headers.get('location')!, origin);
}

test.describe.serial('OIDC runtime configuration profiles', () => {
  test('JARM protects the complete code flow only when the feature is enabled', async ({
    page,
  }) => {
    const enabledPort = 19120;
    const enabledOrigin = `http://127.0.0.1:${enabledPort}`;
    const client = jarmClient(enabledOrigin);
    const enabled = await startParakoInstance({
      port: enabledPort,
      clients: [client],
      config: {
        features: { oidc: { jwt_response_modes: { enabled: true } } },
      },
    });

    try {
      const configuration = await discovery(
        new URL(enabled.issuer),
        client.client_id,
        {
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: 'none',
        },
        undefined,
        { execute: [allowInsecureRequests, useJwtResponseMode] }
      );
      expect(configuration.serverMetadata().response_modes_supported).toEqual(
        expect.arrayContaining([
          'jwt',
          'query.jwt',
          'fragment.jwt',
          'form_post.jwt',
        ])
      );

      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState();
      const nonce = randomNonce();
      const authorization = buildAuthorizationUrl(configuration, {
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        response_mode: 'jwt',
        scope: 'openid',
        code_challenge: await calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });

      await page.goto(`${enabled.origin}/auth/register`);
      await page.locator('#fullname').fill('JARM E2E User');
      await page.locator('#email').fill('jarm-profile-e2e@example.test');
      await page.locator('#password').fill('Violet!River7');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

      await page.goto(authorization.href);
      const consent = page.locator('#consent-submit-btn');
      if (await consent.isVisible()) await consent.click();
      await expect(page).toHaveURL(
        new RegExp(`^${enabledOrigin}/jarm/callback\\?response=`)
      );

      const callbackUrl = new URL(page.url());
      expect(callbackUrl.searchParams.has('code')).toBe(false);
      expect(callbackUrl.searchParams.get('response')?.split('.')).toHaveLength(
        3
      );

      const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      expect(tokens.claims()).toEqual(
        expect.objectContaining({ sub: expect.any(String) })
      );
    } finally {
      await enabled.stop();
    }

    const disabledPort = 19121;
    const disabledOrigin = `http://127.0.0.1:${disabledPort}`;
    const disabledClient = rpClient(disabledOrigin);
    const disabled = await startParakoInstance({
      port: disabledPort,
      clients: [disabledClient],
      config: {
        features: { oidc: { jwt_response_modes: { enabled: false } } },
      },
    });

    try {
      const metadata = await fetch(
        `${disabled.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());
      expect(metadata.response_modes_supported).not.toContain('jwt');

      const response = await fetch(
        authorizationUrl(disabled.issuer, disabledClient, {
          response_mode: 'jwt',
          code_challenge: 'A'.repeat(43),
          code_challenge_method: 'S256',
        }),
        { redirect: 'manual' }
      );
      expect(response.status).toBe(303);
      const errorRedirect = new URL(response.headers.get('location')!);
      expect(errorRedirect.origin + errorRedirect.pathname).toBe(
        disabledClient.redirect_uris[0]
      );
      expect(errorRedirect.searchParams.get('error')).toBe(
        'unsupported_response_mode'
      );
    } finally {
      await disabled.stop();
    }
  });

  test('response encryption delivers an RP-decryptable ID token only when enabled', async ({
    page,
  }) => {
    const enabledPort = 19122;
    const enabledOrigin = `http://127.0.0.1:${enabledPort}`;
    const { client, decryptionKey } = await encryptedClient(enabledOrigin);
    const enabled = await startParakoInstance({
      port: enabledPort,
      clients: [client],
      config: {
        features: { oidc: { encryption: { enabled: true } } },
      },
    });

    try {
      const configuration = await discovery(
        new URL(enabled.issuer),
        client.client_id,
        {
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: 'none',
        },
        undefined,
        { execute: [allowInsecureRequests] }
      );
      expect(
        configuration.serverMetadata().id_token_encryption_alg_values_supported
      ).toContain('RSA-OAEP-256');
      expect(
        configuration.serverMetadata().id_token_encryption_enc_values_supported
      ).toContain('A256GCM');
      enableDecryptingResponses(configuration, ['A256GCM'], decryptionKey);

      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState();
      const nonce = randomNonce();
      const authorization = buildAuthorizationUrl(configuration, {
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        scope: 'openid',
        code_challenge: await calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });

      await page.goto(`${enabled.origin}/auth/register`);
      await page.locator('#fullname').fill('Encrypted Token E2E User');
      await page
        .locator('#email')
        .fill('encrypted-token-profile-e2e@example.test');
      await page.locator('#password').fill('Violet!River7');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

      await page.goto(authorization.href);
      const consent = page.locator('#consent-submit-btn');
      if (await consent.isVisible()) await consent.click();
      await expect(page).toHaveURL(
        new RegExp(`^${enabledOrigin}/encrypted/callback\\?code=`)
      );

      const tokens = await authorizationCodeGrant(
        configuration,
        new URL(page.url()),
        {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
        }
      );
      expect(tokens.id_token?.split('.')).toHaveLength(5);
      expect(tokens.claims()).toEqual(
        expect.objectContaining({ sub: expect.any(String) })
      );
    } finally {
      await enabled.stop();
    }

    const disabledPort = 19123;
    const disabled = await startParakoInstance({
      port: disabledPort,
      config: {
        features: { oidc: { encryption: { enabled: false } } },
      },
    });

    try {
      const metadata = await fetch(
        `${disabled.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());
      expect(metadata).not.toHaveProperty(
        'id_token_encryption_alg_values_supported'
      );
      expect(metadata).not.toHaveProperty(
        'id_token_encryption_enc_values_supported'
      );
    } finally {
      await disabled.stop();
    }
  });

  test('the provider-default PAR endpoint completes an authorization code flow', async ({
    page,
  }) => {
    const port = 19124;
    const origin = `http://127.0.0.1:${port}`;
    const client = rpClient(origin);
    const instance = await startParakoInstance({
      port,
      clients: [client],
    });

    try {
      const configuration = await discovery(
        new URL(instance.issuer),
        client.client_id,
        {
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: 'none',
        },
        undefined,
        { execute: [allowInsecureRequests] }
      );
      expect(
        configuration.serverMetadata().pushed_authorization_request_endpoint
      ).toBe(`${instance.issuer}/request`);

      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState();
      const nonce = randomNonce();
      const authorization = await buildAuthorizationUrlWithPAR(configuration, {
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        scope: 'openid',
        code_challenge: await calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      expect(authorization.searchParams.get('client_id')).toBe(
        client.client_id
      );
      expect(authorization.searchParams.get('request_uri')).toMatch(
        /^urn:ietf:params:oauth:request_uri:/
      );
      expect(authorization.searchParams.has('scope')).toBe(false);

      await page.goto(`${instance.origin}/auth/register`);
      await page.locator('#fullname').fill('PAR E2E User');
      await page.locator('#email').fill('par-profile-e2e@example.test');
      await page.locator('#password').fill('Violet!River7');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

      await page.goto(authorization.href);
      const consent = page.locator('#consent-submit-btn');
      if (await consent.isVisible()) await consent.click();
      await expect(page).toHaveURL(new RegExp(`^${origin}/callback\\?code=`));

      const tokens = await authorizationCodeGrant(
        configuration,
        new URL(page.url()),
        {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
        }
      );
      expect(tokens.claims()).toEqual(
        expect.objectContaining({ sub: expect.any(String) })
      );
    } finally {
      await instance.stop();
    }
  });

  test('the provider-default DPoP profile sender-constrains client-credentials tokens', async () => {
    const port = 19125;
    const resource = 'urn:parako:e2e:dpop';
    const scope = 'dpop:test';
    const client = {
      ...managementClient(),
      audience: resource,
      scope,
      allowedResources: [resource],
      resourcesScopes: scope,
      accessTokenFormat: 'opaque',
    };
    const instance = await startParakoInstance({
      port,
      clients: [client],
      config: {
        features: {
          oidc: {
            scopes: [
              'openid',
              'profile',
              'email',
              'phone',
              'address',
              'offline_access',
              scope,
            ],
          },
        },
      },
    });

    try {
      const configuration = await discovery(
        new URL(instance.issuer),
        client.client_id,
        client.client_secret,
        ClientSecretBasic(client.client_secret),
        { execute: [allowInsecureRequests] }
      );
      expect(
        configuration.serverMetadata().dpop_signing_alg_values_supported
      ).toEqual(expect.arrayContaining(['ES256']));

      const dpop = getDPoPHandle(
        configuration,
        await randomDPoPKeyPair('ES256')
      );
      let tokens: Awaited<ReturnType<typeof clientCredentialsGrant>>;
      try {
        tokens = await clientCredentialsGrant(
          configuration,
          { resource, scope },
          { DPoP: dpop }
        );
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        throw new Error(`DPoP token request failed: ${JSON.stringify(cause)}`, {
          cause: error,
        });
      }
      expect(tokens.token_type.toLowerCase()).toBe('dpop');
      expect(tokens.access_token).toEqual(expect.any(String));

      const introspection = await json(
        await fetch(`${instance.issuer}/token/introspection`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ token: tokens.access_token }),
        })
      );
      expect(introspection.response.status).toBe(200);
      expect(introspection.body).toEqual(
        expect.objectContaining({
          active: true,
          cnf: { jkt: expect.any(String) },
        })
      );
    } finally {
      await instance.stop();
    }
  });

  test('all supported confidential token endpoint authentication methods issue usable tokens', async () => {
    const port = 19130;
    const resource = 'urn:parako:api:v1';
    const scope = 'parako:stats:read';
    const privateKeyId = 'profile-private-key-jwt';
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const sharedClientMetadata = {
      application_type: 'web',
      grant_types: ['client_credentials'],
      response_types: [] as string[],
      scope: '',
      allowedResources: [resource],
      resourcesScopes: scope,
    };
    const secretClients = [
      {
        ...sharedClientMetadata,
        client_id: 'profile-client-secret-basic',
        client_name: 'Client secret basic E2E client',
        client_secret: 'client-secret-basic-value-long-enough',
        token_endpoint_auth_method: 'client_secret_basic',
      },
      {
        ...sharedClientMetadata,
        client_id: 'profile-client-secret-post',
        client_name: 'Client secret post E2E client',
        client_secret: 'client-secret-post-value-long-enough',
        token_endpoint_auth_method: 'client_secret_post',
      },
      {
        ...sharedClientMetadata,
        client_id: 'profile-client-secret-jwt',
        client_name: 'Client secret JWT E2E client',
        client_secret: 'client-secret-jwt-value-at-least-32-bytes-long',
        token_endpoint_auth_method: 'client_secret_jwt',
        token_endpoint_auth_signing_alg: 'HS256',
      },
    ];
    const apiManager = {
      ...managementClient(),
      resourcesScopes: 'parako:clients:write',
    };
    const instance = await startParakoInstance({
      port,
      clients: [...secretClients, apiManager],
    });

    try {
      const managerConfiguration = await discovery(
        new URL(instance.issuer),
        apiManager.client_id,
        apiManager.client_secret,
        ClientSecretBasic(apiManager.client_secret),
        { execute: [allowInsecureRequests] }
      );
      const managerTokens = await clientCredentialsGrant(managerConfiguration, {
        resource,
        scope: 'parako:clients:write',
      });
      const created = await json(
        await fetch(`${instance.origin}/api/v1/clients`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${managerTokens.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...sharedClientMetadata,
            scope: undefined,
            client_name: 'Private key JWT managed E2E client',
            token_endpoint_auth_method: 'private_key_jwt',
            token_endpoint_auth_signing_alg: 'RS256',
            jwks: {
              keys: [
                {
                  ...publicJwk,
                  kid: privateKeyId,
                  use: 'sig',
                  alg: 'RS256',
                },
              ],
            },
          }),
        })
      );
      expect(created.response.status).toBe(201);
      expect(created.body.data).toEqual(
        expect.objectContaining({
          client_id: expect.any(String),
          token_endpoint_auth_method: 'private_key_jwt',
        })
      );
      expect(created.body.data).not.toHaveProperty('client_secret');
      const privateKeyClient = created.body.data as Record<string, any>;

      const rejectedRotation = await json(
        await fetch(
          `${instance.origin}/api/v1/clients/${privateKeyClient.client_id}/secret`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${managerTokens.access_token}`,
            },
          }
        )
      );
      expect(rejectedRotation.response.status).toBe(409);
      expect(rejectedRotation.body).toEqual(
        expect.objectContaining({
          detail: expect.stringContaining(
            'does not use secret-based authentication'
          ),
        })
      );

      const methods = [
        {
          client: secretClients[0],
          auth: ClientSecretBasic(secretClients[0].client_secret),
        },
        {
          client: secretClients[1],
          auth: ClientSecretPost(secretClients[1].client_secret),
        },
        {
          client: secretClients[2],
          auth: ClientSecretJwt(secretClients[2].client_secret),
        },
        {
          client: privateKeyClient,
          auth: PrivateKeyJwt({ key: privateKey, kid: privateKeyId }),
        },
      ];

      for (const { client, auth } of methods) {
        const configuration = await discovery(
          new URL(instance.issuer),
          client.client_id,
          {
            client_secret: client.client_secret,
            token_endpoint_auth_method: client.token_endpoint_auth_method,
          },
          auth,
          { execute: [allowInsecureRequests] }
        );
        const tokens = await clientCredentialsGrant(configuration, {
          resource,
          scope,
        });
        expect(tokens.access_token).toEqual(expect.any(String));

        const protectedResponse = await fetch(
          `${instance.origin}/api/v1/stats/health`,
          {
            headers: {
              authorization: `Bearer ${tokens.access_token}`,
            },
          }
        );
        expect(protectedResponse.status).toBe(200);
      }
    } finally {
      await instance.stop();
    }
  });

  test('response_type=none completes without issuing front-channel credentials', async ({
    page,
  }) => {
    const port = 19126;
    const origin = `http://127.0.0.1:${port}`;
    const client = {
      client_id: 'parako-profile-e2e-none',
      client_name: 'Parako profile E2E none-response RP',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: [],
      response_types: ['none'],
      redirect_uris: [`${origin}/none/callback`],
      scope: 'openid',
    };
    const instance = await startParakoInstance({ port, clients: [client] });

    try {
      await page.goto(`${instance.origin}/auth/register`);
      await page.locator('#fullname').fill('None Response E2E User');
      await page.locator('#email').fill('none-response-e2e@example.test');
      await page.locator('#password').fill('Violet!River7');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

      const authorization = authorizationUrl(instance.issuer, client, {
        response_type: 'none',
        state: 'none-response-state',
      });
      authorization.searchParams.delete('code_challenge');
      authorization.searchParams.delete('code_challenge_method');
      await page.goto(authorization.href);
      const consent = page.locator('#consent-submit-btn');
      if (await consent.isVisible()) await consent.click();

      await expect(page).toHaveURL(
        new RegExp(`^${client.redirect_uris[0]}\\?`)
      );
      const callback = new URL(page.url());
      expect(callback.searchParams.get('state')).toBe('none-response-state');
      expect(callback.searchParams.get('iss')).toBe(instance.issuer);
      expect(callback.searchParams.has('code')).toBe(false);
      expect(callback.searchParams.has('id_token')).toBe(false);
      expect(callback.hash).toBe('');
    } finally {
      await instance.stop();
    }
  });

  test('disabling refresh-token rotation keeps the original token reusable', async ({
    page,
  }) => {
    const port = 19127;
    const origin = `http://127.0.0.1:${port}`;
    const client = rpClient(origin);
    const instance = await startParakoInstance({
      port,
      clients: [client],
      config: {
        features: { oidc: { rotate_refresh_token: false } },
      },
    });

    try {
      const configuration = await discovery(
        new URL(instance.issuer),
        client.client_id,
        {
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: 'none',
        },
        undefined,
        { execute: [allowInsecureRequests] }
      );
      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState();
      const nonce = randomNonce();
      const authorization = buildAuthorizationUrl(configuration, {
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        scope: 'openid offline_access',
        code_challenge: await calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });

      await page.goto(`${instance.origin}/auth/register`);
      await page.locator('#fullname').fill('Non-Rotating Refresh E2E User');
      await page
        .locator('#email')
        .fill('non-rotating-refresh-profile-e2e@example.test');
      await page.locator('#password').fill('Violet!River7');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

      await page.goto(authorization.href);
      const consent = page.locator('#consent-submit-btn');
      if (await consent.isVisible()) await consent.click();
      await expect(page).toHaveURL(new RegExp(`^${origin}/callback\\?code=`));

      const tokens = await authorizationCodeGrant(
        configuration,
        new URL(page.url()),
        {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
        }
      );
      expect(tokens.refresh_token).toEqual(expect.any(String));

      const originalRefreshToken = tokens.refresh_token!;
      const firstRefresh = await refreshTokenGrant(
        configuration,
        originalRefreshToken
      );
      expect(firstRefresh.access_token).toEqual(expect.any(String));
      expect(firstRefresh.refresh_token).toBe(originalRefreshToken);

      const secondRefresh = await refreshTokenGrant(
        configuration,
        originalRefreshToken
      );
      expect(secondRefresh.access_token).toEqual(expect.any(String));
      expect(secondRefresh.refresh_token).toBe(originalRefreshToken);
    } finally {
      await instance.stop();
    }
  });

  test('client-based CORS follows its runtime feature toggle', async ({
    page,
  }) => {
    async function runProfile({
      port,
      enabled,
    }: {
      port: number;
      enabled: boolean;
    }) {
      const origin = `http://127.0.0.1:${port}`;
      const requestOrigin = `http://127.0.0.1:${port + 10_000}`;
      const client = rpClient(origin);
      client.redirect_uris.push(`${requestOrigin}/callback`);
      const instance = await startParakoInstance({
        port,
        clients: [client],
        config: {
          features: { oidc: { client_based_cors: enabled } },
        },
      });

      try {
        const configuration = await discovery(
          new URL(instance.issuer),
          client.client_id,
          {
            redirect_uris: client.redirect_uris,
            token_endpoint_auth_method: 'none',
          },
          undefined,
          { execute: [allowInsecureRequests] }
        );
        const codeVerifier = randomPKCECodeVerifier();
        const state = randomState();
        const nonce = randomNonce();
        const authorization = buildAuthorizationUrl(configuration, {
          client_id: client.client_id,
          redirect_uri: client.redirect_uris[0],
          response_type: 'code',
          scope: 'openid',
          code_challenge: await calculatePKCECodeChallenge(codeVerifier),
          code_challenge_method: 'S256',
          state,
          nonce,
        });

        await page.goto(`${instance.origin}/auth/register`);
        await page.locator('#fullname').fill('CORS Profile E2E User');
        await page
          .locator('#email')
          .fill(`cors-${enabled ? 'enabled' : 'disabled'}-e2e@example.test`);
        await page.locator('#password').fill('Violet!River7');
        await page.locator('#submit-btn').click();
        await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

        await page.goto(authorization.href);
        const consent = page.locator('#consent-submit-btn');
        if (await consent.isVisible()) await consent.click();
        await expect(page).toHaveURL(new RegExp(`^${origin}/callback\\?code=`));
        const tokens = await authorizationCodeGrant(
          configuration,
          new URL(page.url()),
          {
            pkceCodeVerifier: codeVerifier,
            expectedState: state,
            expectedNonce: nonce,
          }
        );

        return await fetch(configuration.serverMetadata().userinfo_endpoint!, {
          headers: {
            authorization: `Bearer ${tokens.access_token}`,
            origin: requestOrigin,
          },
        });
      } finally {
        await instance.stop();
      }
    }

    const allowed = await runProfile({ port: 19128, enabled: true });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:29128'
    );

    const denied = await runProfile({ port: 19129, enabled: false });
    expect(denied.status).toBe(400);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    expect(await denied.json()).toEqual(
      expect.objectContaining({ error: 'invalid_request' })
    );
  });

  test('PKCE policy modes follow the configured policy and RFC 9700 public-client default', async () => {
    const optionalPort = 19109;
    const optionalOrigin = `http://127.0.0.1:${optionalPort}`;
    const publicClient = rpClient(optionalOrigin);
    const confidential = confidentialClient(optionalOrigin);
    const optional = await startParakoInstance({
      port: optionalPort,
      clients: [publicClient, confidential],
      config: {
        features: { oidc: { pkce: { enabled: true, required: false } } },
      },
    });

    try {
      const confidentialResponse = await fetch(
        authorizationUrl(optional.issuer, confidential),
        { redirect: 'manual' }
      );
      expect(confidentialResponse.status).toBe(303);
      expect(
        redirectLocation(confidentialResponse, optional.origin).pathname
      ).toContain('/oidc/v1/interaction/');

      const publicResponse = await fetch(
        authorizationUrl(optional.issuer, publicClient),
        { redirect: 'manual' }
      );
      expect(publicResponse.status).toBe(303);
      const publicError = new URL(publicResponse.headers.get('location')!);
      expect(publicError.origin + publicError.pathname).toBe(
        publicClient.redirect_uris[0]
      );
      expect(publicError.searchParams.get('error')).toBe('invalid_request');
      expect(publicError.searchParams.get('error_description')).toContain(
        'requires PKCE'
      );
    } finally {
      await optional.stop();
    }

    const disabledPort = 19110;
    const disabledOrigin = `http://127.0.0.1:${disabledPort}`;
    const disabledPublicClient = rpClient(disabledOrigin);
    const disabled = await startParakoInstance({
      port: disabledPort,
      clients: [disabledPublicClient],
      config: {
        features: { oidc: { pkce: { enabled: false, required: false } } },
      },
    });

    try {
      const response = await fetch(
        authorizationUrl(disabled.issuer, disabledPublicClient),
        { redirect: 'manual' }
      );
      expect(response.status).toBe(303);
      expect(redirectLocation(response, disabled.origin).pathname).toContain(
        '/oidc/v1/interaction/'
      );
    } finally {
      await disabled.stop();
    }
  });

  test('signed Request Objects are accepted only when client-bound validation succeeds', async () => {
    const port = 19111;
    const origin = `http://127.0.0.1:${port}`;
    const client = requestObjectClient(origin);
    const instance = await startParakoInstance({
      port,
      clients: [client],
      config: {
        features: { oidc: { request_objects: { enabled: true } } },
      },
    });

    try {
      const discovery = await fetch(
        `${instance.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());
      expect(discovery.request_parameter_supported).toBe(true);
      expect(discovery.request_object_signing_alg_values_supported).toContain(
        'HS256'
      );

      const requestPayload = {
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        scope: 'openid',
        state: 'signed-request-object-state',
        nonce: 'signed-request-object-nonce',
        code_challenge: 'A'.repeat(43),
        code_challenge_method: 'S256',
      };
      const sign = (secret: string) =>
        new SignJWT(requestPayload)
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer(client.client_id)
          .setAudience(instance.issuer)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode(secret));

      const accepted = await fetch(
        authorizationUrl(instance.issuer, client, {
          request: await sign(REQUEST_OBJECT_CLIENT_SECRET),
        }),
        { redirect: 'manual' }
      );
      expect(accepted.status).toBe(303);
      expect(redirectLocation(accepted, instance.origin).pathname).toContain(
        '/oidc/v1/interaction/'
      );

      const rejected = await fetch(
        authorizationUrl(instance.issuer, client, {
          request: await sign('wrong-request-object-secret-long-enough'),
        }),
        { redirect: 'manual' }
      );
      expect(rejected.status).toBe(303);
      const errorRedirect = new URL(rejected.headers.get('location')!);
      expect(errorRedirect.origin + errorRedirect.pathname).toBe(
        client.redirect_uris[0]
      );
      expect(errorRedirect.searchParams.get('error')).toBe(
        'invalid_request_object'
      );
    } finally {
      await instance.stop();
    }
  });

  test('JWT introspection signs the response for an opted-in client and media type', async () => {
    const port = 19112;
    const resource = 'urn:parako:e2e:introspection';
    const scope = 'introspection:test';
    const client = {
      ...managementClient(),
      audience: resource,
      scope,
      allowedResources: [resource],
      resourcesScopes: scope,
      accessTokenFormat: 'opaque',
      introspection_endpoint_auth_method: 'client_secret_basic',
      introspection_signed_response_alg: 'RS256',
    };
    const instance = await startParakoInstance({
      port,
      clients: [client],
      config: {
        features: {
          oidc: {
            jwt_introspection: { enabled: true },
            token_introspection: { enabled: true },
            scopes: [
              'openid',
              'profile',
              'email',
              'phone',
              'address',
              'offline_access',
              scope,
            ],
          },
        },
      },
    });

    try {
      const discovery = await fetch(
        `${instance.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());
      expect(discovery.introspection_signing_alg_values_supported).toContain(
        'RS256'
      );

      const authorization = `Basic ${Buffer.from(`${MANAGEMENT_CLIENT_ID}:${MANAGEMENT_CLIENT_SECRET}`).toString('base64')}`;
      const tokenResponse = await json(
        await fetch(discovery.token_endpoint, {
          method: 'POST',
          headers: {
            authorization,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            resource,
            scope,
          }),
        })
      );
      expect(
        tokenResponse.response.status,
        JSON.stringify(tokenResponse.body)
      ).toBe(200);
      expect(tokenResponse.body.access_token.split('.')).toHaveLength(1);

      const introspectionResponse = await fetch(
        discovery.introspection_endpoint,
        {
          method: 'POST',
          headers: {
            accept: 'application/token-introspection+jwt',
            authorization,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            token: tokenResponse.body.access_token,
          }),
        }
      );
      const introspectionBody = await introspectionResponse.text();
      expect(introspectionResponse.status, introspectionBody).toBe(200);
      expect(introspectionResponse.headers.get('content-type')).toContain(
        'application/token-introspection+jwt'
      );

      const jwks = await fetch(discovery.jwks_uri).then(response =>
        response.json()
      );
      const { payload } = await jwtVerify(
        introspectionBody,
        createLocalJWKSet(jwks),
        {
          issuer: instance.issuer,
          audience: MANAGEMENT_CLIENT_ID,
        }
      );
      expect(payload.token_introspection).toEqual(
        expect.objectContaining({
          active: true,
          client_id: MANAGEMENT_CLIENT_ID,
        })
      );
    } finally {
      await instance.stop();
    }
  });

  test('a custom OIDC mount path is reflected consistently in discovery', async () => {
    const port = 19113;
    const origin = `http://127.0.0.1:${port}`;
    const oidcPath = '/connect';
    const instance = await startParakoInstance({
      port,
      clients: [rpClient(origin)],
      config: { oidc: { path: oidcPath } },
    });

    try {
      const discoveryResponse = await fetch(
        `${origin}${oidcPath}/.well-known/openid-configuration`
      );
      const discovery = await discoveryResponse.json();
      expect(discoveryResponse.status).toBe(200);
      expect(discovery.issuer).toBe(`${origin}${oidcPath}`);
      expect(discovery.authorization_endpoint).toBe(
        `${origin}${oidcPath}/authorize`
      );
      expect(discovery.token_endpoint).toBe(`${origin}${oidcPath}/token`);
      expect(discovery.jwks_uri).toBe(`${origin}${oidcPath}/jwks`);

      const defaultPathResponse = await fetch(
        `${origin}/oidc/v1/.well-known/openid-configuration`
      );
      expect(defaultPathResponse.status).toBe(404);
    } finally {
      await instance.stop();
    }
  });

  test('runtime metadata and token lifetime policies are exposed and enforced together', async () => {
    const port = 19114;
    const customScope = 'parako:e2e:custom';
    const customAcr = 'urn:parako:e2e:loa1';
    const clientCredentialsTtl = 73;
    const instance = await startParakoInstance({
      port,
      clients: [managementClient()],
      config: {
        features: {
          oidc: {
            acr_values: { supported: [customAcr] },
            scopes: ['openid', customScope],
            subject_types: ['public'],
          },
        },
        oidc: {
          discovery: {
            service_documentation: 'https://docs.example.test/parako-e2e',
          },
          jwa: {
            id_token_signing_alg_values: ['RS256'],
          },
          token_ttl: { client_credentials: clientCredentialsTtl },
        },
      },
    });

    try {
      const discovery = await fetch(
        `${instance.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());

      expect(new Set(discovery.scopes_supported)).toEqual(
        new Set([
          'openid',
          customScope,
          'profile',
          'email',
          'phone',
          'address',
          'custom_identifiers',
        ])
      );
      expect(discovery.acr_values_supported).toEqual(
        expect.arrayContaining(['urn:pwd', 'urn:mfa:otp', customAcr])
      );
      expect(discovery.subject_types_supported).toEqual(['public']);
      expect(discovery.id_token_signing_alg_values_supported).toEqual([
        'RS256',
      ]);
      expect(discovery.service_documentation).toBe(
        'https://docs.example.test/parako-e2e'
      );

      const tokenResponse = await json(
        await fetch(discovery.token_endpoint, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${MANAGEMENT_CLIENT_ID}:${MANAGEMENT_CLIENT_SECRET}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            resource: 'urn:parako:api:v1',
            scope: 'parako:registration-tokens:write',
          }),
        })
      );
      expect(tokenResponse.response.status).toBe(200);
      expect(tokenResponse.body.expires_in).toBe(clientCredentialsTtl);

      const jwks = await fetch(discovery.jwks_uri).then(response =>
        response.json()
      );
      const { payload } = await jwtVerify(
        tokenResponse.body.access_token,
        createLocalJWKSet(jwks),
        {
          issuer: instance.issuer,
          audience: 'urn:parako:api:v1',
        }
      );
      expect(payload.exp! - payload.iat!).toBe(clientCredentialsTtl);
    } finally {
      await instance.stop();
    }
  });

  test('HTTP POST authorization is available only when explicitly enabled', async () => {
    const authorizationBody = (client: ReturnType<typeof rpClient>) =>
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        scope: 'openid',
        state: 'post-authorization-state',
        code_challenge: 'A'.repeat(43),
        code_challenge_method: 'S256',
      });

    const enabledPort = 19114;
    const enabledOrigin = `http://127.0.0.1:${enabledPort}`;
    const enabledClient = rpClient(enabledOrigin);
    const enabled = await startParakoInstance({
      port: enabledPort,
      clients: [enabledClient],
      config: {
        features: { oidc: { enable_http_post_methods: true } },
      },
    });

    try {
      const response = await fetch(`${enabled.issuer}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: authorizationBody(enabledClient),
        redirect: 'manual',
      });
      expect(response.status).toBe(303);
      expect(redirectLocation(response, enabled.origin).pathname).toContain(
        '/oidc/v1/interaction/'
      );
    } finally {
      await enabled.stop();
    }

    const disabledPort = 19115;
    const disabledOrigin = `http://127.0.0.1:${disabledPort}`;
    const disabledClient = rpClient(disabledOrigin);
    const disabled = await startParakoInstance({
      port: disabledPort,
      clients: [disabledClient],
      config: {
        features: { oidc: { enable_http_post_methods: false } },
      },
    });

    try {
      const response = await fetch(`${disabled.issuer}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: authorizationBody(disabledClient),
        redirect: 'manual',
      });
      expect(response.status).toBe(404);
    } finally {
      await disabled.stop();
    }
  });

  test('single redirect URI omission follows the configured provider policy', async () => {
    const authorizationWithoutRedirect = (issuer: string, clientId: string) => {
      const url = new URL(`${issuer}/authorize`);
      url.search = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'openid',
        state: 'omitted-redirect-state',
        code_challenge: 'A'.repeat(43),
        code_challenge_method: 'S256',
      }).toString();
      return url;
    };

    const enabledPort = 19116;
    const enabledOrigin = `http://127.0.0.1:${enabledPort}`;
    const enabledClient = rpClient(enabledOrigin);
    const enabled = await startParakoInstance({
      port: enabledPort,
      clients: [enabledClient],
      config: {
        features: {
          oidc: { allow_omitting_single_registered_redirect_uri: true },
        },
      },
    });

    try {
      const response = await fetch(
        authorizationWithoutRedirect(enabled.issuer, enabledClient.client_id),
        { redirect: 'manual' }
      );
      expect(response.status).toBe(303);
      expect(redirectLocation(response, enabled.origin).pathname).toContain(
        '/oidc/v1/interaction/'
      );
    } finally {
      await enabled.stop();
    }

    const disabledPort = 19117;
    const disabledOrigin = `http://127.0.0.1:${disabledPort}`;
    const disabledClient = rpClient(disabledOrigin);
    const disabled = await startParakoInstance({
      port: disabledPort,
      clients: [disabledClient],
      config: {
        features: {
          oidc: { allow_omitting_single_registered_redirect_uri: false },
        },
      },
    });

    try {
      const response = await fetch(
        authorizationWithoutRedirect(disabled.issuer, disabledClient.client_id),
        { redirect: 'manual' }
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Invalid Request');
    } finally {
      await disabled.stop();
    }
  });

  test('query-string access tokens follow the explicit provider policy', async () => {
    const disabledPort = 19118;
    const disabled = await startParakoInstance({
      port: disabledPort,
      config: {
        features: { oidc: { accept_query_param_access_tokens: false } },
      },
    });

    try {
      const response = await json(
        await fetch(`${disabled.issuer}/userinfo?access_token=not-a-token`, {
          headers: { accept: 'application/json' },
        })
      );
      expect(response.response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
      expect(response.body.error_description).toContain(
        'must not be provided via query parameter'
      );
    } finally {
      await disabled.stop();
    }

    const enabledPort = 19119;
    const enabled = await startParakoInstance({
      port: enabledPort,
      config: {
        features: { oidc: { accept_query_param_access_tokens: true } },
      },
    });

    try {
      const response = await json(
        await fetch(`${enabled.issuer}/userinfo?access_token=not-a-token`, {
          headers: { accept: 'application/json' },
        })
      );
      expect(response.response.status).toBe(401);
      expect(response.body.error).toBe('invalid_token');
    } finally {
      await enabled.stop();
    }
  });

  test('disabled optional features disappear from discovery and reject use', async () => {
    const port = 19107;
    const origin = `http://127.0.0.1:${port}`;
    const instance = await startParakoInstance({
      port,
      clients: [rpClient(origin), managementClient()],
      config: {
        features: {
          oidc: {
            device_flow: { enabled: false },
            client_credentials: { enabled: false },
            token_revocation: { enabled: false },
            token_introspection: { enabled: false },
            userinfo_endpoint: { enabled: false },
            resource_indicators: { enabled: false },
            rp_initiated_logout: { enabled: false },
            backchannel_logout: { enabled: false },
            request_objects: { enabled: false },
          },
        },
      },
    });

    try {
      const discovery = await fetch(
        `${instance.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());

      for (const property of [
        'device_authorization_endpoint',
        'end_session_endpoint',
        'introspection_endpoint',
        'revocation_endpoint',
        'userinfo_endpoint',
      ]) {
        expect(discovery).not.toHaveProperty(property);
      }
      expect(discovery).not.toHaveProperty('request_parameter_supported');
      expect(discovery.request_uri_parameter_supported).toBe(false);
      expect(discovery.grant_types_supported).not.toContain(
        'client_credentials'
      );

      const device = await fetch(`${instance.issuer}/device/auth`, {
        method: 'POST',
      });
      expect(device.status).toBe(404);

      const credentials = await json(
        await fetch(`${instance.issuer}/token`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: RP_CLIENT_ID,
            grant_type: 'client_credentials',
          }),
        })
      );
      expect(credentials.response.status).toBe(400);
      expect(credentials.body.error).toBe('unsupported_grant_type');
    } finally {
      await instance.stop();
    }
  });

  test('DCR and registration management honor access-token policies and rotation', async () => {
    const port = 19108;
    const instance = await startParakoInstance({
      port,
      clients: [managementClient()],
      config: {
        features: {
          oidc: {
            dynamic_client_registration: {
              enabled: true,
              require_initial_access_token: true,
              issue_registration_access_token: true,
            },
            client_registration_management: {
              enabled: true,
              rotate_registration_access_token: true,
            },
          },
        },
      },
    });

    try {
      const discovery = await fetch(
        `${instance.issuer}/.well-known/openid-configuration`
      ).then(response => response.json());
      expect(discovery.registration_endpoint).toBe(
        `${instance.issuer}/register-rp`
      );

      const tokenResponse = await json(
        await fetch(`${instance.issuer}/token`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${MANAGEMENT_CLIENT_ID}:${MANAGEMENT_CLIENT_SECRET}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'parako:registration-tokens:write',
            resource: 'urn:parako:api:v1',
          }),
        })
      );
      expect(tokenResponse.response.status).toBe(200);
      expect(tokenResponse.body.access_token).toEqual(expect.any(String));

      const initialAccessTokenResponse = await json(
        await fetch(`${instance.origin}/api/v1/registration-tokens`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tokenResponse.body.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            expires_in: 600,
            max_usage_count: 1,
            policies: ['general-policy'],
          }),
        })
      );
      expect(initialAccessTokenResponse.response.status).toBe(201);
      const initialAccessToken = initialAccessTokenResponse.body.data.token;
      expect(initialAccessToken).toEqual(expect.any(String));

      const registrationResponse = await json(
        await fetch(discovery.registration_endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${initialAccessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            client_name: 'Dynamically registered E2E client',
            application_type: 'web',
            redirect_uris: ['https://client.example.test/callback'],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
        })
      );
      expect(registrationResponse.response.status).toBe(201);
      expect(registrationResponse.body.client_id).toEqual(expect.any(String));
      expect(registrationResponse.body.registration_access_token).toEqual(
        expect.any(String)
      );
      expect(registrationResponse.body.registration_client_uri).toEqual(
        expect.any(String)
      );

      const originalRegistrationToken =
        registrationResponse.body.registration_access_token;
      const updateResponse = await json(
        await fetch(registrationResponse.body.registration_client_uri, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${originalRegistrationToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            client_id: registrationResponse.body.client_id,
            client_name: 'Updated dynamic E2E client',
            application_type: 'web',
            redirect_uris: ['https://client.example.test/callback'],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
        })
      );
      expect(updateResponse.response.status).toBe(200);
      expect(updateResponse.body.client_name).toBe(
        'Updated dynamic E2E client'
      );
      expect(updateResponse.body.registration_access_token).toEqual(
        expect.any(String)
      );
      expect(updateResponse.body.registration_access_token).not.toBe(
        originalRegistrationToken
      );

      const deleteResponse = await fetch(
        registrationResponse.body.registration_client_uri,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${updateResponse.body.registration_access_token}`,
          },
        }
      );
      expect(deleteResponse.status).toBe(204);
    } finally {
      await instance.stop();
    }
  });
});
