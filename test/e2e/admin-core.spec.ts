import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

const RP_ORIGIN = 'http://127.0.0.1:19010';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';
import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';
import { currentSessionId } from './support/browser-session.js';

async function loginAsAdmin(page: Page, admin: ManagedUserFixture) {
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin`);
}

async function setActivityStorageAvailability(
  request: APIRequestContext,
  available: boolean
): Promise<void> {
  const response = await request.post(
    `${RP_ORIGIN}/test-control/activity-storage/availability`,
    { data: { available } }
  );
  expect(response.status()).toBe(204);
}

test('an administrator can enter, navigate, and leave the control panel', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const anonymousResponse = await page.goto(`${IDP_ORIGIN}/admin`);
  expect(anonymousResponse?.status()).toBe(200);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);

  const admin = await createManagedUser('admin-core', { role: 'admin' });
  await loginAsAdmin(page, admin);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const response = await page.goto(`${IDP_ORIGIN}/admin`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Control panel' })
    ).toBeVisible();
    await expect(page.locator('#main-content')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Array.from(document.styleSheets).filter(sheet => sheet.href).length
        )
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  }

  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page
    .locator('form[action="/auth/logout"] button[type="submit"]')
    .click();
  await expect(
    page.getByRole('heading', { name: /signed out successfully/i })
  ).toBeVisible();

  await page.goto(`${IDP_ORIGIN}/admin`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  expectNoBrowserFailures(failures);
});

test('an expired administrator session requires authentication and resumes the requested page', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-session-expiry', {
    role: 'admin',
  });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, admin);
  const expiry = await request.post(
    `${RP_ORIGIN}/test-control/application-session-expiry`,
    { data: { sessionId: await currentSessionId(page) } }
  );
  expect(expiry.status()).toBe(204);

  await page.goto(`${IDP_ORIGIN}/admin`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, admin);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Control panel' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('an administrator theme change applies immediately and survives navigation', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-theme', { role: 'admin' });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, admin);
  const initialTheme = await page
    .locator('html')
    .evaluate(element =>
      element.classList.contains('dark') ? 'dark' : 'light'
    );
  const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark';
  const updateResponse = page.waitForResponse(response => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/auth/update-theme'
    );
  });

  await page.locator('#theme-toggle').click();
  expect((await updateResponse).status()).toBe(200);
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate(element =>
          element.classList.contains('dark') ? 'dark' : 'light'
        )
    )
    .toBe(expectedTheme);

  await page.goto(`${IDP_ORIGIN}/admin/users`);
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate(element =>
          element.classList.contains('dark') ? 'dark' : 'light'
        )
    )
    .toBe(expectedTheme);
  expectNoBrowserFailures(failures);
});

test('an authenticated ordinary user cannot enter the control panel', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-denied');

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/admin`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browser User' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});

test('an administrator receives a styled recoverable page for an HTML CSRF denial', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-csrf-denial', { role: 'admin' });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, admin);

  const forbiddenResponsePromise = page.waitForResponse(response => {
    const request = response.request();
    return (
      new URL(response.url()).pathname === '/admin/update-theme' &&
      request.method() === 'POST'
    );
  });
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/admin/update-theme';
    document.body.append(form);
    form.submit();
  });

  const forbiddenResponse = await forbiddenResponsePromise;
  expect(forbiddenResponse.status()).toBe(403);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/update-theme`);
  await expect(
    page.getByRole('heading', { level: 1, name: '403' })
  ).toBeVisible();
  await expect(page.locator('[data-error-action="back"]')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.styleSheets).filter(sheet => sheet.href).length
      )
    )
    .toBeGreaterThanOrEqual(2);

  await page.locator('[data-error-action="back"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Control panel' })
  ).toBeVisible();
  expect(failures.consoleErrors).toEqual([
    expect.stringContaining('403 (Forbidden)'),
  ]);
  expect(failures.failedAssets).toEqual([]);
  expect(failures.failedRequests).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});

test('a superadmin receives full tenant administration without crossing the platform boundary', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const superadmin = await createManagedUser('admin-superadmin', {
    role: 'superadmin',
  });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, superadmin);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Control panel' })
  ).toBeVisible();

  const settingsResponse = await page.goto(`${IDP_ORIGIN}/admin/settings`);
  expect(settingsResponse?.status()).toBe(200);
  if (MULTI_TENANT) {
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/configuration`);
    await expect(page.getByRole('dialog', { name: 'Error' })).toContainText(
      'Platform settings are only accessible from the platform admin portal.'
    );
  } else {
    await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/settings`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Settings' })
    ).toBeVisible();
  }

  expectNoBrowserFailures(failures);
});

test('localized admin navigation stays in French and keeps its route prefix', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-localized', { role: 'admin' });

  await page.goto(`${IDP_ORIGIN}/fr/admin`);
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/fr/auth/login?continue=%2Ffr%2Fadmin`
  );
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page).toHaveURL(`${IDP_ORIGIN}/fr/admin`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  const usersLink = page
    .locator('#sidebar')
    .getByRole('link', { name: 'Utilisateurs' });
  await expect(usersLink).toHaveAttribute('href', '/fr/admin/users');
  await usersLink.click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/fr/admin/users`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#main-content')).toBeVisible();

  expectNoBrowserFailures(failures);
});

const ADMIN_READ_PAGES: ReadonlyArray<{
  path: string;
  heading: string | RegExp;
}> = [
  { path: '/admin', heading: 'Control panel' },
  { path: '/admin/users', heading: 'User Management' },
  { path: '/admin/oidc-clients', heading: 'OIDC Clients' },
  { path: '/admin/jwks', heading: 'JWKS Key Management' },
  { path: '/admin/activities', heading: 'User Activities' },
  { path: '/admin/sessions', heading: 'User Sessions' },
  { path: '/admin/user-grants', heading: 'App Authorizations' },
  { path: '/admin/data-transfer', heading: /^(Data|Données)$/ },
  { path: '/admin/settings', heading: 'Settings' },
  { path: '/admin/configuration', heading: 'Configuration' },
];

const MULTI_TENANT = process.env.PARAKO_E2E_MULTI_TENANCY === 'true';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'narrow', width: 390, height: 844 },
] as const) {
  test(`an administrator can navigate every core read-only admin page at ${viewport.name} width`, async ({
    page,
  }) => {
    const failures = observeBrowserFailures(page);
    const admin = await createManagedUser(`admin-navigation-${viewport.name}`, {
      role: 'admin',
    });

    await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
    await loginAsAdmin(page, admin);
    await page.setViewportSize(viewport);

    for (const adminPage of ADMIN_READ_PAGES.filter(
      pageContract => !MULTI_TENANT || pageContract.path !== '/admin/settings'
    )) {
      const response = await page.goto(`${IDP_ORIGIN}${adminPage.path}`);
      expect(response?.status(), adminPage.path).toBe(200);
      await expect(page).toHaveURL(`${IDP_ORIGIN}${adminPage.path}`);
      await expect(
        page.getByRole('heading', { level: 1, name: adminPage.heading })
      ).toBeVisible();
      await expect(page.locator('#main-content')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        adminPage.path
      ).toBe(true);
    }

    if (MULTI_TENANT) {
      const deniedResponse = await page.goto(`${IDP_ORIGIN}/admin/settings`);
      expect(deniedResponse?.status()).toBe(200);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/configuration`);
      await expect(page.getByRole('dialog', { name: 'Error' })).toContainText(
        'Platform settings are only accessible from the platform admin portal.'
      );
      await page.getByRole('button', { name: 'OK' }).click();
    }

    expectNoBrowserFailures(failures);
  });
}

