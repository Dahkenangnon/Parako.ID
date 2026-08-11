import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';

const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const CURRENT_PASSWORD = 'Password-Matrix!7';
const NEW_PASSWORD = 'Password-Matrix!8';

interface MatrixRuntime {
  stop(): Promise<void>;
}

interface StartedCell {
  issuer: string;
  runtime: MatrixRuntime;
}

function passwordConfig() {
  return {
    security: {
      authentication: {
        // Breach-policy behavior has deterministic service-level coverage;
        // this matrix isolates password persistence and session invalidation.
        password_breach_detection: { enabled: false },
      },
      protection: {
        rate_limiting: {
          enabled: true,
          requests_per_minute: 10_000,
          window_minutes: 1,
        },
      },
    },
  };
}

async function login(
  page: Page,
  origin: string,
  credentials: { email: string; password: string }
): Promise<void> {
  await page.goto(`${origin}/auth/login`);
  await page.locator('#login').fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await page.locator('#login-form button[type="submit"]').click();
}

async function runPasswordSessionJourney(
  browser: Browser,
  start: () => Promise<StartedCell>
): Promise<void> {
  const { issuer, runtime } = await start();
  const origin = new URL(issuer).origin;
  const primaryContext = await browser.newContext();
  const secondaryContext = await browser.newContext();
  const primary = await primaryContext.newPage();
  const secondary = await secondaryContext.newPage();
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];

  for (const page of [primary, secondary]) {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (
        response.status() >= 400 &&
        ['font', 'image', 'script', 'stylesheet'].includes(
          response.request().resourceType()
        )
      ) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });
  }

  try {
    const credentials = {
      email: `password-matrix-${randomUUID()}@example.test`,
      password: CURRENT_PASSWORD,
    };
    await primary.goto(`${origin}/auth/register`);
    await primary.locator('#fullname').fill('Password Matrix User');
    await primary.locator('#email').fill(credentials.email);
    await primary.locator('#password').fill(credentials.password);
    await primary.locator('#submit-btn').click();
    await expect(primary).toHaveURL(`${origin}/accounts/`);

    await login(secondary, origin, credentials);
    await expect(secondary).toHaveURL(`${origin}/accounts/`);

    await primary.goto(`${origin}/accounts/settings/security`);
    await primary.locator('#current-password').fill(CURRENT_PASSWORD);
    await primary.locator('#new-password').fill(NEW_PASSWORD);
    await primary.locator('#confirm-password').fill(NEW_PASSWORD);
    await primary
      .locator('form[action="/accounts/change-password"]')
      .locator('button[type="submit"]')
      .click();
    await expect(primary).toHaveURL(`${origin}/accounts/settings/security`);

    // The changing browser keeps its regenerated session, while every other
    // session for the account is invalidated immediately.
    await primary.goto(`${origin}/accounts/`);
    await expect(primary).toHaveURL(`${origin}/accounts/`);
    await secondary.goto(`${origin}/accounts/`);
    await expect(secondary).toHaveURL(
      `${origin}/auth/login?continue=%2Faccounts%2F`
    );

    await login(secondary, origin, credentials);
    await expect(secondary).toHaveURL(`${origin}/auth/login`);
    const invalidDialog = secondary.getByRole('dialog');
    await expect(invalidDialog).toContainText(
      'Invalid credentials. Please try again.'
    );
    await invalidDialog.getByRole('button', { name: 'OK' }).click();

    await secondary.locator('#login').fill(credentials.email);
    await secondary.locator('#password').fill(NEW_PASSWORD);
    await secondary.locator('#login-form button[type="submit"]').click();
    await expect(secondary).toHaveURL(url => {
      return (
        url.origin === origin &&
        url.pathname === '/accounts/' &&
        url.searchParams.get('email') === credentials.email &&
        url.searchParams.get('status') === 'authenticated'
      );
    });
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
  } finally {
    await primaryContext.close();
    await secondaryContext.close();
    await runtime.stop();
  }
}

test.describe('Password and session adapter matrix', () => {
  test.setTimeout(240_000);

  test('SQLite single tenant', async ({ browser }) => {
    await runPasswordSessionJourney(browser, async () => {
      const runtime = await startParakoInstance({
        port: 19430,
        config: passwordConfig(),
      });
      return { issuer: runtime.issuer, runtime };
    });
  });

  test('MongoDB single tenant', async ({ browser }) => {
    await runPasswordSessionJourney(browser, async () => {
      const runtime = await startMongoSingleTenantParakoInstance({
        port: 19431,
        config: passwordConfig(),
      });
      return { issuer: runtime.issuer, runtime };
    });
  });

  test('MongoDB multi tenant', async ({ browser }) => {
    const tenant = 'password-matrix';
    await runPasswordSessionJourney(browser, async () => {
      const runtime = await startMongoMultiTenantParakoInstance({
        port: 19432,
        config: passwordConfig(),
        tenants: [{ slug: tenant, display_name: 'Password Matrix' }],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });

  test('PostgreSQL single tenant', async ({ browser }) => {
    await runPasswordSessionJourney(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19433,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: false,
        config: passwordConfig(),
      });
      return { issuer: runtime.issuer('default'), runtime };
    });
  });

  test('PostgreSQL multi tenant', async ({ browser }) => {
    const tenant = 'password-matrix';
    await runPasswordSessionJourney(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19434,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: true,
        config: passwordConfig(),
        tenants: [{ slug: tenant, display_name: 'Password Matrix' }],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });
});
