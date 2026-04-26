/**
 * Tests for Task 4.1: Dynamic Provider Resolution in OIDC Interaction Routes
 *
 * Verifies that OidcRoutesManager.registerRoutes():
 * 1. Accepts only `app` (no `provider` parameter)
 * 2. Injects ProviderService for per-request provider resolution
 * 3. Each route calls resolveProvider() via providerService.getProviderForTenant()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { OidcRoutesManager } from '../../../src/oidc/flows/route.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockProvider(name = 'default') {
  return {
    _name: name,
    interactionDetails: vi.fn().mockResolvedValue({
      uid: 'test-uid',
      prompt: { name: 'login' },
      params: {
        client_id: 'test-client',
        redirect_uri: 'https://example.com',
        scope: 'openid',
        state: 'abc',
        nonce: '123',
      },
      session: {},
    }),
    Client: {
      find: vi
        .fn()
        .mockResolvedValue({ clientId: 'test-client', clientName: 'Test' }),
    },
  };
}

function createMockHandler() {
  return {
    handle: vi.fn(),
    handleGet: vi.fn(),
    handlePost: vi.fn(),
    getOptions: vi.fn(),
    verify: vi.fn(),
  };
}

/**
 * Spy-capturing Express app: records all calls to app.get(), app.post(), app.use()
 * with the route path and the handler function, allowing us to invoke them directly.
 */
