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
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Foidc-clients`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/oidc-clients`);
}

async function createWebClient(
  page: Page,
  values: { name: string; description: string; redirectUri: string }
) {
  await page.locator('a[href="/admin/oidc-clients/create"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/oidc-clients/create`);
  await page.locator('#client_name').fill(values.name);
  await page.locator('#description').fill(values.description);
  await page.locator('#redirect_uris').fill(values.redirectUri);
  await page.getByRole('button', { name: 'Create Client' }).click();
  await expect(page).toHaveURL(/\/admin\/oidc-clients\/view\/[^/]+$/);
}

test('an administrator can create, reveal, edit, and rediscover an OIDC client', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-lifecycle', {
    role: 'admin',
  });
  const suffix = randomUUID();
  const clientName = `Phase Two Client ${suffix}`;
  const updatedName = `Updated Phase Two Client ${suffix}`;
  const redirectUri = `https://rp-${suffix}.example.test/callback`;

  await loginAsAdmin(page, admin);
  await createWebClient(page, {
    name: clientName,
    description: 'Created through the admin browser',
    redirectUri,
  });
  await expect(
    page.getByRole('heading', { level: 1, name: clientName })
  ).toBeVisible();
  const detailUrl = page.url();
  const initialHtml = await page.content();
  await expect(page.locator('#client-secret')).toBeEmpty();
  await expect(page.locator('#client-secret')).toBeHidden();

  await page.getByRole('button', { name: 'Copy Client ID' }).click();
  await expect(page.getByText('Copied!', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show Sensitive Data' }).click();
  const revealedSecret = page.locator('#client-secret');
  await expect(revealedSecret).toBeVisible();
  await expect(revealedSecret).not.toBeEmpty();
  const secret = await revealedSecret.textContent();
  expect(secret).toBeTruthy();
  expect(initialHtml).not.toContain(secret!);

  await page.getByRole('link', { name: 'Edit Client' }).click();
  await expect(page).toHaveURL(/\/admin\/oidc-clients\/edit\/[^/]+$/);
  await page.locator('#client_name').fill(updatedName);
  await page.locator('#description').fill('Updated through the admin browser');
  await page.getByRole('button', { name: 'Update Client' }).click();

  await expect(page).toHaveURL(detailUrl);
  await expect(
    page.getByRole('heading', { level: 1, name: updatedName })
  ).toBeVisible();
  await expect(
    page.getByText('Updated through the admin browser', { exact: true })
  ).toBeVisible();

  await page.goto(
    `${IDP_ORIGIN}/admin/oidc-clients?search=${encodeURIComponent(updatedName)}`
  );
  await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
  await page.getByTitle('View Details').click();
  await expect(page).toHaveURL(detailUrl);
  expectNoBrowserFailures(failures);
});

