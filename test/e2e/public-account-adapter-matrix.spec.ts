import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  customFetch,
  discovery,
  fetchUserInfo,
  type CustomFetch,
} from 'openid-client';
import { generate } from 'otplib';

import { signLocalUrl } from '../../src/storage/signed-url.js';
import {
  apiRequest,
  issueManagementToken,
  machineClient,
} from './support/deployment-management-api.js';
import {
  createLoopbackTenantFetch,
  type E2eFetch,
} from './support/loopback-tenant-fetch.js';
import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
  TEST_COOKIE_SECRET,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';

const RP_ORIGIN = 'http://127.0.0.1:19389';
const RP_CLIENT_ID = 'parako-public-account-matrix-rp';
const MANAGEMENT_CLIENT_ID = 'parako-public-account-matrix-management';
// This journey covers the complete visitor and account-management lifecycle
// against a real server. Slower database profiles need a bounded CI budget that
// accommodates the full sequence without weakening any browser assertions.
const PUBLIC_ACCOUNT_JOURNEY_TIMEOUT_MS = 600_000;
// gitleaks:allow -- deterministic credential for disposable E2E runtimes.
const MANAGEMENT_CLIENT_SECRET =
  'parako-public-account-matrix-management-secret-long-enough';
const POSTGRESQL_URL = requireE2ePostgresqlUrl();

interface MatrixRuntime {
  origin: string;
  stop(): Promise<void>;
}

interface StartedCell {
  issuer: string;
  runtime: MatrixRuntime;
}

interface BrowserFailures {
  consoleErrors: string[];
  failedAssets: string[];
  failedRequests: string[];
  pageErrors: string[];
}

interface PreferenceResponse {
  status: number;
  contentType: string;
  body: unknown;
}

interface BrowserFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface BrowserFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
}

async function browserFetch(
  page: Page,
  url: string,
  init: BrowserFetchInit = {}
): Promise<BrowserFetchResponse> {
  return await page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, {
        ...init,
        credentials: 'same-origin',
      });
      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      let body: unknown = text;
      if (text && contentType.includes('application/json')) {
        try {
          body = JSON.parse(text);
        } catch {
          // Keep the raw response so the assertion reports malformed JSON.
        }
      }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    },
    { url, init }
  );
}
let callbackServer: Server | undefined;

function rpClient() {
  return {
    client_id: RP_CLIENT_ID,
    client_name: 'Parako account-matrix temporary RP',
    application_type: 'web',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: [`${RP_ORIGIN}/callback`],
    scope: 'openid profile email',
    require_pkce: true,
  };
}

function managementClient() {
  return machineClient({
    clientId: MANAGEMENT_CLIENT_ID,
    clientSecret: MANAGEMENT_CLIENT_SECRET,
    scopes: 'parako:stats:read',
  });
}

function matrixConfig() {
  return {
    security: {
      protection: {
        // This broad journey intentionally exceeds the default global budget.
        // Dedicated rate-limit suites retain the production thresholds.
        rate_limiting: {
          enabled: true,
          requests_per_minute: 10_000,
          window_minutes: 1,
        },
      },
    },
  };
}

function notificationDisabledConfig() {
  return {
    ...matrixConfig(),
    notifications: {
      defaults: {
        security_alerts: true,
        new_session_alerts: true,
        allow_user_preferences: false,
      },
    },
  };
}

function observeBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = {
    consoleErrors: [],
    failedAssets: [],
    failedRequests: [],
    pageErrors: [],
  };
  page.on('pageerror', error => failures.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') failures.consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failures.failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    if (
      response.status() >= 400 &&
      ['font', 'image', 'script', 'stylesheet'].includes(
        response.request().resourceType()
      )
    ) {
      failures.failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  return failures;
}

function expectNoBrowserFailures(failures: BrowserFailures): void {
  expect(failures).toEqual({
    consoleErrors: [],
    failedAssets: [],
    failedRequests: [],
    pageErrors: [],
  });
}

