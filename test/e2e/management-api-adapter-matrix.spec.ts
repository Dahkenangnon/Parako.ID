import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

import { expect, test, type Browser } from '@playwright/test';
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildEndSessionUrl,
  customFetch,
  discovery,
  fetchUserInfo,
  refreshTokenGrant,
  tokenIntrospection,
  tokenRevocation,
} from 'openid-client';

import {
  apiRequest,
  issueManagementToken,
  machineClient,
  MANAGEMENT_API_RESOURCE,
} from './support/deployment-management-api.js';
import { MANAGEMENT_API_SECURED_OPERATIONS } from './support/management-api-security.js';
import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import { createLoopbackTenantFetch } from './support/loopback-tenant-fetch.js';

const CLIENT_ID = 'parako-api-matrix-e2e';
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const CLIENT_SECRET = 'parako-api-matrix-e2e-secret-long-enough';
const STATS_CLIENT_ID = 'parako-api-matrix-stats';
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const STATS_CLIENT_SECRET = 'parako-api-matrix-stats-secret-long-enough';
const USERS_CLIENT_ID = 'parako-api-matrix-users';
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const USERS_CLIENT_SECRET = 'parako-api-matrix-users-secret-long-enough';
const WRONG_AUDIENCE_CLIENT_ID = 'parako-api-matrix-wrong-audience';
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const WRONG_AUDIENCE_CLIENT_SECRET =
  'parako-api-matrix-wrong-audience-secret-long-enough';
const WRONG_AUDIENCE_RESOURCE = `urn:resource:${WRONG_AUDIENCE_CLIENT_ID}`;
const EXPIRING_CLIENT_ID = 'parako-api-matrix-expiring';
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const EXPIRING_CLIENT_SECRET = 'parako-api-matrix-expiring-secret-long-enough';
const RATE_LIMIT_CLIENT_ID = 'parako-api-matrix-rate-limit';
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const RATE_LIMIT_CLIENT_SECRET =
  'parako-api-matrix-rate-limit-secret-long-enough';
const SESSION_RP_CLIENT_ID = 'parako-api-matrix-session-rp';
const PAIRWISE_RP_A_CLIENT_ID = 'parako-api-matrix-pairwise-a';
const PAIRWISE_RP_B_CLIENT_ID = 'parako-api-matrix-pairwise-b';
const JWT_USERINFO_RP_CLIENT_ID = 'parako-api-matrix-jwt-userinfo';
const SESSION_RP_ORIGIN = 'http://127.0.0.1:19149';
const SESSION_RP_REDIRECT_URI = `${SESSION_RP_ORIGIN}/callback`;
const PAIRWISE_RP_A_REDIRECT_URI = `${SESSION_RP_ORIGIN}/pairwise-a/callback`;
const PAIRWISE_RP_B_REDIRECT_URI = 'http://localhost:19149/pairwise-b/callback';
const JWT_USERINFO_RP_REDIRECT_URI = `${SESSION_RP_ORIGIN}/jwt-userinfo/callback`;
const SCOPES = [
  'parako:users:read',
  'parako:users:write',
  'parako:users:delete',
  'parako:sessions:read',
  'parako:sessions:revoke',
  'parako:clients:read',
  'parako:clients:write',
  'parako:clients:delete',
  'parako:jwks:read',
  'parako:jwks:rotate',
  'parako:audit:read',
  'parako:stats:read',
  'parako:registration-tokens:read',
  'parako:registration-tokens:write',
  'parako:registration-tokens:delete',
].join(' ');
const POSTGRESQL_URL = requireE2ePostgresqlUrl();

interface MatrixRuntime {
  origin: string;
  logs?(): string;
  stop(): Promise<void>;
}

interface ApiEnvelope<T> {
  data: T;
}

interface ApiList<T> {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
    total_count?: number;
  };
}

interface UserRecord {
  id?: string;
  _id?: string;
  email: string;
  nickname?: string;
}

interface ClientRecord {
  client_id: string;
  client_secret?: string;
  client_name: string;
}

interface PublicJwkRecord {
  kid: string;
  alg: string;
  use: string;
  status: 'active' | 'expiring' | 'retired';
  promoted: boolean;
  publicKey: JsonWebKey;
}

interface RegistrationTokenRecord {
  jti: string;
  token?: string;
  max_usage_count: number;
  current_usage_count: number;
  policies: string[];
  note?: string;
}

interface ProblemDetail {
  type: string;
  status: number;
  required_scopes?: string[];
}

interface AuditRecord {
  client_id?: string;
  actor?: { actor_type?: string };
  target?: {
    entity_data?: Record<string, unknown>;
  };
}

interface SessionRecord {
  id?: string;
  jti?: string;
  accountId?: string;
}

let sessionRpServer: Server | undefined;
const backchannelLogoutTokens: string[] = [];

function clientFixture() {
  return machineClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: SCOPES,
  });
}

function securityClientFixtures() {
  return [
    machineClient({
      clientId: STATS_CLIENT_ID,
      clientSecret: STATS_CLIENT_SECRET,
      scopes: 'parako:stats:read',
    }),
    machineClient({
      clientId: USERS_CLIENT_ID,
      clientSecret: USERS_CLIENT_SECRET,
      scopes: 'parako:users:read',
    }),
    machineClient({
      clientId: WRONG_AUDIENCE_CLIENT_ID,
      clientSecret: WRONG_AUDIENCE_CLIENT_SECRET,
      oidcScopes: 'profile',
      resources: [WRONG_AUDIENCE_RESOURCE],
      scopes: 'profile',
    }),
    machineClient({
      clientId: EXPIRING_CLIENT_ID,
      clientSecret: EXPIRING_CLIENT_SECRET,
      scopes: 'parako:stats:read',
      ttl: { ClientCredentials: 1 },
    }),
    machineClient({
      clientId: RATE_LIMIT_CLIENT_ID,
      clientSecret: RATE_LIMIT_CLIENT_SECRET,
      scopes: 'parako:clients:write',
    }),
  ];
}

