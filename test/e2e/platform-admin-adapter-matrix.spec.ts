import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';
import {
  apiRequest,
  issueManagementToken,
  machineClient,
} from './support/deployment-management-api.js';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import {
  startMongoMultiTenantParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';

const PLATFORM_CLIENT_ID = 'parako-platform-browser-e2e';
const TENANT_CLIENT_ID = 'parako-tenant-browser-e2e';
// gitleaks:allow -- deterministic credentials for disposable local E2E clients.
const PLATFORM_CLIENT_SECRET = 'platform-browser-e2e-secret-long-enough';
// gitleaks:allow -- deterministic credentials for disposable local E2E clients.
const TENANT_CLIENT_SECRET = 'tenant-browser-e2e-secret-long-enough';
// gitleaks:allow -- deterministic password for disposable local E2E users.
const USER_PASSWORD = 'E2E-Platform-Admin!9';
const USERS_SCOPE = 'parako:users:write';
const TENANT_ID = 'tenant-a';
const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const GLOBAL_SETTINGS_ROUTES = [
  '/admin/settings/application',
  '/admin/settings/branding',
  '/admin/settings/security',
  '/admin/settings/features',
  '/admin/settings/oidc',
  '/admin/settings/integrations',
] as const;

interface MultiTenantRuntime {
  issuer(tenantId: string): string;
  stop(): Promise<void>;
}

interface ManagedUser {
  email: string;
  password: string;
}

interface ApiEnvelope<T> {
  data: T;
}

const tenants = [{ slug: TENANT_ID, display_name: 'Tenant A' }];

const clients = [
  {
    tenantId: '_platforms',
    client: machineClient({
      clientId: PLATFORM_CLIENT_ID,
      clientSecret: PLATFORM_CLIENT_SECRET,
      scopes: USERS_SCOPE,
    }),
  },
  {
    tenantId: TENANT_ID,
    client: machineClient({
      clientId: TENANT_CLIENT_ID,
      clientSecret: TENANT_CLIENT_SECRET,
      scopes: USERS_SCOPE,
    }),
  },
];

async function createManagedUser({
  issuer,
  clientId,
  clientSecret,
  prefix,
  role,
}: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  prefix: string;
  role: 'admin' | 'superadmin' | 'platform_admin' | 'platform_viewer';
}): Promise<ManagedUser> {
  const token = await issueManagementToken({
    issuer,
    clientId,
    clientSecret,
    scope: USERS_SCOPE,
  });
  const suffix = randomUUID();
  const email = `${prefix}-${suffix}@example.test`;
  const username = `${prefix.slice(0, 15)}-${suffix.replaceAll('-', '')}`;
  const response = await apiRequest(new URL(issuer).origin, '/users', {
    method: 'POST',
    token,
    body: JSON.stringify({
      email,
      username,
      password: USER_PASSWORD,
      given_name: 'Platform',
      family_name: role === 'platform_viewer' ? 'Viewer' : 'Administrator',
      name: `Platform ${role}`,
      role,
    }),
  });

  expect(response.status, await response.clone().text()).toBe(201);
  const created = (await response.json()) as ApiEnvelope<{ email: string }>;

  return { email: created.data.email, password: USER_PASSWORD };
}

async function login(
  page: Page,
  origin: string,
  credentials: ManagedUser
): Promise<void> {
  await page.goto(
    `${origin}/auth/login?continue=${encodeURIComponent('/admin/tenants')}`
  );
  await expect(page.locator('#login')).toBeVisible();
  await page.locator('#login').fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForURL(url => url.pathname !== '/auth/login');
}

async function submitGlobalOidcSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm OIDC Configuration Changes',
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Yes, Save Changes' }).click();
}

