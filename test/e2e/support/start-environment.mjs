import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import express from 'express';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  customFetch,
  discovery,
  fetchUserInfo,
  implicitAuthentication,
  initiateDeviceAuthorization,
  pollDeviceAuthorizationGrant,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  tokenIntrospection,
  tokenRevocation,
  useCodeIdTokenResponseType,
  useIdTokenResponseType,
} from 'openid-client';

import {
  PLATFORM_ONLY_SCOPES,
  SCOPES,
} from '../../../dist/src/api/v1/scopes.js';
import { SmtpCaptureServer } from './smtp-capture.mjs';
import { installFakeGitHubProvider } from './fake-github-provider.mjs';
import {
  MongoFixtureStore,
  PostgresqlFixtureStore,
  SqliteFixtureStore,
} from './fixture-store.mjs';
import {
  applyPostgresqlMigrations,
  createPostgresqlTestDatabase,
  seedPostgresqlFixtures,
} from './parako-instance.mjs';
import { probeLoopbackReadiness } from './loopback-readiness.mjs';
import { createLoopbackTenantFetch } from './loopback-tenant-fetch.ts';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SUPPORT_DIR, '../../..');
const IDP_ORIGIN =
  process.env.PARAKO_E2E_IDP_ORIGIN ?? 'http://127.0.0.1:19007';
const DEPLOYMENT_ORIGIN = process.env.PARAKO_E2E_DEPLOYMENT_URL ?? IDP_ORIGIN;
const ISSUER = `${IDP_ORIGIN}/oidc/v1`;
const RP_ORIGIN = 'http://127.0.0.1:19010';
const CLIENT_ID = 'parako-browser-e2e-rp';
const M2M_CLIENT_ID = 'parako-browser-e2e-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const M2M_CLIENT_SECRET = 'parako-browser-e2e-m2m-secret';
const WRONG_AUDIENCE_CLIENT_ID = 'parako-browser-e2e-wrong-audience';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const WRONG_AUDIENCE_CLIENT_SECRET = 'parako-browser-e2e-wrong-audience-secret';
const WRONG_AUDIENCE_RESOURCE = `urn:resource:${WRONG_AUDIENCE_CLIENT_ID}`;
const EXPIRING_M2M_CLIENT_ID = 'parako-browser-e2e-expiring-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const EXPIRING_M2M_CLIENT_SECRET = 'parako-browser-e2e-expiring-m2m-secret';
const RATE_LIMIT_M2M_CLIENT_ID = 'parako-browser-e2e-rate-limit-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const RATE_LIMIT_M2M_CLIENT_SECRET = 'parako-browser-e2e-rate-limit-m2m-secret';
const DEVICE_CLIENT_ID = 'parako-browser-e2e-device';
const PAIRWISE_CLIENT_A_ID = 'parako-browser-e2e-pairwise-a';
const PAIRWISE_CLIENT_B_ID = 'parako-browser-e2e-pairwise-b';
const JWT_USERINFO_CLIENT_ID = 'parako-browser-e2e-jwt-userinfo';
const IMPLICIT_CLIENT_ID = 'parako-browser-e2e-implicit';
const HYBRID_CLIENT_ID = 'parako-browser-e2e-hybrid';
const SESSION_COOKIE = 'parako_e2e_rp';
// Forward only prompts intentionally exercised by this generic RP. Keeping an
// allowlist prevents the test control query string from becoming an arbitrary
// authorization-request parameter passthrough.
const RP_PROMPTS = new Set(['consent', 'select_account']);
const SMTP_PORT = 19025;
const SMTP_USERNAME = 'parako-browser-e2e';
// gitleaks:allow -- deterministic credential for an isolated local E2E server.
const SMTP_PASSWORD = 'parako-browser-e2e-smtp-password';
// gitleaks:allow -- deterministic credentials for the intercepted local Twilio fixture.
const SMS_ACCOUNT_SID = `AC${'0'.repeat(32)}`;
// gitleaks:allow -- deterministic credentials for the intercepted local Twilio fixture.
const SMS_AUTH_TOKEN = 'parako-browser-e2e-twilio-token';
const SMS_FROM_NUMBER = '+15005550006';
const SOCIAL_CLIENT_ID = 'parako-browser-e2e-social';
// gitleaks:allow -- deterministic credential for an isolated local OAuth fixture.
const SOCIAL_CLIENT_SECRET = 'parako-browser-e2e-social-secret';
// gitleaks:allow -- deterministic cookie-signing fixture, never used outside E2E.
const TEST_SECRET = '0123456789abcdef'.repeat(4);
const TENANT_MANAGEMENT_API_SCOPES = Object.values(SCOPES)
  .filter(scope => !PLATFORM_ONLY_SCOPES.has(scope))
  .join(' ');

const sessions = new Map();
const logoutStates = new Set();
const deviceAuthorizations = new Map();
const backchannelLogoutTokens = [];
const smsMessages = [];
let runtimeRoot;
let parako;
let rpServer;
let smtpCapture;
let mongoFixture;
let postgresqlFixture;
const oidcConfigurations = new Map();
const oidcFetch = createLoopbackTenantFetch(IDP_ORIGIN);
let stopping = false;

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        const separator = value.indexOf('=');
        return [
          decodeURIComponent(value.slice(0, separator)),
          decodeURIComponent(value.slice(separator + 1)),
        ];
      })
  );
}

function getSession(req) {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return id ? { id, value: sessions.get(id) } : undefined;
}

