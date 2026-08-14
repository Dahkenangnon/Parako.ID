import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';
import { currentSessionId } from './support/browser-session.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';

type CapturedMessage = {
  rcptTo: string[];
  source: string;
};

async function resetCapturedMessages(request: APIRequestContext) {
  const response = await request.post(`${RP_ORIGIN}/smtp/reset`);
  expect(response.status()).toBe(204);
}

async function capturedMessages(
  request: APIRequestContext
): Promise<CapturedMessage[]> {
  const response = await request.get(`${RP_ORIGIN}/smtp/messages`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { messages: CapturedMessage[] }).messages;
}

async function waitForMessage(
  request: APIRequestContext,
  recipient: string,
  subject: RegExp
): Promise<CapturedMessage> {
  const matching = async () =>
    (await capturedMessages(request)).filter(
      message =>
        message.rcptTo.includes(recipient) && subject.test(message.source)
    );
  await expect.poll(async () => (await matching()).length).toBe(1);
  return (await matching())[0]!;
}

function decodeQuotedPrintable(source: string): string {
  return source
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replaceAll('&amp;', '&');
}

function extractVerificationUrl(message: CapturedMessage): string {
  const decoded = decodeQuotedPrintable(message.source);
  const match = decoded.match(
    /https?:\/\/[^\s"'<>]+\/accounts\/verify-recovery-email\?token=[A-Za-z0-9_-]+/
  );
  expect(match).not.toBeNull();
  const verificationUrl = new URL(match![0]);
  expect(verificationUrl.origin).toBe(IDP_ORIGIN);
  return verificationUrl.toString();
}

function extractRecoveryCode(message: CapturedMessage): string {
  const match = decodeQuotedPrintable(message.source).match(
    /<strong[^>]*>(\d{6})<\/strong>/
  );
  expect(match).not.toBeNull();
  return match![1]!;
}

async function login(page: Page, user: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
}

async function logout(page: Page) {
  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page.locator('form[action="/auth/logout"]').getByRole('button').click();
  await expect(
    page.getByRole('heading', { name: /signed out/i })
  ).toBeVisible();
}

async function chooseBackupCodeRecovery(page: Page, identifier: string) {
  await page.goto(`${IDP_ORIGIN}/auth/account-recovery`);
  await page.locator('#identifier').fill(identifier);
  await page.locator('#recovery-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-method-select`);
  await page
    .locator(
      'form:has(input[name="method"][value="backup_codes"]) button[type="submit"]'
    )
    .click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-backup-codes`);
}

async function chooseSecondaryEmailRecovery(page: Page, identifier: string) {
  await page.goto(`${IDP_ORIGIN}/auth/account-recovery`);
  await page.locator('#identifier').fill(identifier);
  await page.locator('#recovery-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-method-select`);
  await page
    .locator(
      'form:has(input[name="method"][value="secondary_email"]) button[type="submit"]'
    )
    .click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-secondary-email`);
}

async function submitBackupCode(page: Page, code: string) {
  const characters = code.replaceAll('-', '');
  expect(characters).toMatch(/^[A-F0-9]{8}$/);

  const inputs = page.locator('.backup-input');
  await expect(inputs).toHaveCount(8);
  for (const [index, character] of [...characters].entries()) {
    await inputs.nth(index).fill(character);
  }
  await expect(page.locator('#code')).toHaveValue(
    `${characters.slice(0, 4)}-${characters.slice(4)}`
  );
  await page.getByRole('button', { name: 'Recover Account' }).click();
}

async function submitRecoveryCode(page: Page, code: string) {
  expect(code).toMatch(/^\d{6}$/);
  const inputs = page.locator('.otp-input');
  await expect(inputs).toHaveCount(6);
  for (const [index, digit] of [...code].entries()) {
    await inputs.nth(index).fill(digit);
  }
  await expect(page.locator('#code')).toHaveValue(code);
  await page.getByRole('button', { name: 'Verify Code' }).click();
}

test('recovers an account once with a generated backup code and rejects replay', async ({
  page,
}) => {
  const user = await createManagedUser('public-backup-recovery');
  await login(page, user);

  await page.goto(`${IDP_ORIGIN}/accounts/recovery-setup`);
  await page
    .locator('form[action="/accounts/enable-recovery"] button[type="submit"]')
    .click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/recovery-codes`);

  const firstCode = await page
    .locator('#recovery-codes-data [data-code]')
    .first()
    .getAttribute('data-code');
  expect(firstCode).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);

  await logout(page);
  await chooseBackupCodeRecovery(page, user.email);

  const invalidCode = firstCode!.startsWith('A')
    ? `B${firstCode!.slice(1)}`
    : `A${firstCode!.slice(1)}`;
  await submitBackupCode(page, invalidCode);
  await expect(page.getByText(/invalid backup code/i)).toBeVisible();

  await submitBackupCode(page, firstCode!);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expect(page.getByText(/account recovered successfully/i)).toBeVisible();

  await logout(page);
  await chooseBackupCodeRecovery(page, user.email);
  await submitBackupCode(page, firstCode!);
  await expect(page.getByText(/invalid backup code/i)).toBeVisible();
});