async function postPreference(
  page: Page,
  path: string,
  body: Record<string, unknown>,
  includeCsrf = true
): Promise<PreferenceResponse> {
  return await page.evaluate(
    async ({ path, body, includeCsrf }) => {
      const stateElement =
        document.querySelector<HTMLScriptElement>('#___MAIN_STATE___');
      const state = JSON.parse(stateElement?.textContent ?? '{}') as {
        csrfToken?: string;
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (includeCsrf && state.csrfToken) {
        headers['X-CSRF-Token'] = state.csrfToken;
      }
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();
      let parsed: unknown = text;
      if (contentType.includes('application/json')) parsed = JSON.parse(text);
      return { status: response.status, contentType, body: parsed };
    },
    { path, body, includeCsrf }
  );
}

async function expectStyledPage(page: Page): Promise<void> {
  await expect(page.locator('main, #main-content').first()).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          Array.from(document.styleSheets).filter(sheet => sheet.href).length
      )
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
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
  await expect(page).toHaveURL(new RegExp(`^${origin}/accounts/`));
}

async function fillOtp(page: Page, token: string): Promise<void> {
  expect(token).toMatch(/^\d{6}$/);
  const inputs = page.locator('.otp-input');
  await expect(inputs).toHaveCount(6);
  for (const [index, digit] of [...token].entries()) {
    await inputs.nth(index).fill(digit);
  }
  await expect(page.locator('#code')).toHaveValue(token);
}

async function authorizeTemporaryRp(
  page: Page,
  issuer: string,
  credentials: { email: string; password: string },
  nodeFetch: E2eFetch,
  options: {
    prompt?: 'consent' | 'select_account';
    selectAccountEmail?: string;
  } = {}
): Promise<Record<string, unknown>> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const url = new URL(`${issuer}/authorize`);
  url.search = new URLSearchParams({
    client_id: RP_CLIENT_ID,
    redirect_uri: `${RP_ORIGIN}/callback`,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: options.prompt ?? 'consent',
  }).toString();

  await page.goto(url.href);
  const loginInput = page.locator('#login');
  if (await loginInput.isVisible()) {
    await loginInput.fill(credentials.email);
    await page.locator('#password').fill(credentials.password);
    await page.locator('#login-form button[type="submit"]').click();
  }
  if (options.selectAccountEmail) {
    const accountSelection = page.locator('form[action$="/select_account"]');
    await expect(accountSelection).toBeVisible();
    await accountSelection
      .locator('button[name="account_id"]')
      .filter({ hasText: options.selectAccountEmail })
      .click();
  }
  const consent = page.locator('#consent-submit-btn');
  if (await consent.isVisible()) await consent.click();
  await expect(page).toHaveURL(new RegExp(`^${RP_ORIGIN}/callback\\?`));

  const configuration = await discovery(
    new URL(issuer),
    RP_CLIENT_ID,
    {
      redirect_uris: [`${RP_ORIGIN}/callback`],
      token_endpoint_auth_method: 'none',
    },
    undefined,
    {
      [customFetch]: nodeFetch as CustomFetch,
      execute: [allowInsecureRequests],
    }
  );
  const tokens = await authorizationCodeGrant(
    configuration,
    new URL(page.url()),
    {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
    }
  );
  expect(tokens.access_token).toEqual(expect.any(String));
  expect(tokens.id_token).toEqual(expect.any(String));
  const claims = tokens.claims();
  expect(claims?.sub).toEqual(expect.any(String));
  return (await fetchUserInfo(
    configuration,
    tokens.access_token!,
    claims!.sub
  )) as Record<string, unknown>;
}

