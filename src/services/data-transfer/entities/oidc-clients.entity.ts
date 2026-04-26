import type { EntityConfigDeps } from './index.js';
import type {
  EntityTransferConfig,
  EntityColumnDef,
  ImportContext,
  ExportContext,
  ExportFilters,
} from '../types.js';
import { z } from 'zod';
import { applyClientDefaults } from '../../../oidc/adapter/client-crud-utils.js';
import type { OidcClientData } from '../../../oidc/adapter/client.interface.js';

export function createOidcClientEntityConfig(
  deps: EntityConfigDeps
): EntityTransferConfig {
  const { oidcAdapterBridge } = deps;

  const columns: EntityColumnDef[] = [
    {
      field: 'client_name',
      header: 'Client Name',
      required: true,
      group: 'core',
      validator: z.string().min(1).max(255),
    },
    {
      field: 'application_type',
      header: 'Application Type',
      required: true,
      group: 'core',
      validator: z.enum(['web', 'native', 'spa']),
    },
    {
      field: 'redirect_uris',
      header: 'Redirect URIs',
      group: 'core',
      validator: z.array(z.string().url()).optional(),
    },
    {
      field: 'post_logout_redirect_uris',
      header: 'Post Logout Redirect URIs',
      group: 'core',
      validator: z.array(z.string().url()).optional(),
    },
    {
      field: 'grant_types',
      header: 'Grant Types',
      group: 'core',
      validator: z.array(z.string()).optional(),
    },
    {
      field: 'response_types',
      header: 'Response Types',
      group: 'core',
      validator: z.array(z.string()).optional(),
    },
    {
      field: 'scope',
      header: 'Scope',
      group: 'core',
      validator: z.string().optional(),
    },
    {
      field: 'token_endpoint_auth_method',
      header: 'Auth Method',
      group: 'core',
      validator: z
        .enum([
          'none',
          'client_secret_basic',
          'client_secret_post',
          'client_secret_jwt',
          'private_key_jwt',
        ])
        .optional(),
    },
    {
      field: 'client_uri',
      header: 'Client URI',
      group: 'core',
      validator: z.string().url().optional(),
    },
    {
      field: 'description',
      header: 'Description',
      group: 'core',
      validator: z.string().max(1000).optional(),
    },
    {
      field: 'require_pkce',
      header: 'Require PKCE',
      group: 'core',
      validator: z.boolean().optional(),
    },
    {
      field: 'tags',
      header: 'Tags',
      group: 'core',
      validator: z.array(z.string()).optional(),
    },
    {
      field: 'contacts',
      header: 'Contacts',
      group: 'core',
      validator: z.array(z.string()).optional(),
    },
    // Export-only fields
    { field: 'client_id', header: 'Client ID', group: 'core' },
    { field: 'active', header: 'Active', group: 'core' },
    { field: 'logo_uri', header: 'Logo URI', group: 'core' },
    { field: 'policy_uri', header: 'Policy URI', group: 'core' },
    { field: 'tos_uri', header: 'Terms of Service URI', group: 'core' },
    {
      field: 'id_token_signed_response_alg',
      header: 'ID Token Signing Alg',
      group: 'core',
    },
    { field: 'subject_type', header: 'Subject Type', group: 'core' },
    { field: 'default_max_age', header: 'Default Max Age', group: 'core' },
    { field: 'isInternalClient', header: 'Internal Client', group: 'core' },
    { field: 'created_at', header: 'Created At', group: 'core' },
    { field: 'updated_at', header: 'Updated At', group: 'core' },
    // Internal (secrets)
    { field: 'client_secret', header: 'Client Secret', group: 'internal' },
  ];

  return {
    entityId: 'oidc-clients',
    displayName: 'OIDC Clients',
    description:
      'Import and export OIDC/OAuth2 client registrations (JSON format)',
    importConfig: {
      format: 'json',
      columns: columns.filter(c => c.validator), // Only columns with validators are importable
      requiredFields: ['client_name', 'application_type'],
      maxRows: 500,

      async checkDuplicate(
        _row: Record<string, unknown>,
        _ctx: ImportContext
      ): Promise<string | null> {
        // Each import creates a new client with generated client_id — no duplicates
        return null;
      },

      async prepareRow(
        row: Record<string, unknown>,
        _ctx: ImportContext
      ): Promise<Record<string, unknown>> {
        // Strip any client_id/client_secret from import — always generate new
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { client_id: _id, client_secret: _secret, ...rest } = row;
        return applyClientDefaults(
          rest as unknown as Partial<OidcClientData>
        ) as unknown as Record<string, unknown>;
      },

      async insertRow(
        data: Record<string, unknown>,
        _ctx: ImportContext
      ): Promise<void> {
        await oidcAdapterBridge.client.createClient(
          data as unknown as Partial<OidcClientData>
        );
      },
    },
    exportConfig: {
      format: 'json',
      columns,
      filenamePrefix: 'oidc-clients-export',

      async loadData(
        filters: ExportFilters,
        _ctx: ExportContext
      ): Promise<Record<string, unknown>[]> {
        const clients = await oidcAdapterBridge.client.findAllClients();
        return clients.map(client => {
          const record: Record<string, unknown> = {};
          for (const col of columns) {
            if (col.group === 'core') {
              record[col.field] = (
                client as unknown as Record<string, unknown>
              )[col.field];
            }
          }
          if (filters.includeSecrets) {
            record.client_secret = client.client_secret;
          }
          return record;
        });
      },
    },
  };
}
