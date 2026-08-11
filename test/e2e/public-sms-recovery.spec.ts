import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import { IDP_ORIGIN } from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

type CapturedSms = {
  body: string;
  from: string;
  to: string;
};

function observeBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    failures.push(`request: ${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    if (
      response.status() >= 400 &&
      ['stylesheet', 'script', 'image', 'font'].includes(
        response.request().resourceType()
      )
    ) {
      failures.push(`asset: ${response.status()} ${response.url()}`);
    }
  });
  return failures;
}

async function resetSms(request: APIRequestContext) {
  const response = await request.post(`${RP_ORIGIN}/sms/reset`);
  expect(response.status()).toBe(204);
}

async function capturedSms(request: APIRequestContext): Promise<CapturedSms[]> {
  const response = await request.get(`${RP_ORIGIN}/sms/messages`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { messages: CapturedSms[] }).messages;
}

async function waitForSms(
  request: APIRequestContext,
  recipient: string
): Promise<CapturedSms> {
  const matching = async () =>
    (await capturedSms(request)).filter(message => message.to === recipient);
  await expect.poll(async () => (await matching()).length).toBe(1);
  return (await matching())[0]!;
}

async function submitCode(page: Page, code: string) {
  expect(code).toMatch(/^\d{6}$/);
  const inputs = page.locator('.otp-input');
  await expect(inputs).toHaveCount(6);
  for (const [index, digit] of [...code].entries()) {
    await inputs.nth(index).fill(digit);
  }
  await expect(page.locator('#code')).toHaveValue(code);
  await page.getByRole('button', { name: 'Verify Code' }).click();
}

test('delivers an SMS challenge and recovers the account with the captured code', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  const suffix = randomUUID();
  const email = `sms-recovery-${suffix}@example.test`;
  const phone = '+14155552671';
  const password = 'E2E-Register!9';
  await resetSms(request);

  // Register through the public UI so both contacts are provisioned through a
  // supported product path rather than a storage-specific test backdoor.
  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('SMS Recovery User');
  await page.locator('#email').fill(email);
  await page.locator('#phone').fill(phone);
  await page.locator('#password').fill(password);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page.locator('form[action="/auth/logout"]').getByRole('button').click();
  await expect(
    page.getByRole('heading', { name: /signed out/i })
  ).toBeVisible();

  await page.goto(`${IDP_ORIGIN}/auth/account-recovery`);
  await page.locator('#identifier').fill(email);
  await page.locator('#recovery-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-method-select`);
  await page
    .locator(
      'form:has(input[name="method"][value="sms"]) button[type="submit"]'
    )
    .click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-sms`);
  await expect(
    page.locator('span.font-mono').filter({ hasText: /^\+1\*+671$/ })
  ).toBeVisible();

  await page.locator('#send-btn').click();
  await expect(
    page.getByText(/verification code sent successfully/i)
  ).toBeVisible();
  const message = await waitForSms(request, phone);
  expect(message.from).toBe('+15005550006');
  const code = message.body.match(/recovery code is: (\d{6})/i)?.[1];
  expect(code).toMatch(/^\d{6}$/);

  const expireResponse = await request.post(
    `${RP_ORIGIN}/test-control/recovery-sms-expiry`,
    { data: { email } }
  );
  expect(expireResponse.status()).toBe(204);

  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/auth/recovery-verify-code?type=sms`
  );
  await expect(
    page.getByText('Enter the verification code sent to your phone', {
      exact: true,
    })
  ).toBeVisible();

  await submitCode(page, code!);
  await expect(page.getByText(/verification code has expired/i)).toBeVisible();

  // Request a replacement through the public UI after the configured
  // one-second cooldown. This proves both expiry and normal recovery without
  // manufacturing a valid challenge in the storage fixture.
  await page.waitForTimeout(1_100);
  await page.goto(`${IDP_ORIGIN}/auth/recovery-sms`);
  await resetSms(request);
  await page.locator('#send-btn').click();
  await expect(
    page.getByText(/verification code sent successfully/i)
  ).toBeVisible();
  const replacementMessage = await waitForSms(request, phone);
  const replacementCode = replacementMessage.body.match(
    /recovery code is: (\d{6})/i
  )?.[1];
  expect(replacementCode).toMatch(/^\d{6}$/);
  expect(replacementCode).not.toBe(code);

  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(
    `${IDP_ORIGIN}/auth/recovery-verify-code?type=sms`
  );

  const invalidCode = replacementCode === '000000' ? '111111' : '000000';
  await submitCode(page, invalidCode);
  await expect(page.getByText(/invalid verification code/i)).toBeVisible();
  await submitCode(page, replacementCode!);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(page.getByText(/account recovered successfully/i)).toBeVisible();
  expect(failures).toEqual([]);
});
