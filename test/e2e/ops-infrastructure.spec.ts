import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { Redis } from 'ioredis';

import { createHmacState } from '../../src/utils/hmac-state.js';
import {
  expectNoBrowserFailures,
  observeBrowserFailures,
  type BrowserFailures,
} from './support/browser-failures.js';
import { IDP_ORIGIN } from './support/management-api.js';

// gitleaks:allow -- deterministic HMAC key for an isolated local E2E gateway.
const TEST_HMAC_SECRET = 'parako-browser-e2e-ops-hmac-secret';
const REDIS_HOST = process.env.PARAKO_E2E_REDIS_HOST ?? '127.0.0.1';
const REDIS_PORT = Number(process.env.PARAKO_E2E_REDIS_PORT ?? '6379');
const REDIS_DATABASE = Number(process.env.PARAKO_E2E_REDIS_DATABASE ?? '15');

function isMultiTenant(): boolean {
  return process.env.PARAKO_E2E_MULTI_TENANCY === 'true';
}

function systemOrigin(tenantId: '_ops'): URL {
  const origin = new URL(IDP_ORIGIN);
  origin.hostname = `${tenantId}.idp.localhost`;
  return origin;
}

async function requestSystemTenant(
  request: APIRequestContext,
  path: string,
  options: { method?: 'GET' | 'POST'; maxRedirects?: number } = {}
) {
  const tenantOrigin = systemOrigin('_ops');
  const loopback = new URL(path, tenantOrigin);
  loopback.hostname = '127.0.0.1';
  return request.fetch(loopback.href, {
    method: options.method ?? 'GET',
    ...(options.maxRedirects === undefined
      ? {}
      : { maxRedirects: options.maxRedirects }),
    headers: { host: tenantOrigin.host },
  });
}

async function acknowledgeExpectedConsoleHttpError(
  failures: BrowserFailures,
  status: number
): Promise<void> {
  await expect
    .poll(() => failures.consoleErrors)
    .toEqual([
      expect.stringContaining(`server responded with a status of ${status}`),
    ]);
  failures.consoleErrors.length = 0;
}

async function expectJsonDocument(
  page: Page,
  url: string,
  status: number,
  expected: Record<string, unknown>
): Promise<void> {
  const response = await page.goto(url);
  expect(response?.status()).toBe(status);
  expect(response?.headers()['content-type']).toContain('application/json');
  await expect
    .poll(async () => JSON.parse(await page.locator('body').innerText()))
    .toEqual(expected);
}

test('the _ops host exposes only the stateless operational gateway', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const opsOrigin = systemOrigin('_ops');

  if (!isMultiTenant()) {
    const response = await page.goto(`${opsOrigin.origin}/metrics`);
    expect(response?.status()).toBe(404);
    expect(response?.headers()['content-type']).toContain('text/html');
    await expect(page.getByText('Not Found', { exact: false })).toBeVisible();
    await acknowledgeExpectedConsoleHttpError(failures, 404);
    expectNoBrowserFailures(failures);
    return;
  }

  await expectJsonDocument(page, `${opsOrigin.origin}/metrics`, 200, {
    status: 'ok',
    message: 'Metrics endpoint',
  });
  // The stateless gateway deliberately blocks Chromium's automatic favicon
  // request rather than exposing the regular tenant's static-asset surface.
  await acknowledgeExpectedConsoleHttpError(failures, 404);
  await expectJsonDocument(page, `${opsOrigin.origin}/auth/login`, 404, {
    error: 'Not found',
  });
  await acknowledgeExpectedConsoleHttpError(failures, 404);

  const methodDenied = await requestSystemTenant(request, '/metrics', {
    method: 'POST',
  });
  expect(methodDenied.status()).toBe(405);
  expect(await methodDenied.json()).toEqual({ error: 'Method not allowed' });

  const regularMetrics = await page.goto(`${IDP_ORIGIN}/metrics`);
  expect(regularMetrics?.status()).toBe(404);
  expect(regularMetrics?.headers()['content-type']).toContain('text/html');
  await acknowledgeExpectedConsoleHttpError(failures, 404);
  expectNoBrowserFailures(failures);
});

test('the compiled _ops callback relays one signed code through Redis', async ({
  request,
}) => {
  if (!isMultiTenant()) {
    const unavailable = await requestSystemTenant(
      request,
      '/social/google/callback?code=single-tenant&state=unused',
      { maxRedirects: 0 }
    );
    expect(unavailable.status()).toBe(404);
    expect(unavailable.headers()['content-type']).toContain('text/html');
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const tenantId = `ops-browser-${suffix}`;
  const code = `authorization-code-${suffix}`;
  const state = createHmacState(
    { tenant_id: tenantId, nonce: randomUUID(), timestamp: Date.now() },
    TEST_HMAC_SECRET
  );
  const callback = new URL('/social/google/callback', systemOrigin('_ops'));
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);

  const response = await requestSystemTenant(
    request,
    callback.pathname + callback.search,
    { maxRedirects: 0 }
  );
  expect(response.status()).toBe(302);
  const redirect = new URL(response.headers().location!);
  const ref = redirect.searchParams.get('ref');
  expect(redirect.hostname).toBe(`${tenantId}.idp.localhost`);
  expect(redirect.pathname).toBe('/auth/social/google/complete');
  expect(ref).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );

  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    db: REDIS_DATABASE,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  const key = `social:ref:${ref}`;
  try {
    await redis.connect();
    expect(JSON.parse((await redis.get(key))!)).toMatchObject({
      provider: 'google',
      code,
      tenant_id: tenantId,
    });
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(120);
  } finally {
    await redis.del(key);
    await redis.quit();
  }

  const invalid = await requestSystemTenant(
    request,
    '/social/google/callback?code=sensitive-code&state=invalid-state',
    { maxRedirects: 0 }
  );
  expect(invalid.status()).toBe(400);
  const invalidPayload = await invalid.json();
  expect(invalidPayload).toEqual({
    error: expect.stringMatching(/^Invalid state:/),
  });
  expect(JSON.stringify(invalidPayload)).not.toContain('sensitive-code');
});
