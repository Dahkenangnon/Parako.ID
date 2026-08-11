import { expect, test, type Page } from '@playwright/test';

import { completeOidcInteraction, IDP_ORIGIN } from './support/browser-oidc.js';
const USER_EMAIL = 'pairwise-subject-e2e@example.test';
const USER_PASSWORD = 'Violet!River7';

async function authorize(page: Page, client: 'a' | 'b', origin: string) {
  await page.goto(`${origin}/pairwise/${client}/login`);

  await completeOidcInteraction(page, {
    identifier: USER_EMAIL,
    password: USER_PASSWORD,
  });

  await expect(page.getByTestId('pairwise-result')).toBeVisible();
  return page.getByTestId('pairwise-subject').textContent();
}

test('keeps pairwise subjects stable within a sector and unlinkable across sectors', async ({
  page,
}) => {
  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('Pairwise Subject E2E User');
  await page.locator('#email').fill(USER_EMAIL);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(/\/accounts(?:\/|\?|$)/);

  const first = await authorize(page, 'a', 'http://127.0.0.1:19010');
  const otherSector = await authorize(page, 'b', 'http://localhost:19010');
  const repeated = await authorize(page, 'a', 'http://127.0.0.1:19010');

  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(repeated).toBe(first);
  expect(otherSector).toMatch(/^[a-f0-9]{64}$/);
  expect(otherSector).not.toBe(first);
});