test('the dashboard preserves healthy statistics when activity storage is unavailable', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-dashboard-partial-failure', {
    role: 'admin',
  });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, admin);
  const applications = page.locator('[data-dashboard-stat="oidc"]');
  const expectedApplications = await applications
    .locator('.text-2xl')
    .textContent();

  await setActivityStorageAvailability(request, false);

  try {
    const response = await page.goto(`${IDP_ORIGIN}/admin`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Control panel' })
    ).toBeVisible();
    await expect(
      page.getByLabel('Activity statistics unavailable')
    ).toBeVisible();
    await expect(applications.locator('.text-2xl')).toHaveText(
      expectedApplications ?? ''
    );
  } finally {
    await setActivityStorageAvailability(request, true);
  }

  expectNoBrowserFailures(failures);
});

test('an administrator receives a styled recoverable page for an unexpected HTML failure', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-server-error', {
    role: 'admin',
  });

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin`);
  await loginAsAdmin(page, admin);

  let detailHref = '';
  await expect
    .poll(async () => {
      const response = await page.goto(`${IDP_ORIGIN}/admin/activities`);
      expect(response?.status()).toBe(200);
      detailHref =
        (await page.getByTitle('View Details').first().getAttribute('href')) ??
        '';
      return detailHref;
    })
    .toMatch(/^\/admin\/activities\/[A-Za-z0-9_-]+$/);

  await setActivityStorageAvailability(request, false);
  let storageUnavailable = true;

  try {
    const errorResponse = await page.goto(`${IDP_ORIGIN}${detailHref}`);
    expect(errorResponse?.status()).toBe(500);
    await expect(
      page.getByRole('heading', { level: 1, name: '500' })
    ).toBeVisible();
    const retry = page.locator('[data-error-action="reload"]');
    await expect(retry).toHaveRole('button');
    await expect(retry).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Array.from(document.styleSheets).filter(sheet => sheet.href).length
        )
      )
      .toBeGreaterThanOrEqual(2);

    await setActivityStorageAvailability(request, true);
    storageUnavailable = false;
    await retry.click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}${detailHref}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Activity Details' })
    ).toBeVisible();
  } finally {
    if (storageUnavailable) {
      await setActivityStorageAvailability(request, true);
    }
  }

  expect(failures.consoleErrors).toEqual([
    expect.stringContaining('500 (Internal Server Error)'),
  ]);
  expect(failures.failedAssets).toEqual([]);
  expect(failures.failedRequests).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});