function allClientFixtures() {
  return [
    clientFixture(),
    ...securityClientFixtures(),
    {
      client_id: SESSION_RP_CLIENT_ID,
      client_name: 'Parako adapter-matrix temporary RP',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: [SESSION_RP_REDIRECT_URI],
      post_logout_redirect_uris: [`${SESSION_RP_ORIGIN}/`],
      backchannel_logout_uri: 'https://client.example.com/backchannel_logout',
      backchannel_logout_session_required: true,
      scope: 'openid profile email offline_access',
    },
    {
      client_id: PAIRWISE_RP_A_CLIENT_ID,
      client_name: 'Parako adapter-matrix pairwise RP A',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: [PAIRWISE_RP_A_REDIRECT_URI],
      scope: 'openid',
      subject_type: 'pairwise',
      require_pkce: true,
    },
    {
      client_id: PAIRWISE_RP_B_CLIENT_ID,
      client_name: 'Parako adapter-matrix pairwise RP B',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: [PAIRWISE_RP_B_REDIRECT_URI],
      scope: 'openid',
      subject_type: 'pairwise',
      require_pkce: true,
    },
    {
      client_id: JWT_USERINFO_RP_CLIENT_ID,
      client_name: 'Parako adapter-matrix JWT UserInfo RP',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: [JWT_USERINFO_RP_REDIRECT_URI],
      scope: 'openid profile email',
      require_pkce: true,
      userinfo_signed_response_alg: 'RS256',
    },
  ];
}