async function runPublicAccountJourney(
  browser: Browser,
  start: () => Promise<StartedCell>
): Promise<void> {
  const { issuer, runtime } = await start();
  const origin = new URL(issuer).origin;
  const context = await browser.newContext();
  const page = await context.newPage();
  const nodeFetch = createLoopbackTenantFetch(runtime.origin);
  const failures = observeBrowserFailures(page);

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/accounts/settings/profile`);
    await expect(page).toHaveURL(
      `${origin}/auth/login?continue=%2Faccounts%2Fsettings%2Fprofile`
    );

    const missingRoute = await page.goto(`${origin}/route-that-does-not-exist`);
    expect(missingRoute?.status()).toBe(404);
    await expectStyledPage(page);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Page Not Found' })
    ).toBeVisible();
    expect(failures.pageErrors).toEqual([]);
    expect(failures.failedAssets).toEqual([]);
    failures.consoleErrors.length = 0;

    const invalidOidc = await page.goto(`${issuer}/authorize`);
    expect(invalidOidc?.status()).toBe(400);
    await expectStyledPage(page);
    await expect(
      page.getByRole('heading', { name: 'Invalid Request' })
    ).toBeVisible();
    expect(failures.pageErrors).toEqual([]);
    expect(failures.failedAssets).toEqual([]);
    failures.consoleErrors.length = 0;

    const unknownApiPath = '/route-that-does-not-exist';
    const anonymousApiResponse = await apiRequest(origin, unknownApiPath, {
      fetchImplementation: nodeFetch,
    });
    expect(anonymousApiResponse.status).toBe(401);
    expect(anonymousApiResponse.headers.get('content-type')).toContain(
      'application/problem+json'
    );
    const managementToken = await issueManagementToken({
      issuer,
      clientId: MANAGEMENT_CLIENT_ID,
      clientSecret: MANAGEMENT_CLIENT_SECRET,
      scope: 'parako:stats:read',
      fetchImplementation: nodeFetch,
    });
    for (const method of ['GET', 'POST']) {
      const apiResponse = await apiRequest(origin, unknownApiPath, {
        fetchImplementation: nodeFetch,
        method,
        token: managementToken,
      });
      expect(apiResponse.status).toBe(404);
      expect(apiResponse.headers.get('content-type')).toContain(
        'application/problem+json'
      );
      await expect(apiResponse.json()).resolves.toMatchObject({
        type: 'urn:parako:error:not-found',
        title: 'Resource Not Found',
        status: 404,
        instance: unknownApiPath,
      });
    }

    await page.goto(origin);
    await expect(page).toHaveURL(`${origin}/auth/login`);
    await expectStyledPage(page);
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    await expect(
      postPreference(page, '/auth/update-theme', { theme: 'dark' })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, theme: 'dark' },
    });
    await expect(
      postPreference(page, '/auth/update-locale', { locale: 'fr' })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, locale: 'fr' },
    });
    await expect(
      postPreference(page, '/auth/update-sidebar', { expanded: false })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, expanded: false },
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(
      postPreference(page, '/auth/update-timezone', {
        timezone: 'Africa/Porto-Novo',
      })
    ).resolves.toMatchObject({
      status: 401,
      body: { success: false, error: 'Authentication required' },
    });
    for (const [path, body, error] of [
      ['/auth/update-theme', { theme: 'sepia' }, 'Invalid theme value'],
      ['/auth/update-locale', { locale: 'xx' }, 'Invalid locale value'],
      [
        '/auth/update-sidebar',
        { expanded: 'false' },
        'Invalid sidebar state value',
      ],
      [
        '/auth/update-timezone',
        { timezone: 'Invalid/Timezone' },
        'Invalid timezone identifier',
      ],
    ] as const) {
      await expect(postPreference(page, path, body)).resolves.toMatchObject({
        status: 400,
        body: { success: false, error },
      });
    }
    const preferenceCsrfFailure = await postPreference(
      page,
      '/auth/update-theme',
      { theme: 'light' },
      false
    );
    expect(preferenceCsrfFailure.status).toBe(403);
    expect(preferenceCsrfFailure.contentType).toContain('text/html');
    expect(String(preferenceCsrfFailure.body)).toMatch(/<h1[^>]*>403<\/h1>/);
    await postPreference(page, '/auth/update-theme', { theme: 'light' });
    await postPreference(page, '/auth/update-locale', { locale: 'en' });
    expect(failures.consoleErrors).toEqual([
      expect.stringContaining('401 (Unauthorized)'),
      ...Array.from({ length: 4 }, () =>
        expect.stringContaining('400 (Bad Request)')
      ),
      expect.stringContaining('403 (Forbidden)'),
    ]);
    failures.consoleErrors.length = 0;

    await page.goto(`${origin}/auth/register`);
    await expectStyledPage(page);
    const suffix = randomUUID();
    const credentials = {
      email: `account-matrix-${suffix}@example.test`,
      password: 'Account-Matrix!7',
    };
    await page.locator('#fullname').fill('Account Matrix User');
    await page.locator('#email').fill(credentials.email);
    await page.locator('#password').fill(credentials.password);
    await page.locator('#submit-btn').click();
    await expect(page).toHaveURL(`${origin}/accounts/`);

    const missingCsrf = await browserFetch(
      page,
      `${origin}/accounts/update-profile`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          firstname: 'Missing',
          lastname: 'Token',
        }).toString(),
        redirect: 'manual',
      }
    );
    expect(missingCsrf.status).toBe(403);

    const accountRoutes = [
      '/accounts/',
      '/accounts/settings/profile',
      '/accounts/settings/preferences',
      '/accounts/settings/notifications',
      '/accounts/settings/security',
      '/accounts/settings/recovery',
      '/accounts/settings/social',
      '/accounts/apps',
      '/accounts/sessions',
    ];
    for (const route of accountRoutes) {
      const response = await page.goto(`${origin}${route}`);
      expect(response?.status(), route).toBe(200);
      await expectStyledPage(page);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${origin}/accounts/settings/profile`);
    await page.locator('#firstname').fill('Adapter');
    await page.locator('#lastname').fill('Matrix');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('#profile-form button[type="submit"]').click(),
    ]);
    await expect(page.locator('#firstname')).toHaveValue('Adapter');
    await expect(page.locator('#lastname')).toHaveValue('Matrix');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('#avatar-upload').setInputFiles('public/favicon.png'),
    ]);
    const avatar = page.locator('#preview-avatar');
    const expectedTenant = new URL(issuer).hostname.endsWith(
      '.parako.localhost'
    )
      ? new URL(issuer).hostname.split('.')[0]
      : 'default';
    await expect(avatar).toHaveAttribute(
      'src',
      new RegExp(`/media/file/${expectedTenant}/avatars/avatar-`)
    );
    await page.reload();
    await expect(avatar).toHaveJSProperty('complete', true);
    expect(
      await avatar.evaluate(image => (image as HTMLImageElement).naturalWidth)
    ).toBeGreaterThan(0);

    const avatarUrl = new URL((await avatar.getAttribute('src'))!, origin);
    const mediaKey = decodeURIComponent(
      avatarUrl.pathname.slice('/media/file/'.length)
    );
    const uploadedAvatar = await browserFetch(page, avatarUrl.href);
    expect(uploadedAvatar.status).toBe(200);
    expect(uploadedAvatar.headers['content-type']).toContain('image/png');
    expect(uploadedAvatar.headers['x-content-type-options']).toBe('nosniff');
    expect(uploadedAvatar.headers['cache-control']).toBe(
      'private, max-age=3600'
    );

    const manifest = await browserFetch(page, `${origin}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers['content-type']).toContain(
      'application/manifest+json'
    );
    const serviceWorker = await browserFetch(
      page,
      `${origin}/service-worker.js`
    );
    expect(serviceWorker.status).toBe(200);
    expect(serviceWorker.headers['content-type']).toContain('javascript');
    expect(serviceWorker.headers['cache-control']).toContain('no-cache');

    expect(
      (await browserFetch(page, `${origin}${avatarUrl.pathname}`)).status
    ).toBe(403);
    const tamperedAvatarUrl = new URL(avatarUrl);
    tamperedAvatarUrl.searchParams.set('sig', 'a'.repeat(64));
    expect((await browserFetch(page, tamperedAvatarUrl.href)).status).toBe(403);
    expect(
      (
        await browserFetch(
          page,
          `${origin}${signLocalUrl(mediaKey, TEST_COOKIE_SECRET, -10)}`
        )
      ).status
    ).toBe(403);
    expect(
      (
        await browserFetch(
          page,
          `${origin}${signLocalUrl(`${expectedTenant}/avatars/missing.png`, TEST_COOKIE_SECRET)}`
        )
      ).status
    ).toBe(404);
    expect([400, 404]).toContain(
      (
        await browserFetch(
          page,
          `${origin}${signLocalUrl('../../../etc/passwd', TEST_COOKIE_SECRET)}`
        )
      ).status
    );
    const nullByte = await browserFetch(
      page,
      `${origin}/media/file/test%00.png?expires=9999999999&sig=fake`
    );
    expect(nullByte.status).toBe(400);
    await expect(Promise.resolve(nullByte.body)).resolves.toEqual({
      error: 'Invalid file path',
    });
    const malformedMediaPath = await browserFetch(
      page,
      `${origin}/media/file/%25E0%25A4%25A?expires=9999999999&sig=fake`
    );
    expect(malformedMediaPath.status).toBe(400);
    await expect(Promise.resolve(malformedMediaPath.body)).resolves.toEqual({
      error: 'Invalid path encoding',
    });
    expect(failures.consoleErrors).toHaveLength(8);
    for (const message of failures.consoleErrors) {
      expect(message).toMatch(
        /server responded with a status of (?:400|403|404)/
      );
    }
    failures.consoleErrors.length = 0;

    await page.locator('#remove-button').click();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click(),
    ]);
    await expect(page.locator('#remove-button')).toHaveCount(0);

    await page.goto(`${origin}/accounts/settings/notifications`);
    const notificationForm = page.locator(
      'form[action="/accounts/update-notification-preferences"]'
    );
    await notificationForm.locator('#preferred_channel').selectOption('email');
    await notificationForm
      .locator('input[name="security_alerts"]')
      .uncheck({ force: true });
    await notificationForm
      .locator('input[name="marketing"]')
      .check({ force: true });
    await notificationForm.locator('button[type="submit"]').click();
    await expect(
      notificationForm.locator('input[name="security_alerts"]')
    ).not.toBeChecked();
    await expect(
      notificationForm.locator('input[name="marketing"]')
    ).toBeChecked();

    await page.goto(`${origin}/accounts/settings/preferences`);
    await Promise.all([
      page.waitForNavigation(),
      page
        .locator('#timezone-selector-settings')
        .selectOption('Africa/Porto-Novo'),
    ]);
    await expect(page.locator('#timezone-selector-settings')).toHaveValue(
      'Africa/Porto-Novo'
    );

    const singleAccountUserInfo = await authorizeTemporaryRp(
      page,
      issuer,
      credentials,
      nodeFetch,
      {
        prompt: 'select_account',
        selectAccountEmail: credentials.email,
      }
    );
    expect(singleAccountUserInfo.email).toBe(credentials.email);
    await page.goto(`${origin}/accounts/apps`);
    await expect(
      page.getByText('Parako account-matrix temporary RP')
    ).toBeVisible();
    const revokeApp = page.locator('form[action="/accounts/revoke-app"]');
    await expect(revokeApp.locator('input[name="client_id"]')).toHaveValue(
      RP_CLIENT_ID
    );
    await revokeApp.locator('button[type="submit"]').click();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('dialog').locator('button').last().click(),
    ]);
    await expect(
      page.getByText('Parako account-matrix temporary RP')
    ).toHaveCount(0);

    const secondaryContext = await browser.newContext();
    const secondaryPage = await secondaryContext.newPage();
    const secondaryFailures = observeBrowserFailures(secondaryPage);
    try {
      await login(secondaryPage, origin, credentials);
      await page.goto(`${origin}/accounts/sessions`);
      const logoutSession = page
        .locator('form[action="/accounts/logout-session"]:visible')
        .filter({
          has: page.locator('input[name="sessionType"][value="express"]'),
        });
      await expect(logoutSession).toHaveCount(1);
      await logoutSession.locator('button[type="submit"]').click();
      await Promise.all([
        page.waitForNavigation(),
        page
          .getByRole('dialog')
          .getByRole('button', { name: 'Confirm' })
          .click(),
      ]);
      await secondaryPage.goto(`${origin}/accounts/`);
      await expect(secondaryPage).toHaveURL(
        `${origin}/auth/login?continue=%2Faccounts%2F`
      );

      await login(secondaryPage, origin, credentials);
      await page.goto(`${origin}/accounts/sessions`);
      const logoutOthers = page.locator(
        'form[action="/accounts/logout-all-other-sessions"]:visible'
      );
      await expect(logoutOthers).toHaveCount(1);
      await logoutOthers.locator('button[type="submit"]').click();
      await Promise.all([
        page.waitForNavigation(),
        page
          .getByRole('dialog')
          .getByRole('button', { name: 'Confirm' })
          .click(),
      ]);
      await page.goto(`${origin}/accounts/`);
      await expect(page).toHaveURL(`${origin}/accounts/`);
      await secondaryPage.goto(`${origin}/accounts/`);
      await expect(secondaryPage).toHaveURL(
        `${origin}/auth/login?continue=%2Faccounts%2F`
      );
      expectNoBrowserFailures(secondaryFailures);
    } finally {
      await secondaryContext.close();
    }

    const switcherContext = await browser.newContext();
    const switcherPage = await switcherContext.newPage();
    const secondAccount = {
      email: `account-matrix-second-${suffix}@example.test`,
      password: 'Account-Matrix-Second!7',
    };
    try {
      await switcherPage.goto(`${origin}/auth/register`);
      await switcherPage.locator('#fullname').fill('Second Matrix User');
      await switcherPage.locator('#email').fill(secondAccount.email);
      await switcherPage.locator('#password').fill(secondAccount.password);
      await switcherPage.locator('#submit-btn').click();
      await expect(switcherPage).toHaveURL(`${origin}/accounts/`);
    } finally {
      await switcherContext.close();
    }

    await page.goto(`${origin}/accounts/`);
    await page.locator('#sidebar-user-btn').click();
    await expect(page.locator('#accounts-list-sidebar')).toBeVisible();
    await page
      .locator('form[action="/accounts/add-account"]:visible')
      .getByRole('button')
      .click();
    await expect(page).toHaveURL(`${origin}/auth/login?intent=add-account`);
    await page.locator('#login').fill(secondAccount.email);
    await page.locator('#password').fill(secondAccount.password);
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${origin}/accounts/`);

    const readSwitcher = async () => {
      const response = await browserFetch(
        page,
        `${origin}/accounts/account-switcher-data`
      );
      expect(response.status).toBe(200);
      return response.body as {
        success: boolean;
        totalAccounts: number;
        accounts: Array<{ id: string; email: string; isActive: boolean }>;
      };
    };
    const afterAdd = await readSwitcher();
    expect(afterAdd).toMatchObject({ success: true, totalAccounts: 2 });
    expect(afterAdd.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: credentials.email, isActive: false }),
        expect.objectContaining({ email: secondAccount.email, isActive: true }),
      ])
    );
    const firstAccountId = afterAdd.accounts.find(
      account => account.email === credentials.email
    )?.id;
    const secondAccountId = afterAdd.accounts.find(
      account => account.email === secondAccount.email
    )?.id;
    expect(firstAccountId).toEqual(expect.any(String));
    expect(secondAccountId).toEqual(expect.any(String));

    await page.locator('#sidebar-user-btn').click();
    await page
      .locator(
        `#other-accounts-list-sidebar [data-account-id="${firstAccountId}"]`
      )
      .click();
    await expect(page).toHaveURL(`${origin}/accounts/`);
    const afterSwitch = await readSwitcher();
    expect(afterSwitch.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: credentials.email, isActive: true }),
        expect.objectContaining({
          email: secondAccount.email,
          isActive: false,
        }),
      ])
    );

    const selectedUserInfo = await authorizeTemporaryRp(
      page,
      issuer,
      credentials,
      nodeFetch,
      {
        prompt: 'select_account',
        selectAccountEmail: credentials.email,
      }
    );
    expect(selectedUserInfo.email).toBe(credentials.email);

    await page.goto(`${origin}/accounts/`);
    await page.locator('#sidebar-user-btn').click();
    const removableAccount = page.locator(
      `#other-accounts-list-sidebar [data-account-id="${secondAccountId}"]`
    );
    await removableAccount.getByTitle('Remove account').click();
    await page.getByRole('dialog').locator('button').last().click();
    await expect(removableAccount).toHaveCount(0);
    await expect(readSwitcher()).resolves.toMatchObject({
      success: true,
      totalAccounts: 1,
      accounts: [
        expect.objectContaining({ email: credentials.email, isActive: true }),
      ],
    });

    const foreignAccountResponse = await page.goto(
      `${origin}/auth/continue?account_id=foreign-account-id`
    );
    expect(foreignAccountResponse?.status()).toBe(200);
    await expect(page).toHaveURL(`${origin}/auth/account-select`);
    await expect(
      page.getByText('The selected account is no longer available.')
    ).toBeVisible();
    await expect(page.getByText(credentials.email)).toBeVisible();

    await page.goto(`${origin}/accounts/settings/security`);
    await page.locator('#enable-mfa-app-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${origin}/accounts/setup-mfa`);
    const secret = (
      await page.locator('#manual-setup-key').textContent()
    )?.trim();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    await fillOtp(page, await generate({ secret: secret! }));
    await page
      .locator('form[action="/accounts/setup-mfa"] button[type="submit"]')
      .click();
    await expect(page.locator('#recovery-codes-data [data-code]')).toHaveCount(
      10
    );
    await page.locator('#acknowledge').check();
    await Promise.all([
      page.waitForNavigation(),
      page
        .locator(
          'form[action="/accounts/settings/security"] button[type="submit"]'
        )
        .click(),
    ]);

    await page.goto(`${origin}/auth/logout`);
    await page.locator('form[action="/auth/logout"] button').click();
    await page.locator('a[href="/auth/login"]').first().click();
    await page.locator('#login').fill(credentials.email);
    await page.locator('#password').fill(credentials.password);
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${origin}/auth/mfa-verify`);
    await fillOtp(page, await generate({ secret: secret! }));
    await page
      .locator('form[action="/auth/mfa-verify"] button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${origin}/accounts/`);

    await page.goto(`${origin}/accounts/settings/security`);
    await page
      .locator('form[action="/accounts/disable-mfa?method=totp"] button')
      .click();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('dialog').locator('button').last().click(),
    ]);
    await expect(page.locator('#enable-mfa-app-form')).toBeVisible();

    const newPassword = 'Account-Matrix-Changed!8';
    await page.locator('#current-password').fill(credentials.password);
    await page.locator('#new-password').fill(newPassword);
    await page.locator('#confirm-password').fill(newPassword);
    await page
      .locator('form[action="/accounts/change-password"] button[type="submit"]')
      .click();
    await page.goto(`${origin}/auth/logout`);
    await page.locator('form[action="/auth/logout"] button').click();
    await page.locator('a[href="/auth/login"]').first().click();
    await page.locator('#login').fill(credentials.email);
    await page.locator('#password').fill(newPassword);
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${origin}/accounts/`);
    await expect(
      page.getByRole('heading', { name: 'Adapter Matrix' })
    ).toBeVisible();
    expectNoBrowserFailures(failures);
  } finally {
    await context.close();
    await nodeFetch.close?.();
    await runtime.stop();
  }
}

async function runNotificationPolicyJourney(
  browser: Browser,
  start: () => Promise<StartedCell>
): Promise<void> {
  const { issuer, runtime } = await start();
  const origin = new URL(issuer).origin;
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);
  const suffix = randomUUID();

  try {
    await page.goto(`${origin}/auth/register`);
    await page.locator('#fullname').fill('Notification Policy User');
    await page
      .locator('#email')
      .fill(`notification-policy-${suffix}@example.test`);
    await page.locator('#password').fill('Notification-Policy!7');
    await page.locator('#submit-btn').click();
    await expect(page).toHaveURL(`${origin}/accounts/`);

    await page.goto(`${origin}/accounts/settings/notifications`);
    const preferencesForm = page.locator(
      'form[action="/accounts/update-notification-preferences"]'
    );
    await expect(preferencesForm).toHaveCount(0);
    const csrfToken = await page
      .locator('input[name="_csrf"]')
      .first()
      .inputValue();

    await page.evaluate(
      ({ csrf }) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/accounts/update-notification-preferences';
        for (const [name, value] of Object.entries({
          _csrf: csrf,
          preferred_channel: 'sms',
          marketing: 'on',
        })) {
          const input = document.createElement('input');
          input.name = name;
          input.value = value;
          form.append(input);
        }
        document.body.append(form);
        form.submit();
      },
      { csrf: csrfToken }
    );

    await expect(page).toHaveURL(`${origin}/accounts/settings/notifications`);
    const errorDialog = page.getByRole('dialog', { name: 'Error' });
    await expect(errorDialog).toContainText(
      'Notification preferences cannot be changed'
    );
    await errorDialog.getByRole('button', { name: 'OK' }).click();
    await expect(preferencesForm).toHaveCount(0);
    expectNoBrowserFailures(failures);
  } finally {
    await context.close();
    await runtime.stop();
  }
}

test.beforeAll(async () => {
  callbackServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Temporary RP callback</title>');
  });
  callbackServer.listen(19389, '127.0.0.1');
  await once(callbackServer, 'listening');
});

test.afterAll(async () => {
  if (!callbackServer?.listening) return;
  callbackServer.close();
  await once(callbackServer, 'close');
});

test.describe('Public and normal-account adapter matrix', () => {
  test.setTimeout(PUBLIC_ACCOUNT_JOURNEY_TIMEOUT_MS);

  test('SQLite single tenant', async ({ browser }) => {
    await runPublicAccountJourney(browser, async () => {
      const runtime = await startParakoInstance({
        port: 19380,
        config: matrixConfig(),
        clients: [rpClient(), managementClient()],
      });
      return { issuer: runtime.issuer, runtime };
    });
  });

  test('MongoDB single tenant', async ({ browser }) => {
    await runPublicAccountJourney(browser, async () => {
      const runtime = await startMongoSingleTenantParakoInstance({
        port: 19381,
        config: matrixConfig(),
        clients: [
          { tenantId: 'default', client: rpClient() },
          { tenantId: 'default', client: managementClient() },
        ],
      });
      return { issuer: runtime.issuer, runtime };
    });
  });

  test('MongoDB multi tenant', async ({ browser }) => {
    const tenant = 'account-matrix';
    await runPublicAccountJourney(browser, async () => {
      const runtime = await startMongoMultiTenantParakoInstance({
        port: 19382,
        config: matrixConfig(),
        tenants: [{ slug: tenant, display_name: 'Account Matrix' }],
        clients: [
          { tenantId: tenant, client: rpClient() },
          { tenantId: tenant, client: managementClient() },
        ],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });

  test('PostgreSQL single tenant', async ({ browser }) => {
    await runPublicAccountJourney(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19383,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: false,
        config: matrixConfig(),
        clients: [
          { tenantId: 'default', client: rpClient() },
          { tenantId: 'default', client: managementClient() },
        ],
      });
      return { issuer: runtime.issuer('default'), runtime };
    });
  });

  test('PostgreSQL multi tenant', async ({ browser }) => {
    const tenant = 'account-matrix';
    await runPublicAccountJourney(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19384,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: true,
        config: matrixConfig(),
        tenants: [{ slug: tenant, display_name: 'Account Matrix' }],
        clients: [
          { tenantId: tenant, client: rpClient() },
          { tenantId: tenant, client: managementClient() },
        ],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });
});

test.describe('Notification-policy adapter matrix', () => {
  test.setTimeout(180_000);

  test('SQLite single tenant with user control disabled', async ({
    browser,
  }) => {
    await runNotificationPolicyJourney(browser, async () => {
      const runtime = await startParakoInstance({
        port: 19385,
        config: notificationDisabledConfig(),
      });
      return { issuer: runtime.issuer, runtime };
    });
  });

  test('MongoDB single tenant with user control disabled', async ({
    browser,
  }) => {
    await runNotificationPolicyJourney(browser, async () => {
      const runtime = await startMongoSingleTenantParakoInstance({
        port: 19386,
        config: notificationDisabledConfig(),
      });
      return { issuer: runtime.issuer, runtime };
    });
  });

  test('MongoDB multi tenant with user control disabled', async ({
    browser,
  }) => {
    const tenant = 'notification-policy';
    await runNotificationPolicyJourney(browser, async () => {
      const runtime = await startMongoMultiTenantParakoInstance({
        port: 19387,
        config: notificationDisabledConfig(),
        tenants: [{ slug: tenant, display_name: 'Notification Policy' }],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });

  test('PostgreSQL single tenant with user control disabled', async ({
    browser,
  }) => {
    await runNotificationPolicyJourney(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19388,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: false,
        config: notificationDisabledConfig(),
      });
      return { issuer: runtime.issuer('default'), runtime };
    });
  });

  test('PostgreSQL multi tenant with user control disabled', async ({
    browser,
  }) => {
    const tenant = 'notification-policy';
    await runNotificationPolicyJourney(browser, async () => {
      const runtime = await startPostgresqlParakoInstance({
        port: 19390,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: true,
        config: notificationDisabledConfig(),
        tenants: [{ slug: tenant, display_name: 'Notification Policy' }],
      });
      return { issuer: runtime.issuer(tenant), runtime };
    });
  });
});
