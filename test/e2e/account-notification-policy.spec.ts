import { expect, test } from '@playwright/test';

import { createManagedUser, IDP_ORIGIN } from './support/management-api.js';

test('operator policy hides notification controls and rejects a direct mutation', async ({
  page,
}) => {
  const user = await createManagedUser('account-notification-policy');

  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/accounts/settings/notifications`);
  await expect(
    page.locator('form[action="/accounts/update-notification-preferences"]')
  ).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeVisible();
  const csrfToken = await page
    .locator('input[name="_csrf"]')
    .first()
    .inputValue();

  await page.evaluate(
    ({ csrf }) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/accounts/update-notification-preferences';
      for (const [name, value] of Object.entries({
        _csrf: csrf,
        preferred_channel: 'sms',
        marketing: 'on',
      })) {
        const input = document.createElement('input');
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    },
    { csrf: csrfToken }
  );

  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/notifications`);
  const errorDialog = page.getByRole('dialog', { name: 'Error' });
  await expect(errorDialog).toContainText(
    'Notification preferences cannot be changed'
  );
  await errorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(
    page.locator('form[action="/accounts/update-notification-preferences"]')
  ).toHaveCount(0);
});
