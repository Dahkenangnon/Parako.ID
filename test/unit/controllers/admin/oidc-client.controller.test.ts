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

// ── Helpers ──

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

// ── Platform-only scope counts ──

const platformOnlyScopeCount = SCOPE_DEFINITIONS.filter(s =>
  isPlatformOnlyScope(s.value)
).length;

const allScopeCount = SCOPE_DEFINITIONS.length;
const nonPlatformScopeCount = allScopeCount - platformOnlyScopeCount;

// ── Tests ──

describe('AdminOidcClientController — platform-only scope guard', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminOidcClientController;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    controller = createController(deps);
  });

  // ── UI filtering (getScopeDefinitions) ──

  describe('scope filtering in UI (create/edit/show)', () => {
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

  // ── Server-side stripping (store/update) ──

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

  // ── Preset handling ──

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

  // Sanity: verify platform-only scope count matches expectations
  describe('sanity checks', () => {
    it('has exactly 7 platform-only scopes', () => {
      expect(PLATFORM_ONLY_SCOPES.size).toBe(7);
      expect(platformOnlyScopeCount).toBe(7);
    });
  });
});
