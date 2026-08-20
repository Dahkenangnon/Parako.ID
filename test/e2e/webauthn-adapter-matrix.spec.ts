import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';

const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const PASSWORD = 'WebAuthn-Matrix!7';

interface MatrixRuntime {
  stop(): Promise<void>;
}

interface StartedCell {
  browserOrigin?: string;
  issuer: string;
  runtime: MatrixRuntime;
}

function webauthnConfig(rpId: string, deploymentUrl: string) {
  return {
    deployment: { url: deploymentUrl },
    security: {
      authentication: {
        multi_factor: {
          webauthn: {
            enabled: true,
            rp_name: 'Parako WebAuthn matrix',
            rp_id: rpId,
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
  };
}

async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    }
  );
  return { authenticatorId, cdp };
}

async function login(
  page: Page,
  origin: string,
  credentials: { email: string; password: string }
): Promise<void> {
  await page.goto(`${origin}/auth/login`);
  await page.locator('#login').fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#login-form button[type="submit"]').click(),
  ]);
}

async function logout(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/auth/logout`);
  await page.locator('form[action="/auth/logout"]').getByRole('button').click();
  await page.locator('a[href="/auth/login"]').first().click();
  await expect(page).toHaveURL(`${origin}/auth/login`);
}

async function runPasskeyLifecycle(
  browser: Browser,
  start: () => Promise<StartedCell>
): Promise<void> {
  const { browserOrigin, issuer, runtime } = await start();
  const origin = browserOrigin ?? new URL(issuer).origin;
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];
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
  const { authenticatorId, cdp } = await addVirtualAuthenticator(context, page);

  try {
    const credentials = {
      email: `webauthn-matrix-${randomUUID()}@example.test`,
      password: PASSWORD,
    };
    await page.goto(`${origin}/auth/register`);
    await page.locator('#fullname').fill('WebAuthn Matrix User');
    await page.locator('#email').fill(credentials.email);
    await page.locator('#password').fill(credentials.password);
    await page.locator('#submit-btn').click();
    await expect(page).toHaveURL(`${origin}/accounts/`);

    await page.goto(`${origin}/accounts/setup-webauthn`);
    await page.locator('#webauthn-register-btn').click();
    await expect(page.locator('#friendly-name-section')).toBeVisible();
    await page.locator('#friendly_name').fill('Matrix passkey');
    await page.locator('#webauthn-save-btn').click();
    await expect(page).toHaveURL(`${origin}/accounts/passkeys`);

    const passkey = page.locator('.passkey-item');
    await expect(passkey).toHaveCount(1);
    await passkey.locator('.passkey-rename-btn').click();
    await page.locator('#new-passkey-name').fill('Renamed matrix passkey');
    await page.locator('#rename-confirm-btn').click();
    await expect(passkey.locator('.passkey-name')).toHaveText(
      'Renamed matrix passkey'
    );

    await logout(page, origin);
    await login(page, origin, credentials);
    await expect(page).toHaveURL(`${origin}/auth/mfa-webauthn`);
    await page.locator('#webauthn-auth-btn').click();
    await expect(page).toHaveURL(`${origin}/accounts/`);

    await page.goto(`${origin}/accounts/passkeys`);
    await expect(page.locator('.passkey-last-used')).not.toHaveText(
      /never used/i
    );
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.passkey-delete-btn').click();
    await expect(page.locator('#passkeys-empty')).toBeVisible();

    await logout(page, origin);
    await login(page, origin, credentials);
    await expect(page).toHaveURL(`${origin}/accounts/`);
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
  } finally {
    if (!page.isClosed()) {
      await cdp
        .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
        .catch(() => undefined);
      await cdp.send('WebAuthn.disable').catch(() => undefined);
    }
    await context.close();
    await runtime.stop();
  }
}

test.describe('WebAuthn adapter matrix', () => {
  test.setTimeout(240_000);

  test('SQLite single tenant', async ({ browser }) => {
    await runPasskeyLifecycle(browser, async () => {
      const runtime = await startParakoInstance({
        port: 19420,
        config: webauthnConfig('localhost', 'http://localhost:19420'),
        deploymentUrl: 'http://localhost:19420',
      });
      return {
        browserOrigin: 'http://localhost:19420',
        issuer: runtime.issuer,
        runtime,
      };
    });
  });

  test('MongoDB single tenant', async ({ browser }) => {
    await runPasskeyLifecycle(browser, async () => {
      const runtime = await startMongoSingleTenantParakoInstance({
        port: 19421,
        config: webauthnConfig('localhost', 'http://localhost:19421'),
        deploymentUrl: 'http://localhost:19421',
      });
      return {
        browserOrigin: 'http://localhost:19421',
        issuer: runtime.issuer,
        runtime,
      };
    });
  });

  test('MongoDB multi tenant', async ({ browser }) => {
    const tenant = 'webauthn-matrix';
    await runPasskeyLifecycle(browser, async () => {
      const runtime = await startMongoMultiTenantParakoInstance({
        port: 19422,
        config: webauthnConfig(
          'parako.localhost',
          'http://parako.localhost:19422'
        ),
        deploymentUrl: 'http://parako.localhost:19422',
        tenants: [{ slug: tenant, display_name: 'WebAuthn Matrix' }],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });

  test('PostgreSQL single tenant', async ({ browser }) => {
    await runPasskeyLifecycle(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19423,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: false,
        config: webauthnConfig('localhost', 'http://localhost:19423'),
        deploymentUrl: 'http://localhost:19423',
      });
      return {
        browserOrigin: 'http://localhost:19423',
        issuer: runtime.issuer('default'),
        runtime,
      };
    });
  });

  test('PostgreSQL multi tenant', async ({ browser }) => {
    const tenant = 'webauthn-matrix';
    await runPasskeyLifecycle(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19424,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: true,
        config: webauthnConfig(
          'parako.localhost',
          'http://parako.localhost:19424'
        ),
        deploymentUrl: 'http://parako.localhost:19424',
        tenants: [{ slug: tenant, display_name: 'WebAuthn Matrix' }],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });
});
