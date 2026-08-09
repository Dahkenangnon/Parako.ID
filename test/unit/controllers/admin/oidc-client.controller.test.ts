import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Mock tenant context — default: non-platform tenant in multi-tenant mode
const { mockGetTenantId } = vi.hoisted(() => ({
  mockGetTenantId: vi.fn().mockReturnValue('tenant-abc'),
}));
vi.mock('../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: { getTenantId: mockGetTenantId },
}));

// Import after mocks
import { AdminOidcClientController } from '../../../../src/controllers/admin/oidc-client.controller.js';
import {
  SCOPE_DEFINITIONS,
  PLATFORM_ONLY_SCOPES,
  isPlatformOnlyScope,
} from '../../../../src/api/v1/scopes.js';

function createMockDeps() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const flashChain = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };

  const sessionManager = {
    flash: vi.fn().mockReturnValue(flashChain),
    getActiveUser: vi.fn().mockReturnValue({
      id: 'admin-123',
      username: 'admin',
      email: 'admin@test.com',
    }),
  };

  const activityService = {
    success: vi.fn(),
    failure: vi.fn(),
  };

  const mockClient = {
    client_id: 'client-1',
    client_name: 'Test Client',
    application_type: 'web',
    active: true,
  };

  const oidcAdapter = {
    client: {
      findClientById: vi.fn().mockResolvedValue(mockClient),
      createClient: vi.fn().mockResolvedValue(mockClient),
      updateClient: vi.fn().mockResolvedValue(mockClient),
      activateClient: vi.fn().mockResolvedValue(mockClient),
      deactivateClient: vi.fn().mockResolvedValue(mockClient),
      regenerateClientSecret: vi.fn().mockResolvedValue({
        client: mockClient,
        newSecret: 'new-secret',
      }),
      deleteClient: vi.fn().mockResolvedValue(true),
      searchClients: vi.fn().mockResolvedValue([]),
      findAllClients: vi.fn().mockResolvedValue([]),
      getClientStatistics: vi.fn().mockResolvedValue({ total: 0 }),
    },
  };

  const pubsub = {
    isConnected: vi.fn().mockReturnValue(false),
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      features: { multi_tenancy: { enabled: true } },
      deployment: { redis_prefix: 'parako' },
    }),
  };

  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn().mockReturnValue({}),
  };

  return {
    logger,
    sessionManager,
    activityService,
    oidcAdapter,
    pubsub,
    configManager,
    clientDeviceInfoManager,
    flashChain,
  };
}

