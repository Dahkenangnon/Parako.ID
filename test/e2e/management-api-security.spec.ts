import { expect, test } from '@playwright/test';
import { decodeJwt } from 'jose';

import {
  apiRequest,
  issueClientCredentialsToken,
  issueManagementToken,
  MANAGEMENT_API_RESOURCE,
  readApiJson,
} from './support/management-api.js';
import { MANAGEMENT_API_SECURED_OPERATIONS } from './support/management-api-security.js';

type ProblemDetail = {
  type: string;
  status: number;
  required_scopes?: string[];
};
type AuditRecord = {
  type?: string;
  client_id?: string;
  actor?: { actor_type?: string };
  target?: {
    target_type?: string;
    entity_name?: string;
    entity_data?: Record<string, unknown>;
  };
};
type AuditList = {
  data: AuditRecord[];
};

const WRONG_AUDIENCE_CLIENT_ID = 'parako-browser-e2e-wrong-audience';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const WRONG_AUDIENCE_CLIENT_SECRET = 'parako-browser-e2e-wrong-audience-secret';
const WRONG_AUDIENCE_RESOURCE =
  'urn:resource:parako-browser-e2e-wrong-audience';
const EXPIRING_CLIENT_ID = 'parako-browser-e2e-expiring-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const EXPIRING_CLIENT_SECRET = 'parako-browser-e2e-expiring-m2m-secret';
const RATE_LIMIT_CLIENT_ID = 'parako-browser-e2e-rate-limit-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const RATE_LIMIT_CLIENT_SECRET = 'parako-browser-e2e-rate-limit-m2m-secret';

const operations = MANAGEMENT_API_SECURED_OPERATIONS;

let statsToken: string;
let usersToken: string;

test.beforeAll(async () => {
  [statsToken, usersToken] = await Promise.all([
    issueManagementToken('parako:stats:read'),
    issueManagementToken('parako:users:read'),
  ]);
});

test.describe('Management API operation security matrix', () => {
  for (const [label, method, path, requiredScope] of operations) {
    test(`${label} rejects missing and insufficient credentials`, async () => {
      const missing = await apiRequest(path, { method });
      expect(missing.status).toBe(401);
      expect(missing.headers.get('content-type')).toContain(
        'application/problem+json'
      );
      expect(await readApiJson<ProblemDetail>(missing)).toMatchObject({
        type: 'urn:parako:error:unauthorized',
        status: 401,
      });

      const irrelevantToken =
        requiredScope === 'parako:stats:read' ? usersToken : statsToken;
      const insufficient = await apiRequest(path, {
        method,
        token: irrelevantToken,
      });
      expect(insufficient.status).toBe(403);
      expect(insufficient.headers.get('content-type')).toContain(
        'application/problem+json'
      );
      expect(await readApiJson<ProblemDetail>(insufficient)).toMatchObject({
        type: 'urn:parako:error:scope-insufficient',
        status: 403,
        required_scopes: [requiredScope],
      });
    });
  }

  test('rejects malformed, wrong-audience, and expired bearer tokens', async () => {
    const malformed = await apiRequest('/stats', { token: 'not-a-jwt' });
    expect(malformed.status).toBe(401);
    expect(malformed.headers.get('www-authenticate')).toContain(
      'error="invalid_token"'
    );
    expect(await readApiJson<ProblemDetail>(malformed)).toMatchObject({
      type: 'urn:parako:error:token-invalid',
      status: 401,
    });

    const wrongAudienceToken = await issueClientCredentialsToken({
      clientId: WRONG_AUDIENCE_CLIENT_ID,
      clientSecret: WRONG_AUDIENCE_CLIENT_SECRET,
      resource: WRONG_AUDIENCE_RESOURCE,
      scope: 'profile',
    });
    const wrongAudience = await apiRequest('/stats', {
      token: wrongAudienceToken,
    });
    expect(wrongAudience.status).toBe(401);
    expect(await readApiJson<ProblemDetail>(wrongAudience)).toMatchObject({
      type: 'urn:parako:error:token-invalid',
      status: 401,
    });

    const expiringToken = await issueClientCredentialsToken({
      clientId: EXPIRING_CLIENT_ID,
      clientSecret: EXPIRING_CLIENT_SECRET,
      resource: MANAGEMENT_API_RESOURCE,
      scope: 'parako:stats:read',
    });
    const expiringClaims = decodeJwt(expiringToken);
    expect(expiringClaims.exp! - expiringClaims.iat!).toBe(1);
    // The API intentionally tolerates 30 seconds of clock skew. Waiting past
    // that tolerance validates the real verifier's expired-token branch.
    await new Promise(resolve => setTimeout(resolve, 32_000));

    const expired = await apiRequest('/stats', { token: expiringToken });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('www-authenticate')).toContain(
      'error="invalid_token"'
    );
    expect(await readApiJson<ProblemDetail>(expired)).toMatchObject({
      type: 'urn:parako:error:token-expired',
      status: 401,
    });
  });

  test('rate-limits sensitive operations and records their audit outcome', async () => {
    const token = await issueClientCredentialsToken({
      clientId: RATE_LIMIT_CLIENT_ID,
      clientSecret: RATE_LIMIT_CLIENT_SECRET,
      resource: MANAGEMENT_API_RESOURCE,
      scope: 'parako:clients:write',
    });
    const path = '/clients/missing-rate-limit-target/secret';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await apiRequest(path, { method: 'POST', token });
      expect(response.status).toBe(404);
    }

    const limited = await apiRequest(path, { method: 'POST', token });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('content-type')).toContain(
      'application/problem+json'
    );
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await readApiJson<ProblemDetail>(limited)).toMatchObject({
      type: 'urn:parako:error:rate-limit-exceeded',
      status: 429,
    });

    const auditToken = await issueManagementToken('parako:audit:read');
    let records: AuditRecord[] = [];
    await expect
      .poll(
        async () => {
          const response = await apiRequest(
            `/audit?client_id=${encodeURIComponent(RATE_LIMIT_CLIENT_ID)}`,
            { token: auditToken }
          );
          if (!response.ok) return false;
          records = (await readApiJson<AuditList>(response)).data;
          return records.some(
            record => record.target?.entity_data?.status_code === 429
          );
        },
        { timeout: 10_000 }
      )
      .toBe(true);

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'api_request',
          client_id: RATE_LIMIT_CLIENT_ID,
          actor: expect.objectContaining({
            actor_type: 'service',
          }),
          target: expect.objectContaining({
            target_type: 'system',
            entity_name: 'management_api_request',
            entity_data: expect.objectContaining({
              method: 'POST',
              path: '/clients/missing-rate-limit-target/secret',
              status_code: 429,
              completion: 'finished',
            }),
          }),
        }),
      ])
    );
  });
});
