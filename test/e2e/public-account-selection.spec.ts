import { expect, test, type Page } from '@playwright/test';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

async function login(page: Page, user: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
}

async function addAccount(page: Page, user: ManagedUserFixture) {
  await page.locator('#sidebar-user-btn').click();
  await page
    .locator('form[action="/accounts/add-account"]:visible')
    .getByRole('button')
    .click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login?intent=add-account`);

  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
}

async function finishConsentIfRequested(page: Page) {
  const consent = page.locator('#consent-submit-btn');
  if (await consent.isVisible()) await consent.click();
}

test.describe('public OIDC account selection', () => {
  test('requires explicit selection even when the session has one account', async ({
    page,
  }) => {
    const user = await createManagedUser('select-account-single');
    await login(page, user);

    await page.goto(`${RP_ORIGIN}/login?prompt=select_account`);

    const selection = page.locator('form[action$="/select_account"]');
    await expect(selection).toBeVisible();
    await expect(selection.locator('button[name="account_id"]')).toHaveCount(1);
    await expect(selection).toContainText(user.email);
    await selection.locator('button[name="account_id"]').click();
    await finishConsentIfRequested(page);

    await expect(page).toHaveURL(`${RP_ORIGIN}/`);
    await expect(page.getByTestId('rp-email')).toHaveText(user.email);
  });

  test('selects either account from a multi-account browser session', async ({
    page,
  }) => {
    const first = await createManagedUser('select-account-first');
    const second = await createManagedUser('select-account-second');
    await login(page, first);
    await addAccount(page, second);

    await page.goto(`${RP_ORIGIN}/login?prompt=select_account`);

    const selection = page.locator('form[action$="/select_account"]');
    await expect(selection.locator('button[name="account_id"]')).toHaveCount(2);
    const firstAccount = selection
      .locator('button[name="account_id"]')
      .filter({ hasText: first.email });
    await expect(firstAccount).toBeVisible();
    await firstAccount.click();
    await finishConsentIfRequested(page);

    await expect(page).toHaveURL(`${RP_ORIGIN}/`);
    await expect(page.getByTestId('rp-email')).toHaveText(first.email);
  });

  test('rejects an account id that is not present in the browser session', async ({
    page,
  }) => {
    const user = await createManagedUser('select-account-foreign');
    await login(page, user);

    const response = await page.goto(
      `${IDP_ORIGIN}/auth/continue?account_id=foreign-account-id`
    );

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/account-select`);
    await expect(
      page.getByText('The selected account is no longer available.')
    ).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();

    const cancel = page.getByRole('link', { name: 'Cancel' });
    await expect(cancel).toHaveAttribute('href', '/accounts/');
    await expect(cancel).not.toHaveAttribute('onclick', /.+/);
    await cancel.click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  });
});
