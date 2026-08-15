import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { completeOidcInteraction, RP_ORIGIN } from './support/browser-oidc.js';
import {
  expectNoBrowserFailures,
  observeBrowserFailures,
  type BrowserFailures,
} from './support/browser-failures.js';
import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

type AuthenticatedBrowser = {
  context: BrowserContext;
  failures: BrowserFailures;
  page: Page;
};

async function loginAsAdmin(page: Page, admin: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fsessions`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/sessions`);
}

async function openOidcSession(
  browser: Browser,
  user: ManagedUserFixture
): Promise<AuthenticatedBrowser> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await page.goto(`${RP_ORIGIN}/login?prompt=consent`);
  await completeOidcInteraction(page, {
    identifier: user.email,
    password: user.password,
  });
  await expect(page.getByTestId('rp-authenticated')).toBeVisible();

  return { context, failures, page };
}

async function openDirectLoginSession(
  browser: Browser,
  user: ManagedUserFixture
): Promise<AuthenticatedBrowser> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Faccounts%2F`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(url => {
    return url.origin === IDP_ORIGIN && url.pathname === '/accounts/';
  });

  return { context, failures, page };
}

function oidcSection(page: Page) {
  return page
    .getByRole('heading', { level: 2, name: 'OIDC Sessions' })
    .locator('xpath=../../..');
}

function expressSection(page: Page) {
  return page
    .getByRole('heading', {
      level: 2,
      name: 'Express Sessions (Direct Login)',
    })
    .locator('xpath=../../..');
}

test('an administrator can search, paginate, inspect, and revoke real OIDC sessions', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-sessions-oidc', {
    role: 'admin',
  });
  const user = await createManagedUser('admin-session-target');
  const first = await openOidcSession(browser, user);
  const second = await openOidcSession(browser, user);

  try {
    await loginAsAdmin(page, admin);
    await expect(
      oidcSection(page).getByRole('link', {
        name: `View OIDC session for ${user.username}`,
      })
    ).toHaveCount(2);

    await page.goto(
      `${IDP_ORIGIN}/admin/sessions?${new URLSearchParams({
        username: user.username,
      }).toString()}`
    );
    await expect(oidcSection(page).locator('tbody tr')).toHaveCount(2);

    await page.goto(`${IDP_ORIGIN}/admin/sessions?status=active`);
    await expect(
      oidcSection(page).getByRole('link', {
        name: `View OIDC session for ${user.username}`,
      })
    ).toHaveCount(2);

    const query = new URLSearchParams({
      expressLimit: '1',
      limit: '1',
      search: user.email,
      sortBy: 'loginTime',
      sortOrder: 'asc',
      status: 'active',
      username: user.username,
    });
    await page.goto(`${IDP_ORIGIN}/admin/sessions?${query}`);

    await expect(page.getByLabel('Search')).toHaveValue(user.email);
    await expect(page.getByLabel('Username')).toHaveValue(user.username);
    await expect(page.getByLabel('Session status')).toHaveValue('active');
    await expect(page.getByLabel('Sort sessions by')).toHaveValue('loginTime');
    await expect(page.getByLabel('Sort order')).toHaveValue('asc');
    await expect(oidcSection(page).locator('tbody tr')).toHaveCount(1);

    const firstHref = await page
      .getByRole('link', { name: `View OIDC session for ${user.username}` })
      .getAttribute('href');
    expect(firstHref).toMatch(/^\/admin\/sessions\/[A-Za-z0-9_-]+\?type=oidc$/);

    await page.getByRole('link', { name: 'Next OIDC sessions page' }).click();
    await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
    await expect(page).toHaveURL(/(?:\?|&)limit=1(?:&|$)/);
    await expect(page).toHaveURL(/search=/);
    await expect(page).toHaveURL(/username=/);
    const secondHref = await page
      .getByRole('link', { name: `View OIDC session for ${user.username}` })
      .getAttribute('href');
    expect(secondHref).not.toBe(firstHref);

    await page
      .getByRole('link', { name: `View OIDC session for ${user.username}` })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Session Details' })
    ).toBeVisible();
    await expect(
      page.getByText(user.username, { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText('OIDC', { exact: true }).first()).toBeVisible();

    const revoke = page.getByRole('button', {
      name: `Revoke oidc session for ${user.username}`,
    });
    await revoke.click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Session' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Revoke' })).toBeFocused();
    const response = page.waitForResponse(
      item =>
        item.request().method() === 'POST' &&
        /\/admin\/sessions\/[^/]+\/revoke$/.test(new URL(item.url()).pathname)
    );
    const successAlert = expect(page.getByRole('alert')).toContainText(
      'Session revoked successfully'
    );
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    expect((await response).status()).toBe(302);
    await successAlert;
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/sessions`);

    await page.goto(`${IDP_ORIGIN}/admin/sessions?${query}`);
    await expect(oidcSection(page).locator('tbody tr')).toHaveCount(1);

    await Promise.all([first.page.reload(), second.page.reload()]);
    const [
      firstAnonymous,
      secondAnonymous,
      firstAuthenticated,
      secondAuthenticated,
    ] = await Promise.all([
      first.page.getByTestId('rp-anonymous').count(),
      second.page.getByTestId('rp-anonymous').count(),
      first.page.getByTestId('rp-authenticated').count(),
      second.page.getByTestId('rp-authenticated').count(),
    ]);
    expect(firstAnonymous + secondAnonymous).toBe(1);
    expect(firstAuthenticated + secondAuthenticated).toBe(1);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);

    expectNoBrowserFailures(first.failures);
    expectNoBrowserFailures(second.failures);
    expectNoBrowserFailures(failures);
  } finally {
    await first.context.close();
    await second.context.close();
  }
});