function authorizationTransaction(
  issuer: string,
  options: {
    clientId?: string;
    prompt?: 'consent';
    redirectUri?: string;
    scope?: string;
  } = {}
) {
  const clientId = options.clientId ?? SESSION_RP_CLIENT_ID;
  const redirectUri = options.redirectUri ?? SESSION_RP_REDIRECT_URI;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const url = new URL(`${issuer.replace(/\/$/, '')}/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: options.scope ?? 'openid profile email offline_access',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(options.prompt ? { prompt: options.prompt } : {}),
  }).toString();
  return { url: url.href, verifier, state, nonce, clientId, redirectUri };
}

function matrixConfig() {
  return {
    features: {
      oidc: {
        jwt_userinfo: { enabled: true },
      },
    },
    security: {
      protection: {
        // The matrix deliberately sends more than 100 policy probes. Keep the
        // global application limit out of the way while retaining the fixed
        // Management API endpoint tiers exercised below.
        rate_limiting: {
          enabled: true,
          requests_per_minute: 10_000,
          window_minutes: 1,
        },
      },
    },
  };
}

function expectPublicOnlyKey(key: PublicJwkRecord): void {
  expect(key).toMatchObject({
    kid: expect.any(String),
    alg: expect.any(String),
    use: expect.any(String),
    publicKey: expect.any(Object),
  });
  for (const privateMember of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']) {
    expect(key.publicKey).not.toHaveProperty(privateMember);
  }
}

async function runPersistenceScenario({
  issuer,
  crossTenantOrigin,
}: {
  issuer: string;
  crossTenantOrigin?: string;
}): Promise<void> {
  const apiOrigin = new URL(issuer).origin;
  const token = await issueManagementToken({
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scope: SCOPES,
  });

  expect((await apiRequest(apiOrigin, '/users')).status).toBe(401);

  const suffix = randomUUID();
  const createUser = await apiRequest(apiOrigin, '/users', {
    method: 'POST',
    token,
    body: JSON.stringify({
      email: `matrix-${suffix}@example.test`,
      username: `matrix-${suffix}`,
      password: 'E2E-Strong!7',
      given_name: 'Matrix',
      family_name: 'User',
      name: 'Matrix User',
    }),
  });
  expect(createUser.status, await createUser.clone().text()).toBe(201);
  const createdUser = (await createUser.json()) as ApiEnvelope<UserRecord>;
  const userId = createdUser.data.id ?? createdUser.data._id;
  expect(userId).toEqual(expect.any(String));
  expect(createdUser.data).not.toHaveProperty('password');

  const userPath = `/users/${encodeURIComponent(userId!)}`;

  const listUsers = await apiRequest(apiOrigin, '/users?include_count=true', {
    token,
  });
  expect(listUsers.status).toBe(200);
  expect(((await listUsers.json()) as ApiList<UserRecord>).data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ email: createdUser.data.email }),
    ])
  );

  const getUser = await apiRequest(apiOrigin, userPath, { token });
  expect(getUser.status).toBe(200);
  expect((await getUser.json()) as ApiEnvelope<UserRecord>).toMatchObject({
    data: { email: createdUser.data.email },
  });

  const replaceUser = await apiRequest(apiOrigin, userPath, {
    method: 'PUT',
    token,
    body: JSON.stringify({
      given_name: 'Replaced',
      family_name: 'Matrix User',
      nickname: 'matrix-replaced',
      account_enabled: true,
    }),
  });
  expect(replaceUser.status).toBe(200);
  expect((await replaceUser.json()) as ApiEnvelope<UserRecord>).toMatchObject({
    data: { nickname: 'matrix-replaced' },
  });

  const patchUser = await apiRequest(apiOrigin, userPath, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ nickname: 'matrix-patched' }),
  });
  expect(patchUser.status).toBe(200);
  expect(
    ((await patchUser.json()) as ApiEnvelope<UserRecord>).data.nickname
  ).toBe('matrix-patched');

  const lockUser = await apiRequest(apiOrigin, `${userPath}/lock`, {
    method: 'POST',
    token,
  });
  expect(lockUser.status).toBe(200);
  expect((await lockUser.json()) as ApiEnvelope<UserRecord>).toMatchObject({
    data: { account_enabled: false },
  });

  const unlockUser = await apiRequest(apiOrigin, `${userPath}/lock`, {
    method: 'DELETE',
    token,
  });
  expect(unlockUser.status).toBe(200);
  expect((await unlockUser.json()) as ApiEnvelope<UserRecord>).toMatchObject({
    data: { account_enabled: true },
  });

  expect(
    (
      await apiRequest(apiOrigin, `${userPath}/password-reset`, {
        method: 'POST',
        token,
        body: JSON.stringify({ new_password: 'Reset-E2E-Strong!8' }),
      })
    ).status
  ).toBe(200);
  expect(
    (
      await apiRequest(apiOrigin, `${userPath}/mfa/reset`, {
        method: 'POST',
        token,
      })
    ).status
  ).toBe(200);
  expect(
    (await apiRequest(apiOrigin, `${userPath}/activities`, { token })).status
  ).toBe(200);
  expect(
    (await apiRequest(apiOrigin, `${userPath}/sessions`, { token })).status
  ).toBe(200);

  if (crossTenantOrigin) {
    const crossTenant = await apiRequest(crossTenantOrigin, userPath, {
      token,
    });
    expect([401, 403]).toContain(crossTenant.status);
  }

  const clientName = `Matrix client ${suffix}`;
  const createClient = await apiRequest(apiOrigin, '/clients', {
    method: 'POST',
    token,
    body: JSON.stringify({
      client_name: clientName,
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['client_credentials'],
      response_types: [],
      allowedResources: [MANAGEMENT_API_RESOURCE],
      resourcesScopes: 'parako:stats:read',
    }),
  });
  expect(createClient.status).toBe(201);
  const createdClient =
    (await createClient.json()) as ApiEnvelope<ClientRecord>;
  expect(createdClient.data.client_secret).toEqual(expect.any(String));
  const clientPath = `/clients/${encodeURIComponent(createdClient.data.client_id)}`;

  const getClient = await apiRequest(apiOrigin, clientPath, { token });
  expect(getClient.status).toBe(200);
  expect((await getClient.json()) as ApiEnvelope<ClientRecord>).toMatchObject({
    data: { client_id: createdClient.data.client_id, client_name: clientName },
  });
  expect(
    (await apiRequest(apiOrigin, clientPath, { token })).json() as Promise<
      ApiEnvelope<ClientRecord>
    >
  ).resolves.not.toHaveProperty('data.client_secret');

  const listClients = await apiRequest(
    apiOrigin,
    '/clients?include_count=true',
    { token }
  );
  expect(listClients.status).toBe(200);
  expect(((await listClients.json()) as ApiList<ClientRecord>).data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ client_id: createdClient.data.client_id }),
    ])
  );

  const replaceClient = await apiRequest(apiOrigin, clientPath, {
    method: 'PUT',
    token,
    body: JSON.stringify({
      client_name: `${clientName} replaced`,
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['client_credentials'],
      response_types: [],
      allowedResources: [MANAGEMENT_API_RESOURCE],
      resourcesScopes: 'parako:stats:read',
    }),
  });
  expect(replaceClient.status).toBe(200);

  const patchClient = await apiRequest(apiOrigin, clientPath, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ client_name: `${clientName} patched` }),
  });
  expect(patchClient.status).toBe(200);

  expect(
    (
      await apiRequest(apiOrigin, `${clientPath}/deactivate`, {
        method: 'POST',
        token,
      })
    ).status
  ).toBe(200);
  expect(
    (
      await apiRequest(apiOrigin, `${clientPath}/activate`, {
        method: 'POST',
        token,
      })
    ).status
  ).toBe(200);
  const rotateSecret = await apiRequest(apiOrigin, `${clientPath}/secret`, {
    method: 'POST',
    token,
  });
  expect(rotateSecret.status).toBe(200);
  expect(
    ((await rotateSecret.json()) as ApiEnvelope<ClientRecord>).data
      .client_secret
  ).toEqual(expect.any(String));
  expect(
    (await apiRequest(apiOrigin, `${clientPath}/stats`, { token })).status
  ).toBe(200);

  const invalidRegistrationToken = await apiRequest(
    apiOrigin,
    '/registration-tokens',
    {
      method: 'POST',
      token,
      body: JSON.stringify({ expires_in: 10, max_usage_count: 0 }),
    }
  );
  expect(invalidRegistrationToken.status).toBe(422);

  const createRegistrationToken = await apiRequest(
    apiOrigin,
    '/registration-tokens',
    {
      method: 'POST',
      token,
      body: JSON.stringify({
        expires_in: 300,
        max_usage_count: 1,
        policies: ['general-policy'],
        note: `Adapter matrix ${suffix}`,
      }),
    }
  );
  expect(createRegistrationToken.status).toBe(201);
  const registrationToken =
    (await createRegistrationToken.json()) as ApiEnvelope<RegistrationTokenRecord>;
  expect(registrationToken.data.token).toEqual(expect.any(String));

  const registrationTokenPath = `/registration-tokens/${encodeURIComponent(
    registrationToken.data.jti
  )}`;
  const listRegistrationTokens = await apiRequest(
    apiOrigin,
    '/registration-tokens',
    { token }
  );
  expect(listRegistrationTokens.status).toBe(200);
  const listedRegistrationToken = (
    (await listRegistrationTokens.json()) as ApiList<RegistrationTokenRecord>
  ).data.find(candidate => candidate.jti === registrationToken.data.jti);
  expect(listedRegistrationToken).toBeDefined();
  expect(listedRegistrationToken).not.toHaveProperty('token');

  const getRegistrationToken = await apiRequest(
    apiOrigin,
    registrationTokenPath,
    { token }
  );
  expect(getRegistrationToken.status).toBe(200);
  expect(
    (
      (await getRegistrationToken.json()) as ApiEnvelope<RegistrationTokenRecord>
    ).data
  ).not.toHaveProperty('token');

  expect(
    (await apiRequest(apiOrigin, '/jwks?status=unknown', { token })).status
  ).toBe(422);
  const jwks = await apiRequest(apiOrigin, '/jwks', { token });
  expect(jwks.status).toBe(200);
  const initialKeys = ((await jwks.json()) as ApiEnvelope<PublicJwkRecord[]>)
    .data;
  expect(initialKeys.length).toBeGreaterThan(0);
  initialKeys.forEach(expectPublicOnlyKey);
  expect(
    (
      await apiRequest(
        apiOrigin,
        `/jwks/${encodeURIComponent(initialKeys[0]!.kid)}`,
        { token }
      )
    ).status
  ).toBe(200);

  const rotateKeys = await apiRequest(apiOrigin, '/jwks/rotate', {
    method: 'POST',
    token,
  });
  expect(rotateKeys.status).toBe(200);
  const rotatedKeys = (
    (await (
      await apiRequest(apiOrigin, '/jwks', { token })
    ).json()) as ApiEnvelope<PublicJwkRecord[]>
  ).data;
  expect(rotatedKeys.length).toBeGreaterThan(initialKeys.length);
  rotatedKeys.forEach(expectPublicOnlyKey);
  const retireCandidate =
    rotatedKeys.find(key => key.status === 'expiring') ??
    rotatedKeys.find(
      key =>
        key.status === 'active' &&
        rotatedKeys.some(
          candidate =>
            candidate.kid !== key.kid &&
            candidate.status === 'active' &&
            candidate.promoted
        )
    );
  expect(retireCandidate).toBeDefined();
  const retirePath = `/jwks/${encodeURIComponent(retireCandidate!.kid)}`;
  expect(
    (await apiRequest(apiOrigin, retirePath, { method: 'DELETE', token }))
      .status
  ).toBe(202);
  expect(
    (
      (await (
        await apiRequest(apiOrigin, retirePath, { token })
      ).json()) as ApiEnvelope<PublicJwkRecord>
    ).data.status
  ).toBe('retired');
  expect(
    (await apiRequest(apiOrigin, retirePath, { method: 'DELETE', token }))
      .status
  ).toBe(409);
  expect(
    (
      await apiRequest(apiOrigin, '/jwks/retire-expired', {
        method: 'POST',
        token,
      })
    ).status
  ).toBe(200);
  expect(
    (await apiRequest(apiOrigin, '/jwks/missing-e2e-kid', { token })).status
  ).toBe(404);

  const health = await apiRequest(apiOrigin, '/stats/health', { token });
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({
    data: { status: 'healthy', checks: { database: { status: 'healthy' } } },
  });

  const overview = await apiRequest(apiOrigin, '/stats', { token });
  expect(overview.status).toBe(200);
  expect(
    (await overview.json()) as ApiEnvelope<Record<string, unknown>>
  ).toMatchObject({
    data: {
      users: expect.any(Object),
      clients: expect.any(Object),
      sessions: expect.any(Object),
      grants: expect.any(Object),
      activity: expect.any(Object),
    },
  });

  expect(
    (
      await apiRequest(
        apiOrigin,
        `/audit?from=${encodeURIComponent('2026-08-09T10:00:00Z')}&to=${encodeURIComponent('2026-08-08T10:00:00Z')}`,
        { token }
      )
    ).status
  ).toBe(422);

  let auditEntries: Record<string, unknown>[] = [];
  await expect
    .poll(async () => {
      const audit = await apiRequest(apiOrigin, '/audit?include_count=true', {
        token,
      });
      if (!audit.ok) return 0;
      auditEntries = ((await audit.json()) as ApiList<Record<string, unknown>>)
        .data;
      return auditEntries.length;
    })
    .toBeGreaterThan(0);
  const auditId = String(auditEntries[0]!.id ?? auditEntries[0]!._id ?? '');
  expect(auditId).not.toBe('');
  expect(
    (
      await apiRequest(apiOrigin, `/audit/${encodeURIComponent(auditId)}`, {
        token,
      })
    ).status
  ).toBe(200);
  expect((await apiRequest(apiOrigin, '/audit/types', { token })).status).toBe(
    200
  );
  expect((await apiRequest(apiOrigin, '/audit/stats', { token })).status).toBe(
    200
  );
  expect(
    (await apiRequest(apiOrigin, '/audit/missing-e2e-audit', { token })).status
  ).toBe(404);

  expect(
    (
      await apiRequest(apiOrigin, registrationTokenPath, {
        method: 'DELETE',
        token,
      })
    ).status
  ).toBe(204);
  expect(
    (await apiRequest(apiOrigin, registrationTokenPath, { token })).status
  ).toBe(404);
  expect(
    (await apiRequest(apiOrigin, clientPath, { method: 'DELETE', token }))
      .status
  ).toBe(204);
  expect(
    (await apiRequest(apiOrigin, userPath, { method: 'DELETE', token })).status
  ).toBe(204);
  expect(
    (await apiRequest(apiOrigin, '/users/missing-user-e2e', { token })).status
  ).toBe(404);
}

async function runSecurityScenario(issuer: string): Promise<void> {
  const apiOrigin = new URL(issuer).origin;
  const [statsToken, usersToken] = await Promise.all([
    issueManagementToken({
      issuer,
      clientId: STATS_CLIENT_ID,
      clientSecret: STATS_CLIENT_SECRET,
      scope: 'parako:stats:read',
    }),
    issueManagementToken({
      issuer,
      clientId: USERS_CLIENT_ID,
      clientSecret: USERS_CLIENT_SECRET,
      scope: 'parako:users:read',
    }),
  ]);

  for (const [
    ,
    method,
    path,
    requiredScope,
  ] of MANAGEMENT_API_SECURED_OPERATIONS) {
    const missing = await apiRequest(apiOrigin, path, { method });
    expect(missing.status, `${method} ${path} missing token`).toBe(401);
    expect((await missing.json()) as ProblemDetail).toMatchObject({
      type: 'urn:parako:error:unauthorized',
      status: 401,
    });

    const irrelevantToken =
      requiredScope === 'parako:stats:read' ? usersToken : statsToken;
    const insufficient = await apiRequest(apiOrigin, path, {
      method,
      token: irrelevantToken,
    });
    expect(insufficient.status, `${method} ${path} insufficient scope`).toBe(
      403
    );
    expect((await insufficient.json()) as ProblemDetail).toMatchObject({
      type: 'urn:parako:error:scope-insufficient',
      status: 403,
      required_scopes: [requiredScope],
    });
  }

  const malformed = await apiRequest(apiOrigin, '/stats', {
    token: 'not-a-jwt',
  });
  expect(malformed.status).toBe(401);
  expect((await malformed.json()) as ProblemDetail).toMatchObject({
    type: 'urn:parako:error:token-invalid',
    status: 401,
  });

  const wrongAudienceToken = await issueManagementToken({
    issuer,
    clientId: WRONG_AUDIENCE_CLIENT_ID,
    clientSecret: WRONG_AUDIENCE_CLIENT_SECRET,
    resource: WRONG_AUDIENCE_RESOURCE,
    scope: 'profile',
  });
  const wrongAudience = await apiRequest(apiOrigin, '/stats', {
    token: wrongAudienceToken,
  });
  expect(wrongAudience.status).toBe(401);
  expect((await wrongAudience.json()) as ProblemDetail).toMatchObject({
    type: 'urn:parako:error:token-invalid',
    status: 401,
  });

  const expiringToken = await issueManagementToken({
    issuer,
    clientId: EXPIRING_CLIENT_ID,
    clientSecret: EXPIRING_CLIENT_SECRET,
    scope: 'parako:stats:read',
  });
  const expiringClaims = decodeJwt(expiringToken);
  expect(expiringClaims.exp! - expiringClaims.iat!).toBe(1);
  // Management API verification deliberately permits 30 seconds of clock
  // skew, so this must cross that real boundary instead of mocking time.
  await new Promise(resolve => setTimeout(resolve, 32_000));
  const expired = await apiRequest(apiOrigin, '/stats', {
    token: expiringToken,
  });
  expect(expired.status).toBe(401);
  expect((await expired.json()) as ProblemDetail).toMatchObject({
    type: 'urn:parako:error:token-expired',
    status: 401,
  });

  const rateLimitToken = await issueManagementToken({
    issuer,
    clientId: RATE_LIMIT_CLIENT_ID,
    clientSecret: RATE_LIMIT_CLIENT_SECRET,
    scope: 'parako:clients:write',
  });
  const sensitivePath = '/clients/missing-rate-limit-target/secret';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    expect(
      (
        await apiRequest(apiOrigin, sensitivePath, {
          method: 'POST',
          token: rateLimitToken,
        })
      ).status
    ).toBe(404);
  }
  const limited = await apiRequest(apiOrigin, sensitivePath, {
    method: 'POST',
    token: rateLimitToken,
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect((await limited.json()) as ProblemDetail).toMatchObject({
    type: 'urn:parako:error:rate-limit-exceeded',
    status: 429,
  });

  const auditToken = await issueManagementToken({
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scope: 'parako:audit:read',
  });
  let auditRecords: AuditRecord[] = [];
  await expect
    .poll(async () => {
      const response = await apiRequest(
        apiOrigin,
        `/audit?client_id=${encodeURIComponent(RATE_LIMIT_CLIENT_ID)}`,
        { token: auditToken }
      );
      if (!response.ok) return false;
      auditRecords = ((await response.json()) as ApiList<AuditRecord>).data;
      return auditRecords.some(
        record => record.target?.entity_data?.status_code === 429
      );
    })
    .toBe(true);
  expect(auditRecords).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        client_id: RATE_LIMIT_CLIENT_ID,
        actor: expect.objectContaining({ actor_type: 'service' }),
        target: expect.objectContaining({
          entity_data: expect.objectContaining({
            method: 'POST',
            path: sensitivePath,
            status_code: 429,
            completion: 'finished',
          }),
        }),
      }),
    ])
  );
}

async function runSessionScenario({
  browser,
  issuer,
  crossTenantOrigin,
}: {
  browser: Browser;
  issuer: string;
  crossTenantOrigin?: string;
}): Promise<void> {
  const apiOrigin = new URL(issuer).origin;
  const fetchImplementation = createLoopbackTenantFetch(apiOrigin);
  const token = await issueManagementToken({
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scope: SCOPES,
  });
  const suffix = randomUUID();
  const email = `matrix-session-${suffix}@example.test`;
  const username = `matrix-s-${suffix}`;
  const password = 'E2E-Strong!7';
  const createUser = await apiRequest(apiOrigin, '/users', {
    method: 'POST',
    token,
    body: JSON.stringify({
      email,
      username,
      password,
      given_name: 'Session',
      family_name: 'Matrix',
      name: 'Session Matrix',
    }),
  });
  expect(createUser.status, await createUser.clone().text()).toBe(201);
  const createdUser = (await createUser.json()) as ApiEnvelope<UserRecord>;
  const userId = createdUser.data.id ?? createdUser.data._id;
  expect(userId).toEqual(expect.any(String));

  const contexts = [];
  const authorizationTransactions: Array<{
    callbackUrl: URL;
    verifier: string;
    state: string;
    nonce: string;
  }> = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const transaction = authorizationTransaction(issuer);
      await page.goto(transaction.url);
      await expect(page.locator('#login')).toBeVisible();
      await page.locator('#login').fill(email);
      await page.locator('#password').fill(password);
      await page
        .locator('#login-form')
        .getByRole('button', { name: /sign in/i })
        .click();
      const consent = page.locator('#consent-submit-btn');
      await expect(consent).toBeVisible();
      await consent.click();
      await expect(page).toHaveURL(
        new RegExp(`^${SESSION_RP_ORIGIN.replaceAll('.', '\\.')}/callback\\?`)
      );
      expect(new URL(page.url()).searchParams.get('code')).toEqual(
        expect.any(String)
      );
      authorizationTransactions.push({
        ...transaction,
        callbackUrl: new URL(page.url()),
      });
    }

    const configuration = await discovery(
      new URL(issuer),
      SESSION_RP_CLIENT_ID,
      { token_endpoint_auth_method: 'none' },
      undefined,
      { execute: [allowInsecureRequests], [customFetch]: fetchImplementation }
    );
    allowInsecureRequests(configuration);
    const firstTransaction = authorizationTransactions[0]!;
    const tokens = await authorizationCodeGrant(
      configuration,
      firstTransaction.callbackUrl,
      {
        pkceCodeVerifier: firstTransaction.verifier,
        expectedState: firstTransaction.state,
        expectedNonce: firstTransaction.nonce,
      }
    );
    const claims = tokens.claims();
    expect(tokens.access_token).toEqual(expect.any(String));
    expect(tokens.id_token).toEqual(expect.any(String));
    expect(tokens.refresh_token).toEqual(expect.any(String));
    expect(claims?.sub).toEqual(expect.any(String));
    expect(
      await fetchUserInfo(configuration, tokens.access_token!, claims!.sub)
    ).toMatchObject({ sub: claims!.sub, email });

    const previousRefreshToken = tokens.refresh_token!;
    const refreshed = await refreshTokenGrant(
      configuration,
      previousRefreshToken
    );
    expect(refreshed.access_token).toEqual(expect.any(String));
    expect(refreshed.refresh_token).toEqual(expect.any(String));
    expect(refreshed.refresh_token).not.toBe(previousRefreshToken);
    expect(
      (await tokenIntrospection(configuration, refreshed.access_token!)).active
    ).toBe(true);
    await expect(
      refreshTokenGrant(configuration, previousRefreshToken)
    ).rejects.toMatchObject({ error: 'invalid_grant' });
    expect(
      (await tokenIntrospection(configuration, refreshed.access_token!)).active
    ).toBe(false);
    await tokenRevocation(configuration, refreshed.access_token!, {
      token_type_hint: 'access_token',
    });
    expect(
      (await tokenIntrospection(configuration, refreshed.access_token!)).active
    ).toBe(false);

    await expect(
      authorizationCodeGrant(configuration, firstTransaction.callbackUrl, {
        pkceCodeVerifier: firstTransaction.verifier,
        expectedState: firstTransaction.state,
        expectedNonce: firstTransaction.nonce,
      })
    ).rejects.toMatchObject({ error: 'invalid_grant' });

    // The callback server is shared by the adapter cells. Anchor assertions to
    // this transaction so tokens captured by earlier cells cannot leak in.
    const initialBackchannelTokenCount = backchannelLogoutTokens.length;
    const logoutState = randomBytes(24).toString('base64url');
    const logoutUrl = buildEndSessionUrl(configuration, {
      id_token_hint: tokens.id_token!,
      post_logout_redirect_uri: `${SESSION_RP_ORIGIN}/`,
      state: logoutState,
    });
    const logoutPage = contexts[0]!.pages()[0]!;
    await logoutPage.goto(logoutUrl.href);
    await logoutPage.getByRole('button', { name: 'Yes, Sign Out' }).click();
    await expect(logoutPage).toHaveURL(
      `${SESSION_RP_ORIGIN}/?state=${encodeURIComponent(logoutState)}`
    );
    await expect
      .poll(() => backchannelLogoutTokens.length)
      .toBe(initialBackchannelTokenCount + 1);
    const serverMetadata = configuration.serverMetadata();
    const jwks = (await fetchImplementation(serverMetadata.jwks_uri!).then(
      response => response.json()
    )) as Parameters<typeof createLocalJWKSet>[0];
    const { payload: logoutClaims } = await jwtVerify(
      backchannelLogoutTokens[initialBackchannelTokenCount]!,
      createLocalJWKSet(jwks),
      {
        issuer,
        audience: SESSION_RP_CLIENT_ID,
      }
    );
    expect(logoutClaims.events).toEqual({
      'http://schemas.openid.net/event/backchannel-logout': {},
    });
    expect(logoutClaims.sid).toEqual(expect.any(String));
    expect(logoutClaims.jti).toEqual(expect.any(String));

    const invalidLogoutUrl = buildEndSessionUrl(configuration, {
      id_token_hint: tokens.id_token!,
      post_logout_redirect_uri: 'https://unregistered-rp.invalid/callback',
      state: randomBytes(24).toString('base64url'),
    });
    const invalidLogoutPage = contexts[1]!.pages()[0]!;
    const invalidLogoutResponse = await invalidLogoutPage.goto(
      invalidLogoutUrl.href
    );
    expect(invalidLogoutResponse?.status()).toBe(400);
    await expect(
      invalidLogoutPage.getByRole('heading', { name: 'Invalid Request' })
    ).toBeVisible();
    expect(new URL(invalidLogoutPage.url()).origin).toBe(apiOrigin);
    expect(
      await invalidLogoutPage.locator('link[rel="stylesheet"]').count()
    ).toBeGreaterThan(0);

    const denialContext = await browser.newContext();
    contexts.push(denialContext);
    const denialPage = await denialContext.newPage();
    const denialTransaction = authorizationTransaction(issuer, {
      prompt: 'consent',
    });
    await denialPage.goto(denialTransaction.url);
    await denialPage.locator('#login').fill(email);
    await denialPage.locator('#password').fill(password);
    await denialPage
      .locator('#login-form')
      .getByRole('button', { name: /sign in/i })
      .click();
    await expect(denialPage.locator('#consent-form')).toBeVisible();
    await denialPage.getByRole('link', { name: 'Cancel' }).click();
    await expect(denialPage).toHaveURL(
      new RegExp(`^${SESSION_RP_ORIGIN.replaceAll('.', '\\.')}/callback\\?`)
    );
    const denialCallback = new URL(denialPage.url());
    expect(denialCallback.searchParams.get('error')).toBe('access_denied');
    expect(denialCallback.searchParams.get('state')).toBe(
      denialTransaction.state
    );
    expect(denialCallback.searchParams.has('code')).toBe(false);

    const authorizeAdditionalClient = async ({
      clientId,
      redirectUri,
      scope,
    }: {
      clientId: string;
      redirectUri: string;
      scope: string;
    }) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const transaction = authorizationTransaction(issuer, {
        clientId,
        redirectUri,
        scope,
      });
      await page.goto(transaction.url);
      const login = page.locator('#login');
      if (await login.isVisible()) {
        await login.fill(email);
        await page.locator('#password').fill(password);
        await page
          .locator('#login-form')
          .getByRole('button', { name: /sign in/i })
          .click();
      }
      const consent = page.locator('#consent-submit-btn');
      await expect
        .poll(
          async () =>
            page.url().startsWith(redirectUri) || (await consent.isVisible())
        )
        .toBe(true);
      if (!page.url().startsWith(redirectUri)) await consent.click();
      await expect(page).toHaveURL(
        new RegExp(`^${redirectUri.replaceAll('.', '\\.')}\\?`)
      );
      const clientConfiguration = await discovery(
        new URL(issuer),
        clientId,
        { token_endpoint_auth_method: 'none' },
        undefined,
        { execute: [allowInsecureRequests], [customFetch]: fetchImplementation }
      );
      allowInsecureRequests(clientConfiguration);
      const tokens = await authorizationCodeGrant(
        clientConfiguration,
        new URL(page.url()),
        {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
        }
      );
      return { configuration: clientConfiguration, tokens };
    };

    const jwtUserInfoAuthorization = await authorizeAdditionalClient({
      clientId: JWT_USERINFO_RP_CLIENT_ID,
      redirectUri: JWT_USERINFO_RP_REDIRECT_URI,
      scope: 'openid profile email',
    });
    const jwtUserInfoClaims = jwtUserInfoAuthorization.tokens.claims();
    expect(jwtUserInfoClaims?.sub).toEqual(expect.any(String));
    const jwtUserInfoMetadata =
      jwtUserInfoAuthorization.configuration.serverMetadata();
    const jwtUserInfoResponse = await fetchImplementation(
      jwtUserInfoMetadata.userinfo_endpoint!,
      {
        headers: {
          authorization: `Bearer ${jwtUserInfoAuthorization.tokens.access_token}`,
        },
      }
    );
    expect(jwtUserInfoResponse.status).toBe(200);
    expect(jwtUserInfoResponse.headers.get('content-type')).toContain(
      'application/jwt'
    );
    const jwtUserInfo = await jwtVerify(
      await jwtUserInfoResponse.text(),
      createLocalJWKSet(jwks),
      { issuer, audience: JWT_USERINFO_RP_CLIENT_ID }
    );
    expect(jwtUserInfo.protectedHeader.alg).toBe('RS256');
    expect(jwtUserInfo.payload).toMatchObject({
      sub: jwtUserInfoClaims!.sub,
      email,
    });

    const pairwiseAFirst = await authorizeAdditionalClient({
      clientId: PAIRWISE_RP_A_CLIENT_ID,
      redirectUri: PAIRWISE_RP_A_REDIRECT_URI,
      scope: 'openid',
    });
    const pairwiseB = await authorizeAdditionalClient({
      clientId: PAIRWISE_RP_B_CLIENT_ID,
      redirectUri: PAIRWISE_RP_B_REDIRECT_URI,
      scope: 'openid',
    });
    const pairwiseARepeated = await authorizeAdditionalClient({
      clientId: PAIRWISE_RP_A_CLIENT_ID,
      redirectUri: PAIRWISE_RP_A_REDIRECT_URI,
      scope: 'openid',
    });
    const pairwiseSubjectA = pairwiseAFirst.tokens.claims()?.sub;
    const pairwiseSubjectB = pairwiseB.tokens.claims()?.sub;
    expect(pairwiseSubjectA).toMatch(/^[a-f0-9]{64}$/);
    expect(pairwiseARepeated.tokens.claims()?.sub).toBe(pairwiseSubjectA);
    expect(pairwiseSubjectB).toMatch(/^[a-f0-9]{64}$/);
    expect(pairwiseSubjectB).not.toBe(pairwiseSubjectA);

    const userSessions = await apiRequest(
      apiOrigin,
      `/users/${encodeURIComponent(userId!)}/sessions`,
      { token }
    );
    expect(userSessions.status).toBe(200);
    expect(
      ((await userSessions.json()) as ApiEnvelope<SessionRecord[]>).data.length
    ).toBeGreaterThanOrEqual(2);

    const listPath = `/sessions?username=${encodeURIComponent(username)}&limit=1&include_count=true`;
    const list = await apiRequest(apiOrigin, listPath, { token });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as ApiList<SessionRecord>;
    expect(listed.data).toHaveLength(1);
    expect(listed.pagination).toMatchObject({
      has_more: true,
      next_cursor: expect.any(String),
      total_count: expect.any(Number),
    });
    expect(listed.pagination.total_count).toBeGreaterThanOrEqual(2);
    const firstJti = listed.data[0]!.jti ?? listed.data[0]!.id;
    expect(firstJti).toEqual(expect.any(String));

    const next = await apiRequest(
      apiOrigin,
      `/sessions?username=${encodeURIComponent(username)}&limit=1&after=${encodeURIComponent(listed.pagination.next_cursor!)}`,
      { token }
    );
    expect(next.status).toBe(200);
    const nextPage = (await next.json()) as ApiList<SessionRecord>;
    expect(nextPage.data).toHaveLength(1);
    expect(nextPage.data[0]!.jti ?? nextPage.data[0]!.id).not.toBe(firstJti);

    const sessionPath = `/sessions/${encodeURIComponent(firstJti!)}`;
    const get = await apiRequest(apiOrigin, sessionPath, { token });
    expect(get.status).toBe(200);
    expect((await get.json()) as ApiEnvelope<SessionRecord>).toMatchObject({
      data: { accountId: username },
    });

    if (crossTenantOrigin) {
      expect(
        (await apiRequest(crossTenantOrigin, sessionPath, { token })).status
      ).toBe(401);
    }

    expect(
      (
        await apiRequest(apiOrigin, sessionPath, {
          method: 'DELETE',
          token,
        })
      ).status
    ).toBe(204);
    expect((await apiRequest(apiOrigin, sessionPath, { token })).status).toBe(
      404
    );

    expect(
      (
        await apiRequest(apiOrigin, '/sessions', {
          method: 'DELETE',
          token,
        })
      ).status
    ).toBe(422);
    const bulk = await apiRequest(
      apiOrigin,
      `/sessions?username=${encodeURIComponent(username)}`,
      { method: 'DELETE', token }
    );
    expect(bulk.status).toBe(200);
    expect(
      (
        (await bulk.json()) as ApiEnvelope<{
          revoked_count: number;
        }>
      ).data.revoked_count
    ).toBeGreaterThan(0);

    const empty = await apiRequest(
      apiOrigin,
      `/sessions?username=${encodeURIComponent(username)}`,
      { token }
    );
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as ApiList<SessionRecord>).data).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    if (userId) {
      await apiRequest(apiOrigin, `/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        token,
      });
    }
  }
}

