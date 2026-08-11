import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import { IDP_ORIGIN } from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';
const PHONE = '+14155552671';

type CapturedSms = { body: string; from: string; to: string };

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

async function capturedSms(request: APIRequestContext) {
  const response = await request.get(`${RP_ORIGIN}/sms/messages`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { messages: CapturedSms[] }).messages;
}

function verificationCode(message: CapturedSms | undefined): string {
  const code = message?.body.match(/verification code is: (\d{6})/i)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  return code!;
}

function verificationToken(page: Page): string {
  const token = new URL(page.url()).searchParams.get('token');
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return token!;
}

test('keeps a phone registration anonymous until the delivered code is verified', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  await request.post(`${RP_ORIGIN}/sms/reset`);
  const email = `phone-verification-${randomUUID()}@example.test`;

  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('Phone Verification User');
  await page.locator('#email').fill(email);
  await page.locator('#phone').fill(PHONE);
  await page.locator('#password').fill('E2E-Register!9');
  await page.locator('#submit-btn').click();

  await expect(page).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/auth/phone-verification\\?token=`)
  );
  await expect(
    page.getByRole('heading', { name: 'Verify your phone' })
  ).toBeVisible();
  await expect.poll(async () => (await capturedSms(request)).length).toBe(1);
  const [message] = await capturedSms(request);
  expect(message?.to).toBe(PHONE);
  expect(message?.body).toMatch(/verification code is: \d{6}/i);

  const firstToken = verificationToken(page);
  const firstCode = verificationCode(message);

  // A wrong proof must not consume the pending challenge.
  const wrongCode = firstCode === '000000' ? '111111' : '000000';
  await page.locator('#code').fill(wrongCode);
  await page.getByRole('button', { name: 'Verify phone' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Invalid or expired verification code.'
  );

  // Resending rotates both the opaque browser token and the delivered code.
  // The production SMS policy intentionally applies a one-second per-number
  // cooldown, including in this E2E profile.
  await page.waitForTimeout(1_100);
  await page.getByRole('button', { name: 'Resend code' }).click();
  await expect.poll(async () => (await capturedSms(request)).length).toBe(2);
  const secondToken = verificationToken(page);
  const secondCode = verificationCode((await capturedSms(request))[1]);
  expect(secondToken).not.toBe(firstToken);
  expect(secondCode).not.toBe(firstCode);

  // Rotation invalidates the previous token/code pair.
  await page.goto(`${IDP_ORIGIN}/auth/phone-verification?token=${firstToken}`);
  await page.locator('#code').fill(firstCode);
  await page.getByRole('button', { name: 'Verify phone' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Invalid or expired verification code.'
  );

  // Expiry is advanced in the disposable harness while the browser still
  // exercises Parako's real verification handler and persisted state.
  const expiry = await request.post(
    `${RP_ORIGIN}/test-control/identity-token-expiry`,
    { data: { email, kind: 'phone-verification' } }
  );
  expect(expiry.status()).toBe(204);
  await page.goto(`${IDP_ORIGIN}/auth/phone-verification?token=${secondToken}`);
  await page.locator('#code').fill(secondCode);
  await page.getByRole('button', { name: 'Verify phone' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Invalid or expired verification code.'
  );

  // An expired challenge can be safely replaced, and only the replacement
  // proof may complete activation.
  await page.waitForTimeout(1_100);
  await page.getByRole('button', { name: 'Resend code' }).click();
  await expect.poll(async () => (await capturedSms(request)).length).toBe(3);
  const thirdToken = verificationToken(page);
  const thirdCode = verificationCode((await capturedSms(request))[2]);
  expect(thirdToken).not.toBe(secondToken);
  await page.locator('#code').fill(thirdCode);
  await page.getByRole('button', { name: 'Verify phone' }).click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);

  // Successful verification is one-time: replaying the final pair fails.
  await page.goto(`${IDP_ORIGIN}/auth/phone-verification?token=${thirdToken}`);
  await page.locator('#code').fill(thirdCode);
  await page.getByRole('button', { name: 'Verify phone' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Invalid or expired verification code.'
  );

  await page.goto(`${IDP_ORIGIN}/accounts/`);
  await expect(page).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/auth/login\\?continue=`)
  );

  await page.locator('#login').fill(email);
  await page.locator('#password').fill('E2E-Register!9');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  expect(failures).toEqual([]);
});

test('resumes Authorization Code + PKCE after required phone proof', async ({
  page,
  request,
}) => {
  const failures = observeBrowserFailures(page);
  await request.post(`${RP_ORIGIN}/sms/reset`);
  const email = `oidc-phone-verification-${randomUUID()}@example.test`;
  const phone = '+14155552672';
  const password = 'E2E-OIDC-Phone!9';

  // Registration creates an unverified account and its first challenge. The
  // OIDC login below must rotate to a fresh challenge tied to the interaction.
  await page.goto(`${IDP_ORIGIN}/auth/register`);
  await page.locator('#fullname').fill('OIDC Phone Verification User');
  await page.locator('#email').fill(email);
  await page.locator('#phone').fill(phone);
  await page.locator('#password').fill(password);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/auth/phone-verification\\?token=`)
  );
  await expect.poll(async () => (await capturedSms(request)).length).toBe(1);

  await page.goto(RP_ORIGIN);
  await page.getByTestId('rp-login').click();
  await page.locator('#login').fill(email);
  await page.locator('#password').fill(password);
  await page
    .locator('#login-form')
    .getByRole('button', { name: /sign in/i })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/auth/phone-verification\\?token=`)
  );
  await expect.poll(async () => (await capturedSms(request)).length).toBe(2);
  const oidcCode = verificationCode((await capturedSms(request))[1]);
  await page.locator('#code').fill(oidcCode);
  await page.getByRole('button', { name: 'Verify phone' }).click();

  // The phone proof resumes the same opaque oidc-provider interaction. The
  // user deliberately re-enters their password; Parako never stores it across
  // the possession-proof step.
  await expect(page).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/oidc/v1/interaction/`)
  );
  await expect(page.locator('#login')).toBeVisible();
  await page.locator('#login').fill(email);
  await page.locator('#password').fill(password);
  await page
    .locator('#login-form')
    .getByRole('button', { name: /sign in/i })
    .click();

  const consent = page.locator('#consent-submit-btn');
  await expect(consent).toBeVisible();
  await consent.click();

  await expect(page).toHaveURL(`${RP_ORIGIN}/`);
  await expect(page.getByTestId('rp-authenticated')).toBeVisible();
  await expect(page.getByTestId('rp-email')).toHaveText(email);
  await expect(page.getByTestId('rp-id-token')).toHaveText('present');
  expect(failures).toEqual([]);
});
