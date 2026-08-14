import { expect, test, type Browser } from '@playwright/test';

import { observeBrowserFailures } from './support/browser-failures.js';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import {
  startMongoMultiTenantParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';

const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const BASE_DOMAIN = 'parako.localhost';
const HEADER_TENANT = 'header-tenant';
const CUSTOM_TENANT = 'custom-tenant';
const COLLIDING_SLUG = 'vanity';
const CUSTOM_HOST = `vanity.${BASE_DOMAIN}`;
const SUSPENDED_HOST = `paused.${BASE_DOMAIN}`;
const UNKNOWN_HOST = `missing.${BASE_DOMAIN}`;

function tenantFixtures(port: number) {
  return [
    {
      slug: HEADER_TENANT,
      display_name: 'Header tenant',
      issuer_url: `http://${HEADER_TENANT}.${BASE_DOMAIN}:${port}/oidc/v1`,
    },
    {
      slug: CUSTOM_TENANT,
      display_name: 'Custom domain tenant',
      domain: CUSTOM_HOST,
      issuer_url: `http://${CUSTOM_HOST}:${port}/oidc/v1`,
    },
    {
      slug: COLLIDING_SLUG,
      display_name: 'Colliding subdomain tenant',
      issuer_url: `http://${COLLIDING_SLUG}.${BASE_DOMAIN}:${port}/oidc/v1`,
    },
    {
      slug: 'suspended-custom',
      display_name: 'Suspended custom domain tenant',
      domain: SUSPENDED_HOST,
      issuer_url: `http://${SUSPENDED_HOST}:${port}/oidc/v1`,
      status: 'suspended' as const,
    },
  ];
}

async function discoveryIssuer(
  browser: Browser,
  url: string,
  headers?: Record<string, string>
): Promise<string> {
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  try {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    const document = JSON.parse(await page.locator('body').innerText()) as {
      issuer: string;
    };
    // Chromium asks for /favicon.ico when it renders a raw JSON document. The
    // application intentionally exposes /favicon.png to HTML pages instead.
    expect(failures.failedAssets).toEqual([]);
    expect(failures.failedRequests).toEqual([]);
    expect(failures.pageErrors).toEqual([]);
    expect(failures.consoleErrors.length).toBeLessThanOrEqual(1);
    expect(
      failures.consoleErrors.every(
        message =>
          message ===
          'Failed to load resource: the server responded with a status of 404 (Not Found)'
      )
    ).toBe(true);
    return document.issuer;
  } finally {
    await context.close();
  }
}

async function runTenantResolutionScenario(
  browser: Browser,
  port: number
): Promise<void> {
  const discoveryPath = '/oidc/v1/.well-known/openid-configuration';
  const customOrigin = `http://${CUSTOM_HOST}:${port}`;

  // Exact custom-domain ownership wins over a tenant whose slug happens to
  // match the first hostname label.
  await expect(
    discoveryIssuer(browser, `${customOrigin}${discoveryPath}`)
  ).resolves.toBe(`${customOrigin}/oidc/v1`);

  // The configured header remains the first extraction strategy.
  await expect(
    discoveryIssuer(browser, `${customOrigin}${discoveryPath}`, {
      'x-tenant-id': HEADER_TENANT,
    })
  ).resolves.toBe(`http://${HEADER_TENANT}.${BASE_DOMAIN}:${port}/oidc/v1`);

  const context = await browser.newContext();

  try {
    const unknown = await context.request.get(
      `http://${UNKNOWN_HOST}:${port}${discoveryPath}`
    );
    expect(unknown.status()).toBe(404);
    await expect(unknown.json()).resolves.toEqual({
      error: 'Tenant not found',
    });

    const suspended = await context.request.get(
      `http://${SUSPENDED_HOST}:${port}${discoveryPath}`
    );
    expect(suspended.status()).toBe(403);
    await expect(suspended.json()).resolves.toEqual({
      error: 'Tenant is not active',
    });

    const unknownHeader = await context.request.get(
      `${customOrigin}${discoveryPath}`,
      { headers: { 'x-tenant-id': 'missing' } }
    );
    expect(unknownHeader.status()).toBe(404);
    await expect(unknownHeader.json()).resolves.toEqual({
      error: 'Tenant not found',
    });

    const suspendedHeader = await context.request.get(
      `${customOrigin}${discoveryPath}`,
      { headers: { 'x-tenant-id': 'suspended-custom' } }
    );
    expect(suspendedHeader.status()).toBe(403);
    await expect(suspendedHeader.json()).resolves.toEqual({
      error: 'Tenant is not active',
    });
  } finally {
    await context.close();
  }
}

test.describe('tenant resolution adapter matrix', () => {
  test('resolves tenant domains and extraction precedence on MongoDB', async ({
    browser,
  }) => {
    const port = 19530;
    const runtime = await startMongoMultiTenantParakoInstance({
      port,
      tenants: tenantFixtures(port),
      deploymentUrl: `http://${BASE_DOMAIN}:${port}`,
    });

    try {
      await runTenantResolutionScenario(browser, port);
    } finally {
      await runtime.stop();
    }
  });

  test('resolves tenant domains and extraction precedence on PostgreSQL', async ({
    browser,
  }) => {
    const port = 19531;
    const runtime = await startPostgresqlParakoInstance({
      port,
      postgresqlUrl: POSTGRESQL_URL,
      multiTenancy: true,
      tenants: tenantFixtures(port),
      deploymentUrl: `http://${BASE_DOMAIN}:${port}`,
    });

    try {
      await runTenantResolutionScenario(browser, port);
    } finally {
      await runtime.stop();
    }
  });
});
