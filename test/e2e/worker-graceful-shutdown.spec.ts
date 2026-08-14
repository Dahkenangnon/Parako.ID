import { expect, test, type Page } from '@playwright/test';
import { Job } from 'bullmq';

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

function currentTenantId(): string {
  return process.env.PARAKO_E2E_MULTI_TENANCY === 'true'
    ? (process.env.PARAKO_E2E_TENANT_ID ?? 'browser-e2e')
    : 'default';
}

async function loginAsAdmin(
  page: Page,
  admin: ManagedUserFixture
): Promise<void> {
  await page.goto(`${IDP_ORIGIN}/auth/login?continue=%2Fadmin%2Factivities`);
  await page.locator('#login').fill(admin.email);
  await page.locator('#password').fill(admin.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/activities`);
}

type DrainStatus = {
  enabled: boolean;
  started: boolean;
  released: boolean;
  shutdownStarted: boolean;
  running: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

test('SIGTERM drains an active background job before the worker exits cleanly', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const admin = await createManagedUser('admin-worker-drain', {
    role: 'admin',
  });
  const queue = createE2eBackgroundQueue();
  let job: Job | undefined;

  try {
    await queue.waitUntilReady();
    await loginAsAdmin(page, admin);
    job = await queue.add('password-breach-check', {
      type: 'process',
      name: 'password-breach-check',
      sha1Prefix: process.env.PARAKO_E2E_DRAIN_HIBP_PREFIX,
      sha1Suffix: process.env.PARAKO_E2E_DRAIN_HIBP_SUFFIX,
      userId: admin.id,
      email: admin.email,
      username: admin.username,
      tenantId: currentTenantId(),
      apiTimeoutMs: 30_000,
      minBreachCount: 1,
    });

    await expect
      .poll(async () => {
        const statusResponse = await request.get(
          `${RP_ORIGIN}/test-control/worker-drain/status`
        );
        expect(statusResponse.ok()).toBe(true);
        const status = (await statusResponse.json()) as DrainStatus;
        const persisted = await Job.fromId(queue, String(job!.id));
        return { started: status.started, state: await persisted?.getState() };
      })
      .toEqual({ started: true, state: 'active' });

    const signalResponse = await request.post(
      `${RP_ORIGIN}/test-control/worker-drain/signal`
    );
    expect(signalResponse.status()).toBe(202);

    const drainingResponse = await request.get(
      `${RP_ORIGIN}/test-control/worker-drain/status`
    );
    expect(drainingResponse.ok()).toBe(true);
    expect((await drainingResponse.json()) as DrainStatus).toMatchObject({
      enabled: true,
      started: true,
      released: false,
      shutdownStarted: true,
      running: true,
      exitCode: null,
      signalCode: null,
    });
    expect(await (await Job.fromId(queue, String(job.id)))?.getState()).toBe(
      'active'
    );

    const releaseResponse = await request.post(
      `${RP_ORIGIN}/test-control/worker-drain/release`
    );
    expect(releaseResponse.status()).toBe(204);

    await expect
      .poll(async () => {
        const statusResponse = await request.get(
          `${RP_ORIGIN}/test-control/worker-drain/status`
        );
        const status = (await statusResponse.json()) as DrainStatus;
        const persisted = await Job.fromId(queue, String(job!.id));
        return {
          running: status.running,
          exitCode: status.exitCode,
          state: await persisted?.getState(),
          returnvalue: persisted?.returnvalue,
        };
      })
      .toEqual({
        running: false,
        exitCode: 0,
        state: 'completed',
        returnvalue: {
          checked: true,
          breached: true,
          breachCount: 84,
          notified: true,
        },
      });

    const query = new URLSearchParams({
      search: 'Password found in 84 known data breaches',
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
    ).toContainText('Password found in 84 known data breaches');
    expectNoBrowserFailures(failures);
  } finally {
    await queue.close();
  }
});
