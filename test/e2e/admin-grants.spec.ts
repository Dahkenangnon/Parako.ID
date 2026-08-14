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

type GrantBrowser = {
  context: BrowserContext;
  failures: BrowserFailures;
  page: Page;
};

const RP_CLIENT_ID = 'parako-browser-e2e-rp';
const RP_CLIENT_NAME = 'Parako Browser E2E RP';
const BULK_RP_CLIENT_ID = 'parako-browser-e2e-grants-bulk-rp';

async function loginAsAdmin(page: Page, admin: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fuser-grants`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/user-grants`);
}

async function createGrant(
  browser: Browser,
  user: ManagedUserFixture,
  clientId = RP_CLIENT_ID
): Promise<GrantBrowser> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await page.goto(
    `${RP_ORIGIN}/login?${new URLSearchParams({
      client_id: clientId,
      prompt: 'consent',
    })}`
  );
  await completeOidcInteraction(page, {
    identifier: user.email,
    password: user.password,
  });
  await expect(page.getByTestId('rp-authenticated')).toBeVisible();

  return { context, failures, page };
}

test('an administrator can search, paginate, inspect, and revoke real grants', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-grants-list', {
    role: 'admin',
  });
  const firstUser = await createManagedUser('admin-grant-first');
  const secondUser = await createManagedUser('admin-grant-second');
  const firstGrant = await createGrant(browser, firstUser);
  const secondGrant = await createGrant(browser, secondUser);

  try {
    await loginAsAdmin(page, admin);
    const query = new URLSearchParams({
      clientId: RP_CLIENT_ID,
      limit: '1',
      search: RP_CLIENT_ID,
      sortBy: 'payload.accountId',
      sortOrder: 'asc',
    });
    await page.goto(`${IDP_ORIGIN}/admin/user-grants?${query}`);

    await expect(page.getByLabel('Search')).toHaveValue(RP_CLIENT_ID);
    await expect(page.getByLabel('Client')).toHaveValue(RP_CLIENT_ID);
    await expect(page.getByLabel('Sort grants by')).toHaveValue(
      'payload.accountId'
    );
    await expect(page.getByLabel('Sort order')).toHaveValue('asc');
    await expect(page.locator('tbody tr')).toHaveCount(1);

    const shownUsername = (
      await page.locator('tbody tr td').nth(1).innerText()
    ).trim();
    await page.getByRole('link', { name: 'Next grants page' }).click();
    await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
    await expect(page).toHaveURL(/(?:\?|&)limit=1(?:&|$)/);
    await expect(page).toHaveURL(/search=parako-browser-e2e-rp/);
    await expect(page).toHaveURL(/clientId=parako-browser-e2e-rp/);
    await expect(page).toHaveURL(/sortBy=payload.accountId/);
    await expect(page).toHaveURL(/sortOrder=asc/);

    const stats = await page.evaluate(async () => {
      const response = await fetch('/admin/user-grants/stats');
      return {
        body: (await response.json()) as Record<string, unknown>,
        status: response.status,
      };
    });
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual(
      expect.objectContaining({
        success: true,
        stats: expect.objectContaining({
          expiredGrants: expect.any(Number),
          grantsByClient: expect.any(Array),
          grantsByUser: expect.any(Array),
          recentGrants: expect.any(Number),
          totalGrants: expect.any(Number),
        }),
      })
    );

    const currentRow = page.locator('tbody tr').first();
    const currentUsername = (
      await currentRow.locator('td').nth(1).innerText()
    ).trim();
    expect(currentUsername).not.toBe(shownUsername);
    await currentRow
      .getByRole('link', {
        name: `View grant for ${currentUsername} and ${RP_CLIENT_NAME}`,
      })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Grant Details' })
    ).toBeVisible();
    await expect(
      page.getByText(currentUsername, { exact: true })
    ).toBeVisible();
    await expect(page.getByText(RP_CLIENT_NAME, { exact: true })).toBeVisible();

    const revoke = page.getByRole('button', { name: 'Revoke Grant' });
    await revoke.click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Authorization' });
    await expect(dialog.getByRole('button', { name: 'Revoke' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(revoke).toBeFocused();

    await revoke.click();
    const response = page.waitForResponse(
      item =>
        item.request().method() === 'POST' &&
        /\/admin\/user-grants\/[^/]+\/revoke$/.test(
          new URL(item.url()).pathname
        )
    );
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    expect((await response).status()).toBe(302);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/user-grants`);
    await expect(page.getByRole('alert')).toContainText(
      'Grant revoked successfully'
    );

    await page.goto(
      `${IDP_ORIGIN}/admin/user-grants?${new URLSearchParams({
        username: currentUsername,
      })}`
    );
    await expect(
      page.getByRole('heading', { name: 'No authorizations found' })
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    expectNoBrowserFailures(firstGrant.failures);
    expectNoBrowserFailures(secondGrant.failures);
    expectNoBrowserFailures(failures);
  } finally {
    await firstGrant.context.close();
    await secondGrant.context.close();
  }
});

test('the user-scoped control can be cancelled and revokes every matching grant', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-grants-user-bulk', {
    role: 'admin',
  });
  const user = await createManagedUser('admin-grant-user-target');
  const grant = await createGrant(browser, user);

  try {
    await loginAsAdmin(page, admin);
    await page.goto(
      `${IDP_ORIGIN}/admin/user-grants?${new URLSearchParams({
        username: user.username,
      })}`
    );

    const trigger = page.getByRole('button', {
      name: `Revoke all grants for user ${user.username}`,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Authorization' });
    await expect(dialog).toContainText(
      `Revoke every authorization for ${user.username}?`
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(trigger).toBeFocused();

    await trigger.click();
    const response = page.waitForResponse(
      item =>
        item.request().method() === 'POST' &&
        new URL(item.url()).pathname ===
          `/admin/user-grants/revoke-user/${user.username}`
    );
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    expect((await response).status()).toBe(302);
    await expect(page.getByRole('alert')).toContainText(
      'Successfully revoked 1 grant(s)'
    );
    await page.goto(
      `${IDP_ORIGIN}/admin/user-grants?${new URLSearchParams({
        username: user.username,
      })}`
    );
    await expect(
      page.getByRole('heading', { name: 'No authorizations found' })
    ).toBeVisible();
    expectNoBrowserFailures(grant.failures);
    expectNoBrowserFailures(failures);
  } finally {
    await grant.context.close();
  }
});

test('the client-scoped control revokes grants for every matching user', async ({
  browser,
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-grants-client-bulk', {
    role: 'admin',
  });
  const firstUser = await createManagedUser('admin-client-grant-first');
  const secondUser = await createManagedUser('admin-client-grant-second');
  const firstGrant = await createGrant(browser, firstUser, BULK_RP_CLIENT_ID);
  const secondGrant = await createGrant(browser, secondUser, BULK_RP_CLIENT_ID);

  try {
    await loginAsAdmin(page, admin);
    await page.goto(
      `${IDP_ORIGIN}/admin/user-grants?${new URLSearchParams({
        clientId: BULK_RP_CLIENT_ID,
      })}`
    );

    const trigger = page.getByRole('button', {
      name: `Revoke all grants for client ${BULK_RP_CLIENT_ID}`,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Authorization' });
    await expect(dialog).toContainText(
      `Revoke every authorization for ${BULK_RP_CLIENT_ID}?`
    );
    const response = page.waitForResponse(
      item =>
        item.request().method() === 'POST' &&
        new URL(item.url()).pathname ===
          `/admin/user-grants/revoke-client/${BULK_RP_CLIENT_ID}`
    );
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    expect((await response).status()).toBe(302);
    await expect(page.getByRole('alert')).toContainText(
      'Successfully revoked 2 grant(s)'
    );
    await page.goto(
      `${IDP_ORIGIN}/admin/user-grants?${new URLSearchParams({
        clientId: BULK_RP_CLIENT_ID,
      })}`
    );
    await expect(
      page.getByRole('heading', { name: 'No authorizations found' })
    ).toBeVisible();
    expectNoBrowserFailures(firstGrant.failures);
    expectNoBrowserFailures(secondGrant.failures);
    expectNoBrowserFailures(failures);
  } finally {
    await firstGrant.context.close();
    await secondGrant.context.close();
  }
});

test('the grant UI reports statistics and recovers safely from invalid requests', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-grants-errors', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  await page.goto(`${IDP_ORIGIN}/admin/user-grants?sortBy=__proto__&page=-1`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/user-grants`);
  const validationDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(validationDialog).toContainText(
    'Please correct the highlighted fields and try again.'
  );
  await validationDialog.getByRole('button', { name: 'OK' }).click();

  await page.goto(`${IDP_ORIGIN}/admin/user-grants/${randomUUID()}`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/user-grants`);
  const missingDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(missingDialog).toContainText('Grant not found');
  await missingDialog.getByRole('button', { name: 'OK' }).click();

  const targetPath = `/admin/user-grants/${randomUUID()}/revoke`;
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

test('an authenticated ordinary user cannot access grant administration', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-grants-denied');

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fuser-grants`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/admin/user-grants`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browser User' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});
