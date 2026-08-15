import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  expectNoBrowserFailures,
  observeBrowserFailures,
} from './support/browser-failures.js';
import { requireE2ePostgresqlUrl } from './support/e2e-prerequisites.js';
import {
  startMongoMultiTenantParakoInstance,
  startMongoSingleTenantParakoInstance,
  startParakoInstance,
  startPostgresqlParakoInstance,
} from './support/parako-instance.mjs';

const IDP_PORT = 19317;
const POSTGRESQL_URL = requireE2ePostgresqlUrl();
const TENANT_ID = 'admin-user-profile';
// gitleaks:allow -- deterministic credential for isolated disposable E2E instances.
const PASSWORD = 'E2E-Admin-Profile!9';

type AdminUserConfig = Record<string, unknown>;

interface AdminUserProfileInstance {
  origin: string;
  stop(): Promise<void>;
}

interface AdminUserProfileCell {
  name: string;
  start(config: AdminUserConfig): Promise<AdminUserProfileInstance>;
}

const cells: AdminUserProfileCell[] = [
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
      return { origin: instance.origin, stop: () => instance.stop() };
    },
  },
  {
    name: 'MongoDB multi-tenant',
    start: async config => {
      const instance = await startMongoMultiTenantParakoInstance({
        port: IDP_PORT,
        config,
        tenants: [
          { slug: TENANT_ID, display_name: 'Admin user profile tenant' },
        ],
      });
      return {
        origin: new URL(instance.issuer(TENANT_ID)).origin,
        stop: () => instance.stop(),
      };
    },
  },
  {
    name: 'PostgreSQL single-tenant',
    start: async config => {
      const instance = await startPostgresqlParakoInstance({
        port: IDP_PORT,
        postgresqlUrl: POSTGRESQL_URL,
        multiTenancy: false,
        config,
      });
      return { origin: instance.origin, stop: () => instance.stop() };
    },
  },
  {
    name: 'PostgreSQL multi-tenant',
    start: async config => {
      const instance = await startPostgresqlParakoInstance({
        port: IDP_PORT,
        postgresqlUrl: POSTGRESQL_URL,
        multiTenancy: true,
        config,
        tenants: [
          { slug: TENANT_ID, display_name: 'Admin user profile tenant' },
        ],
      });
      return {
        origin: new URL(instance.issuer(TENANT_ID)).origin,
        stop: () => instance.stop(),
      };
    },
  },
];

const profileConfig: AdminUserConfig = {
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
      roles: {
        available: ['user', 'admin', 'auditor'],
        default: 'admin',
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
            required_for_registration: false,
            edit_policy: 'admin_only',
            usable_for_login: false,
          },
        ],
      },
      password_breach_detection: { enabled: false },
    },
  },
};

async function registerAdministrator(
  page: Page,
  origin: string
): Promise<void> {
  await page.goto(`${origin}/auth/register`);
  await page
    .locator('#email')
    .fill(`profile-admin-${randomUUID()}@example.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(`${origin}/accounts/`);
}

async function fillCreateUserForm(
  page: Page,
  values: { email: string; employeeId: string }
): Promise<void> {
  await page.locator('#email').fill(values.email);
  await page.locator('#given_name').fill('Configured');
  await page.locator('#family_name').fill('User');
  await page.locator('#custom_identifier_1').fill(values.employeeId);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm_password').fill(PASSWORD);
  await page.locator('#roles').selectOption('auditor');
}

for (const cell of cells) {
  test.describe(`admin user configuration profile - ${cell.name}`, () => {
    test('applies configured roles and case-insensitive custom identifiers', async ({
      page,
    }) => {
      // Each cell boots a disposable IdP and exercises two complete user-creation cycles.
      test.slow();
      const failures = observeBrowserFailures(page);
      const instance = await cell.start(profileConfig);

      try {
        await registerAdministrator(page, instance.origin);
        await page.goto(`${instance.origin}/admin/users/new`);

        await expect(page.locator('#roles option[value="auditor"]')).toHaveText(
          'Auditor'
        );
        await expect(page.getByLabel('Employee ID')).toHaveAttribute(
          'placeholder',
          'EMP-0000'
        );

        await fillCreateUserForm(page, {
          email: `invalid-employee-${randomUUID()}@example.test`,
          employeeId: 'not-valid',
        });
        await page.getByRole('button', { name: 'Create User' }).click();
        await expect(page).toHaveURL(`${instance.origin}/admin/users/new`);
        const invalidDialog = page.getByRole('dialog', { name: 'Error' });
        await expect(invalidDialog).toContainText('Invalid Employee ID format');
        await invalidDialog.getByRole('button', { name: 'OK' }).click();

        const createdEmail = `configured-user-${randomUUID()}@example.test`;
        await fillCreateUserForm(page, {
          email: createdEmail,
          employeeId: 'EMP-0042',
        });
        await page.getByRole('button', { name: 'Create User' }).click();

        await expect(page).toHaveURL(
          url =>
            /^\/admin\/users\/[^/]+$/.test(url.pathname) &&
            url.pathname !== '/admin/users/new'
        );
        await expect(page.getByText('Auditor', { exact: true })).toBeVisible();
        await expect(page.getByText('emp-0042', { exact: true })).toBeVisible();

        await page.goto(`${instance.origin}/admin/users/new`);
        await fillCreateUserForm(page, {
          email: `duplicate-employee-${randomUUID()}@example.test`,
          employeeId: 'EMP-0042',
        });
        await page.getByRole('button', { name: 'Create User' }).click();
        const duplicateDialog = page.getByRole('dialog', { name: 'Error' });
        await expect(duplicateDialog).toContainText(
          'This Employee ID is already in use by another user'
        );
        await duplicateDialog.getByRole('button', { name: 'OK' }).click();

        expectNoBrowserFailures(failures);
      } finally {
        await instance.stop();
      }
    });
  });
}
