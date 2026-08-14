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
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fusers`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/users`);
}

type BrowserSessionRequestOptions = {
  method: 'DELETE' | 'POST';
  csrfToken?: string;
};

async function requestAsBrowserSession(
  page: Page,
  path: string,
  options: BrowserSessionRequestOptions
) {
  const tenantUrl = new URL(IDP_ORIGIN);
  const loopbackUrl = new URL(IDP_ORIGIN);
  loopbackUrl.hostname = '127.0.0.1';
  const cookie = (await page.context().cookies(IDP_ORIGIN))
    .map(item => `${item.name}=${item.value}`)
    .join('; ');

  return page.context().request.fetch(`${loopbackUrl.origin}${path}`, {
    method: options.method,
    headers: {
      cookie,
      host: tenantUrl.host,
      ...(options.csrfToken ? { 'x-csrf-token': options.csrfToken } : {}),
    },
  });
}

test('an administrator can manage a user through the HTML control panel', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-user-lifecycle', {
    role: 'admin',
  });
  const suffix = randomUUID();
  const originalEmail = `phase-two-${suffix}@example.test`;
  const updatedEmail = `phase-two-updated-${suffix}@example.test`;
  const password = 'Phase2-Strong!7';

  await loginAsAdmin(page, admin);
  await page.locator('a[href="/admin/users/new"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/users/new`);

  const passwordToggle = page.locator('[data-password-toggle="password"]');
  await expect(passwordToggle).toHaveAttribute('aria-pressed', 'false');
  await passwordToggle.click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await expect(passwordToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(passwordToggle).toHaveAccessibleName('Hide password');
  await passwordToggle.click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await expect(passwordToggle).toHaveAccessibleName('Show password');
  await page.locator('#email').fill(originalEmail);
  await page.locator('#given_name').fill('Phase');
  await page.locator('#family_name').fill('Two');
  await page.locator('#password').fill(password);
  await page.locator('#confirm_password').fill(password);
  await page.locator('#roles').selectOption('user');
  await page.locator('#account_enabled').selectOption('true');
  await page.getByRole('button', { name: 'Create User' }).click();

  await expect(page).toHaveURL(/\/admin\/users\/[^/]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Phase Two' })
  ).toBeVisible();
  await expect(
    page.getByText(originalEmail, { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText('User', { exact: true })).toBeVisible();
  const detailUrl = page.url();

  await page.goto(`${IDP_ORIGIN}/admin/users?search=${originalEmail}`);
  await expect(
    page.getByText(originalEmail, { exact: true }).first()
  ).toBeVisible();
  await page.getByTitle('View Details').click();
  await expect(page).toHaveURL(detailUrl);

  await page.getByRole('link', { name: 'Edit Profile' }).click();
  await page.locator('#email').fill(updatedEmail);
  await page.locator('#given_name').fill('Updated');
  await page.locator('#family_name').fill('Person');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page).toHaveURL(detailUrl);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Updated Person' })
  ).toBeVisible();
  await expect(
    page.getByText(updatedEmail, { exact: true }).first()
  ).toBeVisible();

  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  const disableDialog = page.getByRole('dialog', { name: 'Disable User' });
  await expect(disableDialog).toBeVisible();
  await expect(
    disableDialog.getByRole('button', { name: 'Yes, Disable User' })
  ).toBeFocused();
  await disableDialog
    .getByRole('button', { name: 'Yes, Disable User' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Enable', exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByRole('heading', { level: 1, name: 'Updated Person' })
      .locator('..')
      .getByText('Disabled', { exact: true })
  ).toBeVisible();

  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page
    .locator('form[action="/auth/logout"] button[type="submit"]')
    .click();
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(updatedEmail);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
  await expect(
    page.getByText('Invalid credentials. Please try again.', { exact: true })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('the admin panel prevents the current administrator from locking themselves out', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-self-protection', {
    role: 'admin',
  });

  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}/admin/users/${admin.id}`);

  await expect(
    page.getByRole('button', { name: 'Disable', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Anonymize', exact: true })
  ).toHaveCount(0);

  const csrfToken = await page.locator('input[name="_csrf"]').inputValue();
  const disableResponse = await requestAsBrowserSession(
    page,
    `/admin/users/${admin.id}/disable`,
    { method: 'POST', csrfToken }
  );
  expect(disableResponse.status()).toBe(403);
  await expect(disableResponse.json()).resolves.toEqual({
    success: false,
    error: 'You cannot disable your own account',
  });

  const anonymizeResponse = await requestAsBrowserSession(
    page,
    `/admin/users/${admin.id}`,
    { method: 'DELETE', csrfToken }
  );
  expect(anonymizeResponse.status()).toBe(403);
  await expect(anonymizeResponse.json()).resolves.toEqual({
    success: false,
    error: 'You cannot anonymize your own account',
  });

  await page.goto(`${IDP_ORIGIN}/admin/users/${admin.id}/edit`);
  await page.locator('#account_enabled').selectOption('false');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/users/${admin.id}/edit`);
  const statusDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(statusDialog).toContainText(
    'You cannot disable your own account'
  );
  await statusDialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#account_enabled')).toHaveValue('true');

  await page.locator('#roles').selectOption('user');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const roleDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(roleDialog).toContainText(
    'You cannot remove your own administrator role'
  );
  await roleDialog.getByRole('button', { name: 'OK' }).click();

  await page.goto(`${IDP_ORIGIN}/admin/users/${admin.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Browser User'
  );
  expectNoBrowserFailures(failures);
});

test('an administrator can filter, sort, paginate, and recover from an invalid user query', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-user-list', { role: 'admin' });
  const search = `list-${randomUUID().slice(0, 8)}`;
  const activeUsers = [
    await createManagedUser(search, { role: 'user' }),
    await createManagedUser(search, { role: 'user' }),
  ].sort((left, right) => left.email.localeCompare(right.email));
  const disabledUser = await createManagedUser(search, {
    accountEnabled: false,
    role: 'user',
  });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fusers`);
  await loginAsAdmin(page, admin);

  const query = new URLSearchParams({
    limit: '1',
    role: 'user',
    search,
    sortBy: 'email',
    sortOrder: 'asc',
    status: 'active',
  });
  await page.goto(`${IDP_ORIGIN}/admin/users?${query}`);

  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(activeUsers[0].email);
  await expect(rows).not.toContainText(activeUsers[1].email);
  await expect(rows).not.toContainText(disabledUser.email);
  await expect(page.locator('#role')).toHaveValue('user');
  await expect(page.locator('#status')).toHaveValue('active');
  await expect(page.locator('#sortBy')).toHaveValue('email');
  await expect(page.locator('#sortOrder')).toHaveValue('asc');

  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
  await expect(page).toHaveURL(/(?:\?|&)limit=1(?:&|$)/);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(activeUsers[1].email);

  await page.goto(`${IDP_ORIGIN}/admin/users?search=no-such-${search}`);
  await expect(
    page.getByRole('heading', { name: 'No users found' })
  ).toBeVisible();

  await page.goto(`${IDP_ORIGIN}/admin/users?sortBy=__proto__&page=-1`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/users`);
  const validationDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(validationDialog).toContainText(
    'Please correct the highlighted fields and try again.'
  );
  await validationDialog.getByRole('button', { name: 'OK' }).click();

  expectNoBrowserFailures(failures);
});

test('an administrator can enable and anonymize a user with complete audit and CSRF protection', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-user-state', { role: 'admin' });
  const target = await createManagedUser('admin-state-target', {
    accountEnabled: false,
    role: 'user',
  });

  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}/admin/users/${target.id}`);
  await expect(
    page.getByText('Disabled', { exact: true }).first()
  ).toBeVisible();

  const deniedEnable = await requestAsBrowserSession(
    page,
    `/admin/users/${target.id}/enable`,
    { method: 'POST' }
  );
  expect(deniedEnable.status()).toBe(403);
  await expect(
    page.getByRole('button', { name: 'Enable', exact: true })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  const enableDialog = page.getByRole('dialog', { name: 'Enable User' });
  await expect(enableDialog).toBeVisible();
  await expect(
    enableDialog.getByRole('button', { name: 'Yes, Enable User' })
  ).toBeFocused();
  await enableDialog.getByRole('button', { name: 'Yes, Enable User' }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'View Activities' }).click();
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/admin/users/${target.id}/activities`
  );
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText('Admin enabled user', { exact: true }).count();
      },
      {
        message: 'the managed-user timeline should include target audit events',
        timeout: 20_000,
      }
    )
    .toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Back to User' }).click();
  const deniedAnonymize = await requestAsBrowserSession(
    page,
    `/admin/users/${target.id}`,
    { method: 'DELETE' }
  );
  expect(deniedAnonymize.status()).toBe(403);
  await expect(
    page.getByRole('button', { name: 'Anonymize', exact: true })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Anonymize', exact: true }).click();
  const anonymizeDialog = page.getByRole('dialog', {
    name: 'Anonymize User - Permanent Action',
  });
  await expect(anonymizeDialog).toBeVisible();
  await expect(
    anonymizeDialog.getByRole('button', {
      name: 'Yes, Anonymize Permanently',
    })
  ).toBeFocused();
  await anonymizeDialog
    .getByRole('button', { name: 'Yes, Anonymize Permanently' })
    .click();

  await expect(
    page.getByText('Anonymized', { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText(target.email, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Anonymize', exact: true })
  ).toHaveCount(0);

  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page
    .locator('form[action="/auth/logout"] button[type="submit"]')
    .click();
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(target.email);
  await page.locator('#password').fill(target.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
  await expect(
    page.getByText('Invalid credentials. Please try again.', { exact: true })
  ).toBeVisible();

  expectNoBrowserFailures(failures);
});

test('the create-user form reports validation and duplicate-account conflicts', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-user-validation', {
    role: 'admin',
  });
  const existing = await createManagedUser('admin-user-duplicate', {
    role: 'user',
  });

  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}/admin/users/new`);
  await page.locator('#email').fill(existing.email);
  await page.locator('#given_name').fill('Duplicate');
  await page.locator('#family_name').fill('Person');

  const submit = page.getByRole('button', { name: 'Create User' });
  await page.locator('#password').fill('Short1!');
  await page.locator('#confirm_password').fill('Short1!');
  await submit.click();
  const shortPasswordDialog = page.getByRole('dialog', {
    name: 'Invalid Password',
  });
  await expect(shortPasswordDialog).toContainText(
    'Password must be at least 8 characters long'
  );
  await shortPasswordDialog.getByRole('button', { name: 'OK' }).click();

  await page.locator('#password').fill('Strong1!');
  await page.locator('#confirm_password').fill('Different1!');
  await submit.click();
  const mismatchDialog = page.getByRole('dialog', {
    name: 'Password Mismatch',
  });
  await expect(mismatchDialog).toContainText('Passwords do not match');
  await mismatchDialog.getByRole('button', { name: 'OK' }).click();

  await page.locator('#password').fill('lowercase1!');
  await page.locator('#confirm_password').fill('lowercase1!');
  await submit.click();
  const weakPasswordDialog = page.getByRole('dialog', {
    name: 'Weak Password',
  });
  await expect(weakPasswordDialog).toContainText(
    'Password must contain uppercase and lowercase letters, numbers, and special characters'
  );
  await weakPasswordDialog.getByRole('button', { name: 'OK' }).click();

  await page.locator('#password').fill('Strong1!');
  await page.locator('#confirm_password').fill('Strong1!');
  await submit.click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/users/new`);
  const duplicateDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(duplicateDialog).toContainText('Email already exists');
  await duplicateDialog.getByRole('button', { name: 'OK' }).click();

  expectNoBrowserFailures(failures);
});

test('the user activity page renders empty and not-found recovery states', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-user-activity-empty', {
    role: 'admin',
  });
  const target = await createManagedUser('admin-activity-empty-target', {
    role: 'user',
  });
  const missingType = `missing-${randomUUID().slice(0, 8)}`;

  await loginAsAdmin(page, admin);
  await page.goto(
    `${IDP_ORIGIN}/admin/users/${target.id}/activities?type=${missingType}`
  );
  await expect(
    page.getByRole('heading', { name: 'No activities found' })
  ).toBeVisible();
  await expect(page.getByText(/for the selected activity type/)).toBeVisible();

  await page.goto(`${IDP_ORIGIN}/admin/users/${randomUUID()}/activities`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/users`);
  const missingUserDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(missingUserDialog).toContainText('User not found');
  await missingUserDialog.getByRole('button', { name: 'OK' }).click();

  expectNoBrowserFailures(failures);
});