function requireSession(req, res) {
  const existing = getSession(req);
  if (existing?.value) return existing;

  const id = randomUUID();
  const value = {};
  sessions.set(id, value);
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return { id, value };
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function applySqliteMigrations(databasePath) {
  const migrationsRoot = path.join(PROJECT_ROOT, 'prisma/migrations/sqlite');
  const directories = (
    await fs.readdir(migrationsRoot, { withFileTypes: true })
  )
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const database = new Database(databasePath);
  let clientFixtures = [];

  try {
    for (const directory of directories) {
      const sql = await fs.readFile(
        path.join(migrationsRoot, directory, 'migration.sql'),
        'utf8'
      );
      database.exec(sql);
    }

    const now = new Date().toISOString();
    clientFixtures = [
      {
        client_id: CLIENT_ID,
        client_name: 'Parako Browser E2E RP',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        redirect_uris: [`${RP_ORIGIN}/callback`],
        post_logout_redirect_uris: [`${RP_ORIGIN}/`],
        backchannel_logout_uri: 'https://client.example.com/backchannel_logout',
        backchannel_logout_session_required: true,
        scope: 'openid profile email offline_access',
        require_pkce: true,
        introspection_endpoint_auth_method: 'none',
        revocation_endpoint_auth_method: 'none',
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: M2M_CLIENT_ID,
        client_secret: M2M_CLIENT_SECRET,
        client_name: 'Parako Browser E2E M2M Client',
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        introspection_endpoint_auth_method: 'client_secret_basic',
        revocation_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
        response_types: [],
        scope: '',
        allowedResources: ['urn:parako:api:v1'],
        resourcesScopes: TENANT_MANAGEMENT_API_SCOPES,
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: WRONG_AUDIENCE_CLIENT_ID,
        client_secret: WRONG_AUDIENCE_CLIENT_SECRET,
        client_name: 'Parako Browser E2E Wrong Audience Client',
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
        response_types: [],
        scope: 'profile',
        allowedResources: [WRONG_AUDIENCE_RESOURCE],
        resourcesScopes: 'profile',
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: EXPIRING_M2M_CLIENT_ID,
        client_secret: EXPIRING_M2M_CLIENT_SECRET,
        client_name: 'Parako Browser E2E Expiring M2M Client',
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
        response_types: [],
        scope: '',
        allowedResources: ['urn:parako:api:v1'],
        resourcesScopes: 'parako:stats:read',
        ttl: { ClientCredentials: 1 },
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: RATE_LIMIT_M2M_CLIENT_ID,
        client_secret: RATE_LIMIT_M2M_CLIENT_SECRET,
        client_name: 'Parako Browser E2E Rate Limit M2M Client',
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
        response_types: [],
        scope: '',
        allowedResources: ['urn:parako:api:v1'],
        resourcesScopes: 'parako:clients:write',
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: DEVICE_CLIENT_ID,
        client_name: 'Parako Browser E2E Device',
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        response_types: [],
        scope: 'openid profile email',
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: PAIRWISE_CLIENT_A_ID,
        client_name: 'Parako Browser E2E Pairwise RP A',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: [`${RP_ORIGIN}/pairwise/a/callback`],
        scope: 'openid',
        subject_type: 'pairwise',
        require_pkce: true,
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: PAIRWISE_CLIENT_B_ID,
        client_name: 'Parako Browser E2E Pairwise RP B',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: ['http://localhost:19010/pairwise/b/callback'],
        scope: 'openid',
        subject_type: 'pairwise',
        require_pkce: true,
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: JWT_USERINFO_CLIENT_ID,
        client_name: 'Parako Browser E2E JWT UserInfo RP',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: [`${RP_ORIGIN}/jwt-userinfo/callback`],
        scope: 'openid profile email',
        require_pkce: true,
        userinfo_signed_response_alg: 'RS256',
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: IMPLICIT_CLIENT_ID,
        client_name: 'Parako Browser E2E ID Token RP',
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: ['implicit'],
        response_types: ['id_token'],
        redirect_uris: [`${RP_ORIGIN}/implicit/callback`],
        scope: 'openid profile email',
        active: true,
        created_at: now,
        updated_at: now,
      },
      {
        client_id: HYBRID_CLIENT_ID,
        client_name: 'Parako Browser E2E Hybrid RP',
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'implicit'],
        response_types: ['code id_token'],
        redirect_uris: [`${RP_ORIGIN}/hybrid/callback`],
        scope: 'openid profile email',
        require_pkce: true,
        active: true,
        created_at: now,
        updated_at: now,
      },
    ];

    const insertClient = database.prepare(
      `INSERT INTO oidc_store
          (id, model, payload, client_id, tenant_id, created_at)
         VALUES (?, 'Client', ?, ?, 'default', ?)`
    );
    for (const client of clientFixtures) {
      insertClient.run(
        client.client_id,
        JSON.stringify(client),
        client.client_id,
        now
      );
    }
  } finally {
    database.close();
  }

  return clientFixtures;
}

function mongoFixtureDocumentId(tenantId, logicalId) {
  return tenantId === 'default'
    ? logicalId
    : `${tenantId.length}:${tenantId}:${logicalId}`;
}

