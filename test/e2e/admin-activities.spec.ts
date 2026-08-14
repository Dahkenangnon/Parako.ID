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
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Factivities`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/activities`);
}

async function createUserThroughAdmin(
  page: Page,
  label: string
): Promise<void> {
  const suffix = randomUUID();
  const password = 'Phase2-Strong!7';
  await page.goto(`${IDP_ORIGIN}/admin/users/new`);
  await page.locator('#email').fill(`${label}-${suffix}@example.test`);
  await page.locator('#given_name').fill(label);
  await page.locator('#family_name').fill('Activity');
  await page.locator('#password').fill(password);
  await page.locator('#confirm_password').fill(password);
  await page.locator('#roles').selectOption('user');
  await page.locator('#account_enabled').selectOption('true');
  await page.getByRole('button', { name: 'Create User' }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+$/);
}

function activityQuery(admin: ManagedUserFixture): string {
  return new URLSearchParams({
    limit: '1',
    search: 'Admin created new user',
    sortBy: 'timestamp',
    sortOrder: 'asc',
    status: 'success',
    type: 'user_created_by_admin',
    username: admin.username,
  }).toString();
}

async function waitForPaginatedActivities(
  page: Page,
  admin: ManagedUserFixture
): Promise<void> {
  await expect
    .poll(async () => {
      await page.goto(`${IDP_ORIGIN}/admin/activities?${activityQuery(admin)}`);
      return page.getByRole('link', { name: 'Next page' }).count();
    })
    .toBeGreaterThan(0);
}

test('an administrator can filter, paginate, and inspect adapter-backed activities', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-activities-list', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);
  await createUserThroughAdmin(page, 'First');
  await createUserThroughAdmin(page, 'Second');

  await waitForPaginatedActivities(page, admin);
  await expect(page.getByLabel('Search')).toHaveValue('Admin created new user');
  await expect(page.getByLabel('Activity type')).toHaveValue(
    'user_created_by_admin'
  );
  await expect(page.getByLabel('Activity status')).toHaveValue('success');
  await expect(page.getByLabel('Username')).toHaveValue(admin.username);
  await expect(page.getByLabel('Sort activities by')).toHaveValue('timestamp');

  const firstDetailHref = await page
    .getByTitle('View Details')
    .getAttribute('href');
  expect(firstDetailHref).toMatch(/^\/admin\/activities\/[A-Za-z0-9_-]+$/);
  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
  await expect(page).toHaveURL(/(?:\?|&)limit=1(?:&|$)/);
  await expect(page).toHaveURL(/username=/);
  const secondDetailHref = await page
    .getByTitle('View Details')
    .getAttribute('href');
  expect(secondDetailHref).not.toBe(firstDetailHref);

  await page.getByTitle('View Details').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Activity Details' })
  ).toBeVisible();
  await expect(
    page.getByText('Activity Type').locator('..').locator('p')
  ).toHaveText('user_created_by_admin');
  await expect(
    page.getByText('Actor Username').locator('..').locator('p')
  ).toHaveText(`@${admin.username}`);
  await expect(
    page.getByText('SUCCESS', { exact: true }).first()
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('the clear-old dialog validates input, restores focus, and submits an audited retention action', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-activities-clear', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const trigger = page.getByRole('button', { name: 'Clear old activities' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Clear Old Activities' });
  const days = dialog.getByLabel('Delete activities older than (days)');
  await expect(dialog).toBeVisible();
  await expect(days).toBeFocused();

  await days.fill('36501');
  await dialog.getByRole('button', { name: 'Clear Activities' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Enter a whole number between 1 and 36500'
  );
  await expect(days).toHaveAttribute('aria-invalid', 'true');
  await days.fill('36500');
  await expect(dialog.getByRole('alert')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await days.fill('36500');
  const mutationResponse = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url() === `${IDP_ORIGIN}/admin/activities/clear-old`
  );
  await dialog.getByRole('button', { name: 'Clear Activities' }).click();
  expect((await mutationResponse).status()).toBe(302);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/activities`);
  await expect(page.getByRole('alert')).toContainText(
    /Successfully cleared \d+ old activities/
  );

  await expect
    .poll(async () => {
      const query = new URLSearchParams({
        type: 'old_activities_cleared_by_admin',
        username: admin.username,
      });
      await page.goto(`${IDP_ORIGIN}/admin/activities?${query}`);
      return page
        .locator('tbody tr')
        .filter({ hasText: 'Admin cleared old activities' })
        .count();
    })
    .toBeGreaterThan(0);
  expectNoBrowserFailures(failures);
});

test('a forged clear-old request without CSRF cannot create a retention activity', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-activities-csrf', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  const forbiddenResponse = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url() === `${IDP_ORIGIN}/admin/activities/clear-old`
  );
  const forbiddenNavigation = page.waitForURL(
    `${IDP_ORIGIN}/admin/activities/clear-old`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/admin/activities/clear-old';
    const days = document.createElement('input');
    days.name = 'days';
    days.value = '36500';
    form.append(days);
    document.body.append(form);
    form.submit();
  });
  expect((await forbiddenResponse).status()).toBe(403);
  await forbiddenNavigation;

  await page.goto(
    `${IDP_ORIGIN}/admin/activities?${new URLSearchParams({
      type: 'old_activities_cleared_by_admin',
      username: admin.username,
    })}`
  );
  await expect(
    page.locator('tbody tr').filter({ hasText: 'Admin cleared old activities' })
  ).toHaveCount(0);
  expect(failures.consoleErrors).toEqual([
    expect.stringContaining('403 (Forbidden)'),
  ]);
  expect(failures.failedAssets).toEqual([]);
  expect(failures.failedRequests).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});

test('the admin UI recovers from invalid activity queries and missing details', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-activities-errors', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  await page.goto(
    `${IDP_ORIGIN}/admin/activities?status=unknown&dateFrom=2026-02-30`
  );
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/activities`);
  const validationDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(validationDialog).toContainText(
    'Please correct the highlighted fields and try again.'
  );
  await validationDialog.getByRole('button', { name: 'OK' }).click();

  await page.goto(`${IDP_ORIGIN}/admin/activities/${randomUUID()}`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/activities`);
  const missingDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(missingDialog).toContainText('Activity not found');
  await missingDialog.getByRole('button', { name: 'OK' }).click();
  expectNoBrowserFailures(failures);
});

test('an authenticated ordinary user cannot access activity administration', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-activities-denied');

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Factivities`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/admin/activities`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browser User' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});
