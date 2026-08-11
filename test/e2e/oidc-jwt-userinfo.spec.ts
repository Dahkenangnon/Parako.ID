import { expect, test } from '@playwright/test';

import {
  completeOidcInteraction,
  IDP_ORIGIN,
  RP_ORIGIN,
} from './support/browser-oidc.js';
const USER_EMAIL = 'jwt-userinfo-e2e@example.test';
const USER_PASSWORD = 'Violet!River7';

test('returns and verifies signed JWT UserInfo for an opted-in RP', async ({
  page,
}) => {
  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('JWT UserInfo E2E User');
  await page.locator('#email').fill(USER_EMAIL);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  await page.goto(`${RP_ORIGIN}/jwt-userinfo/login`);
  await completeOidcInteraction(page, {
    identifier: USER_EMAIL,
    password: USER_PASSWORD,
  });

  await expect(page).toHaveURL(
    new RegExp(`^${RP_ORIGIN}/jwt-userinfo/callback\\?`)
  );
  await expect(page.getByTestId('jwt-userinfo-result')).toBeVisible();
  await expect(page.getByTestId('jwt-userinfo-content-type')).toHaveText(
    /application\/jwt/
  );
  await expect(page.getByTestId('jwt-userinfo-alg')).toHaveText('RS256');
  await expect(page.getByTestId('jwt-userinfo-subject-match')).toHaveText(
    'yes'
  );
  await expect(page.getByTestId('jwt-userinfo-email')).toHaveText(USER_EMAIL);
});
