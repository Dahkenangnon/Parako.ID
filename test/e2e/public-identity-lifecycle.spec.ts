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

const RP_ORIGIN = 'http://127.0.0.1:19010';

type CapturedMessage = {
  mailFrom: string;
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
  const payload = (await response.json()) as { messages: CapturedMessage[] };
  return payload.messages;
}

async function expireIdentityToken(
  request: APIRequestContext,
  email: string,
  kind: 'email-verification' | 'password-reset'
) {
  const response = await request.post(
    `${RP_ORIGIN}/test-control/identity-token-expiry`,
    { data: { email, kind } }
  );
  expect(response.status()).toBe(204);
}

async function waitForMessage(
  request: APIRequestContext,
  recipient: string
): Promise<CapturedMessage> {
  await expect
    .poll(async () => {
      const messages = await capturedMessages(request);
      return messages.filter(message => message.rcptTo.includes(recipient))
        .length;
    })
    .toBe(1);

  const message = (await capturedMessages(request)).find(item =>
    item.rcptTo.includes(recipient)
  );
  expect(message).toBeDefined();
  return message!;
}

function extractActionUrl(message: CapturedMessage, path: string): string {
  const decoded = message.source
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replaceAll('&amp;', '&');
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = decoded.match(
    new RegExp(
      `${IDP_ORIGIN.replaceAll('.', '\\.')}${escapedPath}\\?token=[A-Za-z0-9_-]+`
    )
  );
  expect(match, `expected ${path} action URL in captured email`).not.toBeNull();
  return match![0];
}

async function login(page: Page, user: ManagedUserFixture, password: string) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
}

test.describe('public identity lifecycle', () => {
  test('verifies an email using the delivered link and rejects replay without leaking account existence', async ({
    page,
    request,
  }) => {
    const user = await createManagedUser('email-verification');
    await resetCapturedMessages(request);

    await page.goto(`${IDP_ORIGIN}/auth/email-verification`);
    await page.locator('#email').fill(user.email);
    await page.getByRole('button', { name: /send verification link/i }).click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/auth/email-verification?status=pending`
    );
    await expect(
      page.getByRole('heading', { name: 'Verify Your Email' })
    ).toBeVisible();

    const message = await waitForMessage(request, user.email);
    const verificationUrl = extractActionUrl(message, '/auth/verify-email');
    expect(message.mailFrom).toBe('no-reply@parako.test');

    await page.goto(verificationUrl);
    await expect(page).toHaveURL(
      new RegExp(
        `${IDP_ORIGIN.replaceAll('.', '\\.')}/auth/email-verification-success\\?`
      )
    );
    await expect(
      page.getByRole('heading', { name: 'Email Verified!' })
    ).toBeVisible();
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();

    await page.goto(verificationUrl);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/email-verification`);
    await expect(
      page.getByText(/verification link has expired or is invalid/i)
    ).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    await resetCapturedMessages(request);
    await page.locator('#email').fill(user.email);
    await page.getByRole('button', { name: /send verification link/i }).click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/auth/email-verification?status=pending`
    );
    expect(await capturedMessages(request)).toEqual([]);

    await page.goto(`${IDP_ORIGIN}/auth/email-verification`);
    await page.locator('#email').fill('absent-user@example.test');
    await page.getByRole('button', { name: /send verification link/i }).click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/auth/email-verification?status=pending`
    );
    expect(await capturedMessages(request)).toEqual([]);
  });

  test('resets a password using the delivered link, rejects invalid and replayed tokens, and preserves anti-enumeration behavior', async ({
    page,
    request,
  }) => {
    const user = await createManagedUser('password-recovery');
    const newPassword = 'E2E-Recovered!9';
    await resetCapturedMessages(request);

    await page.goto(`${IDP_ORIGIN}/auth/forgot-password`);
    await page.locator('#email').fill(user.email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
    await expect(
      page.getByText(/if an account with that email exists/i)
    ).toBeVisible();

    const message = await waitForMessage(request, user.email);
    const resetUrl = extractActionUrl(message, '/auth/reset-password');

    // The public response must remain indistinguishable for an unknown email,
    // while the capture proves that no message was delivered.
    await resetCapturedMessages(request);
    await page.goto(`${IDP_ORIGIN}/auth/forgot-password`);
    await page.locator('#email').fill('absent-user@example.test');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
    await expect(
      page.getByText(/if an account with that email exists/i)
    ).toBeVisible();
    expect(await capturedMessages(request)).toEqual([]);

    await page.goto(resetUrl);
    await page.locator('#password').fill(newPassword);
    await page.locator('#confirm-password').fill(newPassword);
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
    await expect(
      page.getByText(/password has been reset successfully/i)
    ).toBeVisible();

    await page.goto(resetUrl);
    await page.locator('#password').fill('E2E-Replay!9');
    await page.locator('#confirm-password').fill('E2E-Replay!9');
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/forgot-password`);
    await expect(page.getByText(/invalid or expired token/i)).toBeVisible();

    await page.goto(
      `${IDP_ORIGIN}/auth/reset-password?token=not-a-valid-token`
    );
    await page.locator('#password').fill('E2E-Invalid!9');
    await page.locator('#confirm-password').fill('E2E-Invalid!9');
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/forgot-password`);
    await expect(page.getByText(/invalid or expired token/i)).toBeVisible();

    await login(page, user, user.password);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();

    await login(page, user, newPassword);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  });

  test('rejects delivered email-verification and password-reset links after their persisted expiry', async ({
    page,
    request,
  }) => {
    const verificationUser = await createManagedUser(
      'expired-email-verification'
    );
    await resetCapturedMessages(request);

    await page.goto(`${IDP_ORIGIN}/auth/email-verification`);
    await page.locator('#email').fill(verificationUser.email);
    await page.getByRole('button', { name: /send verification link/i }).click();
    const verificationMessage = await waitForMessage(
      request,
      verificationUser.email
    );
    const verificationUrl = extractActionUrl(
      verificationMessage,
      '/auth/verify-email'
    );
    await expireIdentityToken(
      request,
      verificationUser.email,
      'email-verification'
    );

    await page.goto(verificationUrl);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/email-verification`);
    await expect(
      page.getByText(/verification link has expired or is invalid/i)
    ).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    const resetUser = await createManagedUser('expired-password-reset');
    await resetCapturedMessages(request);
    await page.goto(`${IDP_ORIGIN}/auth/forgot-password`);
    await page.locator('#email').fill(resetUser.email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    const resetMessage = await waitForMessage(request, resetUser.email);
    const resetUrl = extractActionUrl(resetMessage, '/auth/reset-password');
    await expireIdentityToken(request, resetUser.email, 'password-reset');

    await page.goto(resetUrl);
    await page.locator('#password').fill('E2E-Expired!9');
    await page.locator('#confirm-password').fill('E2E-Expired!9');
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/forgot-password`);
    await expect(page.getByText(/invalid or expired token/i)).toBeVisible();
  });
});