test('an administrator can inspect and revoke a real direct-login session', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-sessions-express', {
    role: 'admin',
  });
  const user = await createManagedUser('admin-express-target');
  const direct = await openDirectLoginSession(browser, user);

  try {
    await loginAsAdmin(page, admin);
    const query = new URLSearchParams({
      expressLimit: '1',
      limit: '1',
      username: user.username,
    });
    await page.goto(`${IDP_ORIGIN}/admin/sessions?${query}`);
    await expect(expressSection(page).locator('tbody tr')).toHaveCount(1);

    await page
      .getByRole('link', {
        name: `View direct-login session for ${user.username}`,
      })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Session Details' })
    ).toBeVisible();
    await expect(
      page.getByText('Direct Login', { exact: true }).first()
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: `Revoke express session for ${user.username}`,
      })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Session' });
    const response = page.waitForResponse(
      item =>
        item.request().method() === 'POST' &&
        /\/admin\/sessions\/[^/]+\/revoke$/.test(new URL(item.url()).pathname)
    );
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    expect((await response).status()).toBe(302);

    await page.goto(`${IDP_ORIGIN}/admin/sessions?${query}`);
    await expect(
      expressSection(page).getByRole('heading', { name: 'No Express Sessions' })
    ).toBeVisible();

    await direct.page.goto(`${IDP_ORIGIN}/accounts/`);
    await expect(direct.page).toHaveURL(
      `${IDP_ORIGIN}/auth/login?continue=%2Faccounts%2F`
    );
    expectNoBrowserFailures(direct.failures);
    expectNoBrowserFailures(failures);
  } finally {
    await direct.context.close();
  }
});