function createSpyApp() {
  const routes: Array<{
    method: string;
    path: string;
    handlers: Array<(...args: unknown[]) => unknown>;
  }> = [];

  const handler =
    (method: string) =>
    (path: string, ...fns: Array<(...args: unknown[]) => unknown>) => {
      routes.push({ method, path, handlers: fns });
    };

  return {
    get: vi.fn(handler('GET')),
    post: vi.fn(handler('POST')),
    use: vi.fn(handler('USE')),
    routes,
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('OidcRoutesManager – Dynamic Provider Resolution (Task 4.1)', () => {
  let mockProvider: ReturnType<typeof createMockProvider>;
  let mockProviderService: ReturnType<typeof createMockProviderService>;
  let routesManager: OidcRoutesManager;
  let spyApp: ReturnType<typeof createSpyApp>;

  // Handler mocks
  let mockInteraction: ReturnType<typeof createMockHandler>;
  let mockLogin: ReturnType<typeof createMockHandler>;
  let mockConsent: ReturnType<typeof createMockHandler>;
  let mockSelectAccount: ReturnType<typeof createMockHandler>;
  let mockMfa: ReturnType<typeof createMockHandler>;
  let mockWebauthnMfa: ReturnType<typeof createMockHandler>;
  let mockNewDeviceVerify: ReturnType<typeof createMockHandler>;
  let mockAbort: ReturnType<typeof createMockHandler>;
  let mockSocialLogin: ReturnType<typeof createMockHandler>;
  let mockSocialCb: ReturnType<typeof createMockHandler>;
  let mockError: ReturnType<typeof createMockHandler>;

  function createMockProviderService(
    provider: ReturnType<typeof createMockProvider>
  ) {
    return {
      getProviderForTenant: vi.fn().mockResolvedValue(provider),
      getProvider: vi.fn().mockReturnValue(provider),
      initProvider: vi.fn().mockResolvedValue(provider),
      getOidcPath: vi.fn().mockReturnValue('/oidc/v1'),
      hasProvider: vi.fn().mockReturnValue(true),
      setProvider: vi.fn(),
      reloadJWKS: vi.fn(),
    };
  }

  /**
   * Find a route handler on the internal Router by method and path suffix.
   * Routes are now on `routesManager.interactionRouter` (Express Router),
   * not on the app directly, due to the swappable Router pattern.
   */
  function findRoute(
    method: string,
    pathSuffix: string
  ): ((...args: unknown[]) => unknown) | undefined {
    const router = (routesManager as any).interactionRouter;
    if (!router || !router.stack) return undefined;

    const methodKey = method.toLowerCase();
    for (const layer of router.stack) {
      if (
        layer.route &&
        layer.route.methods[methodKey] &&
        layer.route.path.endsWith(pathSuffix)
      ) {
        // Return the last handler in the route stack (skip setNoCache middleware)
        const handlers = layer.route.stack;
        return handlers[handlers.length - 1]?.handle;
      }
    }
    return undefined;
  }

  beforeEach(() => {
    mockProvider = createMockProvider('default-provider');
    mockProviderService = createMockProviderService(mockProvider);
    mockInteraction = createMockHandler();
    mockLogin = createMockHandler();
    mockConsent = createMockHandler();
    mockSelectAccount = createMockHandler();
    mockMfa = createMockHandler();
    mockWebauthnMfa = createMockHandler();
    mockNewDeviceVerify = createMockHandler();
    mockAbort = createMockHandler();
    mockSocialLogin = createMockHandler();
    mockSocialCb = createMockHandler();
    mockError = createMockHandler();
    spyApp = createSpyApp();

    // Construct OidcRoutesManager with mocks — matches constructor parameter order
    routesManager = new (OidcRoutesManager as any)(
      /* configManager */ {
        getConfig: () => ({
          oidc: { path: '/oidc/v1' },
          application: { title: 'Test' },
          features: { multi_tenancy: { enabled: false } },
        }),
        subscribe: vi.fn(),
      },
      /* providerService */ mockProviderService,
      /* error */ mockError,
      /* abort */ mockAbort,
      /* socialCb */ mockSocialCb,
      /* socialLogin */ mockSocialLogin,
      /* mfa */ mockMfa,
      /* newDeviceVerify */ mockNewDeviceVerify,
      /* selectAccount */ mockSelectAccount,
      /* consent */ mockConsent,
      /* login */ mockLogin,
      /* interaction */ mockInteraction,
      /* webauthnMfa */ mockWebauthnMfa,
      /* sessionManager */ {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
        flash: vi.fn().mockReturnValue({
          success: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
        }),
      },
      /* userService */ {
        findByUsername: vi.fn().mockResolvedValue(null),
      },
      /* mfaUtils */ {
        getEnabledMethods: vi.fn().mockReturnValue([]),
      },
      /* viewResolver */ {
        views: {
          auth: {
            oidc: {
              mfa_select: 'mfa_select',
              mfa_no_fallback: 'mfa_no_fallback',
            },
          },
        },
      },
      /* logger */ {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }
    );

    routesManager.registerRoutes(spyApp as any);
  });

  // ─── Signature ───────────────────────────────────────────────────────

  describe('registerRoutes() signature', () => {
    it('accepts only app parameter (no provider)', () => {
      // Routes are now on the internal Router, not the app.
      // If the method still required a provider, calling it with just spyApp
      // in beforeEach would have failed.
      const router = (routesManager as any).interactionRouter;
      expect(router).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);
    });

    it('has function length of 1 (only app parameter)', () => {
      expect(routesManager.registerRoutes.length).toBe(1);
    });
  });

  // ─── Route Registration ──────────────────────────────────────────────

  describe('routes are registered', () => {
    it('registers all expected routes on the internal Router', () => {
      const router = (routesManager as any).interactionRouter;
      const registeredPaths = router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => {
          const methods = Object.keys(layer.route.methods)
            .filter((m: string) => layer.route.methods[m])
            .map((m: string) => m.toUpperCase());
          return `${methods[0]} ${layer.route.path}`;
        });

      const expectedRoutes = [
        'GET /oidc/v1/interaction/:uid',
        'POST /oidc/v1/interaction/:uid/login',
        'POST /oidc/v1/interaction/:uid/confirm',
        'POST /oidc/v1/interaction/:uid/select_account',
        'POST /oidc/v1/interaction/:uid/mfa',
        'POST /oidc/v1/interaction/:uid/webauthn/options',
        'POST /oidc/v1/interaction/:uid/webauthn/verify',
        'GET /oidc/v1/interaction/:uid/mfa/select',
        'POST /oidc/v1/interaction/:uid/mfa/select',
        'GET /oidc/v1/interaction/:uid/new-device-verify',
        'POST /oidc/v1/interaction/:uid/new-device-verify',
        'GET /oidc/v1/social/:provider',
        'GET /oidc/v1/social/:provider/callback',
        'GET /oidc/v1/interaction/:uid/abort',
      ];

      for (const route of expectedRoutes) {
        expect(registeredPaths).toContain(route);
      }
    });

    it('mounts forwarding middleware and error handler on the app', () => {
      // app.use should be called for forwarding middleware + error handler
      expect(spyApp.use).toHaveBeenCalled();
      const useCalls = spyApp.use.mock.calls;
      // At least 2 calls: forwarding middleware + error handler
      expect(useCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Per-Request Provider Resolution ─────────────────────────────────

  describe('per-request provider resolution', () => {
    const mockReq = { params: { uid: 'test-uid' } } as unknown as Request;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
      render: vi.fn(),
    } as unknown as Response;
    const mockNext = vi.fn() as NextFunction;

    it('GET /interaction/:uid resolves provider per-request', async () => {
      const handler = findRoute('GET', '/interaction/:uid');
      expect(handler).toBeDefined();

      await handler!(mockReq, mockRes, mockNext);

      expect(mockProviderService.getProviderForTenant).toHaveBeenCalledWith(
        DEFAULT_TENANT_ID
      );
      expect(mockInteraction.handle).toHaveBeenCalledWith(
        mockReq,
        mockRes,
        mockNext,
        mockProvider
      );
    });

    it('POST /interaction/:uid/login resolves provider per-request', async () => {
      const handler = findRoute('POST', '/interaction/:uid/login');
      await handler!(mockReq, mockRes, mockNext);

      expect(mockProviderService.getProviderForTenant).toHaveBeenCalled();
      expect(mockLogin.handle.mock.calls[0][3]).toBe(mockProvider);
    });

    it('POST /interaction/:uid/confirm resolves provider', async () => {
      const handler = findRoute('POST', '/interaction/:uid/confirm');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockConsent.handle.mock.calls[0][3]).toBe(mockProvider);
    });

    it('POST /interaction/:uid/select_account resolves provider', async () => {
      const handler = findRoute('POST', '/interaction/:uid/select_account');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockSelectAccount.handle.mock.calls[0][3]).toBe(mockProvider);
    });

    it('POST /interaction/:uid/mfa resolves provider', async () => {
      // Need exact match — not /mfa/select
      const router = (routesManager as any).interactionRouter;
      const entry = router.stack.find(
        (layer: any) =>
          layer.route &&
          layer.route.methods.post &&
          layer.route.path === '/oidc/v1/interaction/:uid/mfa'
      );
      const handlers = entry!.route.stack;
      await handlers[handlers.length - 1].handle(mockReq, mockRes, mockNext);
      expect(mockMfa.handle.mock.calls[0][3]).toBe(mockProvider);
    });

    it('POST /webauthn/options resolves provider', async () => {
      const handler = findRoute('POST', '/webauthn/options');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockWebauthnMfa.getOptions.mock.calls[0][3]).toBe(mockProvider);
    });

    it('POST /webauthn/verify resolves provider', async () => {
      const handler = findRoute('POST', '/webauthn/verify');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockWebauthnMfa.verify.mock.calls[0][3]).toBe(mockProvider);
    });

    it('GET /new-device-verify resolves provider', async () => {
      const handler = findRoute('GET', '/new-device-verify');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockNewDeviceVerify.handleGet.mock.calls[0][3]).toBe(mockProvider);
    });

    it('POST /new-device-verify resolves provider', async () => {
      const handler = findRoute('POST', '/new-device-verify');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockNewDeviceVerify.handlePost.mock.calls[0][3]).toBe(
        mockProvider
      );
    });

    it('GET /abort resolves provider', async () => {
      const handler = findRoute('GET', '/abort');
      await handler!(mockReq, mockRes, mockNext);
      expect(mockAbort.handle.mock.calls[0][3]).toBe(mockProvider);
    });
  });

  // ─── Social routes (no provider) ────────────────────────────────────

  describe('social routes do NOT use provider', () => {
    it('GET /social/:provider does not call getProviderForTenant', async () => {
      mockProviderService.getProviderForTenant.mockClear();

      // Find the social route on the internal Router
      const router = (routesManager as any).interactionRouter;
      const entry = router.stack.find(
        (layer: any) =>
          layer.route &&
          layer.route.methods.get &&
          layer.route.path === '/oidc/v1/social/:provider'
      );
      const handlers = entry!.route.stack;
      const socialHandler = handlers[handlers.length - 1].handle;

      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;
      socialHandler(req, res, next);

      expect(mockSocialLogin.handle).toHaveBeenCalledWith(req, res, next);
      // No 4th arg (no provider)
      expect(mockSocialLogin.handle.mock.calls[0].length).toBe(3);
    });
  });

  // ─── Multi-tenant context ───────────────────────────────────────────

  describe('multi-tenant context', () => {
    it('reads tenant from AsyncLocalStorage', async () => {
      const handler = findRoute('POST', '/interaction/:uid/login');

      const mockReq = { params: { uid: 'u1' } } as unknown as Request;
      const mockRes = {} as Response;
      const mockNext = vi.fn() as NextFunction;

      await tenantContext.run('acme', async () => {
        await handler!(mockReq, mockRes, mockNext);
      });

      expect(mockProviderService.getProviderForTenant).toHaveBeenCalledWith(
        'acme'
      );
    });

    it('different tenants get different providers', async () => {
      const providerA = createMockProvider('tenant-a');
      const providerB = createMockProvider('tenant-b');
      mockProviderService.getProviderForTenant.mockImplementation(
        async (tid: string) => (tid === 'tenant-a' ? providerA : providerB)
      );

      const handler = findRoute('GET', '/interaction/:uid');
      const req = { params: { uid: 'u1' } } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      await tenantContext.run('tenant-a', async () => {
        await handler!(req, res, next);
      });
      expect(mockInteraction.handle.mock.calls[0][3]).toBe(providerA);

      await tenantContext.run('tenant-b', async () => {
        await handler!(req, res, next);
      });
      expect(mockInteraction.handle.mock.calls[1][3]).toBe(providerB);
    });
  });
});
