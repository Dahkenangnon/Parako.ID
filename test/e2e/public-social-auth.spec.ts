import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { createManagedUser, IDP_ORIGIN } from './support/management-api.js';

const RP_ORIGIN = 'http://127.0.0.1:19010';
const PHONE = '+14155552677';

type CapturedSms = { body: string; from: string; to: string };

function observeBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') {
      failures.push(`console: ${message.text()}`);
    }
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

async function expectStyledPage(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('main').first()).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          Array.from(document.styleSheets).filter(sheet => sheet.href).length
      )
    )
    .toBeGreaterThanOrEqual(2);
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

async function approveProvider(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Authorize Parako test access' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
}

async function beginSocialLogin(page: Page) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await expectStyledPage(page);
  await page.locator('button[data-provider="github"]').click();
  await expect(
    page.getByRole('heading', { name: 'Authorize Parako test access' })
  ).toBeVisible();
}

async function setProviderIdentity(
  page: Page,
  { email, subject }: { email?: string; subject: string }
) {
  await page.locator('input[name="provider_subject"]').fill(subject);
  if (email) {
    await page.locator('input[name="verified_email"]').fill(email);
  }
}

async function expectSocialFailure(
  page: Page,
  expectedMessage: RegExp
): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Github Authentication Error' })
  ).toBeVisible();
  await expectStyledPage(page);
  await expect(page.locator('main')).toContainText(expectedMessage);
  await expect(page.locator('main')).not.toContainText(
    /bad_verification_code/i
  );
}

async function closeContext(
  context: BrowserContext,
  failures: string[]
): Promise<void> {
  expect(failures).toEqual([]);
  await context.close();
}

