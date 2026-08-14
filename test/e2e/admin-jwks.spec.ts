import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';
import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

async function loginAsAdmin(page: Page, admin: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fjwks`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/jwks`);
}

async function readStatistic(page: Page, label: string): Promise<number> {
  const card = page.getByText(label, { exact: true }).first().locator('..');
  const value = await card.locator('p').nth(1).textContent();
  const parsed = Number(value?.trim());
  expect(Number.isFinite(parsed), `${label} statistic`).toBe(true);
  return parsed;
}

async function rotateKeys(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rotate Keys', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rotate JWKS Keys' });
  await expect(dialog).toBeVisible();
  const mutationResponsePromise = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url() === `${IDP_ORIGIN}/admin/jwks/rotate`
  );
  const redirectedPagePromise = page.waitForResponse(
    response =>
      response.request().method() === 'GET' &&
      response.url() === `${IDP_ORIGIN}/admin/jwks` &&
      response.status() === 200
  );
  await dialog.getByRole('button', { name: 'Yes, Rotate Keys' }).click();
  expect((await mutationResponsePromise).status()).toBe(302);
  await redirectedPagePromise;
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/jwks`);
  await expect(page.getByRole('dialog', { name: 'Error' })).toBeHidden();
}

test('an administrator can inspect and copy public JWKS data without private material', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-jwks-detail', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  await expect(
    page.getByRole('heading', { level: 1, name: 'JWKS Key Management' })
  ).toBeVisible();
  expect(await readStatistic(page, 'Total Keys')).toBeGreaterThan(0);

  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible();
  const keyId = (
    await firstRow.locator('td').first().locator('span').textContent()
  )?.trim();
  expect(keyId).toBeTruthy();

  const copyIdButton = firstRow.getByTitle('Copy Key ID');
  await copyIdButton.click();
  await expect(copyIdButton.locator('[data-lucide="check"]')).toBeVisible();

  await firstRow.getByTitle('View Details').click();
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/admin/jwks/${encodeURIComponent(keyId!)}`
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Key Details' })
  ).toBeVisible();
  const publicJwk = JSON.parse(
    (await page.locator('#public-jwk-json').textContent()) ?? '{}'
  ) as Record<string, unknown>;
  expect(publicJwk.kid).toBe(keyId);
  for (const privateParameter of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
    expect(publicJwk).not.toHaveProperty(privateParameter);
  }

  const copyPublicButton = page.getByTitle('Copy Public JWK');
  await copyPublicButton.click();
  await expect(copyPublicButton.locator('[data-lucide="check"]')).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('an administrator can cancel and rotate keys, then receives feedback for a rapid repeat', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-jwks-rotate', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);
  const initialTotal = await readStatistic(page, 'Total Keys');

  const rotateButton = page.getByRole('button', {
    name: 'Rotate Keys',
    exact: true,
  });
  await rotateButton.click();
  const dialog = page.getByRole('dialog', { name: 'Rotate JWKS Keys' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Yes, Rotate Keys' })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(rotateButton).toBeFocused();

  await rotateKeys(page);
  await expect(page.getByRole('alert')).toContainText(
    'JWKS keys rotated successfully. New keys are now active.'
  );
  expect(await readStatistic(page, 'Total Keys')).toBeGreaterThan(initialTotal);
  expect(await readStatistic(page, 'Expiring')).toBeGreaterThan(0);

  const totalAfterRotation = await readStatistic(page, 'Total Keys');
  await rotateButton.click();
  const repeatedRotationDialog = page.getByRole('dialog', {
    name: 'Rotate JWKS Keys',
  });
  await expect(repeatedRotationDialog).toBeVisible();
  const repeatedMutationResponse = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url() === `${IDP_ORIGIN}/admin/jwks/rotate`
  );
  const repeatedRedirect = page.waitForResponse(
    response =>
      response.request().method() === 'GET' &&
      response.url() === `${IDP_ORIGIN}/admin/jwks` &&
      response.status() === 200
  );
  await repeatedRotationDialog
    .getByRole('button', { name: 'Yes, Rotate Keys' })
    .click();
  expect((await repeatedMutationResponse).status()).toBe(302);
  await repeatedRedirect;

  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    'Failed to rotate JWKS keys. Please try again.'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(errorDialog).toBeHidden();
  expect(await readStatistic(page, 'Total Keys')).toBe(totalAfterRotation);
  expectNoBrowserFailures(failures);
});

test('an administrator receives visible feedback when no rotated key is old enough to retire', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-jwks-retire', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);
  const totalBeforeRetirement = await readStatistic(page, 'Total Keys');

  await page
    .getByRole('button', { name: 'Retire Expired Keys', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Retire Expired Keys' });
  await expect(dialog).toBeVisible();
  const responsePromise = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url() === `${IDP_ORIGIN}/admin/jwks/retire-expired`
  );
  await dialog.getByRole('button', { name: 'Yes, Retire Expired' }).click();
  expect((await responsePromise).status()).toBe(302);

  await expect(page.getByRole('alert')).toContainText(
    'No keys are past the overlap window yet.'
  );
  expect(await readStatistic(page, 'Total Keys')).toBe(totalBeforeRetirement);
  expectNoBrowserFailures(failures);
});

test('a forged rotation request without CSRF cannot change the keyset', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-jwks-csrf', { role: 'admin' });
  await loginAsAdmin(page, admin);
  const initialTotal = await readStatistic(page, 'Total Keys');

  const forbiddenResponse = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url() === `${IDP_ORIGIN}/admin/jwks/rotate`
  );
  const forbiddenNavigation = page.waitForURL(
    `${IDP_ORIGIN}/admin/jwks/rotate`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/admin/jwks/rotate';
    document.body.append(form);
    form.submit();
  });
  expect((await forbiddenResponse).status()).toBe(403);
  await forbiddenNavigation;

  await page.goto(`${IDP_ORIGIN}/admin/jwks`);
  expect(await readStatistic(page, 'Total Keys')).toBe(initialTotal);
  expect(failures.consoleErrors).toEqual([
    expect.stringContaining('403 (Forbidden)'),
  ]);
  expect(failures.failedAssets).toEqual([]);
  expect(failures.failedRequests).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});

test('the admin UI reports a missing key and returns to the JWKS list', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-jwks-missing', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  await page.goto(`${IDP_ORIGIN}/admin/jwks/${randomUUID()}`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/jwks`);
  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText('Key not found');
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  expectNoBrowserFailures(failures);
});

test('an authenticated ordinary user cannot access JWKS administration', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-jwks-denied');

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fjwks`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/admin/jwks`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browser User' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});
