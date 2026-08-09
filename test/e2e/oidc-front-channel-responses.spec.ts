import { expect, test, type Page } from '@playwright/test';

const IDP_ORIGIN = 'http://127.0.0.1:19007';
const RP_ORIGIN = 'http://127.0.0.1:19010';
const USER_EMAIL = 'front-channel-e2e@example.test';
const USER_PASSWORD = 'Violet!River7';

async function completeInteraction(page: Page): Promise<void> {
  const login = page.locator('#login');
  if (await login.isVisible()) {
    await login.fill(USER_EMAIL);
    await page.locator('#password').fill(USER_PASSWORD);
    await page
      .locator('#login-form')
      .getByRole('button', { name: /sign in/i })
      .click();
  }

  const consent = page.locator('#consent-submit-btn');
  if (await consent.isVisible()) {
    await consent.click();
  }
}

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
  await completeInteraction(page);
  await expect(page.getByTestId('implicit-result')).toBeVisible();
  await expect(page.getByTestId('implicit-subject')).not.toBeEmpty();
  await expect(page.getByTestId('implicit-access-token')).toHaveText('absent');

  await page.goto(`${RP_ORIGIN}/hybrid/login`);
  await completeInteraction(page);
  await expect(page.getByTestId('hybrid-result')).toBeVisible();
  await expect(page.getByTestId('hybrid-subject')).not.toBeEmpty();
  await expect(page.getByTestId('hybrid-access-token')).toHaveText('present');
  await expect(page.getByTestId('hybrid-id-token')).toHaveText('present');
});
