import { expect, test } from '@playwright/test';

import {
  apiRequest,
  issueManagementToken,
  readApiJson,
} from './support/management-api.js';

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
  expires_at: string;
  max_usage_count: number;
  current_usage_count: number;
  policies: string[];
  note?: string;
}

const OPERATION_SCOPES = [
  'parako:jwks:read',
  'parako:jwks:rotate',
  'parako:audit:read',
  'parako:stats:read',
  'parako:registration-tokens:read',
  'parako:registration-tokens:write',
  'parako:registration-tokens:delete',
].join(' ');

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

test.describe('Management API operational domains', () => {
  test('enforces authentication and domain scopes', async () => {
    for (const path of ['/jwks', '/audit', '/stats', '/registration-tokens']) {
      const response = await apiRequest(path);
      expect(response.status, path).toBe(401);
      expect(response.headers.get('content-type')).toContain(
        'application/problem+json'
      );
    }

    const usersToken = await issueManagementToken('parako:users:read');
    for (const path of ['/jwks', '/audit', '/stats', '/registration-tokens']) {
      const response = await apiRequest(path, { token: usersToken });
      expect(response.status, path).toBe(403);
      expect(response.headers.get('content-type')).toContain(
        'application/problem+json'
      );
    }
  });

  test('covers all JWKS lifecycle operations without exposing private keys', async () => {
    const token = await issueManagementToken(OPERATION_SCOPES);

    const invalid = await apiRequest('/jwks?status=unknown', { token });
    expect(invalid.status).toBe(422);

    const initialResponse = await apiRequest('/jwks', { token });
    expect(initialResponse.status).toBe(200);
    const initial = (
      await readApiJson<ApiEnvelope<PublicJwkRecord[]>>(initialResponse)
    ).data;
    expect(initial.length).toBeGreaterThan(0);
    initial.forEach(expectPublicOnlyKey);

    const first = initial[0]!;
    const get = await apiRequest(`/jwks/${encodeURIComponent(first.kid)}`, {
      token,
    });
    expect(get.status).toBe(200);
    expectPublicOnlyKey(
      (await readApiJson<ApiEnvelope<PublicJwkRecord>>(get)).data
    );

    const rotate = await apiRequest('/jwks/rotate', {
      method: 'POST',
      token,
    });
    expect(rotate.status).toBe(200);
    expect(
      await readApiJson<ApiEnvelope<Record<string, unknown>>>(rotate)
    ).toMatchObject({ data: { message: 'Keys rotated successfully' } });

    const afterRotation = (
      await readApiJson<ApiEnvelope<PublicJwkRecord[]>>(
        await apiRequest('/jwks', { token })
      )
    ).data;
    expect(afterRotation.length).toBeGreaterThan(initial.length);
    afterRotation.forEach(expectPublicOnlyKey);

    const retireCandidate =
      afterRotation.find(key => key.status === 'expiring') ??
      afterRotation.find(
        key =>
          key.status === 'active' &&
          afterRotation.some(
            candidate =>
              candidate.kid !== key.kid &&
              candidate.status === 'active' &&
              candidate.promoted
          )
      );
    expect(retireCandidate).toBeDefined();

    const retire = await apiRequest(
      `/jwks/${encodeURIComponent(retireCandidate!.kid)}`,
      { method: 'DELETE', token }
    );
    expect(retire.status).toBe(202);

    const retired = await apiRequest(
      `/jwks/${encodeURIComponent(retireCandidate!.kid)}`,
      { token }
    );
    expect(retired.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<PublicJwkRecord>>(retired)).data.status
    ).toBe('retired');

    const duplicateRetire = await apiRequest(
      `/jwks/${encodeURIComponent(retireCandidate!.kid)}`,
      { method: 'DELETE', token }
    );
    expect(duplicateRetire.status).toBe(409);

    const retireExpired = await apiRequest('/jwks/retire-expired', {
      method: 'POST',
      token,
    });
    expect(retireExpired.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<{ retired: number }>>(retireExpired)).data
        .retired
    ).toEqual(expect.any(Number));

    const missing = await apiRequest('/jwks/missing-e2e-kid', { token });
    expect(missing.status).toBe(404);
  });

  test('covers registration-token creation, redaction, lookup, and revocation', async () => {
    const token = await issueManagementToken(OPERATION_SCOPES);

    const invalid = await apiRequest('/registration-tokens', {
      method: 'POST',
      token,
      body: JSON.stringify({ expires_in: 10, max_usage_count: 0 }),
    });
    expect(invalid.status).toBe(422);

    const note = `E2E registration token ${Date.now()}`;
    const create = await apiRequest('/registration-tokens', {
      method: 'POST',
      token,
      body: JSON.stringify({
        expires_in: 300,
        max_usage_count: 2,
        policies: ['general-policy'],
        note,
      }),
    });
    expect(create.status).toBe(201);
    const created = (
      await readApiJson<ApiEnvelope<RegistrationTokenRecord>>(create)
    ).data;
    expect(created).toMatchObject({
      jti: expect.any(String),
      token: expect.any(String),
      max_usage_count: 2,
      current_usage_count: 0,
      policies: ['general-policy'],
      note,
    });

    const path = `/registration-tokens/${encodeURIComponent(created.jti)}`;
    const list = await apiRequest('/registration-tokens', { token });
    expect(list.status).toBe(200);
    const listed = await readApiJson<ApiList<RegistrationTokenRecord>>(list);
    const listedToken = listed.data.find(item => item.jti === created.jti);
    expect(listedToken).toMatchObject({ note, max_usage_count: 2 });
    expect(listedToken).not.toHaveProperty('token');

    const get = await apiRequest(path, { token });
    expect(get.status).toBe(200);
    const fetched = (
      await readApiJson<ApiEnvelope<RegistrationTokenRecord>>(get)
    ).data;
    expect(fetched).toMatchObject({ jti: created.jti, note });
    expect(fetched).not.toHaveProperty('token');

    const destroy = await apiRequest(path, { method: 'DELETE', token });
    expect(destroy.status).toBe(204);
    expect(await destroy.text()).toBe('');

    const missing = await apiRequest(path, { token });
    expect(missing.status).toBe(404);
  });

  test('queries audit records and aggregate operational statistics', async () => {
    const token = await issueManagementToken(OPERATION_SCOPES);

    const invalidRange = await apiRequest(
      `/audit?from=${encodeURIComponent('2026-08-09T10:00:00Z')}&to=${encodeURIComponent('2026-08-08T10:00:00Z')}`,
      { token }
    );
    expect(invalidRange.status).toBe(422);

    let auditList: ApiList<Record<string, unknown>> | undefined;
    await expect
      .poll(
        async () => {
          const response = await apiRequest('/audit?include_count=true', {
            token,
          });
          if (!response.ok) return -1;
          auditList =
            await readApiJson<ApiList<Record<string, unknown>>>(response);
          return auditList.data.length;
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0);

    expect(auditList!.pagination.total_count).toEqual(expect.any(Number));
    const entry = auditList!.data[0]!;
    const entryId = String(entry.id ?? entry._id ?? '');
    expect(entryId).not.toBe('');

    const get = await apiRequest(`/audit/${encodeURIComponent(entryId)}`, {
      token,
    });
    expect(get.status).toBe(200);

    const types = await apiRequest('/audit/types', { token });
    expect(types.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<string[]>>(types)).data.length
    ).toBeGreaterThan(0);

    const auditStats = await apiRequest('/audit/stats', { token });
    expect(auditStats.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<Record<string, number>>>(auditStats)).data
    ).toMatchObject({ totalActivities: expect.any(Number) });

    const missing = await apiRequest('/audit/missing-e2e-audit', { token });
    expect(missing.status).toBe(404);

    const overview = await apiRequest('/stats', { token });
    expect(overview.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<Record<string, unknown>>>(overview)).data
    ).toMatchObject({
      users: expect.any(Object),
      clients: expect.any(Object),
      sessions: expect.any(Object),
      grants: expect.any(Object),
      activity: expect.any(Object),
    });

    const health = await apiRequest('/stats/health', { token });
    expect(health.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<Record<string, unknown>>>(health)).data
    ).toMatchObject({
      status: 'healthy',
      checks: {
        database: { status: 'healthy' },
        oidc: { status: 'healthy' },
        config: { status: 'healthy' },
      },
    });
  });
});
