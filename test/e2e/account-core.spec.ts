import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

type BrowserFailures = ReturnType<typeof observeBrowserFailures>;

const RP_ORIGIN = 'http://127.0.0.1:19010';
const STORAGE_TENANT_ID =
  process.env.PARAKO_E2E_MULTI_TENANCY === 'true'
    ? (process.env.PARAKO_E2E_TENANT_ID ?? 'browser-e2e')
    : 'default';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function expectNoBrowserFailures(failures: BrowserFailures) {
  expect(failures).toEqual({
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    failedAssets: [],
  });
}

async function login(
  page: Page,
  user: ManagedUserFixture,
  expectedPath = '/accounts/'
) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form').locator('button[type="submit"]').click();
  await expect(page).toHaveURL(
    new RegExp(
      `^${IDP_ORIGIN.replaceAll('.', '\\.')}${expectedPath.replaceAll('/', '\\/')}(?:\\?.*)?$`
    )
  );
}

async function expectStyledAccountPage(page: Page) {
  await expect(page.locator('#main-content')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          Array.from(document.styleSheets).filter(sheet => sheet.href).length
      )
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
}

async function fillOtp(page: Page, token: string) {
  expect(token).toMatch(/^\d{6}$/);
  const inputs = page.locator('.otp-input');
  await expect(inputs).toHaveCount(6);
  for (const [index, digit] of [...token].entries()) {
    await inputs.nth(index).fill(digit);
  }
  await expect(page.locator('#code')).toHaveValue(token);
}

async function authorizeTemporaryRp(page: Page) {
  await page.goto(`${RP_ORIGIN}/login?prompt=consent`);
  const consent = page.locator('#consent-submit-btn');
  if (await consent.isVisible()) await consent.click();
  await expect(page).toHaveURL(`${RP_ORIGIN}/`);
  await expect(page.getByTestId('rp-authenticated')).toBeVisible();
}

