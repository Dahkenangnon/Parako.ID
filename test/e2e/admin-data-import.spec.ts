import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { Job } from 'bullmq';

import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';
import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';
import { createE2eBackgroundQueue } from './support/background-jobs.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

async function loginAsAdmin(
  page: Page,
  admin: ManagedUserFixture
): Promise<void> {
  const continueUrl = encodeURIComponent('/admin/data-transfer/users');
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=${continueUrl}`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/data-transfer/users`);
}

async function uploadUsersCsv(page: Page, rows: string[]): Promise<void> {
  await page.getByLabel('Import file').setInputFiles({
    name: 'users.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `${['Email,First Name,Last Name', ...rows].join('\n')}\n`,
      'utf8'
    ),
  });
}

function getCurrentTenantId(): string {
  return process.env.PARAKO_E2E_MULTI_TENANCY === 'true'
    ? (process.env.PARAKO_E2E_TENANT_ID ?? 'browser-e2e')
    : 'default';
}

async function getAsCurrentBrowserSession(page: Page, path: string) {
  const tenantOrigin = new URL(IDP_ORIGIN);
  const cookies = await page.context().cookies(IDP_ORIGIN);
  const cookie = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');

  return page
    .context()
    .request.get(`http://127.0.0.1:${tenantOrigin.port}${path}`, {
      headers: {
        cookie,
        host: tenantOrigin.host,
      },
    });
}

test('a user import travels through the real queue and worker to visible completion', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-data-import', { role: 'admin' });
  const email = `imported-${randomUUID()}@example.test`;
  await loginAsAdmin(page, admin);
  await uploadUsersCsv(page, [`${email},Queue,Worker`]);

  await expect(page.locator('#preview-total')).toHaveText('1 total rows');
  await expect(page.locator('#preview-valid')).toHaveText('1 valid');
  const confirm = page.getByRole('button', { name: 'Confirm Import' });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(
    page.getByRole('heading', { name: 'Import Completed Successfully' })
  ).toBeVisible();
  await expect(page.locator('#result-summary')).toContainText('Total Rows: 1');
  await expect(page.locator('#result-summary')).toContainText('Imported: 1');
  await expect(page.locator('#result-summary')).toContainText('Errors: 0');

  await page.goto(
    `${IDP_ORIGIN}/admin/users?${new URLSearchParams({ search: email })}`
  );
  await expect(page.locator('tbody tr').filter({ hasText: email })).toHaveCount(
    1
  );
  expectNoBrowserFailures(failures);
});

test('a breached login is processed by the worker into an email and audit', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-breach-worker', {
    role: 'admin',
  });
  const reset = await request.post(`${RP_ORIGIN}/smtp/reset`);
  expect(reset.ok()).toBe(true);

  await loginAsAdmin(page, admin);

  await expect
    .poll(async () => {
      const response = await request.get(`${RP_ORIGIN}/smtp/messages`);
      expect(response.ok()).toBe(true);
      const payload = (await response.json()) as {
        messages: Array<{ rcptTo: string[]; source: string }>;
      };
      return payload.messages.filter(message =>
        message.rcptTo.includes(admin.email)
      );
    })
    .toEqual([
      expect.objectContaining({
        rcptTo: expect.arrayContaining([admin.email]),
        source: expect.stringContaining('password_breached'),
      }),
    ]);

  const query = new URLSearchParams({
    search: 'Password found in',
    type: 'password_breach_detected',
  });
  await expect
    .poll(async () => {
      await page.goto(`${IDP_ORIGIN}/admin/activities?${query}`);
      return page
        .locator('tbody tr')
        .filter({ hasText: admin.username })
        .count();
    })
    .toBe(1);
  await expect(
    page.locator('tbody tr').filter({ hasText: admin.username })
  ).toContainText('Password found in');
  expectNoBrowserFailures(failures);
});

test('invalid user rows produce visible validation details without entering the queue', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-data-import-validation', {
    role: 'admin',
  });
  await loginAsAdmin(page, admin);
  await uploadUsersCsv(page, ['not-an-email,Invalid,Address']);

  await expect(page.locator('#preview-total')).toHaveText('1 total rows');
  await page.getByRole('button', { name: 'Confirm Import' }).click();

  await expect(
    page.getByRole('heading', { name: 'Import Completed with Errors' })
  ).toBeVisible();
  await expect(page.locator('#result-summary')).toContainText('Total Rows: 1');
  await expect(page.locator('#result-summary')).toContainText('Imported: 0');
  await expect(page.locator('#result-summary')).toContainText('Errors: 1');
  await expect(page.locator('#result-error-body')).toContainText(
    'Validation failed'
  );
  await expect(page.locator('#result-error-body')).toContainText(
    'email: Invalid email address'
  );
  expectNoBrowserFailures(failures);
});

