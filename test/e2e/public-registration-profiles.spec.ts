import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { startParakoInstance } from './support/parako-instance.mjs';
import { SmtpCaptureServer } from './support/smtp-capture.mjs';

const IDP_PORT = 19207;
const SMTP_PORT = 19225;
const SMTP_USERNAME = 'parako-registration-e2e';
// gitleaks:allow -- deterministic credential for an isolated local E2E server.
const SMTP_PASSWORD = 'parako-registration-e2e-smtp-password';

function extractVerificationUrl(source: string, origin: string): string {
  const decoded = source
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replaceAll('&amp;', '&');
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = decoded.match(
    new RegExp(`${escapedOrigin}/auth/verify-email\\?token=[A-Za-z0-9_-]+`)
  );
  expect(
    match,
    'expected email-verification URL in captured mail'
  ).not.toBeNull();
  return match![0];
}

test.describe('public registration configuration profiles', () => {
  test('keeps an email registration inactive until the delivered verification link is completed', async ({
    page,
  }) => {
    const smtp = new SmtpCaptureServer({
      host: '127.0.0.1',
      port: SMTP_PORT,
      username: SMTP_USERNAME,
      password: SMTP_PASSWORD,
    });
    await smtp.start();
    let instance: Awaited<ReturnType<typeof startParakoInstance>> | undefined;

    try {
      instance = await startParakoInstance({
        port: IDP_PORT,
        config: {
          integrations: {
            email: {
              smtp_host: '127.0.0.1',
              smtp_port: SMTP_PORT,
              smtp_username: SMTP_USERNAME,
              smtp_password: SMTP_PASSWORD,
              from: 'no-reply@parako.test',
              tls_reject_unauthorized: false,
            },
          },
          security: {
            authentication: {
              signup: {
                signup_methods: ['email'],
                require_email_verification: true,
                contact_channels: {
                  require_at_least_one: true,
                  email: { enabled: true, required: true },
                  phone: { enabled: false, required: false },
                  full_name: { enabled: true, required: true },
                },
              },
              password_breach_detection: { enabled: false },
            },
          },
        },
      });
      const instanceOrigin = instance.origin;

      const email = `registration-${randomUUID()}@example.test`;
      const password = 'E2E-Register!9';
      await page.goto(`${instance.origin}/auth/register`);
      await expect(page.locator('#email')).toHaveAttribute('required', '');
      await expect(page.locator('#phone')).toHaveCount(0);
      await page.locator('#fullname').fill('Registration E2E User');
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(password);
      await page.locator('#submit-btn').click();

      await expect(page).toHaveURL(
        `${instance.origin}/auth/email-verification?status=pending`
      );
      await expect.poll(() => smtp.messages.length).toBe(1);
      expect(smtp.messages[0].rcptTo).toContain(email);
      const verificationUrl = extractVerificationUrl(
        smtp.messages[0].source,
        instance.origin
      );

      await page.goto(`${instance.origin}/accounts/`);
      await expect(page).toHaveURL(
        new RegExp(`${instance.origin}/auth/login\\?continue=`)
      );

      await page.goto(verificationUrl);
      await expect(page).toHaveURL(
        new RegExp(`${instance.origin}/auth/email-verification-success\\?`)
      );
      await expect(
        page.getByRole('heading', { name: 'Email Verified!' })
      ).toBeVisible();

      await page.goto(`${instance.origin}/auth/login`);
      await page.locator('#login').fill(email);
      await page.locator('#password').fill(password);
      await page.locator('#login-form button[type="submit"]').click();
      await expect(page).toHaveURL(
        url =>
          url.origin === instanceOrigin &&
          url.pathname === '/accounts/' &&
          url.searchParams.get('email') === email &&
          url.searchParams.get('status') === 'authenticated'
      );
    } finally {
      await instance?.stop();
      await smtp.close();
    }
  });

  test('authenticates an email registration immediately when verification is optional', async ({
    page,
  }) => {
    const instance = await startParakoInstance({
      port: IDP_PORT,
      config: {
        security: {
          authentication: {
            signup: {
              signup_methods: ['email'],
              require_email_verification: false,
              contact_channels: {
                require_at_least_one: true,
                email: { enabled: true, required: true },
                phone: { enabled: false, required: false },
                full_name: { enabled: false, required: false },
              },
            },
            password_breach_detection: { enabled: false },
          },
        },
      },
    });

    try {
      const email = `optional-verification-${randomUUID()}@example.test`;
      await page.goto(`${instance.origin}/auth/register`);
      await expect(page.locator('#fullname')).toHaveCount(0);
      await expect(page.locator('#email')).toHaveAttribute('required', '');
      await expect(page.locator('#phone')).toHaveCount(0);
      await page.locator('#email').fill(email);
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#submit-btn').click();

      await expect(page).toHaveURL(`${instance.origin}/accounts/`);
    } finally {
      await instance.stop();
    }
  });

  test('reports auto-approval partitions to valid continuations and rejects an untrusted target', async ({
    page,
  }) => {
    const instance = await startParakoInstance({
      port: IDP_PORT,
      config: {
        security: {
          authentication: {
            signup: {
              signup_methods: ['email'],
              require_email_verification: false,
              auto_approval: {
                enabled: true,
                domains_whitelist: ['approved.test', '*.trusted.test'],
              },
              contact_channels: {
                require_at_least_one: true,
                email: { enabled: true, required: true },
                phone: { enabled: false, required: false },
                full_name: { enabled: false, required: false },
              },
            },
            password_breach_detection: { enabled: false },
          },
        },
      },
    });

    try {
      for (const [domain, autoApproved] of [
        ['approved.test', 'true'],
        ['team.trusted.test', 'true'],
        ['outside.test', 'false'],
      ] as const) {
        await page.context().clearCookies();
        const email = `approval-${randomUUID()}@${domain}`;
        const continuation = `${instance.origin}/health?source=registration`;
        await page.goto(
          `${instance.origin}/auth/register?continue=${encodeURIComponent(continuation)}`
        );
        await page.locator('#email').fill(email);
        await page.locator('#password').fill('E2E-Register!9');
        await page.locator('#submit-btn').click();

        await expect(page).toHaveURL(url => {
          return (
            url.origin === instance.origin &&
            url.pathname === '/health' &&
            url.searchParams.get('source') === 'registration' &&
            url.searchParams.get('email') === email &&
            url.searchParams.get('status') === 'registered' &&
            url.searchParams.get('autoApproved') === autoApproved
          );
        });
      }

      await page.context().clearCookies();
      const rejectedEmail = `rejected-redirect-${randomUUID()}@outside.test`;
      await page.goto(
        `${instance.origin}/auth/register?continue=${encodeURIComponent('https://untrusted.example/collect')}`
      );
      await page.locator('#email').fill(rejectedEmail);
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(`${instance.origin}/accounts/`);
    } finally {
      await instance.stop();
    }
  });

  test('supports a phone-only registration without exposing an email field', async ({
    page,
  }) => {
    const instance = await startParakoInstance({
      port: IDP_PORT,
      config: {
        security: {
          authentication: {
            signup: {
              signup_methods: ['phone'],
              require_email_verification: false,
              require_phone_verification: false,
              contact_channels: {
                require_at_least_one: true,
                email: { enabled: false, required: false },
                phone: { enabled: true, required: true },
                full_name: { enabled: true, required: true },
              },
            },
            password_breach_detection: { enabled: false },
          },
        },
      },
    });

    try {
      await page.goto(`${instance.origin}/auth/register`);
      await expect(page.locator('#email')).toHaveCount(0);
      await expect(page.locator('#phone')).toHaveAttribute('required', '');
      await page.locator('#fullname').fill('Phone Registration User');
      await page.locator('#phone').fill('+22997000000');
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#submit-btn').click();

      await expect(page).toHaveURL(`${instance.origin}/accounts/`);
    } finally {
      await instance.stop();
    }
  });

  test('enforces mixed registration contact requirements', async ({ page }) => {
    const instance = await startParakoInstance({
      port: IDP_PORT,
      config: {
        security: {
          authentication: {
            signup: {
              signup_methods: ['email', 'phone'],
              require_email_verification: false,
              require_phone_verification: false,
              contact_channels: {
                require_at_least_one: true,
                email: { enabled: true, required: true },
                phone: { enabled: true, required: true },
                full_name: { enabled: true, required: false },
              },
            },
            password_breach_detection: { enabled: false },
          },
        },
      },
    });

    try {
      const email = `mixed-registration-${randomUUID()}@example.test`;
      await page.goto(`${instance.origin}/auth/register`);
      await expect(page.locator('#fullname')).not.toHaveAttribute(
        'required',
        ''
      );
      await expect(page.locator('#email')).toHaveAttribute('required', '');
      await expect(page.locator('#phone')).toHaveAttribute('required', '');
      await page.locator('#email').fill(email);
      await page.locator('#phone').fill('+22997000001');
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#submit-btn').click();

      await expect(page).toHaveURL(`${instance.origin}/accounts/`);
    } finally {
      await instance.stop();
    }
  });

  test('registers and signs in with a required custom identifier without contact fields', async ({
    page,
  }) => {
    const instance = await startParakoInstance({
      port: IDP_PORT,
      config: {
        security: {
          authentication: {
            login: {
              login_methods: ['custom_identifier'],
            },
            signup: {
              signup_methods: ['custom_identifier'],
              require_email_verification: false,
              require_phone_verification: false,
              contact_channels: {
                require_at_least_one: false,
                email: { enabled: false, required: false },
                phone: { enabled: false, required: false },
                full_name: { enabled: false, required: false },
              },
            },
            custom_identifiers: {
              enabled: true,
              fields: [
                {
                  slot: 1,
                  key: 'employee_id',
                  name: 'Employee ID',
                  hint_for_user: 'EMP-0000',
                  validation_type: 'regex',
                  pattern: '^EMP-[0-9]{4}$',
                  min_length: 8,
                  max_length: 8,
                  case_sensitive: false,
                  required_for_registration: true,
                  edit_policy: 'set_once',
                  usable_for_login: true,
                },
                {
                  slot: 2,
                  key: 'internal_id',
                  name: 'Internal ID',
                  hint_for_user: 'Internal use only',
                  validation_type: 'regex',
                  pattern: '^INT-[0-9]{4}$',
                  min_length: 8,
                  max_length: 8,
                  case_sensitive: true,
                  required_for_registration: false,
                  edit_policy: 'admin_only',
                  usable_for_login: false,
                },
              ],
            },
            password_breach_detection: { enabled: false },
          },
        },
      },
    });

    try {
      await page.goto(`${instance.origin}/auth/register`);
      await expect(page.locator('#email')).toHaveCount(0);
      await expect(page.locator('#phone')).toHaveCount(0);
      await expect(page.locator('#custom_identifier_1')).toHaveAttribute(
        'required',
        ''
      );
      await expect(page.locator('#custom_identifier_2')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Internal use only');

      // Native constraint validation and the browser manager provide the first
      // line of feedback. Submit the form directly once to prove the server
      // independently enforces the configured identifier format.
      await page.locator('#custom_identifier_1').fill('INVALID');
      await page.locator('#password').fill('E2E-Register!9');
      await page
        .locator('form')
        .evaluate((form: HTMLFormElement) => form.submit());
      const invalidDialog = page.getByRole('dialog');
      await expect(invalidDialog).toContainText('Invalid Employee ID format.');
      await invalidDialog.getByRole('button', { name: 'OK' }).click();

      await page.locator('#custom_identifier_1').fill('EMP-0042');
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(`${instance.origin}/accounts/`);

      await page.context().clearCookies();
      await page.goto(`${instance.origin}/auth/register`);
      await page.locator('#custom_identifier_1').fill('EMP-0042');
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#submit-btn').click();
      const duplicateDialog = page.getByRole('dialog');
      await expect(duplicateDialog).toContainText(
        'This Employee ID is already registered.'
      );
      await duplicateDialog.getByRole('button', { name: 'OK' }).click();

      await page.goto(`${instance.origin}/auth/login`);
      await page.locator('#login').fill('EMP-0042');
      await page.locator('#password').fill('E2E-Register!9');
      await page.locator('#login-form button[type="submit"]').click();
      await expect(page).toHaveURL(`${instance.origin}/accounts/`);
    } finally {
      await instance.stop();
    }
  });
});