test.describe('normal-user account core', () => {
  test('guards account pages and rejects authenticated mutations without CSRF', async ({
    page,
  }) => {
    const anonymous = await page.goto(
      `${IDP_ORIGIN}/accounts/settings/profile`
    );
    expect(anonymous?.status()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(
        `^${IDP_ORIGIN.replaceAll('.', '\\.')}/auth/login\\?continue=%2Faccounts%2Fsettings%2Fprofile$`
      )
    );

    const user = await createManagedUser('account-boundary');
    await login(page, user, '/accounts/settings/profile');
    const status = await page.evaluate(
      async url =>
        (
          await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              firstname: 'Missing',
              lastname: 'Token',
            }),
            redirect: 'manual',
          })
        ).status,
      `${IDP_ORIGIN}/accounts/update-profile`
    );
    expect(status).toBe(403);
  });

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'narrow', width: 390, height: 844 },
  ]) {
    test(`renders every core account page with working assets at ${viewport.name} width`, async ({
      page,
    }) => {
      const user = await createManagedUser(
        `account-navigation-${viewport.name}`
      );
      const failures = observeBrowserFailures(page);
      await login(page, user);
      await page.setViewportSize(viewport);

      for (const route of [
        '/accounts/',
        '/accounts/settings/profile',
        '/accounts/settings/preferences',
        '/accounts/settings/notifications',
        '/accounts/settings/security',
        '/accounts/settings/recovery',
        '/accounts/settings/social',
        '/accounts/apps',
        '/accounts/sessions',
      ]) {
        const response = await page.goto(`${IDP_ORIGIN}${route}`);
        expect(response?.status(), route).toBe(200);
        await expectStyledAccountPage(page);
      }

      expectNoBrowserFailures(failures);
    });
  }

  test('canonicalizes account settings and disabled passkey entry points', async ({
    page,
  }) => {
    const user = await createManagedUser('account-canonical-routes');
    const failures = observeBrowserFailures(page);
    await login(page, user);

    const settings = await page.goto(`${IDP_ORIGIN}/accounts/settings`);
    expect(settings?.status()).toBe(200);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/profile`);

    // Passkeys are disabled in the default profile; both entry points must
    // return the user to Security instead of exposing a non-functional page.
    await page.goto(`${IDP_ORIGIN}/accounts/passkeys`);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/security`);
    await page.goto(`${IDP_ORIGIN}/accounts/setup-webauthn`);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/security`);
    expectNoBrowserFailures(failures);
  });

  test('persists profile and password changes through the real forms', async ({
    page,
  }) => {
    const user = await createManagedUser('account-mutations');
    await login(page, user);

    await page.goto(`${IDP_ORIGIN}/accounts/settings/profile`);
    await page.locator('#firstname').fill('Updated');
    await page.locator('#lastname').fill('Person');
    await page.locator('#profile-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/profile`);
    await expect(page.locator('#firstname')).toHaveValue('Updated');
    await expect(page.locator('#lastname')).toHaveValue('Person');

    const newPassword = 'E2E-Changed!8';
    await page.goto(`${IDP_ORIGIN}/accounts/settings/security`);
    await page.locator('#current-password').fill(user.password);
    await page.locator('#new-password').fill(newPassword);
    await page.locator('#confirm-password').fill(newPassword);
    await page
      .locator('form[action="/accounts/change-password"]')
      .locator('button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/security`);

    await page.goto(`${IDP_ORIGIN}/auth/logout`);
    await page
      .locator('form[action="/auth/logout"]')
      .getByRole('button')
      .click();
    await expect(
      page.getByRole('heading', { name: /signed out/i })
    ).toBeVisible();
    await page.locator('a[href="/auth/login"]').first().click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);

    await page.locator('#login').fill(user.email);
    await page.locator('#password').fill(newPassword);
    await page.locator('#login-form').locator('button[type="submit"]').click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
    await expect(
      page.getByRole('heading', { name: 'Updated Person' })
    ).toBeVisible();
  });

  test('persists notification, locale, and timezone preferences without manual refresh', async ({
    page,
  }) => {
    const user = await createManagedUser('account-preferences');
    const failures = observeBrowserFailures(page);
    await login(page, user);

    await page.goto(`${IDP_ORIGIN}/accounts/settings/notifications`);
    const notificationForm = page.locator(
      'form[action="/accounts/update-notification-preferences"]'
    );
    await notificationForm.locator('#preferred_channel').selectOption('email');
    await notificationForm
      .locator('input[name="security_alerts"]')
      .uncheck({ force: true });
    await notificationForm
      .locator('input[name="new_session_alerts"]')
      .uncheck({ force: true });
    await notificationForm
      .locator('input[name="marketing"]')
      .check({ force: true });
    await notificationForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/accounts/settings/notifications`
    );
    await expect(page.locator('#preferred_channel')).toHaveValue('email');
    await expect(
      page.locator('input[name="security_alerts"]')
    ).not.toBeChecked();
    await expect(
      page.locator('input[name="new_session_alerts"]')
    ).not.toBeChecked();
    await expect(page.locator('input[name="marketing"]')).toBeChecked();

    await page.goto(`${IDP_ORIGIN}/accounts/settings/preferences`);
    await Promise.all([
      page.waitForNavigation(),
      page
        .locator('#timezone-selector-settings')
        .selectOption('Africa/Porto-Novo'),
    ]);
    await expect(page.locator('#timezone-selector-settings')).toHaveValue(
      'Africa/Porto-Novo'
    );

    const currentLocale = await page.locator('html').getAttribute('lang');
    const targetLocale = currentLocale === 'fr' ? 'en' : 'fr';
    await Promise.all([
      page.waitForNavigation(),
      page.locator('#language-selector-settings').selectOption(targetLocale),
    ]);
    await expect(page.locator('html')).toHaveAttribute('lang', targetLocale);
    await expect(page.locator('#language-selector-settings')).toHaveValue(
      targetLocale
    );
    expectNoBrowserFailures(failures);
  });

  test('resends primary-email verification from account settings and accepts the delivered proof', async ({
    page,
    request,
  }) => {
    const user = await createManagedUser('account-email-verification');
    const failures = observeBrowserFailures(page);
    await login(page, user);

    const unverify = await request.post(
      `${RP_ORIGIN}/test-control/email-unverify`,
      { data: { email: user.email } }
    );
    expect(unverify.status()).toBe(204);
    const resetCapture = await request.post(`${RP_ORIGIN}/smtp/reset`);
    expect(resetCapture.status()).toBe(204);

    await page.goto(`${IDP_ORIGIN}/accounts/settings/notifications`);
    const resendForm = page.locator(
      'form[action="/accounts/resend-email-verification"]'
    );
    await expect(resendForm).toBeVisible();
    await resendForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(
      `${IDP_ORIGIN}/accounts/settings/notifications`
    );
    await expect(
      page.locator('.toast[data-toast-type="success"]')
    ).toBeVisible();

    await expect
      .poll(async () => {
        const response = await request.get(`${RP_ORIGIN}/smtp/messages`);
        expect(response.ok()).toBe(true);
        const messages = (await response.json()) as {
          messages: Array<{ rcptTo: string[]; source: string }>;
        };
        return messages.messages.filter(item =>
          item.rcptTo.includes(user.email)
        ).length;
      })
      .toBe(1);

    const messagesResponse = await request.get(`${RP_ORIGIN}/smtp/messages`);
    const messages = (await messagesResponse.json()) as {
      messages: Array<{ rcptTo: string[]; source: string }>;
    };
    const delivered = messages.messages.find(item =>
      item.rcptTo.includes(user.email)
    );
    expect(delivered).toBeDefined();
    const decoded = delivered!.source
      .replace(/=\r?\n/g, '')
      .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replaceAll('&amp;', '&');
    const verificationUrl = decoded.match(
      new RegExp(
        `${IDP_ORIGIN.replaceAll('.', '\\.')}/auth/verify-email\\?token=[A-Za-z0-9_-]+`
      )
    )?.[0];
    expect(verificationUrl).toBeDefined();

    await page.goto(verificationUrl!);
    await expect(page).toHaveURL(
      new RegExp(
        `^${IDP_ORIGIN.replaceAll('.', '\\.')}/auth/email-verification-success\\?`
      )
    );
    await page.goto(`${IDP_ORIGIN}/accounts/settings/notifications`);
    await expect(resendForm).toHaveCount(0);
    expectNoBrowserFailures(failures);
  });

  test('sets up recovery codes once and persists recovery controls', async ({
    page,
  }) => {
    const user = await createManagedUser('account-recovery');
    const failures = observeBrowserFailures(page);
    await login(page, user);

    const setup = await page.goto(`${IDP_ORIGIN}/accounts/recovery-setup`);
    expect(setup?.status()).toBe(200);
    await expectStyledAccountPage(page);

    await page
      .locator('form[action="/accounts/enable-recovery"]')
      .locator('button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/recovery-codes`);
    await expect(page.locator('#recovery-codes-data [data-code]')).toHaveCount(
      10
    );
    await expect(page.locator('#download-codes')).toBeVisible();
    await expect(page.locator('#copy-all-codes')).toBeVisible();

    // Recovery codes are deliberately removed from the session after the
    // first render. A reload must never expose the same plaintext codes again.
    await page.reload();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);

    const regenerate = page.locator(
      'form[action="/accounts/regenerate-backup-codes"]'
    );
    await expect(regenerate).toBeVisible();
    await regenerate.evaluate(form =>
      HTMLFormElement.prototype.submit.call(form)
    );
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/recovery-codes`);
    await expect(page.locator('#recovery-codes-data [data-code]')).toHaveCount(
      10
    );

    await page.goto(`${IDP_ORIGIN}/accounts/settings/recovery`);
    const disableBackupCodes = page.locator(
      'form[action="/accounts/disable-recovery?method=backup_codes"]'
    );
    await expect(disableBackupCodes).toBeVisible();
    await disableBackupCodes.locator('button[type="submit"]').click();
    const disableDialog = page.getByRole('dialog', {
      name: 'Remove Backup Codes',
    });
    await expect(disableDialog).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      disableDialog.getByRole('button', { name: 'Confirm' }).click(),
    ]);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/recovery`);
    await expect(
      page.locator(
        'form[action="/accounts/enable-recovery?method=backup_codes"]'
      )
    ).toBeVisible();
    expectNoBrowserFailures(failures);
  });

  test('lists and revokes other browser sessions without ending the current session', async ({
    browser,
    page,
  }) => {
    const user = await createManagedUser('account-sessions');
    const primaryFailures = observeBrowserFailures(page);
    await login(page, user);

    const secondaryContext = await browser.newContext();
    const secondaryPage = await secondaryContext.newPage();
    const secondaryFailures = observeBrowserFailures(secondaryPage);

    try {
      await login(secondaryPage, user);
      await page.goto(`${IDP_ORIGIN}/accounts/sessions`);

      const singleLogoutForm = page.locator(
        'form[action="/accounts/logout-session"]:visible'
      );
      await expect(singleLogoutForm).toHaveCount(1);

      // Exercise the actual dialog integration: cancellation must preserve the
      // session and confirmation must submit the protected form.
      await singleLogoutForm.locator('button[type="submit"]').click();
      await expect(
        page.getByRole('heading', { name: 'Sign Out Session' })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(singleLogoutForm).toHaveCount(1);

      await singleLogoutForm.locator('button[type="submit"]').click();
      await Promise.all([
        page.waitForNavigation(),
        page.getByRole('button', { name: 'Confirm' }).click(),
      ]);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/sessions`);
      await expect(singleLogoutForm).toHaveCount(0);

      await secondaryPage.goto(`${IDP_ORIGIN}/accounts/`);
      await expect(secondaryPage).toHaveURL(
        `${IDP_ORIGIN}/auth/login?continue=%2Faccounts%2F`
      );

      await login(secondaryPage, user);
      await page.goto(`${IDP_ORIGIN}/accounts/sessions`);
      const allOtherLogoutForm = page.locator(
        'form[action="/accounts/logout-all-other-sessions"]:visible'
      );
      await expect(allOtherLogoutForm).toHaveCount(1);
      await allOtherLogoutForm.locator('button[type="submit"]').click();
      await Promise.all([
        page.waitForNavigation(),
        page.getByRole('button', { name: 'Confirm' }).click(),
      ]);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/sessions`);
      await expect(allOtherLogoutForm).toHaveCount(0);

      await page.goto(`${IDP_ORIGIN}/accounts/`);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
      await secondaryPage.goto(`${IDP_ORIGIN}/accounts/`);
      await expect(secondaryPage).toHaveURL(
        `${IDP_ORIGIN}/auth/login?continue=%2Faccounts%2F`
      );

      expectNoBrowserFailures(primaryFailures);
      expectNoBrowserFailures(secondaryFailures);
    } finally {
      await secondaryContext.close();
    }
  });

  test('adds, switches, and removes accounts in one browser session', async ({
    page,
  }) => {
    const firstUser = await createManagedUser('account-switcher-first');
    const secondUser = await createManagedUser('account-switcher-second');
    const failures = observeBrowserFailures(page);
    await login(page, firstUser);

    await page.locator('#sidebar-user-btn').click();
    await expect(page.locator('#accounts-list-sidebar')).toBeVisible();
    await page
      .locator('form[action="/accounts/add-account"]:visible')
      .getByRole('button')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login?intent=add-account`);

    await page.locator('#login').fill(secondUser.email);
    await page.locator('#password').fill(secondUser.password);
    await page
      .locator('form')
      .filter({ has: page.locator('#login') })
      .locator('button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

    const readSwitcher = async () => {
      const result = await page.evaluate(async url => {
        const response = await fetch(url);
        return {
          status: response.status,
          body: (await response.json()) as {
            success: boolean;
            totalAccounts: number;
            accounts: Array<{
              id: string;
              email: string;
              isActive: boolean;
            }>;
          },
        };
      }, `${IDP_ORIGIN}/accounts/account-switcher-data`);
      expect(result.status).toBe(200);
      return result.body;
    };

    const afterAdd = await readSwitcher();
    expect(afterAdd).toMatchObject({ success: true, totalAccounts: 2 });
    expect(afterAdd.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: firstUser.email, isActive: false }),
        expect.objectContaining({ email: secondUser.email, isActive: true }),
      ])
    );

    await page.locator('#sidebar-user-btn').click();
    const firstAccount = page.locator(
      `#other-accounts-list-sidebar [data-account-id="${firstUser.id}"]`
    );
    await expect(firstAccount).toContainText(firstUser.email);
    await firstAccount.click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

    const afterSwitch = await readSwitcher();
    expect(afterSwitch.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: firstUser.email, isActive: true }),
        expect.objectContaining({ email: secondUser.email, isActive: false }),
      ])
    );

    await page.locator('#sidebar-user-btn').click();
    const secondAccount = page.locator(
      `#other-accounts-list-sidebar [data-account-id="${secondUser.id}"]`
    );
    await expect(secondAccount).toContainText(secondUser.email);
    await secondAccount.getByTitle('Remove account').click();
    const removeDialog = page.getByRole('dialog');
    await expect(removeDialog).toBeVisible();
    await removeDialog.locator('button').last().click();
    await expect(secondAccount).toHaveCount(0);

    const afterRemove = await readSwitcher();
    expect(afterRemove).toMatchObject({ success: true, totalAccounts: 1 });
    expect(afterRemove.accounts).toEqual([
      expect.objectContaining({ email: firstUser.email, isActive: true }),
    ]);
    expectNoBrowserFailures(failures);
  });

  test('recovers the account switcher through its CSP-safe retry control', async ({
    page,
  }) => {
    const user = await createManagedUser('account-switcher-retry');
    const failures = observeBrowserFailures(page);
    let requestCount = 0;
    await page.route('**/accounts/account-switcher-data', async route => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          body: JSON.stringify({
            error: 'Temporary account-switcher failure',
            success: false,
          }),
          contentType: 'application/json',
          status: 200,
        });
        return;
      }
      await route.continue();
    });

    await login(page, user);
    await expect(page.locator('[onclick]')).toHaveCount(0);
    await page.locator('#sidebar-user-btn').click();
    await expect(page.locator('#accounts-error-sidebar')).toBeVisible();
    await page.locator('#accounts-retry-sidebar').click();
    await expect(page.locator('#accounts-list-sidebar')).toBeVisible();
    expect(requestCount).toBe(2);
    await page.unroute('**/accounts/account-switcher-data');
    expectNoBrowserFailures(failures);
  });

  test('uploads, serves, persists, and removes the account avatar', async ({
    page,
  }) => {
    const user = await createManagedUser('account-avatar');
    const failures = observeBrowserFailures(page);
    await login(page, user);
    await page.goto(`${IDP_ORIGIN}/accounts/settings/profile`);

    await Promise.all([
      page.waitForNavigation(),
      page.locator('#avatar-upload').setInputFiles('public/favicon.png'),
    ]);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/profile`);

    const avatar = page.locator('#preview-avatar');
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute(
      'src',
      new RegExp(
        `/media/file/${escapeRegExp(STORAGE_TENANT_ID)}/avatars/avatar-`
      )
    );
    await expect(page.locator('#remove-button')).toBeVisible();

    // Reloading proves the media key was persisted, while loading the image
    // through the browser exercises the signed local-storage URL end to end.
    await page.reload();
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveJSProperty('complete', true);
    expect(
      await avatar.evaluate(image => (image as HTMLImageElement).naturalWidth)
    ).toBeGreaterThan(0);

    await page.locator('#remove-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      dialog.getByRole('button', { name: 'Remove' }).click(),
    ]);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/settings/profile`);
    await expect(page.locator('#remove-button')).toHaveCount(0);
    await expect(page.locator('#preview-avatar')).toBeHidden();
    expectNoBrowserFailures(failures);
  });

  test('enrolls, challenges, and disables authenticator-app MFA', async ({
    page,
  }) => {
    const user = await createManagedUser('account-totp');
    const failures = observeBrowserFailures(page);
    await login(page, user);
    await page.goto(`${IDP_ORIGIN}/accounts/settings/security`);

    const [setupResponse] = await Promise.all([
      page.waitForNavigation(),
      page
        .locator('#enable-mfa-app-form')
        .locator('button[type="submit"]')
        .click(),
    ]);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/setup-mfa`);
    expect(setupResponse?.headers()['cache-control']).toContain('no-store');

    const secret = (
      await page.locator('#manual-setup-key').textContent()
    )?.trim();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    await fillOtp(page, await generate({ secret: secret! }));

    const [recoveryCodesResponse] = await Promise.all([
      page.waitForNavigation(),
      page
        .locator('form[action="/accounts/setup-mfa"] button[type="submit"]')
        .click(),
    ]);
    expect(recoveryCodesResponse?.headers()['cache-control']).toContain(
      'no-store'
    );
    await expect(page.locator('#recovery-codes-data [data-code]')).toHaveCount(
      10
    );

    await page.locator('#acknowledge').check();
    await Promise.all([
      page.waitForNavigation(),
      page
        .locator(
          'form[action="/accounts/settings/security"] button[type="submit"]'
        )
        .click(),
    ]);
    expect(new URL(page.url()).pathname).toBe('/accounts/settings/security');
    const disableTotp = page.locator(
      'form[action="/accounts/disable-mfa?method=totp"]'
    );
    await expect(disableTotp.locator('button[type="submit"]')).toBeVisible();

    await page.goto(`${IDP_ORIGIN}/auth/logout`);
    await page
      .locator('form[action="/auth/logout"]')
      .getByRole('button')
      .click();
    await page.locator('a[href="/auth/login"]').first().click();
    await page.locator('#login').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-verify`);

    await fillOtp(page, await generate({ secret: secret! }));
    await page
      .locator('form[action="/auth/mfa-verify"]')
      .locator('button[type="submit"]')
      .click();
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

    await page.goto(`${IDP_ORIGIN}/accounts/settings/security`);
    await disableTotp.locator('button[type="submit"]').click();
    const disableDialog = page.getByRole('dialog');
    await expect(disableDialog).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      disableDialog.locator('button').last().click(),
    ]);
    await expect(page.locator('#enable-mfa-app-form')).toBeVisible();
    expectNoBrowserFailures(failures);
  });

  test('lists and revokes grants created by a real temporary RP', async ({
    page,
  }) => {
    const user = await createManagedUser('account-apps');
    const failures = observeBrowserFailures(page);
    await login(page, user);

    await authorizeTemporaryRp(page);
    await page.goto(`${IDP_ORIGIN}/accounts/apps`);
    await expectStyledAccountPage(page);
    await expect(page.getByText('Parako Browser E2E RP')).toBeVisible();

    const singleRevokeForm = page.locator(
      'form[action="/accounts/revoke-app"]'
    );
    await expect(
      singleRevokeForm.locator('input[name="client_id"]')
    ).toHaveValue('parako-browser-e2e-rp');
    await singleRevokeForm.locator('button[type="submit"]').click();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('dialog').locator('button').last().click(),
    ]);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/apps`);
    await expect(page.getByText('Parako Browser E2E RP')).toHaveCount(0);

    await authorizeTemporaryRp(page);
    await page.goto(`${IDP_ORIGIN}/accounts/apps`);
    await expect(page.getByText('Parako Browser E2E RP')).toBeVisible();

    const revokeAllForm = page.locator(
      'form[action="/accounts/revoke-all-apps"]'
    );
    await revokeAllForm.locator('button[type="submit"]').click();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('dialog').locator('button').last().click(),
    ]);
    await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/apps`);
    await expect(page.getByText('Parako Browser E2E RP')).toHaveCount(0);
    expectNoBrowserFailures(failures);
  });
});
