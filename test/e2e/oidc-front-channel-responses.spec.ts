import { expect, test } from '@playwright/test';

import {
  completeOidcInteraction,
  IDP_ORIGIN,
  RP_ORIGIN,
} from './support/browser-oidc.js';
const USER_EMAIL = 'front-channel-e2e@example.test';
const USER_PASSWORD = 'Violet!River7';

test('validates ID-token-only and hybrid front-channel responses end to end', async ({
  page,
}) => {
  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('Front-channel E2E User');
  await page.locator('#email').fill(USER_EMAIL);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  await page.goto(`${RP_ORIGIN}/implicit/login`);
  await completeOidcInteraction(page, {
    identifier: USER_EMAIL,
    password: USER_PASSWORD,
  });
  await expect(page.getByTestId('implicit-result')).toBeVisible();
  await expect(page.getByTestId('implicit-subject')).not.toBeEmpty();
  await expect(page.getByTestId('implicit-access-token')).toHaveText('absent');

  await page.goto(`${RP_ORIGIN}/hybrid/login`);
  await completeOidcInteraction(page, {
    identifier: USER_EMAIL,
    password: USER_PASSWORD,
  });
  await expect(page.getByTestId('hybrid-result')).toBeVisible();
  await expect(page.getByTestId('hybrid-subject')).not.toBeEmpty();
  await expect(page.getByTestId('hybrid-access-token')).toHaveText('present');
  await expect(page.getByTestId('hybrid-id-token')).toHaveText('present');
});
