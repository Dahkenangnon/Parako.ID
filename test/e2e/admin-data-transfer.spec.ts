import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type Download,
  type Page,
  type Response,
} from '@playwright/test';
import Papa from 'papaparse';

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

type DownloadResult = {
  body: string;
  download: Download;
  response: Response;
};

async function loginAsAdmin(
  page: Page,
  admin: ManagedUserFixture,
  continuePath = '/admin/data-transfer'
): Promise<void> {
  const continueUrl = encodeURIComponent(continuePath);
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=${continueUrl}`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}${continuePath}`);
}

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function captureDownload(
  page: Page,
  failures: BrowserFailures,
  pathname: string,
  action: () => Promise<unknown>
): Promise<DownloadResult> {
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === pathname && response.status() === 200;
  });
  const downloadPromise = page.waitForEvent('download');
  await action();
  const [download, response] = await Promise.all([
    downloadPromise,
    responsePromise,
  ]);
  // Chromium reports a successful navigation download as an aborted
  // document request. Remove only the exact request already proven by the
  // matching 200 response and download event above.
  const expectedAbort = `GET ${response.url()}`;
  const expectedAbortIndex = failures.failedRequests.indexOf(expectedAbort);
  if (expectedAbortIndex >= 0) {
    failures.failedRequests.splice(expectedAbortIndex, 1);
  }
  return { body: await readDownload(download), download, response };
}

function parseCsv(body: string): {
  fields: string[];
  rows: Array<Record<string, string>>;
} {
  const result = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
  });
  expect(result.errors).toEqual([]);
  return { fields: result.meta.fields ?? [], rows: result.data };
}

function expectPrivateDownload(
  result: DownloadResult,
  extension: string
): void {
  expect(result.download.suggestedFilename()).toMatch(
    new RegExp(`\\.${extension}$`)
  );
  expect(result.response.headers()['cache-control']).toBe('no-store');
  expect(result.response.headers()['content-disposition']).toContain(
    'attachment; filename='
  );
}

test('an administrator can navigate accessible transfer tabs and download an import template', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-transfer-navigation', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);

  await expect(
    page.getByRole('heading', { level: 1, name: /^(Data|Donn\u00e9es)$/ })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Users/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /OIDC Clients/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Activity Logs/ })).toBeVisible();

  await page.getByRole('link', { name: /Users/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Users' })
  ).toBeVisible();
  const importTab = page.getByRole('tab', { name: 'Import' });
  const exportTab = page.getByRole('tab', { name: 'Export' });
  await expect(importTab).toHaveAttribute('aria-controls', 'import-panel');
  await expect(importTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Import' })).toBeVisible();
  await expect(page.getByLabel('Import file')).toBeVisible();

  await importTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(exportTab).toBeFocused();
  await expect(exportTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Export' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(importTab).toBeFocused();

  const template = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/users/import/template',
    () => page.getByRole('link', { name: 'Download Template' }).click()
  );
  expectPrivateDownload(template, 'csv');
  const parsed = parseCsv(template.body);
  expect(parsed.fields).toEqual(
    expect.arrayContaining(['Email', 'First Name', 'Last Name'])
  );

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  expectNoBrowserFailures(failures);
});

test('user exports enforce core, sensitive, and secret field policies', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-transfer-users', {
    role: 'admin',
  });
  await createManagedUser('transfer-export-record');
  await loginAsAdmin(page, admin, '/admin/data-transfer/users');
  await page.getByRole('tab', { name: 'Export' }).click();

  const exportButton = page.getByRole('button', { name: 'Export Users' });
  const core = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/users/export',
    () => exportButton.click()
  );
  expectPrivateDownload(core, 'csv');
  const coreCsv = parseCsv(core.body);
  expect(coreCsv.fields).toContain('Email');
  expect(coreCsv.fields).not.toContain('Phone Number');
  expect(coreCsv.fields).not.toContain('Password Hash');

  await page.getByLabel('Include sensitive fields').check();
  const sensitive = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/users/export',
    () => exportButton.click()
  );
  const sensitiveCsv = parseCsv(sensitive.body);
  expect(sensitiveCsv.fields).toEqual(
    expect.arrayContaining(['Phone Number', 'Street Address'])
  );
  expect(sensitiveCsv.fields).not.toContain('Password Hash');

  await page.getByLabel('Include secrets/internal data').check();
  await exportButton.click();
  const dialog = page.getByRole('dialog', { name: 'Export Secrets' });
  await expect(dialog).toContainText('audit logged');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(exportButton).toBeFocused();

  await exportButton.click();
  const secrets = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/users/export',
    () =>
      page
        .getByRole('dialog', { name: 'Export Secrets' })
        .getByRole('button', { name: 'Export with Secrets' })
        .click()
  );
  expectPrivateDownload(secrets, 'csv');
  const secretCsv = parseCsv(secrets.body);
  expect(secretCsv.fields).toEqual(
    expect.arrayContaining(['Password Hash', 'Hash Algorithm'])
  );
  expect(secretCsv.rows.some(row => Boolean(row['Password Hash']))).toBe(true);
  expectNoBrowserFailures(failures);
});