async function exerciseGlobalSettings(
  page: Page,
  platformOrigin: string
): Promise<void> {
  for (const route of GLOBAL_SETTINGS_ROUTES) {
    const response = await page.goto(`${platformOrigin}${route}`);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator(`form[action="${route}"]`)).toBeVisible();
  }

  await page.goto(`${platformOrigin}/admin/settings/features`);
  const helpfulErrors = page.getByLabel('Show Helpful Errors', {
    exact: true,
  });
  await expect(helpfulErrors).toBeVisible();
  const originalHelpfulErrors = await helpfulErrors.isChecked();
  let featuresSaved = false;
  let oidcSaved = false;
  let originalAccessTokenTtl = '';

  try {
    await helpfulErrors.setChecked(!originalHelpfulErrors);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    featuresSaved = true;
    await expect(page).toHaveURL(`${platformOrigin}/admin/settings/features`);
    await expect(helpfulErrors).toBeChecked({
      checked: !originalHelpfulErrors,
    });
    await page.reload();
    await expect(helpfulErrors).toBeChecked({
      checked: !originalHelpfulErrors,
    });

    await page.goto(`${platformOrigin}/admin/settings/oidc`);
    const accessTokenTtl = page.getByLabel('Access Token');
    originalAccessTokenTtl = await accessTokenTtl.inputValue();
    const updatedAccessTokenTtl =
      originalAccessTokenTtl === '1801' ? '1802' : '1801';
    await accessTokenTtl.fill(updatedAccessTokenTtl);
    await submitGlobalOidcSettings(page);
    oidcSaved = true;
    await expect(page).toHaveURL(`${platformOrigin}/admin/settings/oidc`);
    await expect(accessTokenTtl).toHaveValue(updatedAccessTokenTtl);
    await page.reload();
    await expect(accessTokenTtl).toHaveValue(updatedAccessTokenTtl);
  } finally {
    if (oidcSaved) {
      await page.goto(`${platformOrigin}/admin/settings/oidc`);
      await page.getByLabel('Access Token').fill(originalAccessTokenTtl);
      await submitGlobalOidcSettings(page);
      await expect(page.getByLabel('Access Token')).toHaveValue(
        originalAccessTokenTtl
      );
    }
    if (featuresSaved) {
      await page.goto(`${platformOrigin}/admin/settings/features`);
      await page
        .getByLabel('Show Helpful Errors', { exact: true })
        .setChecked(originalHelpfulErrors);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(
        page.getByLabel('Show Helpful Errors', { exact: true })
      ).toBeChecked({ checked: originalHelpfulErrors });
    }
  }
}

async function exerciseGlobalApplicationConflict(
  browser: Browser,
  firstPage: Page,
  platformOrigin: string,
  credentials: ManagedUser
): Promise<void> {
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const failures = observeBrowserFailures(secondPage);
  let firstSaveCompleted = false;
  let originalTitle = '';
  let originalDescription = '';

  try {
    await login(secondPage, platformOrigin, credentials);
    await firstPage.goto(`${platformOrigin}/admin/settings/application`);
    await secondPage.goto(`${platformOrigin}/admin/settings/application`);

    const firstVersion = firstPage.locator('input[name="_configVersion"]');
    const secondVersion = secondPage.locator('input[name="_configVersion"]');
    await expect(firstVersion).toHaveValue(/\d+/);
    await expect(secondVersion).toHaveValue(await firstVersion.inputValue());

    const firstTitle = firstPage.getByLabel('Application Title');
    const firstDescription = firstPage.getByLabel('Description');
    const secondTitle = secondPage.getByLabel('Application Title');
    originalTitle = await firstTitle.inputValue();
    originalDescription = await firstDescription.inputValue();
    const winningTitle = `${originalTitle} first save`;

    await firstTitle.fill(winningTitle);
    await firstPage.getByRole('button', { name: 'Save Changes' }).click();
    firstSaveCompleted = true;
    await expect(firstPage).toHaveURL(
      `${platformOrigin}/admin/settings/application`
    );
    await expect(firstTitle).toHaveValue(winningTitle);

    await secondTitle.fill(`${originalTitle} stale save`);
    await secondPage.getByRole('button', { name: 'Save Changes' }).click();
    await expect(secondPage).toHaveURL(
      `${platformOrigin}/admin/settings/application`
    );
    const conflictDialog = secondPage.getByRole('dialog', { name: 'Error' });
    await expect(conflictDialog).toContainText(
      'Configuration was modified by another administrator'
    );
    await conflictDialog.getByRole('button', { name: 'OK' }).click();
    await expect(secondTitle).toHaveValue(winningTitle);
    await secondPage.reload();
    await expect(secondTitle).toHaveValue(winningTitle);
  } finally {
    if (firstSaveCompleted) {
      await firstPage.goto(`${platformOrigin}/admin/settings/application`);
      await firstPage.getByLabel('Application Title').fill(originalTitle);
      await firstPage.getByLabel('Description').fill(originalDescription);
      await firstPage.getByRole('button', { name: 'Save Changes' }).click();
      await expect(firstPage.getByLabel('Application Title')).toHaveValue(
        originalTitle
      );
    }

    await secondContext.close();
  }

  expectNoBrowserFailures(failures);
}

