/**
 * Tests for OidcManager dynamic provider dispatch.
 *
 * Verifies that OidcManager.start() uses dynamic path resolution in both modes:
 * - Single-tenant: mounts dynamic middleware that reads oidcPath per-request
 *   and lazily configures recreated providers via WeakMap
 * - Multi-tenant: mounts dynamic middleware that resolves provider per-request
 *   per tenant, with path resolved from config at request time
 * - WeakMap caching: same provider returns same callback handler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { OidcManager } from '../../../src/oidc/index.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockProvider(name = 'default') {
  const callbackHandler = vi.fn().mockResolvedValue(undefined);
  return {
    _name: name,
    use: vi.fn(),
    callback: vi.fn().mockReturnValue(callbackHandler),
    _callbackHandler: callbackHandler,
    proxy: false,
  };
}

function createMockConfigManager(multiTenantEnabled: boolean) {
  return {
    getConfig: vi.fn().mockReturnValue({
      oidc: { path: '/oidc/v1' },
      features: {
        multi_tenancy: { enabled: multiTenantEnabled },
      },
      security: {
        key_store: { overlap_window_seconds: 7200 },
      },
    }),
    subscribe: vi.fn(),
  };
}

function createMockProviderService(
  provider: ReturnType<typeof createMockProvider>
) {
  return {
    initProvider: vi.fn().mockResolvedValue(provider),
    getProviderForTenant: vi.fn().mockResolvedValue(provider),
    getProvider: vi.fn().mockReturnValue(provider),
    getOidcPath: vi.fn().mockReturnValue('/oidc/v1'),
    hasProvider: vi.fn().mockReturnValue(true),
    setProvider: vi.fn(),
    reloadJWKS: vi.fn(),
  };
}

function createMockApp() {
  return {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  };
}

/** Create a minimal mock request with path and url properties. */
function createMockReq(
  path: string,
  url?: string
): Request & { path: string; url: string; baseUrl: string } {
  return {
    path,
    url: url ?? path,
    baseUrl: '',
  } as any;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('OidcManager – Dynamic Callback Dispatch', () => {
  let mockProvider: ReturnType<typeof createMockProvider>;
  let mockKoaMiddleware: { renderMiddleware: vi.Mock };
  let mockOidcMiddleware: {
    applyOidcMiddleware: vi.Mock;
    preMiddleware: vi.Mock;
    postMiddleware: vi.Mock;
  };
  let mockOidcListener: { setupListeners: vi.Mock };
  let mockOidcRoutes: { registerRoutes: vi.Mock };
  let mockSessionManager: { setOidcAdapterBridge: vi.Mock };
  let mockAdapterBridge: Record<string, unknown>;

  beforeEach(() => {
    mockProvider = createMockProvider('default');
    mockKoaMiddleware = {
      renderMiddleware: vi.fn(),
    };
    mockOidcMiddleware = {
      applyOidcMiddleware: vi.fn(),
      preMiddleware: vi.fn(),
      postMiddleware: vi.fn(),
    };
    mockOidcListener = {
      setupListeners: vi.fn().mockResolvedValue(undefined),
    };
    mockOidcRoutes = {
      registerRoutes: vi.fn(),
    };
    mockSessionManager = {
      setOidcAdapterBridge: vi.fn(),
    };
    mockAdapterBridge = { initialize: vi.fn(async () => {}) };
  });

  function createOidcManager(
    multiTenantEnabled: boolean,
    tenantProviderRegistry?: Record<string, unknown>
  ) {
    const mockConfigManager = createMockConfigManager(multiTenantEnabled);
    const mockProviderService = createMockProviderService(mockProvider);

    return {
      manager: new (OidcManager as any)(
        /* providerService */ mockProviderService,
        /* koaMiddleware */ mockKoaMiddleware,
        /* oidcMiddleware */ mockOidcMiddleware,
        /* oidcListener */ mockOidcListener,
        /* oidRoutes */ mockOidcRoutes,
        /* sessionManager */ mockSessionManager,
        /* oidcAdapterBridge */ mockAdapterBridge,
        /* configManager */ mockConfigManager,
        /* tenantProviderRegistry */ tenantProviderRegistry ?? undefined
      ),
      mockProviderService,
      mockConfigManager,
    };
  }

  /**
   * Find the dynamic OIDC dispatcher middleware mounted via app.use(fn).
   * It's mounted as a single-argument app.use(asyncFn) — no static path prefix.
   */
  function findDynamicDispatcher(app: ReturnType<typeof createMockApp>) {
    // The forwarding middleware from OidcRoutesManager is also mounted as
    // app.use(fn), so we need the OIDC dispatcher which is the async one
    // mounted after registerRoutes. It's the last single-arg app.use call
    // before the error handler (which has 4 args).
    const singleArgCalls = app.use.mock.calls.filter(
      (call: unknown[]) => call.length === 1 && typeof call[0] === 'function'
    );
    // The last single-arg call is the OIDC dynamic dispatcher
    // (registerRoutes mounts its forwarding middleware first, then error handler,
    //  but the error handler has 4 args so it's excluded)
    return singleArgCalls[singleArgCalls.length - 1]?.[0] as
      | ((req: Request, res: Response, next: NextFunction) => Promise<void>)
      | undefined;
  }

  // ─── Single-tenant mode ──────────────────────────────────────────────

  describe('single-tenant mode (multi_tenancy.enabled = false)', () => {
    it('mounts dynamic middleware (no static path prefix)', async () => {
      const app = createMockApp();
      const { manager } = createOidcManager(false);

      await manager.start(app);

      // Should NOT mount with a static path like app.use('/oidc/v1', handler)
      const staticMounts = app.use.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === '/oidc/v1' && typeof call[1] === 'function'
      );
      expect(staticMounts.length).toBe(0);

      // Should mount a dynamic middleware as app.use(fn)
      const dispatcher = findDynamicDispatcher(app);
      expect(dispatcher).toBeDefined();
    });

    it('configures provider with Koa middleware and listeners', async () => {
      const app = createMockApp();
      const { manager } = createOidcManager(false);

      await manager.start(app);

      // renderMiddleware should be applied via configureProvider
      expect(mockProvider.use).toHaveBeenCalledWith(
        mockKoaMiddleware.renderMiddleware
      );
      // setupListeners should be called
      expect(mockOidcListener.setupListeners).toHaveBeenCalledWith(
        mockProvider
      );
    });

    it('registers interaction routes', async () => {
      const app = createMockApp();
      const { manager } = createOidcManager(false);

      await manager.start(app);

      expect(mockOidcRoutes.registerRoutes).toHaveBeenCalledWith(app);
    });

    it('dynamic middleware skips non-OIDC requests', async () => {
      const app = createMockApp();
      const { manager } = createOidcManager(false);

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq('/some/other/path');
      const res = {} as Response;
      const next = vi.fn();

      await dispatcher(req, res, next);

      // Should call next() to pass through
      expect(next).toHaveBeenCalledWith();
      // Should NOT invoke provider callback
      expect(mockProvider._callbackHandler).not.toHaveBeenCalled();
    });

    it('dynamic middleware handles OIDC requests and strips mount path', async () => {
      const app = createMockApp();
      const { manager } = createOidcManager(false);

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq(
        '/oidc/v1/.well-known/openid-configuration',
        '/oidc/v1/.well-known/openid-configuration'
      );
      const res = {} as Response;
      const next = vi.fn();

      await dispatcher(req, res, next);

      // Should invoke provider callback with stripped URL
      expect(mockProvider._callbackHandler).toHaveBeenCalled();
      // After callback, URL should be restored
      expect(req.url).toBe('/oidc/v1/.well-known/openid-configuration');
      expect(req.baseUrl).toBe('');
    });

    it('lazily configures recreated providers', async () => {
      const app = createMockApp();
      const { manager, mockProviderService } = createOidcManager(false);

      await manager.start(app);

      // Simulate provider recreation: new provider returned by getProvider
      const newProvider = createMockProvider('recreated');
      mockProviderService.getProvider.mockReturnValue(newProvider);
      mockProviderService.getOidcPath.mockReturnValue('/oidc/v2');

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq('/oidc/v2/token', '/oidc/v2/token');
      const res = {} as Response;
      const next = vi.fn();

      await dispatcher(req, res, next);

      // New provider should be configured (renderMiddleware + listeners)
      expect(newProvider.use).toHaveBeenCalledWith(
        mockKoaMiddleware.renderMiddleware
      );
      expect(mockOidcListener.setupListeners).toHaveBeenCalledWith(newProvider);
      // And its callback should be invoked
      expect(newProvider._callbackHandler).toHaveBeenCalled();
    });
  });

  // ─── Multi-tenant mode ───────────────────────────────────────────────

  describe('multi-tenant mode (multi_tenancy.enabled = true)', () => {
    it('mounts dynamic dispatcher without static path prefix', async () => {
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(mockProvider),
      };
      const { manager } = createOidcManager(true, registry);

      await manager.start(app);

      // Should NOT mount with static path prefix
      const staticMounts = app.use.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === '/oidc/v1' && typeof call[1] === 'function'
      );
      expect(staticMounts.length).toBe(0);

      // Should mount dynamic dispatcher
      const dispatcher = findDynamicDispatcher(app);
      expect(dispatcher).toBeDefined();
    });

    it('does NOT apply middleware directly to default provider', async () => {
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(mockProvider),
      };
      const { manager } = createOidcManager(true, registry);

      await manager.start(app);

      // In multi-tenant mode, middleware is NOT applied to default provider
      // (it's handled by the configurator on each tenant provider instead)
      expect(mockProvider.use).not.toHaveBeenCalledWith(
        mockKoaMiddleware.renderMiddleware
      );
      expect(mockOidcListener.setupListeners).not.toHaveBeenCalled();
    });

    it('registers provider configurator that uses ensureProviderConfigured', async () => {
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(mockProvider),
      };
      const { manager } = createOidcManager(true, registry);

      await manager.start(app);

      expect(registry.setProviderConfigurator).toHaveBeenCalledWith(
        expect.any(Function)
      );

      // Call the configurator with a tenant provider
      const tenantProvider = createMockProvider('tenant-x');
      const configurator = registry.setProviderConfigurator.mock.calls[0][0];
      await configurator(tenantProvider, 'tenant-x');

      // Should configure the tenant provider
      expect(tenantProvider.use).toHaveBeenCalledWith(
        mockKoaMiddleware.renderMiddleware
      );
      expect(mockOidcListener.setupListeners).toHaveBeenCalledWith(
        tenantProvider
      );
    });

    it('dynamic dispatcher resolves provider from tenant context', async () => {
      const tenantProvider = createMockProvider('tenant-acme');
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(tenantProvider),
      };
      const { manager, mockProviderService } = createOidcManager(
        true,
        registry
      );
      mockProviderService.getProviderForTenant.mockResolvedValue(
        tenantProvider
      );

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq(
        '/oidc/v1/.well-known/openid-configuration',
        '/oidc/v1/.well-known/openid-configuration'
      );
      const res = {} as Response;
      const next = vi.fn();

      await tenantContext.run('acme', async () => {
        await dispatcher(req, res, next);
      });

      // Should have called getProviderForTenant with 'acme'
      expect(mockProviderService.getProviderForTenant).toHaveBeenCalledWith(
        'acme'
      );
      // Should invoke the tenant provider's callback
      expect(tenantProvider.callback).toHaveBeenCalled();
      expect(tenantProvider._callbackHandler).toHaveBeenCalled();
    });

    it('caches callback in WeakMap (same provider = same handler)', async () => {
      const tenantProvider = createMockProvider('cached');
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(tenantProvider),
      };
      const { manager, mockProviderService } = createOidcManager(
        true,
        registry
      );
      mockProviderService.getProviderForTenant.mockResolvedValue(
        tenantProvider
      );

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const makeReq = () => createMockReq('/oidc/v1/auth', '/oidc/v1/auth');

      // Call twice within tenant context
      await tenantContext.run('test-tenant', () =>
        dispatcher(makeReq(), {} as Response, vi.fn())
      );
      await tenantContext.run('test-tenant', () =>
        dispatcher(makeReq(), {} as Response, vi.fn())
      );

      // provider.callback() should be called only ONCE (cached)
      expect(tenantProvider.callback).toHaveBeenCalledTimes(1);
      // But the handler should be called twice
      expect(tenantProvider._callbackHandler).toHaveBeenCalledTimes(2);
    });

    it('dispatcher calls next(error) on failure', async () => {
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(mockProvider),
      };
      const { manager, mockProviderService } = createOidcManager(
        true,
        registry
      );
      mockProviderService.getProviderForTenant.mockRejectedValue(
        new Error('Tenant not found')
      );

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq('/oidc/v1/token', '/oidc/v1/token');
      const next = vi.fn();

      await tenantContext.run('bad-tenant', () =>
        dispatcher(req, {} as Response, next)
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('returns 400 with hint when "No tenant resolved" error is thrown', async () => {
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(mockProvider),
      };
      const { manager, mockProviderService } = createOidcManager(
        true,
        registry
      );
      mockProviderService.getProviderForTenant.mockRejectedValue(
        new Error(
          '[TenantProviderRegistry] No tenant resolved — multi-tenancy is enabled. ' +
            'Use a subdomain (e.g., acme.parako.test) or set the x-tenant-id header.'
        )
      );

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq('/oidc/v1/token', '/oidc/v1/token');
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
      const next = vi.fn();

      await tenantContext.run('default', () => dispatcher(req, res, next));

      // Should return 400, NOT call next(error)
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json as any).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Tenant identification required',
          hint: expect.stringContaining('subdomain'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('dispatcher skips non-OIDC requests', async () => {
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(mockProvider),
      };
      const { manager } = createOidcManager(true, registry);

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;
      const req = createMockReq('/api/health');
      const next = vi.fn();

      await dispatcher(req, {} as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockProvider._callbackHandler).not.toHaveBeenCalled();
    });

    it('dispatcher picks up changed oidcPath from config', async () => {
      const tenantProvider = createMockProvider('path-change');
      const app = createMockApp();
      const registry = {
        setProviderConfigurator: vi.fn(),
        getProvider: vi.fn().mockResolvedValue(tenantProvider),
      };
      const { manager, mockProviderService } = createOidcManager(
        true,
        registry
      );
      mockProviderService.getProviderForTenant.mockResolvedValue(
        tenantProvider
      );

      await manager.start(app);

      const dispatcher = findDynamicDispatcher(app)!;

      // Simulate path change: getOidcPath now returns /oidc/v2
      mockProviderService.getOidcPath.mockReturnValue('/oidc/v2');

      // Request to OLD path should be skipped
      const oldReq = createMockReq('/oidc/v1/token', '/oidc/v1/token');
      const oldNext = vi.fn();
      await tenantContext.run('acme', () =>
        dispatcher(oldReq, {} as Response, oldNext)
      );
      expect(oldNext).toHaveBeenCalledWith();
      expect(tenantProvider._callbackHandler).not.toHaveBeenCalled();

      // Request to NEW path should be handled
      const newReq = createMockReq('/oidc/v2/token', '/oidc/v2/token');
      const newNext = vi.fn();
      await tenantContext.run('acme', () =>
        dispatcher(newReq, {} as Response, newNext)
      );
      expect(tenantProvider._callbackHandler).toHaveBeenCalled();
    });
  });
});
