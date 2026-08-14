import { expect, test, type Page } from '@playwright/test';
import { Job } from 'bullmq';

import { registerJwksRotationSchedule } from '../../src/jobs/schedules/jwks-rotation.schedule.js';
import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';
import { createE2eBackgroundQueue } from './support/background-jobs.js';
import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

async function loginAsAdmin(
  page: Page,
  admin: ManagedUserFixture
): Promise<void> {
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Fjwks`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/jwks`);
}

async function readStatistic(page: Page, label: string): Promise<number> {
  const card = page.getByText(label, { exact: true }).first().locator('..');
  const value = Number((await card.locator('p').nth(1).textContent())?.trim());
  expect(Number.isFinite(value), `${label} statistic`).toBe(true);
  return value;
}

test('automatic JWKS rotation is scheduled once and becomes visible to the tenant administrator', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const queue = createE2eBackgroundQueue();

  try {
    await queue.waitUntilReady();
    await expect.poll(() => queue.getJobSchedulersCount()).toBe(1);
    expect(await queue.getJobSchedulers()).toEqual([
      expect.objectContaining({
        key: 'jwks-rotation-periodic',
        name: 'jwks-rotation',
        pattern: '0 2 1 * *',
        tz: 'UTC',
        template: expect.objectContaining({
          data: { type: 'process', name: 'jwks-rotation' },
        }),
      }),
    ]);

    await registerJwksRotationSchedule(queue, { rotationIntervalDays: 90 });
    await registerJwksRotationSchedule(queue, { rotationIntervalDays: 90 });
    expect(await queue.getJobSchedulersCount()).toBe(1);

    const admin = await createManagedUser('admin-jwks-scheduler', {
      role: 'admin',
    });
    await loginAsAdmin(page, admin);
    const totalBeforeRotation = await readStatistic(page, 'Total Keys');

    const aged = await request.post(
      `${RP_ORIGIN}/test-control/jwks/make-rotation-due`
    );
    expect(aged.ok()).toBe(true);

    const job = await queue.add('jwks-rotation', {
      type: 'process',
      name: 'jwks-rotation',
    });
    await expect
      .poll(async () => {
        const persisted = await Job.fromId(queue, String(job.id));
        return persisted?.getState();
      })
      .toBe('completed');

    await expect
      .poll(async () => {
        await page.goto(`${IDP_ORIGIN}/admin/jwks`);
        return readStatistic(page, 'Total Keys');
      })
      .toBeGreaterThan(totalBeforeRotation);

    const query = new URLSearchParams({
      search: 'JWKS keys rotated by background scheduler',
      type: 'jwks_rotated_by_scheduler',
    });
    await expect
      .poll(async () => {
        await page.goto(`${IDP_ORIGIN}/admin/activities?${query}`);
        return page
          .locator('tbody tr')
          .filter({ hasText: 'JWKS keys rotated by background scheduler' })
          .count();
      })
      .toBe(1);
    expectNoBrowserFailures(failures);
  } finally {
    await queue.close();
  }
});
