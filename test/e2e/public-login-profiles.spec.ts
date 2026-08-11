import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';

const IDP_PORT = 19307;
const PASSWORD = 'E2E-Login!9';
const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const TENANT_ID = 'login-matrix';

type LoginConfig = Record<string, unknown>;

interface LoginProfileInstance {
  origin: string;
  fixtureStore: {
    setAccountEnabled(email: string, enabled: boolean): Promise<boolean>;
    setLoginBlocked(email: string, blocked: boolean): Promise<boolean>;
  };
  stop(): Promise<void>;
}

interface LoginCell {
  name: string;
  start(config: LoginConfig): Promise<LoginProfileInstance>;
}

const loginCells: LoginCell[] = [
  {
    name: 'SQLite single-tenant',
    start: config => startParakoInstance({ port: IDP_PORT, config }),
  },
  {
    name: 'MongoDB single-tenant',
    start: async config => {
      const instance = await startMongoSingleTenantParakoInstance({
        port: IDP_PORT,
        config,
      });
      return {
        ...instance,
        fixtureStore: instance.fixtureStore(),
      };
    },
  },
  {
    name: 'MongoDB multi-tenant',
    start: async config => {
      const instance = await startMongoMultiTenantParakoInstance({
        port: IDP_PORT,
        config,
        tenants: [{ slug: TENANT_ID, display_name: 'Login matrix tenant' }],
      });
      return {
        ...instance,
        origin: new URL(instance.issuer(TENANT_ID)).origin,
        fixtureStore: instance.fixtureStore(TENANT_ID),
      };
    },
  },
  {
    name: 'PostgreSQL single-tenant',
    start: async config => {
      const instance = await startPostgresqlParakoInstance({
        port: IDP_PORT,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: false,
        config,
      });
      return {
        ...instance,
        origin: instance.origin,
        fixtureStore: instance.fixtureStore(),
      };
    },
  },
  {
    name: 'PostgreSQL multi-tenant',
    start: async config => {
      const instance = await startPostgresqlParakoInstance({
        port: IDP_PORT,
        postgresqlUrl: POSTGRESQL_URL!,
        multiTenancy: true,
        config,
        tenants: [{ slug: TENANT_ID, display_name: 'Login matrix tenant' }],
      });
      return {
        ...instance,
        origin: new URL(instance.issuer(TENANT_ID)).origin,
        fixtureStore: instance.fixtureStore(TENANT_ID),
      };
    },
  },
];

const contactChannels = {
  require_at_least_one: false,
  email: { enabled: true, required: false },
  phone: { enabled: true, required: false },
  full_name: { enabled: false, required: false },
};

async function register(
  page: Page,
  origin: string,
  fields: { email?: string; phone?: string; customIdentifier?: string }
) {
  await page.goto(`${origin}/auth/register`);
  if (fields.email) await page.locator('#email').fill(fields.email);
  if (fields.phone) await page.locator('#phone').fill(fields.phone);
  if (fields.customIdentifier) {
    await page.locator('#custom_identifier_1').fill(fields.customIdentifier);
  }
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(`${origin}/accounts/`);
}

async function login(page: Page, origin: string, identifier: string) {
  await page.goto(`${origin}/auth/login`);
  await page.locator('#login').fill(identifier);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#login-form button[type="submit"]').click();
}

