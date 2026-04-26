import { z } from 'zod';
import crypto from 'node:crypto';
import type { EntityConfigDeps } from './index.js';
import type {
  EntityTransferConfig,
  EntityColumnDef,
  ImportContext,
  ExportContext,
  ExportFilters,
} from '../types.js';

export function createUserEntityConfig(
  deps: EntityConfigDeps
): EntityTransferConfig {
  const { userService, passwordUtils } = deps;

  const importColumns: EntityColumnDef[] = [
    {
      field: 'email',
      header: 'Email',
      required: true,
      group: 'core',
      validator: z.string().email().max(254),
      aliases: ['email_address', 'e-mail'],
    },
    {
      field: 'given_name',
      header: 'First Name',
      required: true,
      group: 'core',
      validator: z.string().min(1).max(100),
      aliases: ['first_name', 'firstname', 'givenname'],
    },
    {
      field: 'family_name',
      header: 'Last Name',
      required: true,
      group: 'core',
      validator: z.string().min(1).max(100),
      aliases: ['last_name', 'lastname', 'familyname', 'surname'],
    },
    {
      field: 'middle_name',
      header: 'Middle Name',
      group: 'core',
      validator: z.string().max(100).optional(),
      aliases: ['middlename'],
    },
    {
      field: 'nickname',
      header: 'Nickname',
      group: 'core',
      validator: z.string().max(100).optional(),
    },
    {
      field: 'gender',
      header: 'Gender',
      group: 'core',
      validator: z.enum(['M', 'F']).optional(),
    },
    {
      field: 'birthdate',
      header: 'Birthdate',
      group: 'core',
      validator: z.string().optional(),
    },
    {
      field: 'phone_number',
      header: 'Phone Number',
      group: 'sensitive',
      validator: z.string().max(30).optional(),
      aliases: ['phone', 'tel'],
    },
    {
      field: 'locale',
      header: 'Locale',
      group: 'core',
      validator: z.string().max(10).optional(),
    },
    {
      field: 'zoneinfo',
      header: 'Timezone',
      group: 'core',
      validator: z.string().max(50).optional(),
      aliases: ['timezone', 'tz'],
    },
    {
      field: 'country',
      header: 'Country',
      group: 'sensitive',
      validator: z.string().max(100).optional(),
    },
    {
      field: 'region',
      header: 'Region',
      group: 'sensitive',
      validator: z.string().max(100).optional(),
      aliases: ['state', 'province'],
    },
    {
      field: 'city',
      header: 'City',
      group: 'sensitive',
      validator: z.string().max(100).optional(),
    },
    {
      field: 'postal_code',
      header: 'Postal Code',
      group: 'sensitive',
      validator: z.string().max(20).optional(),
      aliases: ['zip', 'zip_code', 'postcode'],
    },
    {
      field: 'street_address',
      header: 'Street Address',
      group: 'sensitive',
      validator: z.string().max(500).optional(),
      aliases: ['address', 'street'],
    },
    {
      field: 'profile',
      header: 'Profile URL',
      group: 'sensitive',
      validator: z.string().max(2048).optional(),
    },
    {
      field: 'website',
      header: 'Website',
      group: 'sensitive',
      validator: z.string().max(2048).optional(),
    },
    {
      field: 'picture',
      header: 'Profile Picture',
      group: 'sensitive',
      validator: z.string().max(2048).optional(),
    },
  ];

  const exportColumns: EntityColumnDef[] = [
    { field: 'email', header: 'Email', group: 'core' },
    { field: 'given_name', header: 'First Name', group: 'core' },
    { field: 'family_name', header: 'Last Name', group: 'core' },
    { field: 'username', header: 'Username', group: 'core' },
    { field: 'middle_name', header: 'Middle Name', group: 'core' },
    { field: 'nickname', header: 'Nickname', group: 'core' },
    {
      field: 'custom_identifier_1',
      header: 'Custom Identifier 1',
      group: 'core',
    },
    {
      field: 'custom_identifier_2',
      header: 'Custom Identifier 2',
      group: 'core',
    },
    {
      field: 'custom_identifier_3',
      header: 'Custom Identifier 3',
      group: 'core',
    },
    { field: 'gender', header: 'Gender', group: 'core' },
    {
      field: 'birthdate',
      header: 'Birthdate',
      group: 'core',
      formatter: (v: unknown) =>
        v instanceof Date ? v.toISOString().split('T')[0] : String(v ?? ''),
    },
    {
      field: 'account_enabled',
      header: 'Account Status',
      group: 'core',
      formatter: (v: unknown) => (v ? 'Enabled' : 'Disabled'),
    },
    {
      field: 'email_verified',
      header: 'Email Verified',
      group: 'core',
      formatter: (v: unknown) => (v ? 'Yes' : 'No'),
    },
    {
      field: 'roles',
      header: 'Roles',
      group: 'core',
      formatter: (v: unknown) => (Array.isArray(v) ? v.join(';') : ''),
    },
    {
      field: 'created_at',
      header: 'Created Date',
      group: 'core',
      formatter: (v: unknown) =>
        v instanceof Date ? v.toISOString().split('T')[0] : String(v ?? ''),
    },
    {
      field: 'updated_at',
      header: 'Updated Date',
      group: 'core',
      formatter: (v: unknown) =>
        v instanceof Date ? v.toISOString().split('T')[0] : String(v ?? ''),
    },
    { field: 'phone_number', header: 'Phone Number', group: 'sensitive' },
    { field: 'profile', header: 'Profile URL', group: 'sensitive' },
    { field: 'website', header: 'Website', group: 'sensitive' },
    { field: 'picture', header: 'Profile Picture', group: 'sensitive' },
    { field: 'country', header: 'Country', group: 'sensitive' },
    { field: 'region', header: 'Region', group: 'sensitive' },
    { field: 'city', header: 'City', group: 'sensitive' },
    { field: 'postal_code', header: 'Postal Code', group: 'sensitive' },
    { field: 'street_address', header: 'Street Address', group: 'sensitive' },
    { field: 'locale', header: 'Locale', group: 'sensitive' },
    { field: 'zoneinfo', header: 'Timezone', group: 'sensitive' },
    { field: 'password', header: 'Password Hash', group: 'internal' },
    {
      field: 'password_hash_algo',
      header: 'Hash Algorithm',
      group: 'internal',
    },
    {
      field: 'password_updated_at',
      header: 'Password Updated',
      group: 'internal',
      formatter: (v: unknown) =>
        v instanceof Date ? v.toISOString().split('T')[0] : String(v ?? ''),
    },
  ];

  return {
    entityId: 'users',
    displayName: 'Users',
    description: 'Import and export user accounts (CSV format)',
    importConfig: {
      format: 'csv',
      columns: importColumns,
      requiredFields: ['email', 'given_name', 'family_name'],
      maxRows: 5000,

      async checkDuplicate(
        row: Record<string, unknown>,
        _ctx: ImportContext
      ): Promise<string | null> {
        const email = String(row.email ?? '')
          .trim()
          .toLowerCase();
        if (!email) return 'Email is required';
        const existing = await userService.findByEmail(email);
        return existing ? 'Email already exists' : null;
      },

      async prepareRow(
        row: Record<string, unknown>,
        _ctx: ImportContext
      ): Promise<Record<string, unknown>> {
        const password = crypto.randomUUID();
        const hashedPassword = await passwordUtils.hashPassword(password);

        const userData: Record<string, unknown> = {
          email: String(row.email ?? '')
            .trim()
            .toLowerCase(),
          given_name: String(row.given_name ?? '').trim(),
          family_name: String(row.family_name ?? '').trim(),
          account_enabled: true,
          email_verified: true,
          auth_provider: 'local',
          password: hashedPassword,
          password_hash_algo: 'argon2id',
          password_updated_at: new Date(),
          // custom_identifier fields left as null — no synthetic values needed
          // (partialFilterExpression on MongoDB indexes handles null safely)
        };

        const optionalStringFields = [
          'middle_name',
          'nickname',
          'phone_number',
          'profile',
          'website',
          'picture',
          'country',
          'region',
          'city',
          'postal_code',
          'street_address',
          'locale',
          'zoneinfo',
        ];
        for (const field of optionalStringFields) {
          const val = row[field];
          if (val && String(val).trim()) {
            userData[field] = String(val).trim();
          }
        }

        if (row.gender) {
          const g = String(row.gender).toUpperCase();
          if (g === 'M' || g === 'F') {
            userData.gender = g;
          }
        }

        if (row.birthdate) {
          const date = new Date(String(row.birthdate));
          if (!isNaN(date.getTime())) {
            userData.birthdate = date;
          }
        }

        return userData;
      },

      async insertRow(
        data: Record<string, unknown>,
        _ctx: ImportContext
      ): Promise<void> {
        await userService.createUserWithGeneratedUsername(data);
      },
    },
    exportConfig: {
      format: 'csv',
      columns: exportColumns,
      filenamePrefix: 'users-export',

      async loadData(
        filters: ExportFilters,
        _ctx: ExportContext
      ): Promise<Record<string, unknown>[]> {
        const MAX_EXPORT_ROWS = 10000;
        const users = await userService.findMany(
          {},
          { sort: { created_at: -1 }, limit: MAX_EXPORT_ROWS }
        );

        return users.map(user => {
          const record: Record<string, unknown> = {};
          // Always include core fields
          for (const col of exportColumns) {
            if (col.group === 'core') {
              record[col.field] = (user as unknown as Record<string, unknown>)[
                col.field
              ];
            }
          }
          if (filters.includeSensitive) {
            for (const col of exportColumns) {
              if (col.group === 'sensitive') {
                record[col.field] = (
                  user as unknown as Record<string, unknown>
                )[col.field];
              }
            }
          }
          if (filters.includeSecrets) {
            for (const col of exportColumns) {
              if (col.group === 'internal') {
                record[col.field] = (
                  user as unknown as Record<string, unknown>
                )[col.field];
              }
            }
          }
          return record;
        });
      },
    },
  };
}