test('a batch conflict reports partial completion and persists only the successful row', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-data-import-partial', {
    role: 'admin',
  });
  const email = `partial-${randomUUID()}@example.test`;
  await loginAsAdmin(page, admin);
  await uploadUsersCsv(page, [
    `${email},First,Import`,
    `${email},Second,Import`,
  ]);

  await expect(page.locator('#preview-total')).toHaveText('2 total rows');
  await expect(page.locator('#preview-valid')).toHaveText('2 valid');
  await page.getByRole('button', { name: 'Confirm Import' }).click();

  await expect(
    page.getByRole('heading', { name: 'Import Completed with Errors' })
  ).toBeVisible();
  await expect(page.locator('#result-summary')).toContainText('Total Rows: 2');
  await expect(page.locator('#result-summary')).toContainText('Imported: 1');
  await expect(page.locator('#result-summary')).toContainText('Errors: 1');
  await expect(page.locator('#result-error-body')).toContainText(
    'Email is already registered'
  );
  await expect(page.locator('#result-error-body')).toContainText(email);

  await page.goto(
    `${IDP_ORIGIN}/admin/users?${new URLSearchParams({ search: email })}`
  );
  await expect(page.locator('tbody tr').filter({ hasText: email })).toHaveCount(
    1
  );
  expectNoBrowserFailures(failures);
});

test('a terminal worker failure exhausts retries and becomes visible to the administrator', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-data-import-terminal', {
    role: 'admin',
  });
  const queue = createE2eBackgroundQueue();
  const importUrl = `${IDP_ORIGIN}/admin/data-transfer/users/import`;
  let job: Job | undefined;

  try {
    await queue.waitUntilReady();
    await loginAsAdmin(page, admin);
    await uploadUsersCsv(page, [
      `terminal-${randomUUID()}@example.test,Terminal,Failure`,
    ]);
    await expect(page.locator('#preview-valid')).toHaveText('1 valid');

    await page.route(
      importUrl,
      async route => {
        job = await queue.add('data-import', {
          type: 'process',
          name: 'data-import',
          entityId: 'users',
          rows: [{ email: `terminal-${randomUUID()}@example.test` }],
          tenantId: getCurrentTenantId(),
          adminUser: null,
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            phase: 'enqueued',
            valid: true,
            jobId: job.id,
            totalRows: 1,
            validCount: 1,
          }),
        });
      },
      { times: 1 }
    );

    await page.getByRole('button', { name: 'Confirm Import' }).click();
    await expect(page.locator('#result-summary h3')).toHaveText(
      'Import Failed'
    );
    await expect(page.locator('#result-summary')).toContainText('adminUser');

    expect(job?.id).toEqual(expect.any(String));
    const persistedJob = await Job.fromId(queue, String(job!.id));
    expect(persistedJob).not.toBeNull();
    await expect(persistedJob!.getState()).resolves.toBe('failed');
    expect(persistedJob!.attemptsMade).toBe(3);
    expectNoBrowserFailures(failures);
  } finally {
    await page.unroute(importUrl);
    await queue.close();
  }
});

test('an administrator cannot observe a sibling tenant import job', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-data-import-isolation', {
    role: 'admin',
  });
  const queue = createE2eBackgroundQueue();
  let job: Job | undefined;

  try {
    await queue.waitUntilReady();
    job = await queue.add(
      'data-import',
      {
        type: 'process',
        name: 'data-import',
        entityId: 'users',
        rows: [{ email: `sibling-${randomUUID()}@example.test` }],
        tenantId: `${getCurrentTenantId()}-sibling`,
        adminUser: { username: 'sibling-admin' },
      },
      { delay: 5 * 60_000, attempts: 1 }
    );
    await expect(job.getState()).resolves.toBe('delayed');

    await loginAsAdmin(page, admin);
    const base = `/admin/data-transfer/users/import/${job.id}`;
    const results = await Promise.all(
      [`${base}/status`, `${base}/progress`].map(async url => {
        const response = await getAsCurrentBrowserSession(page, url);
        return {
          status: response.status(),
          body: (await response.json()) as { error?: string },
        };
      })
    );

    expect(results).toEqual([
      { status: 404, body: { error: 'Import job not found' } },
      { status: 404, body: { error: 'Import job not found' } },
    ]);
    expectNoBrowserFailures(failures);
  } finally {
    await job?.remove();
    await queue.close();
  }
});