async function withRuntime(
  start: () => Promise<MatrixRuntime>,
  run: (runtime: MatrixRuntime) => Promise<void>
): Promise<void> {
  const runtime = await start();
  try {
    await run(runtime);
  } catch (error) {
    const logs = runtime.logs?.();
    if (logs) {
      const logPath = test.info().outputPath('parako-runtime.log');
      await writeFile(logPath, logs, 'utf8');
      await test.info().attach('parako-runtime.log', {
        path: logPath,
        contentType: 'text/plain',
      });
    }
    throw error;
  } finally {
    await runtime.stop();
  }
}

test.beforeAll(async () => {
  sessionRpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', SESSION_RP_ORIGIN);
    if (request.method === 'POST' && url.pathname === '/backchannel-logout') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const logoutToken = new URLSearchParams(
        Buffer.concat(chunks).toString('utf8')
      ).get('logout_token');
      if (!logoutToken) {
        response.writeHead(400).end();
        return;
      }
      backchannelLogoutTokens.push(logoutToken);
      response.writeHead(204).end();
      return;
    }
    if (url.pathname !== '/' && !url.pathname.endsWith('/callback')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Temporary RP callback</title>');
  });
  sessionRpServer.listen(19149, '127.0.0.1');
  await once(sessionRpServer, 'listening');
});