async function startMongoFixtureDatabase({
  clientFixtures,
  multiTenancy,
  tenantId,
}) {
  const server = await MongoMemoryServer.create({
    instance: { dbName: `parako-browser-e2e-${tenantId}` },
  });
  const databaseName = `parako-browser-e2e-${tenantId}`;
  const uri = server.getUri(databaseName);
  const client = new MongoClient(uri);
  await client.connect();
  const database = client.db(databaseName);

  if (multiTenancy) {
    const now = new Date();
    await database.collection('tenants').insertOne({
      slug: tenantId,
      display_name: 'Parako Browser E2E',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  await database.collection('Client').insertMany(
    clientFixtures.map(clientFixture => ({
      _id: mongoFixtureDocumentId(tenantId, clientFixture.client_id),
      logical_id: clientFixture.client_id,
      tenant_id: tenantId,
      payload: clientFixture,
    }))
  );

  return {
    client,
    fixtureStore: new MongoFixtureStore(database, tenantId),
    server,
    uri,
  };
}

async function waitForReady(url, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Parako exited before readiness with code ${child.exitCode}`
      );
    }
    try {
      if (await probeLoopbackReadiness(url)) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getOidcConfiguration(
  clientId = CLIENT_ID,
  metadata = {},
  execute = []
) {
  if (!oidcConfigurations.has(clientId)) {
    const configuration = await discovery(
      new URL(ISSUER),
      clientId,
      {
        token_endpoint_auth_method: 'none',
        introspection_endpoint_auth_method: 'none',
        revocation_endpoint_auth_method: 'none',
        ...metadata,
      },
      undefined,
      {
        execute: [allowInsecureRequests, ...execute],
        [customFetch]: oidcFetch,
      }
    );
    allowInsecureRequests(configuration);
    oidcConfigurations.set(clientId, configuration);
  }
  return oidcConfigurations.get(clientId);
}

function renderRp(session, logoutComplete) {
  const user = session?.userInfo;
  if (!user) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Parako E2E RP</title></head><body>
      <main data-testid="rp-anonymous"><h1>Temporary E2E RP</h1>
      ${logoutComplete ? '<p data-testid="rp-logout-complete">Logout complete</p>' : ''}
      <a data-testid="rp-login" href="/login">Sign in with Parako</a></main></body></html>`;
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Parako E2E RP</title></head><body>
    <main data-testid="rp-authenticated"><h1>Authenticated</h1>
    <dl><dt>Email</dt><dd data-testid="rp-email">${html(user.email)}</dd>
    <dt>Subject</dt><dd data-testid="rp-subject">${html(user.sub)}</dd>
    <dt>ID token</dt><dd data-testid="rp-id-token">${session.idToken ? 'present' : 'missing'}</dd>
    <dt>Refresh token</dt><dd data-testid="rp-refresh-token">${session.refreshToken ? 'present' : 'missing'}</dd>
    <dt>Refresh rotated</dt><dd data-testid="rp-refresh-rotated">${session.refreshRotated ? 'yes' : 'not-yet'}</dd>
    <dt>Refresh replay rejected</dt><dd data-testid="rp-refresh-replay-rejected">${session.refreshReplayRejected ? 'yes' : 'not-checked'}</dd>
    <dt>Code replay rejected</dt><dd data-testid="rp-code-replay-rejected">${session.codeReplayRejected ? 'yes' : 'not-checked'}</dd>
    <dt>Token active</dt><dd data-testid="rp-token-active">${session.tokenActive === undefined ? 'not-checked' : String(session.tokenActive)}</dd></dl>
    <a data-testid="rp-replay-code" href="/replay-code">Replay authorization code</a>
    <a data-testid="rp-refresh" href="/refresh">Refresh tokens</a>
    <a data-testid="rp-replay-refresh" href="/replay-refresh">Replay rotated refresh token</a>
    <a data-testid="rp-introspect" href="/introspect">Introspect access token</a>
    <a data-testid="rp-revoke" href="/revoke">Revoke access token</a>
    <a data-testid="rp-logout" href="/logout">Sign out</a></main></body></html>`;
}

/**
 * @param {SqliteFixtureStore | MongoFixtureStore} fixtureStore
 */
async function startRp(fixtureStore, socialEnabled) {
  const app = express();
  app.disable('x-powered-by');

  if (socialEnabled) {
    installFakeGitHubProvider(app, {
      clientId: SOCIAL_CLIENT_ID,
      clientSecret: SOCIAL_CLIENT_SECRET,
      // Tenant-owned provider credentials return directly to the active
      // tenant origin; platform-owned credentials use the separate _ops flow.
      redirectUri: `${IDP_ORIGIN}/auth/social/github/callback`,
    });
  }

  app.get('/health', (_req, res) => res.json({ status: 'ready' }));
  // Browsers request this automatically; keep strict console/network E2E
  // diagnostics focused on application failures.
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  app.post(
    '/backchannel-logout',
    express.urlencoded({ extended: false }),
    async (req, res) => {
      if (typeof req.body.logout_token !== 'string') {
        res.status(400).send('Missing logout_token');
        return;
      }
      backchannelLogoutTokens.push(req.body.logout_token);
      res.sendStatus(204);
    }
  );
  app.get('/backchannel-status', (_req, res) => {
    res.json({ tokens: backchannelLogoutTokens });
  });
  app.post('/backchannel-reset', (_req, res) => {
    backchannelLogoutTokens.length = 0;
    res.sendStatus(204);
  });
  app.get('/smtp/messages', (_req, res) => {
    res.json({ messages: smtpCapture?.messages ?? [] });
  });
  app.post('/smtp/reset', (_req, res) => {
    smtpCapture?.clear();
    res.sendStatus(204);
  });
  app.post('/sms/capture', express.json({ limit: '2kb' }), (req, res) => {
    const { body, from, to } = req.body ?? {};
    if (
      typeof body !== 'string' ||
      typeof from !== 'string' ||
      typeof to !== 'string'
    ) {
      res.status(400).json({ error: 'Invalid SMS capture payload' });
      return;
    }
    smsMessages.push({ body, from, to });
    res.status(201).json({ id: `captured-${smsMessages.length}` });
  });
  app.get('/sms/messages', (_req, res) => {
    res.json({ messages: smsMessages });
  });
  app.post('/sms/reset', (_req, res) => {
    smsMessages.length = 0;
    res.sendStatus(204);
  });
  app.post(
    '/test-control/social-integration',
    express.json({ limit: '2kb' }),
    async (req, res) => {
      const { email, method, providerSub } = req.body ?? {};
      if (
        typeof email !== 'string' ||
        email.length === 0 ||
        typeof method !== 'string' ||
        !/^[a-z][a-z0-9_-]{1,31}$/.test(method) ||
        typeof providerSub !== 'string' ||
        providerSub.length === 0
      ) {
        res.status(400).json({ error: 'Invalid social-integration fixture' });
        return;
      }

      // This test-only control seeds a different provider so browser scenarios
      // can exercise provider-count policies without introducing a second fake
      // OAuth implementation or a production-only bypass.
      const integrationId = await fixtureStore.insertSocialIntegration(
        email,
        method,
        providerSub
      );
      if (!integrationId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.status(201).json({ id: integrationId });
    }
  );
  app.post(
    '/test-control/identity-token-expiry',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      const { email, kind } = req.body ?? {};
      if (
        typeof email !== 'string' ||
        (kind !== 'email-verification' &&
          kind !== 'password-reset' &&
          kind !== 'phone-verification')
      ) {
        res
          .status(400)
          .json({ error: 'Invalid identity-token expiry request' });
        return;
      }

      if (!(await fixtureStore.expireIdentityToken(email, kind))) {
        res.status(404).json({ error: 'Pending identity token not found' });
        return;
      }
      res.sendStatus(204);
    }
  );
  app.post(
    '/test-control/phone-unverify',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      const { email } = req.body ?? {};
      if (typeof email !== 'string' || email.length === 0) {
        res.status(400).json({ error: 'Invalid phone-unverify request' });
        return;
      }

      if (!(await fixtureStore.setPhoneUnverified(email))) {
        res.status(404).json({ error: 'User phone not found' });
        return;
      }
      res.sendStatus(204);
    }
  );
  app.post(
    '/test-control/email-unverify',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      const { email } = req.body ?? {};
      if (typeof email !== 'string' || email.length === 0) {
        res.status(400).json({ error: 'Invalid email-unverify request' });
        return;
      }

      // The user remains active and authenticated. Only the durable primary
      // email proof is cleared so the browser can exercise the real account
      // resend flow without introducing a production-only bypass.
      if (!(await fixtureStore.setEmailUnverified(email))) {
        res.status(404).json({ error: 'User email not found' });
        return;
      }
      res.sendStatus(204);
    }
  );
  app.post(
    '/test-control/mfa-email-expiry',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      const { email } = req.body ?? {};
      if (typeof email !== 'string' || email.length === 0) {
        res.status(400).json({ error: 'Invalid email MFA expiry request' });
        return;
      }

      // This control belongs to the disposable RP harness, not Parako. It
      // advances durable state instead of faking clocks or bypassing the
      // public verification handler, so the browser still exercises the real
      // expired-code branch end to end.
      if (!(await fixtureStore.expireMfaEmailCode(email))) {
        res.status(404).json({ error: 'Pending email MFA code not found' });
        return;
      }
      res.sendStatus(204);
    }
  );
  app.post(
    '/test-control/recovery-sms-expiry',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      const { email } = req.body ?? {};
      if (typeof email !== 'string' || email.length === 0) {
        res.status(400).json({ error: 'Invalid recovery SMS expiry request' });
        return;
      }

      // Keep time travel in the disposable harness. The subsequent browser
      // submission still executes Parako's real expiry and consumption path.
      if (!(await fixtureStore.expireRecoverySmsCode(email))) {
        res.status(404).json({ error: 'Pending recovery SMS code not found' });
        return;
      }
      res.sendStatus(204);
    }
  );
  app.post(
    '/test-control/recovery-secondary-email-expiry',
    express.json({ limit: '1kb' }),
    async (req, res) => {
      const { sessionId } = req.body ?? {};
      if (
        typeof sessionId !== 'string' ||
        sessionId.length < 16 ||
        sessionId.length > 128 ||
        !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(sessionId)
      ) {
        res
          .status(400)
          .json({ error: 'Invalid secondary-email expiry request' });
        return;
      }

      // The secondary-email challenge is intentionally session-scoped. The
      // disposable harness advances that persisted session timestamp while
      // leaving Parako's public verification path untouched.
      if (!(await fixtureStore.expireSecondaryEmailRecoveryCode(sessionId))) {
        res
          .status(404)
          .json({ error: 'Pending secondary-email code not found' });
        return;
      }
      res.sendStatus(204);
    }
  );
  app.get('/', (req, res) => {
    const state =
      typeof req.query.state === 'string' ? req.query.state : undefined;
    const logoutComplete = Boolean(state && logoutStates.delete(state));
    res.type('html').send(renderRp(getSession(req)?.value, logoutComplete));
  });

  app.get('/login', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = requireSession(req, res).value;
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    const prompt =
      typeof req.query.prompt === 'string' && RP_PROMPTS.has(req.query.prompt)
        ? req.query.prompt
        : undefined;
    session.transaction = { codeVerifier, state, nonce };

    const url = buildAuthorizationUrl(configuration, {
      client_id: CLIENT_ID,
      redirect_uri: `${RP_ORIGIN}/callback`,
      response_type: 'code',
      scope: 'openid profile email offline_access',
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      ...(prompt ? { prompt } : {}),
    });
    res.redirect(url.href);
  });

  app.get('/pairwise/:client/login', async (req, res) => {
    const pairwiseClient =
      req.params.client === 'a'
        ? {
            clientId: PAIRWISE_CLIENT_A_ID,
            redirectUri: `${RP_ORIGIN}/pairwise/a/callback`,
          }
        : req.params.client === 'b'
          ? {
              clientId: PAIRWISE_CLIENT_B_ID,
              redirectUri: 'http://localhost:19010/pairwise/b/callback',
            }
          : undefined;
    if (!pairwiseClient) {
      res.status(404).send('Unknown pairwise client');
      return;
    }

    const configuration = await getOidcConfiguration(pairwiseClient.clientId);
    const session = requireSession(req, res).value;
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    session.pairwiseTransaction = {
      clientId: pairwiseClient.clientId,
      codeVerifier,
      nonce,
      redirectUri: pairwiseClient.redirectUri,
      state,
    };

    const url = buildAuthorizationUrl(configuration, {
      client_id: pairwiseClient.clientId,
      redirect_uri: pairwiseClient.redirectUri,
      response_type: 'code',
      scope: 'openid',
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(url.href);
  });

  app.get('/pairwise/:client/callback', async (req, res) => {
    const session = getSession(req)?.value;
    const transaction = session?.pairwiseTransaction;
    if (
      !transaction ||
      transaction.clientId.endsWith(req.params.client) === false
    ) {
      res.status(400).send('Missing pairwise authorization transaction');
      return;
    }

    delete session.pairwiseTransaction;
    const configuration = await getOidcConfiguration(transaction.clientId);
    const tokens = await authorizationCodeGrant(
      configuration,
      new URL(req.originalUrl, transaction.redirectUri),
      {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
      }
    );
    const subject = tokens.claims()?.sub;
    if (!subject) {
      throw new Error('Pairwise authorization did not return a subject');
    }

    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pairwise subject</title></head><body><main data-testid="pairwise-result"><p data-testid="pairwise-subject">${html(subject)}</p></main></body></html>`
      );
  });

  app.get('/jwt-userinfo/login', async (req, res) => {
    const configuration = await getOidcConfiguration(JWT_USERINFO_CLIENT_ID);
    const session = requireSession(req, res).value;
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    session.jwtUserinfoTransaction = { codeVerifier, nonce, state };

    const url = buildAuthorizationUrl(configuration, {
      client_id: JWT_USERINFO_CLIENT_ID,
      redirect_uri: `${RP_ORIGIN}/jwt-userinfo/callback`,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(url.href);
  });

  app.get('/jwt-userinfo/callback', async (req, res) => {
    const configuration = await getOidcConfiguration(JWT_USERINFO_CLIENT_ID);
    const session = getSession(req)?.value;
    const transaction = session?.jwtUserinfoTransaction;
    if (!transaction) {
      res.status(400).send('Missing JWT UserInfo authorization transaction');
      return;
    }

    delete session.jwtUserinfoTransaction;
    const tokens = await authorizationCodeGrant(
      configuration,
      new URL(req.originalUrl, RP_ORIGIN),
      {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
      }
    );
    const idTokenClaims = tokens.claims();
    if (!tokens.access_token || !idTokenClaims?.sub) {
      throw new Error(
        'JWT UserInfo authorization did not return required tokens'
      );
    }

    const metadata = configuration.serverMetadata();
    if (!metadata.userinfo_endpoint || !metadata.jwks_uri) {
      throw new Error('JWT UserInfo endpoints are missing from discovery');
    }
    const response = await oidcFetch(metadata.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const compactJwt = await response.text();
    if (!response.ok) {
      throw new Error(
        `JWT UserInfo request failed (${response.status}): ${compactJwt}`
      );
    }

    const jwks = await oidcFetch(metadata.jwks_uri).then(jwksResponse =>
      jwksResponse.json()
    );
    const { payload, protectedHeader } = await jwtVerify(
      compactJwt,
      createLocalJWKSet(jwks),
      {
        issuer: ISSUER,
        audience: JWT_USERINFO_CLIENT_ID,
      }
    );

    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>JWT UserInfo</title></head><body><main data-testid="jwt-userinfo-result"><p data-testid="jwt-userinfo-content-type">${html(contentType)}</p><p data-testid="jwt-userinfo-alg">${html(protectedHeader.alg)}</p><p data-testid="jwt-userinfo-subject-match">${payload.sub === idTokenClaims.sub ? 'yes' : 'no'}</p><p data-testid="jwt-userinfo-email">${html(payload.email)}</p></main></body></html>`
      );
  });

  app.get('/implicit/login', async (req, res) => {
    const configuration = await getOidcConfiguration(IMPLICIT_CLIENT_ID, {}, [
      useIdTokenResponseType,
    ]);
    const session = requireSession(req, res).value;
    const state = randomState();
    const nonce = randomNonce();
    session.implicitTransaction = { nonce, state };

    const url = buildAuthorizationUrl(configuration, {
      client_id: IMPLICIT_CLIENT_ID,
      redirect_uri: `${RP_ORIGIN}/implicit/callback`,
      response_type: 'id_token',
      scope: 'openid profile email',
      state,
      nonce,
    });
    res.redirect(url.href);
  });

  app.get('/implicit/callback', (_req, res) => {
    res.type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ID token callback</title></head><body><main>Validating response</main><script>
      const response = new URLSearchParams({ response: location.hash.slice(1) });
      location.replace('/implicit/complete?' + response.toString());
    </script></body></html>`);
  });

  app.get('/implicit/complete', async (req, res) => {
    const session = getSession(req)?.value;
    const transaction = session?.implicitTransaction;
    const response =
      typeof req.query.response === 'string' ? req.query.response : undefined;
    if (!transaction || !response) {
      res.status(400).send('Missing ID-token authorization transaction');
      return;
    }

    delete session.implicitTransaction;
    const configuration = await getOidcConfiguration(IMPLICIT_CLIENT_ID, {}, [
      useIdTokenResponseType,
    ]);
    const callbackUrl = new URL(`${RP_ORIGIN}/implicit/callback`);
    callbackUrl.hash = response;
    const claims = await implicitAuthentication(
      configuration,
      callbackUrl,
      transaction.nonce,
      { expectedState: transaction.state }
    );
    const parameters = new URLSearchParams(response);

    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ID token result</title></head><body><main data-testid="implicit-result"><p data-testid="implicit-subject">${html(claims.sub)}</p><p data-testid="implicit-access-token">${parameters.has('access_token') ? 'present' : 'absent'}</p></main></body></html>`
      );
  });

  app.get('/hybrid/login', async (req, res) => {
    const configuration = await getOidcConfiguration(HYBRID_CLIENT_ID, {}, [
      useCodeIdTokenResponseType,
    ]);
    const session = requireSession(req, res).value;
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    session.hybridTransaction = { codeVerifier, nonce, state };

    const url = buildAuthorizationUrl(configuration, {
      client_id: HYBRID_CLIENT_ID,
      redirect_uri: `${RP_ORIGIN}/hybrid/callback`,
      response_type: 'code id_token',
      scope: 'openid profile email',
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(url.href);
  });

  app.get('/hybrid/callback', (_req, res) => {
    res.type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hybrid callback</title></head><body><main>Validating response</main><script>
      const response = new URLSearchParams({ response: location.hash.slice(1) });
      location.replace('/hybrid/complete?' + response.toString());
    </script></body></html>`);
  });

  app.get('/hybrid/complete', async (req, res) => {
    const session = getSession(req)?.value;
    const transaction = session?.hybridTransaction;
    const response =
      typeof req.query.response === 'string' ? req.query.response : undefined;
    if (!transaction || !response) {
      res.status(400).send('Missing hybrid authorization transaction');
      return;
    }

    delete session.hybridTransaction;
    const configuration = await getOidcConfiguration(HYBRID_CLIENT_ID, {}, [
      useCodeIdTokenResponseType,
    ]);
    const callbackUrl = new URL(`${RP_ORIGIN}/hybrid/callback`);
    callbackUrl.hash = response;
    const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
    });
    const claims = tokens.claims();
    if (!tokens.access_token || !tokens.id_token || !claims?.sub) {
      throw new Error('Hybrid response did not return required OIDC tokens');
    }

    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hybrid result</title></head><body><main data-testid="hybrid-result"><p data-testid="hybrid-subject">${html(claims.sub)}</p><p data-testid="hybrid-access-token">present</p><p data-testid="hybrid-id-token">present</p></main></body></html>`
      );
  });

  app.get('/device/start', async (_req, res) => {
    const configuration = await getOidcConfiguration(DEVICE_CLIENT_ID);
    const authorization = await initiateDeviceAuthorization(configuration, {
      scope: 'openid profile email',
    });
    const id = randomUUID();
    const state = { authorization };
    deviceAuthorizations.set(id, state);

    void pollDeviceAuthorizationGrant(configuration, authorization)
      .then(tokens => {
        state.tokens = tokens;
      })
      .catch(error => {
        state.error = error instanceof Error ? error.message : String(error);
      });

    res.type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Device authorization</title></head><body>
      <main data-testid="device-pending"><h1>Authorize device</h1>
      <p data-testid="device-user-code">${html(authorization.user_code)}</p>
      <a data-testid="device-verification" href="${html(authorization.verification_uri_complete ?? authorization.verification_uri)}">Verify device</a>
      <a data-testid="device-status" href="/device/status/${id}">Check status</a></main></body></html>`);
  });

  app.get('/device/status/:id', (req, res) => {
    const state = deviceAuthorizations.get(req.params.id);
    if (!state) {
      res.status(404).send('Unknown device authorization');
      return;
    }

    if (state.error) {
      res
        .status(500)
        .type('html')
        .send(`<main data-testid="device-error">${html(state.error)}</main>`);
      return;
    }

    if (!state.tokens) {
      res
        .type('html')
        .send(
          '<main data-testid="device-polling">Authorization pending</main>'
        );
      return;
    }

    res.type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Device authorized</title></head><body>
      <main data-testid="device-authorized"><h1>Device authorized</h1>
      <p data-testid="device-access-token">${state.tokens.access_token ? 'present' : 'missing'}</p>
      <p data-testid="device-id-token">${state.tokens.id_token ? 'present' : 'missing'}</p></main></body></html>`);
  });

  app.get('/callback', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = getSession(req)?.value;
    if (typeof req.query.error === 'string') {
      if (session) delete session.transaction;
      res.type('html')
        .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorization denied</title></head><body>
        <main data-testid="rp-authorization-error"><h1>Authorization failed</h1>
        <p data-testid="rp-authorization-error-code">${html(req.query.error)}</p></main></body></html>`);
      return;
    }
    if (!session?.transaction) {
      res.status(400).send('Missing authorization transaction');
      return;
    }

    const { codeVerifier, state, nonce } = session.transaction;
    delete session.transaction;
    const callbackUrl = new URL(req.originalUrl, RP_ORIGIN);
    const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
    });
    const claims = tokens.claims();
    if (!tokens.access_token || !tokens.id_token || !claims?.sub) {
      throw new Error(
        'Authorization response did not contain required OIDC tokens'
      );
    }
    session.idToken = tokens.id_token;
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.replayTransaction = { callbackUrl, codeVerifier, state, nonce };
    session.userInfo = await fetchUserInfo(
      configuration,
      tokens.access_token,
      claims.sub
    );
    res.redirect('/');
  });

  app.get('/replay-code', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = getSession(req)?.value;
    if (!session?.replayTransaction) {
      res.status(400).send('Missing consumed authorization transaction');
      return;
    }

    const { callbackUrl, codeVerifier, state, nonce } =
      session.replayTransaction;
    try {
      await authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      res.status(500).send('Authorization code replay unexpectedly succeeded');
    } catch (error) {
      if (error?.error !== 'invalid_grant') throw error;
      session.codeReplayRejected = true;
      res.redirect('/');
    }
  });

  app.get('/refresh', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = getSession(req)?.value;
    if (!session?.refreshToken) {
      res.status(400).send('Missing refresh token');
      return;
    }

    const previousRefreshToken = session.refreshToken;
    const tokens = await refreshTokenGrant(configuration, previousRefreshToken);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Refresh grant did not return rotated tokens');
    }
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.previousRefreshToken = previousRefreshToken;
    session.refreshRotated = tokens.refresh_token !== previousRefreshToken;
    session.refreshReplayRejected = false;
    session.tokenActive = undefined;
    res.redirect('/');
  });

  app.get('/replay-refresh', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = getSession(req)?.value;
    if (!session?.previousRefreshToken) {
      res.status(400).send('Missing consumed refresh token');
      return;
    }

    try {
      await refreshTokenGrant(configuration, session.previousRefreshToken);
      res.status(500).send('Refresh token replay unexpectedly succeeded');
    } catch (error) {
      if (error?.error !== 'invalid_grant') throw error;
      session.refreshReplayRejected = true;
      session.tokenActive = undefined;
      res.redirect('/');
    }
  });

  app.get('/introspect', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = getSession(req)?.value;
    if (!session?.accessToken) {
      res.status(400).send('Missing access token');
      return;
    }

    const result = await tokenIntrospection(configuration, session.accessToken);
    session.tokenActive = result.active;
    res.redirect('/');
  });

  app.get('/revoke', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const session = getSession(req)?.value;
    if (!session?.accessToken) {
      res.status(400).send('Missing access token');
      return;
    }

    await tokenRevocation(configuration, session.accessToken, {
      token_type_hint: 'access_token',
    });
    const result = await tokenIntrospection(configuration, session.accessToken);
    session.tokenActive = result.active;
    res.redirect('/');
  });

  app.get('/logout', async (req, res) => {
    const configuration = await getOidcConfiguration();
    const local = getSession(req);
    if (!local?.value?.idToken) {
      res.redirect('/');
      return;
    }

    const state = randomState();
    logoutStates.add(state);
    const url = buildEndSessionUrl(configuration, {
      id_token_hint: local.value.idToken,
      post_logout_redirect_uri: `${RP_ORIGIN}/`,
      state,
    });
    sessions.delete(local.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect(url.href);
  });

  app.use((error, _req, res, _next) => {
    void _next;
    console.error('[E2E RP]', error);
    res.status(500).send('Temporary RP request failed');
  });

  rpServer = createServer(app);
  rpServer.listen(19010, '127.0.0.1');
  await once(rpServer, 'listening');
}

