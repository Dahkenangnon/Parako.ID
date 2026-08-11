import { expect, test } from '@playwright/test';

import {
  completeOidcInteraction,
  IDP_ORIGIN,
  RP_ORIGIN,
} from './support/browser-oidc.js';
const USER_EMAIL = 'device-e2e@example.test';
const USER_PASSWORD = 'Cobalt!Forest8';

test('runs the device authorization grant through browser verification', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('Device E2E User');
  await page.locator('#email').fill(USER_EMAIL);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  await page.goto(`${RP_ORIGIN}/device/start`);
  await expect(page.getByTestId('device-pending')).toBeVisible();
  await expect(page.getByTestId('device-user-code')).not.toBeEmpty();
  const statusUrl = await page
    .getByTestId('device-status')
    .getAttribute('href');
  expect(statusUrl).toMatch(/^\/device\/status\//);

  await page.getByTestId('device-verification').click();
  await expect(page).toHaveURL(new RegExp(`^${IDP_ORIGIN}/oidc/v1/`));

  await page.getByRole('button', { name: 'Continue' }).click();

  await completeOidcInteraction(page, {
    identifier: USER_EMAIL,
    password: USER_PASSWORD,
  });

  await expect(page.getByText('Authorization Successful!')).toBeVisible();

  await expect
    .poll(
      async () => {
        const response = await request.get(`${RP_ORIGIN}${statusUrl}`);
        return response.text();
      },
      { timeout: 30_000 }
    )
    .toContain('data-testid="device-authorized"');

  await page.goto(`${RP_ORIGIN}${statusUrl}`);
  await expect(page.getByTestId('device-access-token')).toHaveText('present');
  await expect(page.getByTestId('device-id-token')).toHaveText('present');
  expect(pageErrors).toEqual([]);
});