test.afterAll(async () => {
  if (!sessionRpServer?.listening) return;
  sessionRpServer.close();
  await once(sessionRpServer, 'close');
});

test.describe('Management API adapter lifecycle and security matrix', () => {
  test('SQLite single tenant', async ({ browser }) => {
    await withRuntime(
      () =>
        startParakoInstance({
          port: 19140,
          config: matrixConfig(),
          clients: allClientFixtures(),
          backchannelCaptureUrl: `${SESSION_RP_ORIGIN}/backchannel-logout`,
        }),
      async runtime => {
        const issuer = `${runtime.origin}/oidc/v1`;
        await runPersistenceScenario({ issuer });
        await runSecurityScenario(issuer);
        await runSessionScenario({ browser, issuer });
      }
    );
  });

  test('MongoDB single tenant', async ({ browser }) => {
    await withRuntime(
      () =>
        startMongoSingleTenantParakoInstance({
          port: 19141,
          config: matrixConfig(),
          backchannelCaptureUrl: `${SESSION_RP_ORIGIN}/backchannel-logout`,
          clients: allClientFixtures().map(client => ({
            tenantId: 'default',
            client,
          })),
        }),
      async runtime => {
        const issuer = `${runtime.origin}/oidc/v1`;
        await runPersistenceScenario({ issuer });
        await runSecurityScenario(issuer);
        await runSessionScenario({ browser, issuer });
      }
    );
  });

  test('MongoDB multi tenant', async ({ browser }) => {
    const tenantA = 'matrix-a';
    const tenantB = 'matrix-b';
    await withRuntime(
      () =>
        startMongoMultiTenantParakoInstance({
          port: 19142,
          config: matrixConfig(),
          backchannelCaptureUrl: `${SESSION_RP_ORIGIN}/backchannel-logout`,
          tenants: [
            { slug: tenantA, display_name: 'Matrix A' },
            { slug: tenantB, display_name: 'Matrix B' },
          ],
          clients: allClientFixtures().map(client => ({
            tenantId: tenantA,
            client,
          })),
        }),
      async () => {
        const issuer = `http://${tenantA}.parako.localhost:19142/oidc/v1`;
        await runPersistenceScenario({
          issuer,
          crossTenantOrigin: `http://${tenantB}.parako.localhost:19142`,
        });
        await runSecurityScenario(issuer);
        await runSessionScenario({
          browser,
          issuer,
          crossTenantOrigin: `http://${tenantB}.parako.localhost:19142`,
        });
      }
    );
  });

  test('PostgreSQL single tenant', async ({ browser }) => {
    await withRuntime(
      () =>
        startPostgresqlParakoInstance({
          port: 19143,
          config: matrixConfig(),
          backchannelCaptureUrl: `${SESSION_RP_ORIGIN}/backchannel-logout`,
          postgresqlUrl: POSTGRESQL_URL!,
          multiTenancy: false,
          clients: allClientFixtures().map(client => ({
            tenantId: 'default',
            client,
          })),
        }),
      async runtime => {
        const issuer = `${runtime.origin}/oidc/v1`;
        await runPersistenceScenario({ issuer });
        await runSecurityScenario(issuer);
        await runSessionScenario({ browser, issuer });
      }
    );
  });

  test('PostgreSQL multi tenant', async ({ browser }) => {
    const tenantA = 'matrix-a';
    const tenantB = 'matrix-b';
    await withRuntime(
      () =>
        startPostgresqlParakoInstance({
          port: 19144,
          config: matrixConfig(),
          backchannelCaptureUrl: `${SESSION_RP_ORIGIN}/backchannel-logout`,
          postgresqlUrl: POSTGRESQL_URL!,
          multiTenancy: true,
          tenants: [
            { slug: tenantA, display_name: 'Matrix A' },
            { slug: tenantB, display_name: 'Matrix B' },
          ],
          clients: allClientFixtures().map(client => ({
            tenantId: tenantA,
            client,
          })),
        }),
      async () => {
        const issuer = `http://${tenantA}.parako.localhost:19144/oidc/v1`;
        await runPersistenceScenario({
          issuer,
          crossTenantOrigin: `http://${tenantB}.parako.localhost:19144`,
        });
        await runSecurityScenario(issuer);
        await runSessionScenario({
          browser,
          issuer,
          crossTenantOrigin: `http://${tenantB}.parako.localhost:19144`,
        });
      }
    );
  });
});
