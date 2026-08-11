import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { generate } from 'otplib';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

type CapturedMessage = {
  rcptTo: string[];
  source: string;
};

function observeBrowserFailures(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedAssets: string[] = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    if (
      response.status() >= 400 &&
      ['stylesheet', 'script', 'image', 'font'].includes(
        response.request().resourceType()
      )
    ) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  return { pageErrors, consoleErrors, failedRequests, failedAssets };
}

async function capturedMessages(
  request: APIRequestContext
): Promise<CapturedMessage[]> {
  const response = await request.get(`${RP_ORIGIN}/smtp/messages`);
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { messages: CapturedMessage[] };
  return payload.messages;
}

async function resetCapturedMessages(request: APIRequestContext) {
  const response = await request.post(`${RP_ORIGIN}/smtp/reset`);
  expect(response.status()).toBe(204);
}

function decodeQuotedPrintable(source: string): string {
  return source
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
}

function loginCodes(messages: CapturedMessage[], recipient: string): string[] {
  return messages
    .filter(message => message.rcptTo.includes(recipient))
    .map(message => decodeQuotedPrintable(message.source))
    .filter(source => /Subject: Your .* login code/i.test(source))
    .map(source => source.match(/<strong>(\d{6})<\/strong>/)?.[1])
    .filter((code): code is string => Boolean(code));
}

async function waitForLoginCodes(
  request: APIRequestContext,
  recipient: string,
  count: number
): Promise<string[]> {
  await expect
    .poll(
      async () => loginCodes(await capturedMessages(request), recipient).length
    )
    .toBe(count);
  return loginCodes(await capturedMessages(request), recipient);
}

async function fillOtp(page: Page, code: string) {
  expect(code).toMatch(/^\d{6}$/);
  const inputs = page.locator('.otp-input');
  await expect(inputs).toHaveCount(6);
  for (const [index, digit] of [...code].entries()) {
    await inputs.nth(index).fill(digit);
  }
  await expect(page.locator('#code')).toHaveValue(code);
}

async function login(page: Page, user: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
}

async function logout(page: Page) {
  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page.locator('form[action="/auth/logout"]').getByRole('button').click();
  await page.locator('a[href="/auth/login"]').first().click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
}

async function submitMfaCode(page: Page, code: string) {
  await fillOtp(page, code);
  await page
    .locator('form[action="/auth/mfa-verify"] button[type="submit"]')
    .click();
}

async function expireEmailMfaCode(request: APIRequestContext, email: string) {
  const response = await request.post(
    `${RP_ORIGIN}/test-control/mfa-email-expiry`,
    { data: { email } }
  );
  expect(response.status()).toBe(204);
}