test('social registration and OIDC social login enforce contact and phone policy', async ({
  browser,
  request,
}) => {
  const email = `social-${randomUUID()}@example.test`;
  await request.post(`${RP_ORIGIN}/sms/reset`);

  // First exercise the public registration and ordinary social-login paths.
  // The fixture omits contact claims so Parako must render and validate its
  // real configurable contact-completion page.
  const registrationContext = await browser.newContext();
  const registrationPage = await registrationContext.newPage();
  const registrationFailures = observeBrowserFailures(registrationPage);

  await registrationPage.goto(`${IDP_ORIGIN}/auth/register`);
  await expectStyledPage(registrationPage);
  const registrationButton = registrationPage.locator(
    'button[data-provider="github"][data-action="register"]'
  );
  await expect(registrationButton).toBeVisible();
  await registrationButton.click();
  await approveProvider(registrationPage);

  await expect(registrationPage).toHaveURL(
    `${IDP_ORIGIN}/auth/social-contact-info?provider=github`
  );
  await expectStyledPage(registrationPage);
  const emailInput = registrationPage.locator('#email');
  const phoneInput = registrationPage.locator('#phone_number');
  await expect(emailInput).toHaveAttribute('required', '');
  await expect(phoneInput).toHaveAttribute('required', '');
  await expect(registrationPage.locator('label[for="email"]')).toContainText(
    '*'
  );
  await expect(
    registrationPage.locator('label[for="phone_number"]')
  ).toContainText('*');
  await emailInput.fill(email);
  await phoneInput.fill(PHONE);
  await registrationPage
    .getByRole('button', { name: 'Complete Registration' })
    .click();

  await expect(registrationPage).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/auth/phone-verification\\?token=`)
  );
  await expectStyledPage(registrationPage);
  await expect.poll(async () => (await capturedSms(request)).length).toBe(1);
  const initialMessage = (await capturedSms(request))[0];
  expect(initialMessage?.to).toBe(PHONE);
  await registrationPage
    .locator('#code')
    .fill(verificationCode(initialMessage));
  await registrationPage.getByRole('button', { name: 'Verify phone' }).click();
  await expect(registrationPage).toHaveURL(`${IDP_ORIGIN}/auth/login`);

  await registrationPage.locator('button[data-provider="github"]').click();
  await approveProvider(registrationPage);
  await expect(registrationPage).toHaveURL(`${IDP_ORIGIN}/accounts/`);
  await expectStyledPage(registrationPage);
  await closeContext(registrationContext, registrationFailures);

  // Revoke the persisted phone proof in the disposable database, then start a
  // real Authorization Code + PKCE flow from the temporary RP in a clean
  // browser context. Parako must stop the social callback before login until
  // a newly delivered possession proof succeeds.
  const unverify = await request.post(
    `${RP_ORIGIN}/test-control/phone-unverify`,
    {
      data: { email },
    }
  );
  expect(unverify.status()).toBe(204);
  await request.post(`${RP_ORIGIN}/sms/reset`);

  const oidcContext = await browser.newContext();
  const oidcPage = await oidcContext.newPage();
  const oidcFailures = observeBrowserFailures(oidcPage);

  await oidcPage.goto(RP_ORIGIN);
  await oidcPage.getByTestId('rp-login').click();
  await expect(oidcPage).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/oidc/v1/interaction/`)
  );
  await expectStyledPage(oidcPage);
  await oidcPage.locator('button[data-provider="github"]').click();
  await approveProvider(oidcPage);

  await expect(oidcPage).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/auth/phone-verification\\?token=`)
  );
  await expect(oidcPage.getByTestId('rp-authenticated')).toHaveCount(0);
  await expect.poll(async () => (await capturedSms(request)).length).toBe(1);
  const oidcMessage = (await capturedSms(request))[0];
  expect(oidcMessage?.to).toBe(PHONE);
  await oidcPage.locator('#code').fill(verificationCode(oidcMessage));
  await oidcPage.getByRole('button', { name: 'Verify phone' }).click();

  // Phone possession resumes the same opaque oidc-provider interaction but
  // does not silently authenticate. A fresh provider authorization completes
  // login without retaining or replaying the previous callback state.
  await expect(oidcPage).toHaveURL(
    new RegExp(`${IDP_ORIGIN}/oidc/v1/interaction/`)
  );
  await expect(
    oidcPage.locator('button[data-provider="github"]')
  ).toBeVisible();
  await oidcPage.locator('button[data-provider="github"]').click();
  await approveProvider(oidcPage);

  const consent = oidcPage.locator('#consent-submit-btn');
  if (await consent.isVisible()) {
    await consent.click();
  }
  await expect(oidcPage).toHaveURL(`${RP_ORIGIN}/`);
  await expect(oidcPage.getByTestId('rp-authenticated')).toBeVisible();
  await expect(oidcPage.getByTestId('rp-email')).toHaveText(email);
  await expect(oidcPage.getByTestId('rp-id-token')).toHaveText('present');
  await closeContext(oidcContext, oidcFailures);
});

test('social login handles provider denial without losing the verified callback state', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await beginSocialLogin(page);
  await page.getByRole('button', { name: 'Deny' }).click();

  await expectSocialFailure(page, /denied access/i);
  await closeContext(context, failures);
});

test('social login rejects a tampered callback state before token exchange', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await beginSocialLogin(page);
  await page.getByRole('button', { name: 'Return invalid state' }).click();

  await expectSocialFailure(page, /invalid oauth state|try again/i);
  await closeContext(context, failures);
});

test('social login contains an upstream token failure on a styled error page', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await beginSocialLogin(page);
  await page.getByRole('button', { name: 'Return provider failure' }).click();

  await expectSocialFailure(
    page,
    /unable to complete|invalid request|try again/i
  );
  await closeContext(context, failures);
});

test('disabled social providers stay local and report their unavailable state', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await page.goto(`${IDP_ORIGIN}/auth/social/google/login`);

  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
  await expectStyledPage(page);
  await expect(page.getByRole('dialog')).toContainText(
    /google login is not available/i
  );
  await closeContext(context, failures);
});

test('manual-link policy rejects anonymous email matching and returns an explicit account link to settings', async ({
  browser,
}) => {
  const user = await createManagedUser('social-manual-link');
  const providerSubject = `manual-link-${randomUUID()}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = observeBrowserFailures(page);

  await beginSocialLogin(page);
  await setProviderIdentity(page, {
    email: user.email,
    subject: providerSubject,
  });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expectSocialFailure(page, /account already exists/i);

  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

  await page.goto(`${IDP_ORIGIN}/accounts/settings/social`);
  await expectStyledPage(page);
  await page.locator('a[href="/accounts/social/github/link"]').click();
  await setProviderIdentity(page, {
    email: user.email,
    subject: providerSubject,
  });
  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/social`);
  await expectStyledPage(page);
  await expect(page.locator('.toast[data-toast-type="success"]')).toContainText(
    /github account linked successfully/i
  );
  await expect(
    page.locator('form[action="/accounts/social/github/unlink"]')
  ).toBeVisible();

  await page
    .locator(
      'form[action="/accounts/social/github/unlink"] button[type="submit"]'
    )
    .click();
  const unlinkConfirmation = page.getByRole('dialog', {
    name: 'Unlink Social Provider',
  });
  await expect(unlinkConfirmation).toBeVisible();
  await unlinkConfirmation.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/social`);
  await expect(
    page.locator('a[href="/accounts/social/github/link"]')
  ).toBeVisible();
  await closeContext(context, failures);
});