async function runPlatformAdministrationScenario(
  browser: Browser,
  runtime: MultiTenantRuntime
): Promise<void> {
  const platformIssuer = runtime.issuer('_platforms');
  const tenantIssuer = runtime.issuer(TENANT_ID);
  const platformOrigin = new URL(platformIssuer).origin;
  const tenantOrigin = new URL(tenantIssuer).origin;
  const [platformAdmin, platformViewer, platformSuperadmin, tenantAdmin] =
    await Promise.all([
      createManagedUser({
        issuer: platformIssuer,
        clientId: PLATFORM_CLIENT_ID,
        clientSecret: PLATFORM_CLIENT_SECRET,
        prefix: 'platform-admin',
        role: 'platform_admin',
      }),
      createManagedUser({
        issuer: platformIssuer,
        clientId: PLATFORM_CLIENT_ID,
        clientSecret: PLATFORM_CLIENT_SECRET,
        prefix: 'platform-viewer',
        role: 'platform_viewer',
      }),
      createManagedUser({
        issuer: platformIssuer,
        clientId: PLATFORM_CLIENT_ID,
        clientSecret: PLATFORM_CLIENT_SECRET,
        prefix: 'platform-superadmin',
        role: 'superadmin',
      }),
      createManagedUser({
        issuer: tenantIssuer,
        clientId: TENANT_CLIENT_ID,
        clientSecret: TENANT_CLIENT_SECRET,
        prefix: 'tenant-admin',
        role: 'admin',
      }),
    ]);

  const contexts = [];

  try {
    const anonymousContext = await browser.newContext();
    contexts.push(anonymousContext);
    const anonymousPage = await anonymousContext.newPage();
    const anonymousFailures = observeBrowserFailures(anonymousPage);
    await anonymousPage.goto(`${platformOrigin}/admin/tenants`);
    await expect(anonymousPage).toHaveURL(
      `${platformOrigin}/auth/login?continue=%2Fadmin%2Ftenants`
    );
    expectNoBrowserFailures(anonymousFailures);

    const adminContext = await browser.newContext();
    contexts.push(adminContext);
    const adminPage = await adminContext.newPage();
    const adminFailures = observeBrowserFailures(adminPage);
    await login(adminPage, platformOrigin, platformAdmin);
    await expect(adminPage).toHaveURL(`${platformOrigin}/admin/tenants`);
    await expect(
      adminPage.getByRole('heading', { name: 'Tenant Management' })
    ).toBeVisible();
    const newTenantLink = adminPage.locator('a[href="/admin/tenants/new"]');
    await expect(newTenantLink).toBeVisible();

    await newTenantLink.click();
    await adminPage.locator('#slug').fill('browser-created');
    await adminPage.locator('#display_name').fill('Browser Tenant');
    await adminPage
      .locator('#domain')
      .fill('Browser-Created.Parako.Localhost.');
    await adminPage.getByRole('button', { name: 'Create Tenant' }).click();
    await expect(adminPage).toHaveURL(
      `${platformOrigin}/admin/tenants/browser-created`
    );
    await expect(
      adminPage.getByRole('heading', { name: 'Browser Tenant' })
    ).toBeVisible();
    const tenantDomainValue = adminPage
      .locator('label')
      .filter({ hasText: /^Domain$/ })
      .locator('..')
      .locator('p');
    await expect(tenantDomainValue).toHaveText(
      'browser-created.parako.localhost'
    );

    await adminPage.getByRole('link', { name: 'Edit', exact: true }).click();
    await adminPage.locator('#display_name').fill('Browser Tenant Updated');
    await adminPage.locator('#domain').fill('Updated.Parako.Localhost.');
    await adminPage.getByRole('button', { name: 'Save Changes' }).click();
    await expect(adminPage).toHaveURL(
      `${platformOrigin}/admin/tenants/browser-created`
    );
    await expect(
      adminPage.getByRole('heading', { name: 'Browser Tenant Updated' })
    ).toBeVisible();
    await expect(tenantDomainValue).toHaveText('updated.parako.localhost');

    await adminPage.getByRole('button', { name: 'Suspend' }).click();
    await expect(adminPage).toHaveURL(
      `${platformOrigin}/admin/tenants/browser-created`
    );
    await expect(
      adminPage.getByText('suspended', { exact: true })
    ).toBeVisible();

    await adminPage.getByRole('button', { name: 'Activate' }).click();
    await expect(adminPage.getByText('active', { exact: true })).toBeVisible();

    await adminPage.getByRole('button', { name: 'Suspend' }).click();
    await expect(
      adminPage.getByText('suspended', { exact: true })
    ).toBeVisible();
    await adminPage.getByRole('button', { name: 'Archive' }).click();
    await expect(
      adminPage.getByText('archived', { exact: true })
    ).toBeVisible();
    const archivedDiscovery = await adminContext.request.get(
      `http://updated.parako.localhost:${new URL(platformOrigin).port}/oidc/v1/.well-known/openid-configuration`
    );
    expect(archivedDiscovery.status()).toBe(403);
    await expect(archivedDiscovery.json()).resolves.toEqual({
      error: 'Tenant is not active',
    });

    await adminPage.getByRole('button', { name: 'Activate' }).click();
    await expect(adminPage.getByText('active', { exact: true })).toBeVisible();

    await adminPage.goto(`${platformOrigin}/admin/tenants/_platforms`);
    const masterHeading = adminPage.getByRole('heading', { level: 1 });
    const originalMasterName = await masterHeading.textContent();
    expect(originalMasterName?.trim()).toBeTruthy();
    await expect(
      adminPage.locator('a[href="/admin/tenants/_platforms/edit"]')
    ).toHaveCount(0);
    await expect(
      adminPage.getByRole('button', { name: /Suspend|Activate|Archive/ })
    ).toHaveCount(0);

    const masterCsrf = await adminPage
      .locator('input[name="_csrf"]')
      .first()
      .inputValue();
    const protectedEditPage = await adminContext.request.get(
      `${platformOrigin}/admin/tenants/_platforms/edit`
    );
    expect(protectedEditPage.status()).toBe(403);
    expect(await protectedEditPage.text()).toContain(
      'The platform master tenant cannot be modified'
    );

    const protectedEdit = await adminContext.request.post(
      `${platformOrigin}/admin/tenants/_platforms/edit`,
      {
        form: {
          _csrf: masterCsrf,
          display_name: 'Compromised Platform Tenant',
        },
      }
    );
    expect(protectedEdit.status()).toBe(403);
    const protectedStatus = await adminContext.request.post(
      `${platformOrigin}/admin/tenants/_platforms/status`,
      {
        form: { _csrf: masterCsrf, status: 'suspended' },
      }
    );
    expect(protectedStatus.status()).toBe(403);
    await adminPage.reload();
    await expect(masterHeading).toHaveText(originalMasterName!.trim());
    await expect(adminPage.getByText('active', { exact: true })).toBeVisible();
    await expect(adminPage.locator('a[href="/admin/users"]')).toHaveCount(0);
    await expect(adminPage.locator('a[href="/admin/settings"]')).toHaveCount(0);
    await expect(
      adminPage.locator('a[href="/admin/configuration"]')
    ).toHaveCount(0);
    const platformAdminSettingsBoundary = await adminContext.request.get(
      `${platformOrigin}/admin/settings`,
      { maxRedirects: 0 }
    );
    expect(platformAdminSettingsBoundary.status()).toBe(302);
    expect(platformAdminSettingsBoundary.headers().location).toBe('/accounts/');
    expectNoBrowserFailures(adminFailures);

    const superadminContext = await browser.newContext();
    contexts.push(superadminContext);
    const superadminPage = await superadminContext.newPage();
    const superadminFailures = observeBrowserFailures(superadminPage);
    await login(superadminPage, platformOrigin, platformSuperadmin);
    await expect(superadminPage).toHaveURL(`${platformOrigin}/admin/tenants`);
    await expect(
      superadminPage.getByRole('heading', { name: 'Tenant Management' })
    ).toBeVisible();
    await superadminPage.locator('a[href="/admin/tenants/new"]').click();
    await superadminPage.locator('#slug').fill('superadmin-created');
    await superadminPage
      .locator('#display_name')
      .fill('Superadmin Browser Tenant');
    await superadminPage.locator('#domain').fill('UPDATED.PARAKO.LOCALHOST');
    await superadminPage.getByRole('button', { name: 'Create Tenant' }).click();
    await expect(superadminPage).toHaveURL(
      `${platformOrigin}/admin/tenants/new`
    );
    await expect(
      superadminPage.getByText(/domain.*already exists/i)
    ).toBeVisible();
    await superadminPage.locator('#domain').fill('');
    await superadminPage.getByRole('button', { name: 'Create Tenant' }).click();
    await expect(superadminPage).toHaveURL(
      `${platformOrigin}/admin/tenants/superadmin-created`
    );
    await expect(
      superadminPage.getByRole('heading', {
        name: 'Superadmin Browser Tenant',
      })
    ).toBeVisible();
    await superadminPage.goto(`${platformOrigin}/admin/tenants`);
    await expect(
      superadminPage.locator('#sidebar a[href="/admin/settings"]')
    ).toBeVisible();
    await exerciseGlobalSettings(superadminPage, platformOrigin);
    await exerciseGlobalApplicationConflict(
      browser,
      superadminPage,
      platformOrigin,
      platformSuperadmin
    );
    expectNoBrowserFailures(superadminFailures);

    const viewerContext = await browser.newContext();
    contexts.push(viewerContext);
    const viewerPage = await viewerContext.newPage();
    const viewerFailures = observeBrowserFailures(viewerPage);
    await login(viewerPage, platformOrigin, platformViewer);
    await expect(viewerPage).toHaveURL(`${platformOrigin}/admin/tenants`);
    await expect(
      viewerPage.getByRole('heading', { name: 'Tenant Management' })
    ).toBeVisible();
    await expect(
      viewerPage.locator('a[href="/admin/tenants/new"]')
    ).toHaveCount(0);
    await expect(viewerPage.locator('a[href="/admin/users"]')).toHaveCount(0);
    await expect(viewerPage.locator('a[href="/admin/settings"]')).toHaveCount(
      0
    );
    const viewerSettingsBoundary = await viewerContext.request.get(
      `${platformOrigin}/admin/settings`,
      { maxRedirects: 0 }
    );
    expect(viewerSettingsBoundary.status()).toBe(302);
    expect(viewerSettingsBoundary.headers().location).toBe('/accounts/');

    const tenantRow = viewerPage
      .locator('tr')
      .filter({ hasText: 'Browser Tenant Updated' });
    await expect(tenantRow).toBeVisible();
    await expect(tenantRow.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await tenantRow.getByRole('link', { name: 'View' }).click();
    await expect(viewerPage).toHaveURL(
      `${platformOrigin}/admin/tenants/browser-created`
    );
    await expect(
      viewerPage.getByRole('link', { name: 'Edit', exact: true })
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole('button', { name: /Suspend|Activate|Archive/ })
    ).toHaveCount(0);

    const blockedWrite = await viewerContext.request.post(
      `${platformOrigin}/admin/tenants/browser-created/status`,
      {
        form: { status: 'archived' },
        maxRedirects: 0,
      }
    );
    expect(blockedWrite.status()).toBe(403);
    await expect(blockedWrite.json()).resolves.toEqual({
      error: 'Write access requires platform_admin',
    });
    await viewerPage.reload();
    await expect(viewerPage.getByText('active', { exact: true })).toBeVisible();
    expectNoBrowserFailures(viewerFailures);

    const tenantAdminContext = await browser.newContext();
    contexts.push(tenantAdminContext);
    const tenantAdminPage = await tenantAdminContext.newPage();
    const tenantAdminFailures = observeBrowserFailures(tenantAdminPage);
    await login(tenantAdminPage, tenantOrigin, tenantAdmin);
    await expect(tenantAdminPage).toHaveURL(
      `${tenantOrigin}/admin/configuration`
    );

    const tenantBoundary = await tenantAdminContext.request.get(
      `${tenantOrigin}/admin/tenants`,
      { maxRedirects: 0 }
    );
    expect(tenantBoundary.status()).toBe(302);
    expect(tenantBoundary.headers().location).toBe('/admin/configuration');
    const tenantSettingsBoundary = await tenantAdminContext.request.get(
      `${tenantOrigin}/admin/settings`,
      { maxRedirects: 0 }
    );
    expect(tenantSettingsBoundary.status()).toBe(302);
    expect(tenantSettingsBoundary.headers().location).toBe(
      '/admin/configuration'
    );
    await expect(
      tenantAdminPage.getByRole('heading', { name: 'Tenant Management' })
    ).toHaveCount(0);
    expectNoBrowserFailures(tenantAdminFailures);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

test.describe('platform administration adapter matrix', () => {
  // Each case exercises the full cross-role browser lifecycle against one real
  // multi-tenant adapter runtime; individual assertions retain the shorter
  // timeout from the shared Playwright configuration.
  test.describe.configure({ timeout: 240_000 });

  test('enforces platform roles and tenant isolation on MongoDB', async ({
    browser,
  }) => {
    const runtime = await startMongoMultiTenantParakoInstance({
      port: 19520,
      tenants,
      clients,
    });

    try {
      await runPlatformAdministrationScenario(browser, runtime);
    } finally {
      await runtime.stop();
    }
  });

  test('enforces platform roles and tenant isolation on PostgreSQL', async ({
    browser,
  }) => {
    const runtime = await startPostgresqlParakoInstance({
      port: 19521,
      postgresqlUrl: POSTGRESQL_URL,
      multiTenancy: true,
      tenants,
      clients,
    });

    try {
      await runPlatformAdministrationScenario(browser, runtime);
    } finally {
      await runtime.stop();
    }
  });
});