function createController(deps: ReturnType<typeof createMockDeps>) {
  return new (AdminOidcClientController as any)(
    deps.logger,
    deps.sessionManager,
    deps.activityService,
    deps.oidcAdapter,
    deps.pubsub,
    deps.configManager,
    deps.clientDeviceInfoManager
  ) as AdminOidcClientController;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    render: vi.fn(),
    redirect: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const platformOnlyScopeCount = SCOPE_DEFINITIONS.filter(s =>
  isPlatformOnlyScope(s.value)
).length;

const allScopeCount = SCOPE_DEFINITIONS.length;
const nonPlatformScopeCount = allScopeCount - platformOnlyScopeCount;

describe('AdminOidcClientController — platform-only scope guard', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminOidcClientController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantId.mockReturnValue('tenant-abc');
    deps = createMockDeps();
    controller = createController(deps);
  });

  describe('list query contract', () => {
    it('accepts the active sort emitted by the admin table', async () => {
      const res = makeRes();

      await controller.list(
        makeReq({ query: { sortBy: 'active', sortOrder: 'asc' } }),
        res
      );

      expect((res.render as any).mock.calls[0][1].sortOptions).toEqual({
        sortBy: 'active',
        sortOrder: 'asc',
      });
    });

    it.each([
      [{ nested: true }, { nested: true }],
      [42, 84],
      [[], []],
    ])(
      'ignores non-string application and status filters %#',
      async (application_type, status) => {
        const res = makeRes();

        await expect(
          controller.list(
            makeReq({ query: { application_type, status } as any }),
            res
          )
        ).resolves.toBeUndefined();

        expect(deps.oidcAdapter.client.findAllClients).toHaveBeenCalledWith({});
        expect((res.render as any).mock.calls[0][1].filters).toEqual(
          expect.objectContaining({ applicationType: '', status: '' })
        );
      }
    );

    it('treats the validated all status as no active-state filter', async () => {
      await controller.list(makeReq({ query: { status: 'all' } }), makeRes());

      expect(deps.oidcAdapter.client.findAllClients).toHaveBeenCalledWith({});
    });

    it('filters, sorts, and paginates search results before rendering', async () => {
      deps.oidcAdapter.client.searchClients.mockResolvedValue([
        {
          client_id: 'zeta',
          client_name: 'Zeta',
          application_type: 'web',
          active: true,
        },
        {
          client_id: 'alpha',
          client_name: 'Alpha',
          application_type: 'web',
          active: true,
        },
        {
          client_id: 'inactive',
          client_name: 'Beta',
          application_type: 'web',
          active: false,
        },
        {
          client_id: 'native',
          client_name: 'Native',
          application_type: 'native',
          active: true,
        },
      ]);
      deps.oidcAdapter.client.getClientStatistics.mockResolvedValue({
        total: 4,
      });
      const res = makeRes();

      await controller.list(
        makeReq({
          query: {
            search: 'demo',
            application_type: 'web',
            status: 'active',
            sortBy: 'client_name',
            sortOrder: 'asc',
            page: '2',
            limit: '1',
          },
        }),
        res
      );

      expect(deps.oidcAdapter.client.searchClients).toHaveBeenCalledWith(
        'demo'
      );
      expect((res.render as any).mock.calls[0][1]).toEqual(
        expect.objectContaining({
          clients: [expect.objectContaining({ client_id: 'zeta' })],
          pagination: {
            currentPage: 2,
            totalPages: 2,
            totalItems: 2,
            itemsPerPage: 1,
            hasNext: false,
            hasPrev: true,
          },
          filters: {
            search: 'demo',
            applicationType: 'web',
            status: 'active',
          },
          stats: { total: 4 },
          staticClientsNote: false,
        })
      );
    });

    it('preserves adapter order when clients have equal sort values', async () => {
      deps.oidcAdapter.client.findAllClients.mockResolvedValue([
        {
          client_id: 'first',
          client_name: 'Same Name',
          application_type: 'web',
        },
        {
          client_id: 'second',
          client_name: 'Same Name',
          application_type: 'web',
        },
      ]);
      const res = makeRes();

      await controller.list(
        makeReq({ query: { sortBy: 'client_name', sortOrder: 'asc' } }),
        res
      );

      expect(
        (res.render as any).mock.calls[0][1].clients.map(
          (client: { client_id: string }) => client.client_id
        )
      ).toEqual(['first', 'second']);
    });

    it('never exposes stored client secrets to the list template', async () => {
      const storedClient = {
        client_id: 'secret-client',
        client_name: 'Secret Client',
        application_type: 'web',
        client_secret: 'must-not-enter-html',
      };
      deps.oidcAdapter.client.findAllClients.mockResolvedValue([storedClient]);
      const res = makeRes();

      await controller.list(makeReq(), res);

      const [renderedClient] = (res.render as any).mock.calls[0][1].clients;
      expect(renderedClient).not.toHaveProperty('client_secret');
      expect(storedClient).toHaveProperty(
        'client_secret',
        'must-not-enter-html'
      );
    });

    it('sorts unfiltered search results descending when a sort field is missing', async () => {
      deps.oidcAdapter.client.searchClients.mockResolvedValue([
        {
          client_id: 'missing-date-one',
          client_name: 'Missing Date One',
          application_type: 'web',
        },
        {
          client_id: 'dated',
          client_name: 'Dated',
          application_type: 'web',
          created_at: '2026-08-01T00:00:00.000Z',
        },
        {
          client_id: 'missing-date-two',
          client_name: 'Missing Date Two',
          application_type: 'web',
        },
      ]);
      const res = makeRes();

      await controller.list(
        makeReq({
          query: {
            search: 'client',
            sortBy: 'created_at',
            sortOrder: 'desc',
          },
        }),
        res
      );

      expect(
        (res.render as any).mock.calls[0][1].clients.map(
          (client: { client_id: string }) => client.client_id
        )
      ).toEqual(['dated', 'missing-date-one', 'missing-date-two']);
    });
  });

  describe('scope filtering in UI (create/edit/show)', () => {
    it('redirects with an error when the requested client does not exist', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue(null);
      const req = makeReq({ params: { id: 'missing' } });
      const res = makeRes();

      await controller.show(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'OIDC client not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
      expect(res.render).not.toHaveBeenCalled();
    });

    it('never exposes a stored client secret to the rendered detail page', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue({
        client_id: 'client-1',
        client_name: 'Secret Client',
        application_type: 'web',
        client_secret: 'must-not-enter-html',
      });
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'client-1' } }), res);

      const view = (res.render as any).mock.calls[0][1];
      expect(view.client).not.toHaveProperty('client_secret');
      expect(view.hasSecret).toBe(true);
    });

    it('returns all scopes for _platforms tenant in multi-tenant mode', async () => {
      mockGetTenantId.mockReturnValue('_platforms');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.create(makeReq(), res);

      const renderCall = (res.render as any).mock.calls[0];
      const scopeDefinitions = renderCall[1].scopeDefinitions;
      expect(scopeDefinitions).toHaveLength(allScopeCount);
    });

    it('excludes platform-only scopes for non-platform tenant in multi-tenant mode', async () => {
      mockGetTenantId.mockReturnValue('tenant-abc');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.create(makeReq(), res);

      const renderCall = (res.render as any).mock.calls[0];
      const scopeDefinitions = renderCall[1].scopeDefinitions;
      expect(scopeDefinitions).toHaveLength(nonPlatformScopeCount);

      // Verify none of the platform-only scopes are present
      const scopeValues = scopeDefinitions.map(
        (s: { value: string }) => s.value
      );
      for (const platformScope of PLATFORM_ONLY_SCOPES) {
        expect(scopeValues).not.toContain(platformScope);
      }
    });

    it('returns all scopes in single-tenant mode (multi_tenancy disabled)', async () => {
      mockGetTenantId.mockReturnValue('default');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: false } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.create(makeReq(), res);

      const renderCall = (res.render as any).mock.calls[0];
      const scopeDefinitions = renderCall[1].scopeDefinitions;
      expect(scopeDefinitions).toHaveLength(allScopeCount);
    });

    it('filters scopes in edit() for non-platform tenant', async () => {
      mockGetTenantId.mockReturnValue('tenant-abc');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.edit(makeReq({ params: { id: 'client-1' } }), res);

      const renderCall = (res.render as any).mock.calls[0];
      const scopeDefinitions = renderCall[1].scopeDefinitions;
      expect(scopeDefinitions).toHaveLength(nonPlatformScopeCount);
    });

    it('never exposes a stored client secret to the edit template', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue({
        client_id: 'client-1',
        client_name: 'Secret Client',
        application_type: 'web',
        client_secret: 'must-not-enter-html',
      });
      const res = makeRes();

      await controller.edit(makeReq({ params: { id: 'client-1' } }), res);

      const view = (res.render as any).mock.calls[0][1];
      expect(view.client).not.toHaveProperty('client_secret');
    });

    it('redirects with an error when an edited client no longer exists', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue(null);
      const res = makeRes();

      await controller.edit(makeReq({ params: { id: 'missing' } }), res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'OIDC client not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
      expect(res.render).not.toHaveBeenCalled();
    });

    it('filters scopes in show() for non-platform tenant', async () => {
      mockGetTenantId.mockReturnValue('tenant-abc');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.show(makeReq({ params: { id: 'client-1' } }), res);

      const renderCall = (res.render as any).mock.calls[0];
      const scopeDefinitions = renderCall[1].scopeDefinitions;
      expect(scopeDefinitions).toHaveLength(nonPlatformScopeCount);
    });
  });

  describe('server-side scope stripping in store()', () => {
    const formBody = {
      client_name: 'M2M Client',
      application_type: 'web',
      grant_types: 'client_credentials',
      response_types: '',
      token_endpoint_auth_method: 'client_secret_basic',
      redirect_uris: '',
      post_logout_redirect_uris: '',
      resourcesScopes:
        'parako:clients:read parako:tenants:read parako:settings:write',
      api_scopes: [],
      allowedResources: 'urn:parako:api:v1',
    };

    it('does not persist a client that fails OIDC validation', async () => {
      const res = makeRes();

      await controller.store(
        makeReq({ body: { ...formBody, client_name: '   ' } }),
        res
      );

      expect(deps.oidcAdapter.client.createClient).not.toHaveBeenCalled();
      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Validation failed: client_name is required'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients/create');
    });

    it('does not persist response types unsupported by oidc-provider', async () => {
      const res = makeRes();

      await controller.store(
        makeReq({ body: { ...formBody, response_types: 'token' } }),
        res
      );

      expect(deps.oidcAdapter.client.createClient).not.toHaveBeenCalled();
      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Validation failed: Invalid response_types: token'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients/create');
    });

    it('strips platform-only scopes from resourcesScopes for non-platform tenant', async () => {
      mockGetTenantId.mockReturnValue('tenant-abc');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.store(makeReq({ body: { ...formBody } }), res);

      const createCall = deps.oidcAdapter.client.createClient.mock.calls[0][0];
      // parako:tenants:read and parako:settings:write should be stripped
      expect(createCall.resourcesScopes).not.toContain('parako:tenants:read');
      expect(createCall.resourcesScopes).not.toContain('parako:settings:write');
      // parako:clients:read should remain
      expect(createCall.resourcesScopes).toContain('parako:clients:read');
    });

    it('omits resourcesScopes when a tenant requested only platform scopes', async () => {
      await controller.store(
        makeReq({
          body: {
            ...formBody,
            resourcesScopes: 'parako:tenants:read parako:settings:write',
          },
        }),
        makeRes()
      );

      expect(
        deps.oidcAdapter.client.createClient.mock.calls[0][0].resourcesScopes
      ).toBeUndefined();
    });

    it('preserves platform-only scopes for _platforms tenant', async () => {
      mockGetTenantId.mockReturnValue('_platforms');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.store(makeReq({ body: { ...formBody } }), res);

      const createCall = deps.oidcAdapter.client.createClient.mock.calls[0][0];
      expect(createCall.resourcesScopes).toContain('parako:tenants:read');
      expect(createCall.resourcesScopes).toContain('parako:settings:write');
      expect(createCall.resourcesScopes).toContain('parako:clients:read');
    });

    it('broadcasts cache invalidation after a client is created', async () => {
      deps.pubsub.isConnected.mockReturnValue(true);

      await controller.store(makeReq({ body: { ...formBody } }), makeRes());

      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:oidc:client:invalidated',
        expect.objectContaining({
          clientId: 'client-1',
          action: 'created',
          originId: expect.any(String),
          timestamp: expect.any(Number),
        })
      );
    });

    it('completes creation when cache invalidation publishing fails', async () => {
      deps.pubsub.isConnected.mockReturnValue(true);
      deps.pubsub.publish.mockRejectedValue(new Error('redis unavailable'));
      const res = makeRes();

      await controller.store(makeReq({ body: { ...formBody } }), res);
      await Promise.resolve();

      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/oidc-clients/view/client-1'
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Pubsub broadcast of OIDC client invalidation failed',
        expect.objectContaining({ err: 'redis unavailable' })
      );
    });

    it('uses the default cache prefix and logs non-Error publish failures', async () => {
      deps.pubsub.isConnected.mockReturnValue(true);
      deps.pubsub.publish.mockRejectedValue('connection closed');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
      });

      await controller.store(makeReq({ body: { ...formBody } }), makeRes());
      await Promise.resolve();

      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:oidc:client:invalidated',
        expect.any(Object)
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Pubsub broadcast of OIDC client invalidation failed',
        expect.objectContaining({ err: 'connection closed' })
      );
    });
  });

  describe('server-side scope stripping in update()', () => {
    const formBody = {
      client_name: 'M2M Client',
      application_type: 'web',
      grant_types: 'client_credentials',
      response_types: '',
      token_endpoint_auth_method: 'client_secret_basic',
      redirect_uris: '',
      post_logout_redirect_uris: '',
      resourcesScopes:
        'parako:users:read parako:cross-tenant:read parako:tenants:write',
      api_scopes: [],
      allowedResources: 'urn:parako:api:v1',
    };

    it('does not attempt an update when the client no longer exists', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue(null);
      const res = makeRes();

      await controller.update(
        makeReq({ params: { id: 'missing' }, body: { ...formBody } }),
        res
      );

      expect(deps.oidcAdapter.client.updateClient).not.toHaveBeenCalled();
      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'OIDC client not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
    });

    it('does not persist an update that fails OIDC validation', async () => {
      const res = makeRes();

      await controller.update(
        makeReq({
          params: { id: 'client-1' },
          body: { ...formBody, client_name: '' },
        }),
        res
      );

      expect(deps.oidcAdapter.client.updateClient).not.toHaveBeenCalled();
      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Validation failed: client_name is required'
      );
      expect(res.redirect).toHaveBeenCalledWith(
        '/admin/oidc-clients/client-1/edit'
      );
    });

    it('reports a client removed before its valid update is saved', async () => {
      deps.oidcAdapter.client.updateClient.mockResolvedValue(null);
      const res = makeRes();

      await controller.update(
        makeReq({ params: { id: 'missing' }, body: { ...formBody } }),
        res
      );

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'OIDC client not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
    });

    it('strips platform-only scopes from resourcesScopes for non-platform tenant', async () => {
      mockGetTenantId.mockReturnValue('tenant-abc');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.update(
        makeReq({ params: { id: 'client-1' }, body: { ...formBody } }),
        res
      );

      const updateCall = deps.oidcAdapter.client.updateClient.mock.calls[0][1];
      expect(updateCall.resourcesScopes).not.toContain(
        'parako:cross-tenant:read'
      );
      expect(updateCall.resourcesScopes).not.toContain('parako:tenants:write');
      expect(updateCall.resourcesScopes).toContain('parako:users:read');
    });
  });

  describe('preset handling', () => {
    const baseFormBody = {
      client_name: 'Test Client',
      application_type: 'web',
      grant_types: 'client_credentials',
      response_types: '',
      token_endpoint_auth_method: 'client_secret_basic',
      redirect_uris: '',
      post_logout_redirect_uris: '',
      api_scopes: [],
      allowedResources: '',
      resourcesScopes: '',
    };

    it('store() passes preset field through to adapter', async () => {
      mockGetTenantId.mockReturnValue('_platforms');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.store(
        makeReq({ body: { ...baseFormBody, preset: 'api_management' } }),
        res
      );

      const createCall = deps.oidcAdapter.client.createClient.mock.calls[0][0];
      expect(createCall.preset).toBe('api_management');
    });

    it('store() auto-sets allowedResources for api_management preset', async () => {
      mockGetTenantId.mockReturnValue('_platforms');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.store(
        makeReq({
          body: { ...baseFormBody, preset: 'api_management' },
        }),
        res
      );

      const createCall = deps.oidcAdapter.client.createClient.mock.calls[0][0];
      expect(createCall.allowedResources).toContain('urn:parako:api:v1');
    });

    it('update() strips preset from data (immutability)', async () => {
      mockGetTenantId.mockReturnValue('_platforms');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.update(
        makeReq({
          params: { id: 'client-1' },
          body: { ...baseFormBody, preset: 'api_management' },
        }),
        res
      );

      const updateCall = deps.oidcAdapter.client.updateClient.mock.calls[0][1];
      expect(updateCall.preset).toBeUndefined();
    });

    it('update() strips application_type from data (immutability)', async () => {
      mockGetTenantId.mockReturnValue('_platforms');
      deps.configManager.getConfig.mockReturnValue({
        features: { multi_tenancy: { enabled: true } },
        deployment: { redis_prefix: 'parako' },
      });

      const res = makeRes();
      await controller.update(
        makeReq({
          params: { id: 'client-1' },
          body: { ...baseFormBody, application_type: 'native' },
        }),
        res
      );

      const updateCall = deps.oidcAdapter.client.updateClient.mock.calls[0][1];
      expect(updateCall.application_type).toBeUndefined();
    });
  });

  describe('form input hardening', () => {
    it('normalizes a complete valid client form before persistence', async () => {
      await controller.store(
        makeReq({
          body: {
            client_name: 'Complete Client',
            description: '  Production relying party  ',
            application_type: 'web',
            preset: 'web',
            redirect_uris:
              ' https://rp.example/callback \n\nhttps://rp.example/callback-two ',
            post_logout_redirect_uris:
              ' https://rp.example/logout-callback \n ',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            scope: '  openid profile  ',
            token_endpoint_auth_method: 'client_secret_basic',
            jwks_uri: '  https://rp.example/.well-known/jwks.json  ',
            client_uri: '  https://rp.example  ',
            logo_uri: '  https://rp.example/logo.png  ',
            policy_uri: '  https://rp.example/policy  ',
            tos_uri: '  https://rp.example/terms  ',
            require_pkce: 'on',
            active: 'on',
            id_token_signed_response_alg: '  RS256  ',
            subject_type: '  public  ',
            default_max_age: '3600',
            tags: ' demo, , production ',
            contacts: ' owner@example.com, ops@example.com ',
            isInternalClient: 'on',
            allowedResources: [
              'urn:example:api',
              'urn:parako:api:v1',
              'urn:example:api',
            ],
            resourcesScopes: 'custom:read parako:clients:read',
            api_scopes: 'parako:clients:read',
          },
        }),
        makeRes()
      );

      expect(deps.oidcAdapter.client.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Production relying party',
          redirect_uris: [
            'https://rp.example/callback',
            'https://rp.example/callback-two',
          ],
          post_logout_redirect_uris: ['https://rp.example/logout-callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: 'openid profile',
          jwks_uri: 'https://rp.example/.well-known/jwks.json',
          client_uri: 'https://rp.example',
          logo_uri: 'https://rp.example/logo.png',
          policy_uri: 'https://rp.example/policy',
          tos_uri: 'https://rp.example/terms',
          require_pkce: true,
          active: true,
          id_token_signed_response_alg: 'RS256',
          subject_type: 'public',
          default_max_age: 3600,
          tags: ['demo', 'production'],
          contacts: ['owner@example.com', 'ops@example.com'],
          isInternalClient: true,
          allowedResources: ['urn:example:api', 'urn:parako:api:v1'],
          resourcesScopes: 'custom:read parako:clients:read',
        })
      );
    });

    it('persists the required public key source for private_key_jwt clients', async () => {
      await controller.store(
        makeReq({
          body: {
            client_name: 'Private Key Client',
            application_type: 'web',
            token_endpoint_auth_method: 'private_key_jwt',
            jwks_uri: 'https://rp.example/.well-known/jwks.json',
          },
        }),
        makeRes()
      );

      expect(deps.oidcAdapter.client.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          token_endpoint_auth_method: 'private_key_jwt',
          jwks_uri: 'https://rp.example/.well-known/jwks.json',
        })
      );
    });

    it('adds the Management API resource when API scopes are selected', async () => {
      await controller.store(
        makeReq({
          body: {
            client_name: 'API Client',
            application_type: 'web',
            token_endpoint_auth_method: 'client_secret_basic',
            allowedResources: 'urn:example:api',
            api_scopes: ['parako:clients:read'],
          },
        }),
        makeRes()
      );

      expect(
        deps.oidcAdapter.client.createClient.mock.calls[0][0].allowedResources
      ).toEqual(['urn:example:api', 'urn:parako:api:v1']);
    });

    it('omits blank optional fields and normalizes scalar protocol values', async () => {
      await controller.store(
        makeReq({
          body: {
            client_name: 'Sparse Client',
            description: '   ',
            application_type: 'web',
            grant_types: 'authorization_code',
            response_types: 'code',
            redirect_uris: 'https://sparse.example/callback',
            scope: '',
            token_endpoint_auth_method: 'client_secret_basic',
            client_uri: ' ',
            logo_uri: '',
            policy_uri: ' ',
            tos_uri: '',
            id_token_signed_response_alg: ' ',
            subject_type: '',
            default_max_age: 'not-a-number',
          },
        }),
        makeRes()
      );

      expect(deps.oidcAdapter.client.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          description: undefined,
          grant_types: ['authorization_code'],
          response_types: ['code'],
          redirect_uris: ['https://sparse.example/callback'],
          scope: undefined,
          client_uri: undefined,
          logo_uri: undefined,
          policy_uri: undefined,
          tos_uri: undefined,
          id_token_signed_response_alg: undefined,
          subject_type: undefined,
          default_max_age: undefined,
          require_pkce: false,
          active: false,
          isInternalClient: false,
        })
      );
    });

    it('ignores a structured redirect URI field instead of crashing create', async () => {
      const res = makeRes();

      await expect(
        controller.store(
          makeReq({
            body: {
              client_name: 'Safe Client',
              application_type: 'web',
              token_endpoint_auth_method: 'client_secret_basic',
              redirect_uris: { nested: 'https://attacker.invalid' },
            },
          }),
          res
        )
      ).resolves.toBeUndefined();

      expect(
        deps.oidcAdapter.client.createClient.mock.calls[0][0].redirect_uris
      ).toEqual([]);
    });

    it('ignores a structured post-logout URI field instead of crashing create', async () => {
      const res = makeRes();

      await expect(
        controller.store(
          makeReq({
            body: {
              client_name: 'Safe Client',
              application_type: 'web',
              token_endpoint_auth_method: 'client_secret_basic',
              post_logout_redirect_uris: { nested: 'https://attacker.invalid' },
            },
          }),
          res
        )
      ).resolves.toBeUndefined();

      expect(
        deps.oidcAdapter.client.createClient.mock.calls[0][0]
          .post_logout_redirect_uris
      ).toEqual([]);
    });

    it('ignores structured tags and contacts instead of crashing create', async () => {
      const res = makeRes();

      await expect(
        controller.store(
          makeReq({
            body: {
              client_name: 'Safe Client',
              application_type: 'web',
              token_endpoint_auth_method: 'client_secret_basic',
              tags: { nested: 'tag' },
              contacts: { nested: 'admin@example.com' },
            },
          }),
          res
        )
      ).resolves.toBeUndefined();

      expect(deps.oidcAdapter.client.createClient.mock.calls[0][0]).toEqual(
        expect.objectContaining({ tags: [], contacts: [] })
      );
    });

    it('ignores structured multi-value fields instead of persisting objects', async () => {
      await controller.store(
        makeReq({
          body: {
            client_name: 'Safe Client',
            application_type: 'web',
            token_endpoint_auth_method: 'client_secret_basic',
            grant_types: { nested: 'authorization_code' },
            response_types: { nested: 'code' },
            allowedResources: { nested: 'urn:example:api' },
            api_scopes: { nested: 'parako:clients:read' },
          },
        }),
        makeRes()
      );

      expect(deps.oidcAdapter.client.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          grant_types: [],
          response_types: [],
          allowedResources: [],
          resourcesScopes: undefined,
        })
      );
    });
  });

  describe('client state mutations', () => {
    it('does not attempt deletion when the client does not exist', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue(null);
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'missing' } }), res);

      expect(deps.oidcAdapter.client.deleteClient).not.toHaveBeenCalled();
      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'OIDC client not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
    });

    it('reports an adapter deletion failure without claiming success', async () => {
      deps.oidcAdapter.client.deleteClient.mockResolvedValue(false);
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'client-1' } }), res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Failed to delete OIDC client'
      );
      expect(deps.flashChain.success).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
    });

    it('does not attempt secret regeneration when the client no longer exists', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue(null);
      const res = makeRes();

      await controller.regenerateSecret(
        makeReq({ params: { id: 'missing' } }),
        res
      );

      expect(
        deps.oidcAdapter.client.regenerateClientSecret
      ).not.toHaveBeenCalled();
      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'OIDC client not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
    });

    it('records and reports successful deletion with a safe fallback name', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue({
        client_id: 'client-1',
        client_name: '',
        application_type: 'web',
      });
      const res = makeRes();

      await controller.destroy(makeReq({ params: { id: 'client-1' } }), res);

      expect(deps.activityService.success).toHaveBeenCalledWith(
        'oidc_client_deleted',
        'Admin deleted OIDC client',
        null,
        expect.objectContaining({
          target: {
            target_type: 'client',
            entity_id: 'client-1',
            entity_name: 'Unknown Client',
          },
        })
      );
      expect(deps.flashChain.success).toHaveBeenCalledWith(
        'OIDC client "Unknown Client" deleted successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
    });

    it.each([
      ['activate', 'activateClient'],
      ['deactivate', 'deactivateClient'],
      ['regenerateSecret', 'regenerateClientSecret'],
    ] as const)(
      '%s reports a missing client consistently',
      async (controllerMethod, adapterMethod) => {
        deps.oidcAdapter.client[adapterMethod].mockResolvedValue(null);
        const res = makeRes();

        await (controller[controllerMethod] as any)(
          makeReq({ params: { id: 'missing' } }),
          res
        );

        expect(deps.flashChain.error).toHaveBeenCalledWith(
          'OIDC client not found'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/oidc-clients');
      }
    );

    it.each([
      [
        'activate',
        'activateClient',
        'oidc_client_activated',
        'Admin activated OIDC client',
        'OIDC client "Test Client" activated successfully',
      ],
      [
        'deactivate',
        'deactivateClient',
        'oidc_client_deactivated',
        'Admin deactivated OIDC client',
        'OIDC client "Test Client" deactivated successfully',
      ],
      [
        'regenerateSecret',
        'regenerateClientSecret',
        'oidc_client_secret_regenerated',
        'Admin regenerated client secret',
        'Client secret regenerated for "Test Client"',
      ],
    ] as const)(
      '%s records and reports a successful mutation',
      async (
        controllerMethod,
        adapterMethod,
        activityType,
        description,
        flashMessage
      ) => {
        const req = makeReq({ params: { id: 'client-1' } });
        const res = makeRes();

        await (controller[controllerMethod] as any)(req, res);

        expect(deps.oidcAdapter.client[adapterMethod]).toHaveBeenCalledWith(
          'client-1'
        );
        expect(deps.activityService.success).toHaveBeenCalledWith(
          activityType,
          description,
          null,
          expect.objectContaining({
            target: {
              target_type: 'client',
              entity_id: 'client-1',
              entity_name: 'Test Client',
            },
          })
        );
        expect(deps.flashChain.success).toHaveBeenCalledWith(flashMessage);
        expect(res.redirect).toHaveBeenCalledWith(
          '/admin/oidc-clients/view/client-1'
        );
      }
    );

    it.each(['none', 'private_key_jwt'] as const)(
      'regenerateSecret rejects %s clients without changing their authentication model',
      async tokenEndpointAuthMethod => {
        deps.oidcAdapter.client.findClientById.mockResolvedValue({
          client_id: 'client-1',
          client_name: 'Public key client',
          application_type: 'web',
          token_endpoint_auth_method: tokenEndpointAuthMethod,
        });
        const res = makeRes();

        await controller.regenerateSecret(
          makeReq({ params: { id: 'client-1' } }),
          res
        );

        expect(deps.flashChain.error).toHaveBeenCalledWith(
          'Client "Public key client" does not use secret-based authentication'
        );
        expect(
          deps.oidcAdapter.client.regenerateClientSecret
        ).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
          '/admin/oidc-clients/view/client-1'
        );
      }
    );
  });

  describe('JSON endpoints', () => {
    it('returns 404 when a secret is requested for a missing client', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue(null);
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ params: { id: 'missing' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Client or secret not found',
      });
      expect(deps.activityService.success).not.toHaveBeenCalled();
    });

    it('returns 404 when a public client has no stored secret', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue({
        client_id: 'public-client',
        client_name: 'Public Client',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
      });
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ params: { id: 'public-client' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Client or secret not found',
      });
    });

    it('returns and audits an explicitly revealed client secret', async () => {
      deps.oidcAdapter.client.findClientById.mockResolvedValue({
        client_id: 'confidential-client',
        client_name: 'Confidential Client',
        application_type: 'web',
        client_secret: 'revealed-on-demand',
      });
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ params: { id: 'confidential-client' } }),
        res
      );

      expect(res.json).toHaveBeenCalledWith({
        client_secret: 'revealed-on-demand',
      });
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'oidc_client_secret_viewed',
        'Admin viewed client secret',
        null,
        expect.objectContaining({
          target: {
            target_type: 'client',
            entity_id: 'confidential-client',
            entity_name: 'Confidential Client',
          },
        })
      );
    });

    it('returns a stable JSON error when secret lookup fails', async () => {
      const failure = new Error('secret storage unavailable');
      deps.oidcAdapter.client.findClientById.mockRejectedValue(failure);
      const res = makeRes();

      await controller.revealSecret(
        makeReq({ params: { id: 'client-1' } }),
        res
      );

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'oidc_client_reveal_secret_failed',
        id: 'client-1',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to reveal client secret',
      });
    });

    it('returns client statistics as JSON', async () => {
      deps.oidcAdapter.client.getClientStatistics.mockResolvedValue({
        total: 8,
        active: 6,
        inactive: 2,
      });
      const res = makeRes();

      await controller.statistics(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        total: 8,
        active: 6,
        inactive: 2,
      });
    });

    it('returns a stable JSON error when statistics storage fails', async () => {
      const failure = new Error('statistics unavailable');
      deps.oidcAdapter.client.getClientStatistics.mockRejectedValue(failure);
      const res = makeRes();

      await controller.statistics(makeReq(), res);

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'oidc_client_statistics_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to get client statistics',
      });
    });

    it('ignores structured search input instead of passing it to storage', async () => {
      const res = makeRes();

      await controller.search(
        makeReq({ query: { q: { nested: 'value' } } as any }),
        res
      );

      expect(deps.oidcAdapter.client.searchClients).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('returns only the public client summary for search results', async () => {
      deps.oidcAdapter.client.searchClients.mockResolvedValue([
        {
          client_id: 'client-1',
          client_name: 'Search Result',
          application_type: 'web',
          active: true,
          client_secret: 'must-not-leak',
          contacts: ['owner@example.com'],
        },
      ]);
      const res = makeRes();

      await controller.search(makeReq({ query: { q: 'Search' } }), res);

      expect(res.json).toHaveBeenCalledWith([
        {
          client_id: 'client-1',
          client_name: 'Search Result',
          application_type: 'web',
          active: true,
        },
      ]);
    });

    it('returns a stable JSON error when client search fails', async () => {
      const failure = new Error('search unavailable');
      deps.oidcAdapter.client.searchClients.mockRejectedValue(failure);
      const req = makeReq({ query: { q: 'client' } });
      const res = makeRes();

      await controller.search(req, res);

      expect(deps.logger.error).toHaveBeenCalledWith(failure, {
        context: 'oidc_client_search_failed',
        query: req.query,
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Search failed' });
    });
  });

  // Sanity: verify platform-only scope count matches expectations
  describe('sanity checks', () => {
    it('has exactly 7 platform-only scopes', () => {
      expect(PLATFORM_ONLY_SCOPES.size).toBe(7);
      expect(platformOnlyScopeCount).toBe(7);
    });
  });
});
