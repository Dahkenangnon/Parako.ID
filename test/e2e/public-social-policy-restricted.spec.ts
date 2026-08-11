import { randomUUID } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createManagedUser, IDP_ORIGIN } from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

function observeBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    failures.push(`request: ${request.method()} ${request.url()}`);
  });
  return failures;
}

async function closeContext(context: BrowserContext, failures: string[]) {
  expect(failures).toEqual([]);
  await context.close();
}

async function beginSocialLogin(page: Page) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('button[data-provider="github"]').click();
  await expect(
    page.getByRole('heading', { name: 'Authorize Parako test access' })
  ).toBeVisible();
}

async function approveIdentity(
  page: Page,
  { email, subject }: { email: string; subject: string }
) {
  await page.locator('input[name="provider_subject"]').fill(subject);
  await page.locator('input[name="verified_email"]').fill(email);
  await page.getByRole('button', { name: 'Approve' }).click();
}

async function passwordLogin(page: Page, email: string, password: string) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
}

test('verified provider email auto-links an existing account', async ({
  browser,
}) => {
  const user = await createManagedUser('social-auto-link');
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await beginSocialLogin(page);
  await approveIdentity(page, {
    email: user.email,
    subject: `auto-link-${randomUUID()}`,
  });

  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await page.goto(`${IDP_ORIGIN}/accounts/settings/social`);
  await expect(
    page.locator('form[action="/accounts/social/github/unlink"]')
  ).toBeVisible();
  await closeContext(context, failures);
});

test('require-existing-account policy refuses unknown provider identities', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await beginSocialLogin(page);
  await approveIdentity(page, {
    email: `social-unknown-${randomUUID()}@example.test`,
    subject: `unknown-${randomUUID()}`,
  });

  await expect(
    page.getByRole('heading', { name: 'Github Authentication Error' })
  ).toBeVisible();
  await expect(page.locator('main')).toContainText(
    /authentication failed.*try again/i
  );
  await closeContext(context, failures);
});

test('single-provider policy refuses an additional explicit link', async ({
  browser,
  request,
}) => {
  const user = await createManagedUser('social-single-provider');
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
  const failures = observeBrowserFailures(page);
  await passwordLogin(page, user.email, user.password);

  await page.goto(`${IDP_ORIGIN}/accounts/settings/social`);
  await page.locator('a[href="/accounts/social/github/link"]').click();
  await approveIdentity(page, {
    email: user.email,
    subject: `github-${randomUUID()}`,
  });

  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/social`);
  await expect(page.getByRole('dialog', { name: 'Error' })).toContainText(
    /multiple social providers are not allowed/i
  );
  await expect(
    page.locator('form[action="/accounts/social/github/unlink"]')
  ).toHaveCount(0);
  await closeContext(context, failures);
});