async function stop() {
  if (stopping) return;
  stopping = true;

  if (rpServer?.listening) {
    rpServer.close();
    await once(rpServer, 'close');
  }
  if (parako && parako.exitCode === null) {
    parako.kill('SIGTERM');
    await Promise.race([
      once(parako, 'exit'),
      new Promise(resolve => setTimeout(resolve, 10_000)),
    ]);
    if (parako.exitCode === null) parako.kill('SIGKILL');
  }
  await smtpCapture?.close();
  if (mongoFixture) {
    await mongoFixture.client.close();
    await mongoFixture.server.stop();
  }
  await postgresqlFixture?.drop();
  await oidcFetch.close?.();
  if (runtimeRoot) {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
}

async function main() {
  const storageAdapter = process.env.PARAKO_E2E_STORAGE_ADAPTER ?? 'sqlite';
  if (!['sqlite', 'mongodb', 'postgresql'].includes(storageAdapter)) {
    throw new Error(`Unsupported E2E storage adapter: ${storageAdapter}`);
  }
  const multiTenancy = process.env.PARAKO_E2E_MULTI_TENANCY === 'true';
  const tenantId = multiTenancy
    ? (process.env.PARAKO_E2E_TENANT_ID ?? 'browser-e2e')
    : 'default';
  const webauthnEnabled = process.env.PARAKO_E2E_WEBAUTHN === 'true';
  const smsEnabled = process.env.PARAKO_E2E_SMS === 'true';
  const registrationSmsEnabled =
    process.env.PARAKO_E2E_SMS_REGISTRATION === 'true';
  const securityQuestionsEnabled =
    process.env.PARAKO_E2E_SECURITY_QUESTIONS === 'true';
  const notificationPreferencesEnabled =
    process.env.PARAKO_E2E_NOTIFICATION_PREFERENCES !== 'false';
  const socialEnabled = process.env.PARAKO_E2E_SOCIAL === 'true';
  const socialExistingUserPolicy =
    process.env.PARAKO_E2E_SOCIAL_EXISTING_USER_POLICY ?? 'require_manual_link';
  const socialNoUserPolicy =
    process.env.PARAKO_E2E_SOCIAL_NO_USER_POLICY ?? 'allow_registration';
  const socialAllowMultiple =
    process.env.PARAKO_E2E_SOCIAL_ALLOW_MULTIPLE !== 'false';
  const socialMaxProviders = Number.parseInt(
    process.env.PARAKO_E2E_SOCIAL_MAX_PROVIDERS ?? '5',
    10
  );
  runtimeRoot = await fs.mkdtemp(path.join(tmpdir(), 'parako-browser-e2e-'));
  const databasePath = path.join(runtimeRoot, 'parako-e2e.db');
  const runtimeDirectory = path.join(runtimeRoot, 'runtime');
  await fs.mkdir(runtimeDirectory, { recursive: true });
  for (const directory of ['dist', 'public']) {
    await fs.symlink(
      path.join(PROJECT_ROOT, directory),
      path.join(runtimeRoot, directory),
      'dir'
    );
  }
  await fs.symlink(
    path.join(PROJECT_ROOT, 'package.json'),
    path.join(runtimeRoot, 'package.json'),
    'file'
  );
  await fs.symlink(
    path.join(PROJECT_ROOT, 'runtime/locales'),
    path.join(runtimeDirectory, 'locales'),
    'dir'
  );
  const clientFixtures = await applySqliteMigrations(databasePath);
  let fixtureStore;
  let storageEnvironment;
  if (storageAdapter === 'mongodb') {
    mongoFixture = await startMongoFixtureDatabase({
      clientFixtures,
      multiTenancy,
      tenantId,
    });
    fixtureStore = mongoFixture.fixtureStore;
    storageEnvironment = {
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: mongoFixture.uri,
      OIDC_STORAGE_ADAPTER: 'mongodb',
    };
  } else if (storageAdapter === 'postgresql') {
    const administrativeUrl = process.env.PARAKO_E2E_POSTGRESQL_URL;
    if (!administrativeUrl) {
      throw new Error(
        'PARAKO_E2E_POSTGRESQL_URL is required for PostgreSQL browser profiles'
      );
    }
    postgresqlFixture = await createPostgresqlTestDatabase(administrativeUrl);
    await applyPostgresqlMigrations(postgresqlFixture.databaseUrl);
    await seedPostgresqlFixtures(
      postgresqlFixture.databaseUrl,
      multiTenancy
        ? [{ slug: tenantId, display_name: 'Parako Browser E2E tenant' }]
        : [],
      clientFixtures.map(client => ({ tenantId, client }))
    );
    fixtureStore = new PostgresqlFixtureStore(
      postgresqlFixture.databaseUrl,
      tenantId
    );
    storageEnvironment = {
      STORAGE_ADAPTER: 'postgresql',
      STORAGE_POSTGRESQL_URL: postgresqlFixture.databaseUrl,
      DATABASE_URL: postgresqlFixture.databaseUrl,
      OIDC_STORAGE_ADAPTER: 'postgresql',
    };
  } else {
    fixtureStore = new SqliteFixtureStore(databasePath);
    storageEnvironment = {
      STORAGE_ADAPTER: 'sqlite',
      STORAGE_SQLITE_PATH: databasePath,
      OIDC_STORAGE_ADAPTER: 'sqlite',
    };
  }
  smtpCapture = new SmtpCaptureServer({
    host: '127.0.0.1',
    port: SMTP_PORT,
    username: SMTP_USERNAME,
    password: SMTP_PASSWORD,
  });
  await smtpCapture.start();
  await fs.writeFile(
    path.join(runtimeDirectory, 'parako.json'),
    `${JSON.stringify(
      {
        features: {
          oidc: { jwt_userinfo: { enabled: true } },
          social_providers: socialEnabled
            ? {
                enabled: ['github'],
                available: ['github'],
                behavior: {
                  existing_user_no_integration: socialExistingUserPolicy,
                  no_user_account: socialNoUserPolicy,
                  missing_contact_info: 'redirect_to_form',
                  require_password_on_registration: false,
                  options: {
                    allow_multiple_providers: socialAllowMultiple,
                    auto_verify_email: false,
                    show_helpful_errors: false,
                    max_providers_per_user: socialMaxProviders,
                  },
                },
                github: {
                  client_id: SOCIAL_CLIENT_ID,
                  client_secret: SOCIAL_CLIENT_SECRET,
                  authorization_endpoint: `${RP_ORIGIN}/fake-github/authorize`,
                  token_endpoint: `${RP_ORIGIN}/fake-github/token`,
                  userinfo_endpoint: `${RP_ORIGIN}/fake-github/user`,
                  scopes: ['read:user', 'user:email'],
                },
              }
            : undefined,
        },
        integrations: {
          email: {
            smtp_host: '127.0.0.1',
            smtp_port: SMTP_PORT,
            smtp_username: SMTP_USERNAME,
            smtp_password: SMTP_PASSWORD,
            from: 'no-reply@parako.test',
            tls_reject_unauthorized: false,
          },
        },
        notifications: {
          channels: {
            sms: {
              enabled: smsEnabled,
              provider: 'twilio',
              api_key: smsEnabled ? SMS_ACCOUNT_SID : '',
              api_secret: smsEnabled ? SMS_AUTH_TOKEN : '',
              from_number: smsEnabled ? SMS_FROM_NUMBER : '',
              rate_limits: {
                per_phone_per_hour: 10,
                per_ip_per_day: 20,
                cooldown_seconds: 1,
              },
            },
          },
          defaults: {
            security_alerts: true,
            new_session_alerts: true,
            allow_user_preferences: notificationPreferencesEnabled,
          },
        },
        security: {
          authentication: {
            signup: smsEnabled
              ? {
                  signup_methods: ['email', 'phone'],
                  require_email_verification: false,
                  require_phone_verification: registrationSmsEnabled,
                  contact_channels: {
                    require_at_least_one: true,
                    email: { enabled: true, required: true },
                    phone: { enabled: true, required: true },
                    full_name: { enabled: true, required: true },
                  },
                }
              : undefined,
            recovery: {
              security_questions: { enabled: securityQuestionsEnabled },
              sms: { enabled: smsEnabled },
            },
            multi_factor: {
              webauthn: {
                enabled: webauthnEnabled,
                rp_name: 'Parako Browser E2E',
                rp_id: new URL(IDP_ORIGIN).hostname,
                timeout: 60_000,
                attestation: 'none',
                user_verification: 'required',
                resident_key: 'preferred',
                max_credentials_per_user: 10,
              },
            },
          },
          protection: {
            rate_limiting: {
              enabled: true,
              requests_per_minute: 10_000,
              window_minutes: 1,
            },
          },
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  parako = spawn(
    process.execPath,
    [
      '--import',
      path.join(SUPPORT_DIR, 'mock-oidc-outbound.mjs'),
      '--import',
      path.join(SUPPORT_DIR, 'mock-twilio.mjs'),
      path.join(PROJECT_ROOT, 'dist/src/index.js'),
    ],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DEPLOYMENT_ENVIRONMENT: 'development',
        DEPLOYMENT_SERVER_PORT: '19007',
        DEPLOYMENT_URL: DEPLOYMENT_ORIGIN,
        ...storageEnvironment,
        FILE_STORAGE_PROVIDER: 'local',
        MULTI_TENANCY_ENABLED: String(multiTenancy),
        MULTI_TENANCY_EXTRACTION_PRIORITY: 'header,subdomain',
        MULTI_TENANCY_TENANT_HEADER: 'x-tenant-id',
        USE_FILE_CONFIG: 'true',
        ENCRYPTION_KEY: TEST_SECRET,
        JWT_SECRET: `jwt-${TEST_SECRET}`,
        COOKIE_SECRET_1: `cookie-one-${TEST_SECRET}`,
        COOKIE_SECRET_2: `cookie-two-${TEST_SECRET}`,
        HMAC_SECRET: `hmac-${TEST_SECRET}`,
        REDIS_HOST: '',
        PM2_INSTANCES: '1',
        PARAKO_ROOT: runtimeRoot,
        PARAKO_E2E_BACKCHANNEL_CAPTURE_URL: `${RP_ORIGIN}/backchannel-logout`,
        PARAKO_E2E_SMS_CAPTURE_URL: `${RP_ORIGIN}/sms/capture`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  parako.stdout.pipe(process.stdout);
  parako.stderr.pipe(process.stderr);

  await waitForReady(`${IDP_ORIGIN}/readyz`, parako);
  await startRp(fixtureStore, socialEnabled);
}

process.once('SIGINT', () => void stop().finally(() => process.exit(0)));
process.once('SIGTERM', () => void stop().finally(() => process.exit(0)));
process.once('uncaughtException', error => {
  console.error(error);
  void stop().finally(() => process.exit(1));
});
process.once('unhandledRejection', error => {
  console.error(error);
  void stop().finally(() => process.exit(1));
});

await main();