test('the bulk dialog can be cancelled and then revokes every session for one account', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-sessions-bulk', {
    role: 'admin',
  });
  const user = await createManagedUser('admin-bulk-target');
  const oidc = await openOidcSession(browser, user);
  const direct = await openDirectLoginSession(browser, user);

  try {
    await loginAsAdmin(page, admin);
    const query = new URLSearchParams({ username: user.username });
    await page.goto(`${IDP_ORIGIN}/admin/sessions?${query}`);
    await expect(oidcSection(page).locator('tbody tr')).not.toHaveCount(0);
    await expect(expressSection(page).locator('tbody tr')).not.toHaveCount(0);

    const trigger = page.getByRole('button', {
      name: `Revoke all sessions for ${user.username}`,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Session' });
    await expect(dialog).toContainText(
      `Revoke every active session for ${user.username} on all devices?`
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    const response = page.waitForResponse(
      item =>
        item.request().method() === 'POST' &&
        new URL(item.url()).pathname ===
          `/admin/sessions/revoke-user/${user.username}`
    );
    const successAlert = expect(page.getByRole('alert')).toContainText(
      `session(s) for user ${user.username}`
    );
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    expect((await response).status()).toBe(302);
    await successAlert;

    await page.goto(`${IDP_ORIGIN}/admin/sessions?${query}`);
    await expect(
      oidcSection(page).getByRole('heading', { name: 'No OIDC Sessions' })
    ).toBeVisible();
    await expect(
      expressSection(page).getByRole('heading', { name: 'No Express Sessions' })
    ).toBeVisible();

    await oidc.page.reload();
    await expect(oidc.page.getByTestId('rp-anonymous')).toBeVisible();
    await direct.page.goto(`${IDP_ORIGIN}/accounts/`);
    await expect(direct.page).toHaveURL(
      `${IDP_ORIGIN}/auth/login?continue=%2Faccounts%2F`
    );
    expectNoBrowserFailures(oidc.failures);
    expectNoBrowserFailures(direct.failures);
    expectNoBrowserFailures(failures);
  } finally {
    await oidc.context.close();
    await direct.context.close();
  }
});

test('the admin session UI reports statistics and recovers safely from invalid requests', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-sessions-errors', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const stats = await page.evaluate(async () => {
    const response = await fetch('/admin/sessions/stats');
    return {
      body: (await response.json()) as Record<string, unknown>,
      status: response.status,
    };
  });
  expect(stats.status).toBe(200);
  expect(stats.body).toEqual(
    expect.objectContaining({
      averageSessionsPerUser: expect.any(String),
      expressTotal: expect.any(Number),
      oidcActive: expect.any(Number),
      oidcExpired: expect.any(Number),
      oidcTotal: expect.any(Number),
      total: expect.any(Number),
      uniqueUsers: expect.any(Number),
    })
  );

  await page.goto(
    `${IDP_ORIGIN}/admin/sessions?status=unknown&sortBy=__proto__&page=-1`
  );
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/sessions`);
  const validationDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(validationDialog).toContainText(
    'Please correct the highlighted fields and try again.'
  );
  await validationDialog.getByRole('button', { name: 'OK' }).click();

  await page.goto(`${IDP_ORIGIN}/admin/sessions/${randomUUID()}`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/sessions`);
  const missingDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(missingDialog).toContainText('Session not found');
  await missingDialog.getByRole('button', { name: 'OK' }).click();

  const targetPath = `/admin/sessions/${randomUUID()}/revoke`;
  const forbiddenResponse = page.waitForResponse(
    item =>
      item.request().method() === 'POST' &&
      new URL(item.url()).pathname === targetPath
  );
  const forbiddenNavigation = page.waitForURL(`${IDP_ORIGIN}${targetPath}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.evaluate(path => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = path;
    const sessionType = document.createElement('input');
    sessionType.name = 'sessionType';
    sessionType.value = 'oidc';
    form.append(sessionType);
    document.body.append(form);
    form.submit();
  }, targetPath);
  expect((await forbiddenResponse).status()).toBe(403);
  await forbiddenNavigation;

  expect(failures.consoleErrors).toEqual([
    expect.stringContaining('403 (Forbidden)'),
  ]);
  expect(failures.failedAssets).toEqual([]);
  expect(failures.failedRequests).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});

test('an authenticated ordinary user cannot access session administration', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-sessions-denied');

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fsessions`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/admin/sessions`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browser User' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});