test('verifies, uses, and removes a secondary recovery email while rejecting old codes', async ({
  page,
  request,
}) => {
  const user = await createManagedUser('public-secondary-recovery');
  const secondaryEmail = `recovery-${user.email}`;
  await resetCapturedMessages(request);
  await login(page, user);

  await page.goto(`${IDP_ORIGIN}/accounts/recovery-setup`);
  await page.locator('#secondary-email').fill(secondaryEmail);
  await page
    .locator('form[action="/accounts/enable-recovery"] button[type="submit"]')
    .click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/recovery-codes`);

  const verificationMessage = await waitForMessage(
    request,
    secondaryEmail,
    /Subject: Verify your recovery email/i
  );
  await page.goto(extractVerificationUrl(verificationMessage));
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);
  await expect(
    page.getByText(/recovery email verified successfully/i)
  ).toBeVisible();

  await resetCapturedMessages(request);
  await logout(page);
  await chooseSecondaryEmailRecovery(page, user.email);
  await page.locator('#email').fill(secondaryEmail);
  await page.getByRole('button', { name: 'Send Verification Code' }).click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-verify-code`);

  const firstMessage = await waitForMessage(
    request,
    secondaryEmail,
    /Subject: Account Recovery Verification Code/i
  );
  const firstCode = extractRecoveryCode(firstMessage);
  const invalidCode = firstCode === '000000' ? '111111' : '000000';
  await submitRecoveryCode(page, invalidCode);
  await expect(page.getByText(/invalid verification code/i)).toBeVisible();
  await submitRecoveryCode(page, firstCode);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await resetCapturedMessages(request);
  await logout(page);
  await chooseSecondaryEmailRecovery(page, user.email);
  await page.locator('#email').fill(secondaryEmail);
  await page.getByRole('button', { name: 'Send Verification Code' }).click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-verify-code`);

  const secondMessage = await waitForMessage(
    request,
    secondaryEmail,
    /Subject: Account Recovery Verification Code/i
  );
  const secondCode = extractRecoveryCode(secondMessage);
  expect(secondCode).not.toBe(firstCode);

  const expireResponse = await request.post(
    `${RP_ORIGIN}/test-control/recovery-secondary-email-expiry`,
    { data: { sessionId: await currentSessionId(page) } }
  );
  expect(expireResponse.status()).toBe(204);
  await submitRecoveryCode(page, secondCode);
  await expect(page.getByText(/verification code has expired/i)).toBeVisible();

  await resetCapturedMessages(request);
  await page.goto(`${IDP_ORIGIN}/auth/account-recovery`);
  await page.locator('#identifier').fill(user.email);
  await page.locator('#recovery-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-method-select`);
  await page
    .locator(
      'form:has(input[name="method"][value="secondary_email"]) button[type="submit"]'
    )
    .click();
  await page.locator('#email').fill(secondaryEmail);
  await page.getByRole('button', { name: 'Send Verification Code' }).click();
  const thirdMessage = await waitForMessage(
    request,
    secondaryEmail,
    /Subject: Account Recovery Verification Code/i
  );
  const thirdCode = extractRecoveryCode(thirdMessage);
  expect(thirdCode).not.toBe(secondCode);
  await submitRecoveryCode(page, firstCode);
  await expect(page.getByText(/invalid verification code/i)).toBeVisible();
  await submitRecoveryCode(page, thirdCode);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/accounts/settings/recovery`);
  const removeSecondaryEmail = page.locator(
    'form[action="/accounts/disable-recovery?method=secondary_email"]'
  );
  await expect(removeSecondaryEmail).toBeVisible();
  await removeSecondaryEmail.locator('button[type="submit"]').click();
  const removeDialog = page.getByRole('dialog', {
    name: 'Remove Backup Email',
  });
  await expect(removeDialog).toBeVisible();
  await Promise.all([
    page.waitForNavigation(),
    removeDialog.getByRole('button', { name: 'Confirm' }).click(),
  ]);
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);
  await expect(
    page.locator(
      'form[action="/accounts/enable-recovery?method=secondary_email"]'
    )
  ).toBeVisible();

  await logout(page);
  await page.goto(`${IDP_ORIGIN}/auth/account-recovery`);
  await page.locator('#identifier').fill(user.email);
  await page.locator('#recovery-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/recovery-method-select`);
  await expect(
    page.locator('input[name="method"][value="secondary_email"]')
  ).toHaveCount(0);
});
