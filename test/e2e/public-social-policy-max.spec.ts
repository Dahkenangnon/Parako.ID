import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { createManagedUser, IDP_ORIGIN } from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

async function passwordLogin(page: Page, email: string, password: string) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
}

test('maximum-provider policy refuses an additional explicit link', async ({
  browser,
  request,
}) => {
  const user = await createManagedUser('social-max-provider');
  const seeded = await request.post(
    `${RP_ORIGIN}/test-control/social-integration`,
    {
      data: {
        email: user.email,
        method: 'facebook',
        providerSub: `facebook-${randomUUID()}`,
      },
    }
  );
  expect(seeded.status()).toBe(201);

  const context = await browser.newContext();
  const page = await context.newPage();
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    failures.push(`request: ${request.method()} ${request.url()}`);
  });
  await passwordLogin(page, user.email, user.password);

  await page.goto(`${IDP_ORIGIN}/accounts/settings/social`);
  await page.locator('a[href="/accounts/social/github/link"]').click();
  await page
    .locator('input[name="provider_subject"]')
    .fill(`github-${randomUUID()}`);
  await page.locator('input[name="verified_email"]').fill(user.email);
  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/social`);
  await expect(page.getByRole('dialog', { name: 'Error' })).toContainText(
    /maximum number of social providers \(1\) reached/i
  );
  await expect(
    page.locator('form[action="/accounts/social/github/unlink"]')
  ).toHaveCount(0);
  expect(failures).toEqual([]);
  await context.close();
});
