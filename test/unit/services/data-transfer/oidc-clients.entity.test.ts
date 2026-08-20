import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IActivityService } from '../../../../src/di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { IOIDCAdapterBridge } from '../../../../src/di/interfaces/oidc-adapter-bridge.interface.js';
import type { IPasswordUtils } from '../../../../src/di/interfaces/password-utils.interface.js';
import type { IUserService } from '../../../../src/di/interfaces/user-service.interface.js';
import { DataTransferService } from '../../../../src/services/data-transfer/data-transfer.service.js';
import { createOidcClientEntityConfig } from '../../../../src/services/data-transfer/entities/oidc-clients.entity.js';
import type { EntityConfigDeps } from '../../../../src/services/data-transfer/entities/types.js';
import type { ImportContext } from '../../../../src/services/data-transfer/types.js';

describe('OIDC client data-transfer entity', () => {
  let logger: ILogger;
  let clientService: {
    createClient: ReturnType<typeof vi.fn>;
    findAllClients: ReturnType<typeof vi.fn>;
  };
  let deps: EntityConfigDeps;
  let context: ImportContext;

  beforeEach(() => {
    logger = { info: vi.fn() } as unknown as ILogger;
    clientService = {
      createClient: vi.fn(async data => data),
      findAllClients: vi.fn(async () => []),
    };
    deps = {
      logger,
      activityService: {} as IActivityService,
      userService: {} as IUserService,
      passwordUtils: {} as IPasswordUtils,
      oidcAdapterBridge: {
        client: clientService,
      } as unknown as IOIDCAdapterBridge,
    };
    context = {
      logger,
      adminUser: { username: 'admin' },
      tenantId: 'tenant-a',
    };
  });

  it('publishes the supported JSON import and export contract', () => {
    const config = createOidcClientEntityConfig(deps);

    expect(config).toMatchObject({
      entityId: 'oidc-clients',
      displayName: 'OIDC Clients',
      importConfig: {
        format: 'json',
        requiredFields: ['client_name', 'application_type'],
        maxRows: 500,
      },
      exportConfig: {
        format: 'json',
        filenamePrefix: 'oidc-clients-export',
      },
    });
    const importableFields = config.importConfig!.columns.map(
      column => column.field
    );
    expect(importableFields).toContain('redirect_uris');
    expect(importableFields).not.toContain('client_id');
    expect(importableFields).not.toContain('client_secret');
    expect(
      config.exportConfig!.columns.find(
        column => column.field === 'client_secret'
      )
    ).toMatchObject({ group: 'internal' });
  });

  it('allows only declared import fields and always mints fresh credentials', async () => {
    const config = createOidcClientEntityConfig(deps);

    const prepared = await config.importConfig!.prepareRow(
      {
        client_name: 'Demo RP',
        application_type: 'web',
        redirect_uris: ['https://rp.example.test/callback'],
        client_id: 'attacker-controlled-id',
        client_secret: 'attacker-controlled-secret',
        active: false,
        isInternalClient: true,
        created_at: '2000-01-01T00:00:00.000Z',
        injected: 'must-not-survive',
      },
      context
    );

    expect(prepared).toMatchObject({
      client_name: 'Demo RP',
      application_type: 'web',
      redirect_uris: ['https://rp.example.test/callback'],
      active: true,
      isInternalClient: false,
    });
    expect(prepared.client_id).not.toBe('attacker-controlled-id');
    expect(prepared.client_secret).not.toBe('attacker-controlled-secret');
    expect(prepared.created_at).not.toBe('2000-01-01T00:00:00.000Z');
    expect(prepared).not.toHaveProperty('injected');
  });

  it('rejects missing required client identity fields during preparation', async () => {
    const config = createOidcClientEntityConfig(deps);

    await expect(
      config.importConfig!.prepareRow(
        { client_name: '   ', application_type: null },
        context
      )
    ).rejects.toThrow(
      'Client name and application type are required for OIDC client import'
    );
  });

  it('rejects a non-string client name during preparation', async () => {
    const config = createOidcClientEntityConfig(deps);

    await expect(
      config.importConfig!.prepareRow(
        { client_name: 42, application_type: 'web' },
        context
      )
    ).rejects.toThrow(
      'Client name and application type are required for OIDC client import'
    );
  });

  it('prepares public clients without generating a client secret', async () => {
    const config = createOidcClientEntityConfig(deps);

    const prepared = await config.importConfig!.prepareRow(
      {
        client_name: '  Browser RP  ',
        application_type: 'spa',
        token_endpoint_auth_method: 'none',
        require_pkce: true,
      },
      context
    );

    expect(prepared).toMatchObject({
      client_name: 'Browser RP',
      application_type: 'web',
      preset: 'spa',
      token_endpoint_auth_method: 'none',
      require_pkce: true,
    });
    expect(prepared).not.toHaveProperty('client_secret');
  });

  it('inserts prepared clients through the adapter bridge', async () => {
    const config = createOidcClientEntityConfig(deps);
    const prepared = {
      client_id: 'generated-id',
      client_name: 'Demo RP',
      application_type: 'web',
    };

    await expect(
      config.importConfig!.insertRow(prepared, context)
    ).resolves.toBeUndefined();
    expect(clientService.createClient).toHaveBeenCalledWith(prepared);
  });

  it('rejects a client name that becomes empty after normalization', async () => {
    const config = createOidcClientEntityConfig(deps);
    const transferService = new DataTransferService(
      logger,
      deps.activityService
    );

    const result = await transferService.validateImport(
      [{ client_name: '   ', application_type: 'web' }],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.client_name).toBeDefined();
  });

  it('rejects dangerous redirect URI schemes during import validation', async () => {
    const config = createOidcClientEntityConfig(deps);
    const transferService = new DataTransferService(
      logger,
      deps.activityService
    );

    const result = await transferService.validateImport(
      [
        {
          client_name: 'Demo RP',
          application_type: 'web',
          redirect_uris: ['javascript:alert(document.domain)'],
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.redirect_uris).toContain(
      'Dangerous protocol not allowed in redirect_uri'
    );
  });

  it('rejects non-HTTP client metadata URIs during import validation', async () => {
    const config = createOidcClientEntityConfig(deps);
    const transferService = new DataTransferService(
      logger,
      deps.activityService
    );

    const result = await transferService.validateImport(
      [
        {
          client_name: 'Demo RP',
          application_type: 'web',
          client_uri: 'javascript:alert(document.domain)',
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.client_uri).toContain(
      'Client URI must use the http or https protocol'
    );
  });

  it.each([
    [
      'https://admin:secret@rp.example.test/',
      'Client URI must not include credentials',
    ],
    [
      'https://*.rp.example.test/',
      'Client URI must not include a wildcard hostname',
    ],
    ['not a URL', 'Client URI must be a valid URL'],
  ])('rejects unsafe client metadata URI %s', async (clientUri, message) => {
    const config = createOidcClientEntityConfig(deps);
    const transferService = new DataTransferService(
      logger,
      deps.activityService
    );

    const result = await transferService.validateImport(
      [
        {
          client_name: 'Demo RP',
          application_type: 'web',
          client_uri: clientUri,
        },
      ],
      config,
      context
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.fields.client_uri).toContain(message);
  });

  it('accepts a complete valid OIDC client import row', async () => {
    const config = createOidcClientEntityConfig(deps);
    const transferService = new DataTransferService(
      logger,
      deps.activityService
    );

    const result = await transferService.validateImport(
      [
        {
          client_name: 'Demo RP',
          application_type: 'spa',
          redirect_uris: ['https://rp.example.test/callback'],
          post_logout_redirect_uris: ['https://rp.example.test/'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          scope: 'openid profile',
          token_endpoint_auth_method: 'none',
          client_uri: 'https://rp.example.test/',
          description: 'Demonstration relying party',
          require_pkce: true,
          tags: ['demo'],
          contacts: ['admin@example.test'],
        },
      ],
      config,
      context
    );

    expect(result).toMatchObject({ valid: true, validCount: 1, errors: [] });
    await expect(
      config.importConfig!.checkDuplicate({}, context)
    ).resolves.toBeNull();
  });

  it('exports declared metadata while gating client secrets', async () => {
    const config = createOidcClientEntityConfig(deps);
    const storedClient = {
      client_id: 'client-1',
      client_name: 'Demo RP',
      application_type: 'web',
      active: true,
      client_secret: 'decrypted-secret',
      repository_only_field: 'must-not-leak',
    };
    clientService.findAllClients.mockResolvedValue([storedClient]);

    const publicExport = await config.exportConfig!.loadData({}, context);
    const secretExport = await config.exportConfig!.loadData(
      { includeSecrets: true },
      context
    );
    const malformedSecretExport = await config.exportConfig!.loadData(
      { includeSecrets: 'false' as unknown as boolean },
      context
    );

    expect(clientService.findAllClients).toHaveBeenCalledWith();
    expect(publicExport[0]).toMatchObject({
      client_id: 'client-1',
      client_name: 'Demo RP',
      application_type: 'web',
      active: true,
    });
    expect(publicExport[0]).not.toHaveProperty('client_secret');
    expect(publicExport[0]).not.toHaveProperty('repository_only_field');
    expect(secretExport[0]).toMatchObject({
      client_secret: 'decrypted-secret',
    });
    expect(malformedSecretExport[0]).not.toHaveProperty('client_secret');
    expect(secretExport[0]).not.toHaveProperty('repository_only_field');
  });
});