test('an administrator confirms deactivation in an accessible dialog', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-deactivation', {
    role: 'admin',
  });
  const suffix = randomUUID();

  await loginAsAdmin(page, admin);
  await createWebClient(page, {
    name: `Deactivate Client ${suffix}`,
    description: 'Confirms destructive client changes',
    redirectUri: `https://deactivate-${suffix}.example.test/callback`,
  });

  const deactivateButton = page.getByRole('button', {
    name: 'Deactivate',
    exact: true,
  });
  await deactivateButton.click();
  const dialog = page.getByRole('dialog', {
    name: 'Deactivate OIDC Client',
  });
  await expect(dialog).toBeVisible();
  const confirmButton = dialog.getByRole('button', {
    name: 'Yes, Deactivate',
  });
  await expect(confirmButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(deactivateButton).toBeFocused();
  await expect(deactivateButton).toBeVisible();

  await deactivateButton.click();
  await dialog.getByRole('button', { name: 'Yes, Deactivate' }).click();
  await expect(
    page.getByRole('button', { name: 'Activate', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Deactivate', exact: true })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('an administrator regenerates a confidential client secret after confirmation', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-secret', {
    role: 'admin',
  });
  const suffix = randomUUID();

  await loginAsAdmin(page, admin);
  await createWebClient(page, {
    name: `Regenerate Client ${suffix}`,
    description: 'Rotates a confidential client secret',
    redirectUri: `https://regenerate-${suffix}.example.test/callback`,
  });

  await page.getByRole('button', { name: 'Show Sensitive Data' }).click();
  const secretElement = page.locator('#client-secret');
  await expect(secretElement).toBeVisible();
  await expect(secretElement).not.toBeEmpty();
  const originalSecret = await secretElement.textContent();
  expect(originalSecret).toBeTruthy();

  await page.getByRole('button', { name: 'Regenerate Secret' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Regenerate Client Secret',
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Yes, Regenerate Secret' }).click();

  await page.getByRole('button', { name: 'Show Sensitive Data' }).click();
  await expect(secretElement).toBeVisible();
  await expect(secretElement).not.toBeEmpty();
  const regeneratedSecret = await secretElement.textContent();
  expect(regeneratedSecret).toBeTruthy();
  expect(regeneratedSecret).not.toBe(originalSecret);
  expectNoBrowserFailures(failures);
});

test('an administrator cancels and then confirms permanent client deletion', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-delete', {
    role: 'admin',
  });
  const suffix = randomUUID();
  const clientName = `Delete Client ${suffix}`;

  await loginAsAdmin(page, admin);
  await createWebClient(page, {
    name: clientName,
    description: 'Confirms permanent client deletion',
    redirectUri: `https://delete-${suffix}.example.test/callback`,
  });

  const deleteButton = page.getByRole('button', { name: 'Delete Client' });
  await deleteButton.click();
  const dialog = page.getByRole('dialog', {
    name: 'Delete OIDC Client - Permanent Action',
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await dialog.getByRole('button', { name: 'Yes, Delete Permanently' }).click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/oidc-clients`);
  await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
  expectNoBrowserFailures(failures);
});

test('OIDC client sorting and pagination preserve the active list query', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-list-state', {
    role: 'admin',
  });
  const suffix = randomUUID();
  const searchPrefix = `List State ${suffix}`;
  const firstClient = `${searchPrefix} Alpha`;
  const secondClient = `${searchPrefix} Zulu`;

  await loginAsAdmin(page, admin);
  await createWebClient(page, {
    name: secondClient,
    description: 'Second sorted client',
    redirectUri: `https://list-zulu-${suffix}.example.test/callback`,
  });
  await page.goto(`${IDP_ORIGIN}/admin/oidc-clients`);
  await createWebClient(page, {
    name: firstClient,
    description: 'First sorted client',
    redirectUri: `https://list-alpha-${suffix}.example.test/callback`,
  });

  const query = new URLSearchParams({
    search: searchPrefix,
    application_type: 'web',
    status: 'active',
    sortBy: 'client_name',
    sortOrder: 'asc',
    limit: '1',
  });
  await page.goto(`${IDP_ORIGIN}/admin/oidc-clients?${query}`);

  await expect(page.locator('select[name="sortBy"]')).toHaveValue(
    'client_name'
  );
  await expect(page.getByText(firstClient, { exact: true })).toBeVisible();
  await expect(page.getByText(secondClient, { exact: true })).toHaveCount(0);

  const clientSortLink = page.getByRole('link', {
    name: 'Client',
    exact: true,
  });
  await expect(clientSortLink).toHaveAttribute('href', /sortOrder=desc/);
  await expect(clientSortLink).toHaveAttribute('href', /limit=1/);

  await clientSortLink.click();
  await expect(page).toHaveURL(/sortOrder=desc/);
  await expect(page.getByText(secondClient, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Client', exact: true }).click();
  await expect(page).toHaveURL(/sortOrder=asc/);
  await expect(page.getByText(firstClient, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/limit=1/);
  await expect(page).toHaveURL(/sortBy=client_name/);
  await expect(page).toHaveURL(/sortOrder=asc/);
  await expect(page.getByText(secondClient, { exact: true })).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('the quick-start cards apply each supported client preset in the browser', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-presets', {
    role: 'admin',
  });
  const grantType = (value: string) =>
    page.locator(`input[name="grant_types"][value="${value}"]`);

  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}/admin/oidc-clients/create`);

  await page.locator('[data-preset="spa"]').click();
  await expect(page.locator('#preset')).toHaveValue('spa');
  await expect(page.locator('#application_type')).toHaveValue('web');
  await expect(page.locator('#token_endpoint_auth_method')).toHaveValue('none');
  await expect(page.locator('#require_pkce')).toBeChecked();
  await expect(grantType('authorization_code')).toBeChecked();
  await expect(grantType('refresh_token')).toBeChecked();

  await page.locator('[data-preset="native"]').click();
  await expect(page.locator('#application_type')).toHaveValue('native');
  await expect(page.locator('#token_endpoint_auth_method')).toHaveValue('none');
  await expect(page.locator('#require_pkce')).toBeChecked();

  await page.locator('[data-preset="m2m"]').click();
  await expect(page.locator('#application_type')).toHaveValue('web');
  await expect(page.locator('#token_endpoint_auth_method')).toHaveValue(
    'client_secret_basic'
  );
  await expect(page.locator('#require_pkce')).not.toBeChecked();
  await expect(grantType('client_credentials')).toBeChecked();
  await expect(page.locator('#management-api-scopes-section')).toBeVisible();
  await expect(page.locator('#custom-resource-sub-section')).toBeVisible();
  await expect(page.locator('#mgmt-api-scope-sub-section')).toBeHidden();

  await page.locator('[data-preset="device"]').click();
  await expect(page.locator('#application_type')).toHaveValue('native');
  await expect(page.locator('#token_endpoint_auth_method')).toHaveValue(
    'client_secret_post'
  );
  await expect(
    grantType('urn:ietf:params:oauth:grant-type:device_code')
  ).toBeChecked();
  await expect(page.locator('#scope')).toHaveValue(/offline_access/);

  await page.locator('[data-preset="api_management"]').click();
  await expect(page.locator('#preset')).toHaveValue('api_management');
  await expect(grantType('client_credentials')).toBeChecked();
  await expect(page.locator('#custom-resource-sub-section')).toBeHidden();
  await expect(page.locator('#mgmt-api-scope-sub-section')).toBeVisible();

  const platformScope = page.locator(
    'input[name="api_scopes"][value="parako:tenants:read"]'
  );
  if (process.env.PARAKO_E2E_MULTI_TENANCY === 'true') {
    await expect(platformScope).toHaveCount(0);
  } else {
    await expect(platformScope).toHaveCount(1);
  }
  expectNoBrowserFailures(failures);
});

test('the client form rejects unsafe redirect metadata without creating a client', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-invalid', {
    role: 'admin',
  });
  const clientName = `Invalid Client ${randomUUID()}`;

  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}/admin/oidc-clients/create`);
  await page.locator('#client_name').fill(clientName);
  await page.locator('#redirect_uris').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Create Client' }).click();

  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/oidc-clients/create`);
  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    'Dangerous protocol not allowed in redirect_uri'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await page.goto(
    `${IDP_ORIGIN}/admin/oidc-clients?search=${encodeURIComponent(clientName)}`
  );
  await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
  expectNoBrowserFailures(failures);
});

test('the admin UI reports a missing OIDC client and returns to the list', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-client-missing', {
    role: 'admin',
  });

  await loginAsAdmin(page, admin);
  await page.goto(`${IDP_ORIGIN}/admin/oidc-clients/view/${randomUUID()}`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/oidc-clients`);
  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText('OIDC client not found');
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  expectNoBrowserFailures(failures);
});

test('an ordinary user cannot access OIDC client administration', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-client-denied');

  await page.goto(
    `${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Foidc-clients%2Fcreate`
  );
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/admin/oidc-clients/create`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create OIDC Client' })
  ).toHaveCount(0);
  expectNoBrowserFailures(failures);
});