test.describe('public MFA challenges', () => {
  test('enrolls email MFA and enforces invalid, replaced, expired, and valid login codes', async ({
    page,
    request,
  }) => {
    const user = await createManagedUser('email-mfa');
    const failures = observeBrowserFailures(page);

    await login(page, user);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
    await resetCapturedMessages(request);
    await page.goto(`${IDP_ORIGIN}/accounts/settings/security`);

    await page.locator('#enable-mfa-email-form button[type="submit"]').click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/accounts/setup-mfa?method=email`
    );
    // The default E2E profile renders French copy; the semantic page heading
    // remains the stable contract while translations vary by locale.
    await expect(page.locator('.auth-heading')).toBeVisible();

    await expect
      .poll(async () => {
        const messages = await capturedMessages(request);
        return messages.filter(message => message.rcptTo.includes(user.email))
          .length;
      })
      .toBe(1);
    const setupMessage = (await capturedMessages(request))[0];
    const setupCode = decodeQuotedPrintable(setupMessage.source).match(
      /\b(\d{6})\b/
    )?.[1];
    expect(setupCode).toMatch(/^\d{6}$/);

    await fillOtp(page, setupCode!);
    await page
      .locator(
        'form[action="/accounts/setup-mfa?method=email"] button[type="submit"]'
      )
      .click();
    await expect(page.locator('#recovery-codes-data [data-code]')).toHaveCount(
      10
    );
    await page.locator('#acknowledge').check();
    await page
      .locator(
        'form[action="/accounts/settings/security"] button[type="submit"]'
      )
      .click();
    await expect(
      page.locator('form[action$="disable-mfa?method=email"]')
    ).toBeVisible();

    await logout(page);
    await resetCapturedMessages(request);
    await login(page, user);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    const [firstCode] = await waitForLoginCodes(request, user.email, 1);

    const invalidCode = firstCode === '000000' ? '999999' : '000000';
    await submitMfaCode(page, invalidCode);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    await expect(
      page.getByText(/invalid or expired verification code/i)
    ).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    await page
      .locator('form[action="/auth/mfa-resend"] button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    const resentNotice = page
      .getByRole('alert')
      .filter({ hasText: /new verification code has been sent/i });
    await expect(resentNotice).toBeVisible();
    await resentNotice
      .getByRole('button', { name: 'Dismiss notification' })
      .click();
    const [, secondCode] = await waitForLoginCodes(request, user.email, 2);
    expect(secondCode).not.toBe(firstCode);

    await submitMfaCode(page, firstCode);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    await expect(
      page.getByText(/invalid or expired verification code/i)
    ).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    await expireEmailMfaCode(request, user.email);
    await submitMfaCode(page, secondCode);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    await expect(
      page.getByText(/invalid or expired verification code/i)
    ).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    await page
      .locator('form[action="/auth/mfa-resend"] button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    const finalResentNotice = page
      .getByRole('alert')
      .filter({ hasText: /new verification code has been sent/i });
    await expect(finalResentNotice).toBeVisible();
    await finalResentNotice
      .getByRole('button', { name: 'Dismiss notification' })
      .click();
    const [, , thirdCode] = await waitForLoginCodes(request, user.email, 3);
    await submitMfaCode(page, thirdCode);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

    expect(failures).toEqual({
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
      failedAssets: [],
    });
  });

  test('requires an explicit method choice and completes email and TOTP challenges', async ({
    page,
    request,
  }) => {
    const user = await createManagedUser('multi-mfa');
    const failures = observeBrowserFailures(page);

    await login(page, user);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
    await page.goto(`${IDP_ORIGIN}/accounts/settings/security`);

    await page.locator('#enable-mfa-app-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/setup-mfa`);
    const totpSecret = (
      await page.locator('#manual-setup-key').textContent()
    )?.trim();
    expect(totpSecret).toMatch(/^[A-Z2-7]+$/);
    await fillOtp(page, await generate({ secret: totpSecret! }));
    await page
      .locator('form[action="/accounts/setup-mfa"] button[type="submit"]')
      .click();
    await expect(page.locator('#recovery-codes-data [data-code]')).toHaveCount(
      10
    );
    await page.locator('#acknowledge').check();
    await page
      .locator(
        'form[action="/accounts/settings/security"] button[type="submit"]'
      )
      .click();
    expect(new URL(page.url()).pathname).toBe('/accounts/settings/security');

    await resetCapturedMessages(request);
    await page.locator('#enable-mfa-email-form button[type="submit"]').click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/accounts/setup-mfa?method=email`
    );
    await expect
      .poll(async () => {
        const messages = await capturedMessages(request);
        return messages.filter(message => message.rcptTo.includes(user.email))
          .length;
      })
      .toBe(1);
    const setupCode = decodeQuotedPrintable(
      (await capturedMessages(request))[0].source
    ).match(/\b(\d{6})\b/)?.[1];
    expect(setupCode).toMatch(/^\d{6}$/);
    await fillOtp(page, setupCode!);
    await page
      .locator(
        'form[action="/accounts/setup-mfa?method=email"] button[type="submit"]'
      )
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/security`);
    await expect(
      page.locator('form[action$="disable-mfa?method=email"]')
    ).toBeVisible();

    await logout(page);
    await resetCapturedMessages(request);
    await login(page, user);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-select`);
    await expect(
      page.locator('form[action="/auth/mfa-select"] input[value="totp"]')
    ).toBeAttached();
    const emailChoice = page
      .locator('form[action="/auth/mfa-select"]')
      .filter({ has: page.locator('input[value="email"]') });
    await emailChoice.getByRole('button').click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    const [emailCode] = await waitForLoginCodes(request, user.email, 1);
    await submitMfaCode(page, emailCode);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

    await logout(page);
    await login(page, user);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-select`);
    const totpChoice = page
      .locator('form[action="/auth/mfa-select"]')
      .filter({ has: page.locator('input[value="totp"]') });
    await totpChoice.getByRole('button').click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);
    await submitMfaCode(page, await generate({ secret: totpSecret! }));
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

    expect(failures).toEqual({
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
      failedAssets: [],
    });
  });
});