test('OIDC client exports omit secrets by default and audit explicit secret exports', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-transfer-clients', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin, '/admin/data-transfer/oidc-clients');
  await page.getByRole('tab', { name: 'Export' }).click();
  await expect(page.getByLabel('Include sensitive fields')).toHaveCount(0);

  const exportButton = page.getByRole('button', {
    name: 'Export OIDC Clients',
  });
  const core = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/oidc-clients/export',
    () => exportButton.click()
  );
  expectPrivateDownload(core, 'json');
  const coreClients = JSON.parse(core.body) as Array<Record<string, unknown>>;
  expect(coreClients.length).toBeGreaterThan(0);
  expect(
    coreClients.every(client => !Object.hasOwn(client, 'client_secret'))
  ).toBe(true);

  await page.getByLabel('Include secrets/internal data').check();
  await exportButton.click();
  const secretClients = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/oidc-clients/export',
    () =>
      page
        .getByRole('dialog', { name: 'Export Secrets' })
        .getByRole('button', { name: 'Export with Secrets' })
        .click()
  );
  expectPrivateDownload(secretClients, 'json');
  const secretRecords = JSON.parse(secretClients.body) as Array<
    Record<string, unknown>
  >;
  expect(secretRecords.some(client => Boolean(client.client_secret))).toBe(
    true
  );

  await expect
    .poll(async () => {
      const query = new URLSearchParams({
        search: 'Admin exported OIDC Clients with secrets',
        type: 'sensitive_data_export',
      });
      await page.goto(`${IDP_ORIGIN}/admin/activities?${query}`);
      return page
        .locator('tbody tr')
        .filter({ hasText: 'Admin exported OIDC Clients with secrets' })
        .count();
    })
    .toBeGreaterThan(0);
  expectNoBrowserFailures(failures);
});

test('activity export filters real audit rows and invalid transfer routes recover safely', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-transfer-activities', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin, '/admin/data-transfer/activities');
  await expect(page.getByLabel('Include sensitive fields')).toHaveCount(0);
  await expect(page.getByLabel('Include secrets/internal data')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Download Template' })
  ).toHaveCount(0);

  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel('From Date').fill(today);
  await page.getByLabel('To Date').fill(today);
  const exported = await captureDownload(
    page,
    failures,
    '/admin/data-transfer/activities/export',
    () => page.getByRole('button', { name: 'Export Activity Logs' }).click()
  );
  expectPrivateDownload(exported, 'csv');
  const activities = parseCsv(exported.body);
  expect(activities.fields).toEqual(
    expect.arrayContaining(['Timestamp', 'Type', 'Status', 'Username'])
  );
  expect(activities.rows.length).toBeGreaterThan(0);

  await page.goto(
    `${IDP_ORIGIN}/admin/data-transfer/activities/export?dateFrom=2026-02-30`
  );
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/data-transfer/activities`);
  const exportError = page.getByRole('dialog', { name: 'Error' });
  await expect(exportError).toContainText('Failed to export data');
  await exportError.getByRole('button', { name: 'OK' }).click();

  await page.goto(`${IDP_ORIGIN}/admin/data-transfer/unknown-${randomUUID()}`);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/data-transfer`);
  const entityError = page.getByRole('dialog', { name: 'Error' });
  await expect(entityError).toContainText('Unknown entity type');
  await entityError.getByRole('button', { name: 'OK' }).click();
  expectNoBrowserFailures(failures);
});

test('an authenticated ordinary user cannot access data-transfer pages or exports', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const user = await createManagedUser('admin-transfer-denied');

  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fdata-transfer`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  for (const path of [
    '/admin/data-transfer',
    '/admin/data-transfer/users',
    '/admin/data-transfer/users/export',
  ]) {
    await page.goto(`${IDP_ORIGIN}${path}`);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  }
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browser User' })
  ).toBeVisible();
  expectNoBrowserFailures(failures);
});