for (const cell of loginCells) {
  test.describe(`public login configuration profiles — ${cell.name}`, () => {
    test('authenticates each configured email, phone, and custom-identifier method', async ({
      page,
    }) => {
      const instance = await cell.start({
        security: {
          authentication: {
            login: {
              login_methods: ['email', 'phone', 'custom_identifier'],
            },
            signup: {
              signup_methods: ['email', 'phone', 'custom_identifier'],
              require_email_verification: false,
              require_phone_verification: false,
              contact_channels: contactChannels,
            },
            custom_identifiers: {
              enabled: true,
              fields: [
                {
                  slot: 1,
                  key: 'member_id',
                  name: 'Member ID',
                  hint_for_user: 'LOGIN-0000',
                  validation_type: 'regex',
                  pattern: '^LOGIN-[0-9]{4}$',
                  min_length: 10,
                  max_length: 10,
                  case_sensitive: false,
                  required_for_registration: false,
                  edit_policy: 'set_once',
                  usable_for_login: true,
                },
              ],
            },
            password_breach_detection: { enabled: false },
          },
        },
      });

      try {
        const identities = [
          {
            fields: { email: `login-${randomUUID()}@example.test` },
            login: '',
          },
          {
            fields: { phone: '+22997000021' },
            login: '+22997000021',
          },
          {
            fields: { customIdentifier: 'LOGIN-0021' },
            login: 'LOGIN-0021',
          },
        ];
        identities[0].login = identities[0].fields.email!;

        for (const identity of identities) {
          await page.context().clearCookies();
          await register(page, instance.origin, identity.fields);
          await page.context().clearCookies();
          await login(page, instance.origin, identity.login);
          await expect(page).toHaveURL(`${instance.origin}/accounts/`);
        }
      } finally {
        await instance.stop();
      }
    });

    test('rejects a valid credential whose method is disabled', async ({
      page,
    }) => {
      const instance = await cell.start({
        security: {
          authentication: {
            login: { login_methods: ['email'] },
            signup: {
              signup_methods: ['phone'],
              require_phone_verification: false,
              contact_channels: {
                ...contactChannels,
                phone: { enabled: true, required: true },
              },
            },
            password_breach_detection: { enabled: false },
          },
        },
      });

      try {
        await register(page, instance.origin, { phone: '+22997000022' });
        await page.context().clearCookies();
        await login(page, instance.origin, '+22997000022');

        await expect(page).toHaveURL(`${instance.origin}/auth/login`);
        await expect(page.getByRole('dialog')).toContainText(
          'This login method is not available.'
        );
      } finally {
        await instance.stop();
      }
    });

    test('does not reveal account existence and preserves explicit account-state errors', async ({
      page,
    }) => {
      const instance = await cell.start({
        security: {
          authentication: {
            login: { login_methods: ['email'] },
            signup: {
              signup_methods: ['email'],
              require_email_verification: false,
              contact_channels: {
                ...contactChannels,
                email: { enabled: true, required: true },
              },
            },
            password_breach_detection: { enabled: false },
          },
        },
      });

      try {
        const email = `credential-boundary-${randomUUID()}@example.test`;
        await register(page, instance.origin, { email });
        await page.context().clearCookies();

        await page.goto(`${instance.origin}/auth/login`);
        await page.locator('#login').fill(email);
        await page.locator('#password').fill('Incorrect!9');
        await page.locator('#login-form button[type="submit"]').click();
        const wrongPasswordMessage = await page
          .getByRole('dialog')
          .textContent();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'OK' })
          .click();

        await page
          .locator('#login')
          .fill(`missing-${randomUUID()}@example.test`);
        await page.locator('#password').fill('Incorrect!9');
        await page.locator('#login-form button[type="submit"]').click();
        const missingAccountMessage = await page
          .getByRole('dialog')
          .textContent();
        expect(missingAccountMessage).toBe(wrongPasswordMessage);
        expect(missingAccountMessage).toContain(
          'Invalid credentials. Please try again.'
        );
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'OK' })
          .click();

        await expect(
          instance.fixtureStore.setAccountEnabled(email, false)
        ).resolves.toBe(true);
        await login(page, instance.origin, email);
        await expect(page.getByRole('dialog')).toContainText(
          'Invalid credentials. Please try again.'
        );
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'OK' })
          .click();

        await expect(
          instance.fixtureStore.setAccountEnabled(email, true)
        ).resolves.toBe(true);
        await expect(
          instance.fixtureStore.setLoginBlocked(email, true)
        ).resolves.toBe(true);
        await login(page, instance.origin, email);
        await expect(page.getByRole('dialog')).toContainText(
          'This account is blocked'
        );
      } finally {
        await instance.stop();
      }
    });

    test('rate-limits repeated requests to the login route when enabled', async ({
      page,
    }) => {
      const instance = await cell.start({
        security: {
          protection: {
            rate_limiting: {
              enabled: true,
              requests_per_minute: 4,
              window_minutes: 1,
            },
          },
        },
      });

      try {
        let limitedResponse = null;
        for (let index = 0; index < 8; index += 1) {
          const response = await page.goto(`${instance.origin}/auth/login`);
          if (response?.status() === 429) {
            limitedResponse = response;
            break;
          }
        }

        expect(limitedResponse).not.toBeNull();
        expect(await limitedResponse!.text()).toContain('Too many requests');
        expect(limitedResponse!.headers()['ratelimit-reset']).toBeDefined();
      } finally {
        await instance.stop();
      }
    });
  });
}
