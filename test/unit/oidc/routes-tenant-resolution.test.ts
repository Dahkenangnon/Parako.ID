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
  let mockConfigManager: {
    getConfig: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockSessionManager: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    flash: ReturnType<typeof vi.fn>;
  };
  let mockUserService: { findByUsername: ReturnType<typeof vi.fn> };
  let mockMfaUtils: { getEnabledMethods: ReturnType<typeof vi.fn> };
  let mockViewResolver: {
    views: {
      auth: {
        oidc: { mfa_select: string; mfa_no_fallback: string };
      };
    };
  };
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

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

  function findExactRoute(
    method: string,
    path: string
  ): ((...args: unknown[]) => unknown) | undefined {
    const router = (routesManager as any).interactionRouter;
    if (!router?.stack) return undefined;

    const methodKey = method.toLowerCase();
    const layer = router.stack.find(
      (candidate: any) =>
        candidate.route?.methods[methodKey] && candidate.route.path === path
    );
    const handlers = layer?.route.stack;
    return handlers?.[handlers.length - 1]?.handle;
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
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        oidc: { path: '/oidc/v1' },
        application: { title: 'Test' },
        features: { multi_tenancy: { enabled: false } },
      }),
      subscribe: vi.fn(),
    };
    mockSessionManager = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      flash: vi.fn().mockReturnValue({
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      }),
    };
    mockUserService = {
      findByUsername: vi.fn().mockResolvedValue(null),
    };
    mockMfaUtils = {
      getEnabledMethods: vi.fn().mockReturnValue([]),
    };
    mockViewResolver = {
      views: {
        auth: {
          oidc: {
            mfa_select: 'mfa_select',
            mfa_no_fallback: 'mfa_no_fallback',
          },
        },
      },
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    // Construct OidcRoutesManager with mocks — matches constructor parameter order
    routesManager = new (OidcRoutesManager as any)(
      /* configManager */ mockConfigManager,
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
      /* sessionManager */ mockSessionManager,
      /* userService */ mockUserService,
      /* mfaUtils */ mockMfaUtils,
      /* viewResolver */ mockViewResolver,
      /* logger */ mockLogger
    );

    routesManager.registerRoutes(spyApp as any);
  });

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

    it('GET /social/:provider/callback delegates without a provider', () => {
      const handler = findExactRoute(
        'GET',
        '/oidc/v1/social/:provider/callback'
      );
      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      handler!(req, res, next);

      expect(mockSocialCb.handle).toHaveBeenCalledWith(req, res, next);
      expect(mockSocialCb.handle.mock.calls[0]).toHaveLength(3);
      expect(mockProviderService.getProviderForTenant).not.toHaveBeenCalled();
    });
  });

  describe('route error forwarding', () => {
    it.each([
      ['GET', '/oidc/v1/interaction/:uid'],
      ['POST', '/oidc/v1/interaction/:uid/login'],
      ['POST', '/oidc/v1/interaction/:uid/confirm'],
      ['POST', '/oidc/v1/interaction/:uid/select_account'],
      ['POST', '/oidc/v1/interaction/:uid/mfa'],
      ['POST', '/oidc/v1/interaction/:uid/webauthn/options'],
      ['POST', '/oidc/v1/interaction/:uid/webauthn/verify'],
      ['GET', '/oidc/v1/interaction/:uid/new-device-verify'],
      ['POST', '/oidc/v1/interaction/:uid/new-device-verify'],
      ['GET', '/oidc/v1/interaction/:uid/abort'],
    ])('%s %s forwards provider resolution failures', async (method, path) => {
      const failure = new Error('provider unavailable');
      mockProviderService.getProviderForTenant.mockRejectedValueOnce(failure);
      const next = vi.fn();

      await findExactRoute(method, path)!(
        { params: { uid: 'test-uid' } } as unknown as Request,
        {} as Response,
        next
      );

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(failure);
    });
  });

  describe('MFA method selection', () => {
    function createResponse() {
      return {
        redirect: vi.fn(),
        render: vi.fn(),
      } as unknown as Response;
    }

    it('redirects to the interaction when no pending MFA user exists', async () => {
      const req = { params: { uid: 'mfa-uid' } } as unknown as Request;
      const res = createResponse();

      await findExactRoute('GET', '/oidc/v1/interaction/:uid/mfa/select')!(
        req,
        res,
        vi.fn()
      );

      expect(res.redirect).toHaveBeenCalledWith('/oidc/v1/interaction/mfa-uid');
      expect(mockUserService.findByUsername).not.toHaveBeenCalled();
    });

    it('redirects when the pending MFA user no longer exists', async () => {
      mockSessionManager.get.mockReturnValueOnce({
        username: 'removed-user',
        email: 'removed@example.test',
      });
      const req = { params: { uid: 'mfa-uid' } } as unknown as Request;
      const res = createResponse();

      await findExactRoute('GET', '/oidc/v1/interaction/:uid/mfa/select')!(
        req,
        res,
        vi.fn()
      );

      expect(mockUserService.findByUsername).toHaveBeenCalledWith(
        'removed-user'
      );
      expect(res.redirect).toHaveBeenCalledWith('/oidc/v1/interaction/mfa-uid');
    });

    it.each([
      {
        methods: ['totp', 'email'],
        clientId: 'test-client',
        client: { clientId: 'test-client', clientName: 'Test' },
        expectedMethods: { totp: true, email: true, webauthn: false },
      },
      {
        methods: ['email', 'webauthn'],
        clientId: undefined,
        client: null,
        expectedMethods: { totp: false, email: true, webauthn: true },
      },
    ])(
      'renders the selector for multiple methods (client $clientId)',
      async ({ methods, clientId, client, expectedMethods }) => {
        const user = { username: 'mfa-user' };
        mockSessionManager.get.mockImplementation(
          (_req: Request, key: string) =>
            key === 'pendingMfaUser'
              ? { username: 'mfa-user', email: 'mfa@example.test' }
              : 'csrf-value'
        );
        mockUserService.findByUsername.mockResolvedValue(user);
        mockMfaUtils.getEnabledMethods.mockReturnValue(methods);
        mockProvider.interactionDetails.mockResolvedValue({
          params: {
            client_id: clientId,
            redirect_uri: 'https://rp.example.test/callback',
            scope: 'openid',
          },
        });
        const req = { params: { uid: 'mfa-uid' } } as unknown as Request;
        const res = createResponse();

        await findExactRoute('GET', '/oidc/v1/interaction/:uid/mfa/select')!(
          req,
          res,
          vi.fn()
        );

        expect(mockProvider.interactionDetails).toHaveBeenCalledOnce();
        if (clientId) {
          expect(mockProvider.Client.find).toHaveBeenCalledWith(clientId);
        } else {
          expect(mockProvider.Client.find).not.toHaveBeenCalled();
        }
        expect(res.render).toHaveBeenCalledWith('mfa_select', {
          client,
          uid: 'mfa-uid',
          params: expect.objectContaining({ client_id: clientId }),
          title: 'Choose Verification - Test',
          enabledMethods: expectedMethods,
          selectUrl: '/oidc/v1/interaction/mfa-uid/mfa/select',
          csrfToken: 'csrf-value',
        });
      }
    );

    it('stores recovery intent and renders no fallback for fewer than two methods', async () => {
      const now = 1_800_000_000_000;
      const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
      mockSessionManager.get.mockImplementation((_req: Request, key: string) =>
        key === 'pendingMfaUser'
          ? { username: 'mfa-user', email: 'mfa@example.test' }
          : 'csrf-value'
      );
      mockUserService.findByUsername.mockResolvedValue({
        username: 'mfa-user',
      });
      mockMfaUtils.getEnabledMethods.mockReturnValue(['totp']);
      const req = { params: { uid: 'mfa-uid' } } as unknown as Request;
      const res = createResponse();

      await findExactRoute('GET', '/oidc/v1/interaction/:uid/mfa/select')!(
        req,
        res,
        vi.fn()
      );

      expect(mockSessionManager.set).toHaveBeenCalledWith(
        req,
        'oidcRecoveryIntent',
        {
          uid: 'mfa-uid',
          clientId: 'test-client',
          redirectUri: 'https://example.com',
          scope: 'openid',
          state: 'abc',
          nonce: '123',
          timestamp: now,
          expiresAt: now + 30 * 60 * 1000,
        }
      );
      expect(res.render).toHaveBeenCalledWith('mfa_no_fallback', {
        uid: 'mfa-uid',
        title: 'Cannot Complete Login - Test',
        csrfToken: 'csrf-value',
      });
      dateNow.mockRestore();
    });

    it('logs and forwards unexpected MFA selector errors', async () => {
      const failure = new Error('session read failed');
      mockSessionManager.get.mockImplementationOnce(() => {
        throw failure;
      });
      const next = vi.fn();

      await findExactRoute('GET', '/oidc/v1/interaction/:uid/mfa/select')!(
        { params: { uid: 'mfa-uid' } } as unknown as Request,
        createResponse(),
        next
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in MFA select GET handler',
        { error: failure }
      );
      expect(next).toHaveBeenCalledWith(failure);
    });

    it('stores the selected method and redirects to the interaction', () => {
      const req = {
        params: { uid: 'mfa-uid' },
        body: { method: 'webauthn' },
      } as unknown as Request;
      const res = createResponse();

      findExactRoute('POST', '/oidc/v1/interaction/:uid/mfa/select')!(req, res);

      expect(mockSessionManager.set).toHaveBeenCalledWith(
        req,
        'selectedMfaMethod',
        'webauthn'
      );
      expect(res.redirect).toHaveBeenCalledWith('/oidc/v1/interaction/mfa-uid');
    });
  });

  describe('mounted middleware and route rebuilding', () => {
    it('forwards requests through the current interaction router', () => {
      const forwardingMiddleware = spyApp.use.mock.calls[0][0] as unknown as (
        req: Request,
        res: Response,
        next: NextFunction
      ) => void;
      const activeRouter = vi.fn();
      (routesManager as any).interactionRouter = activeRouter;
      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn();

      forwardingMiddleware(req, res, next);

      expect(activeRouter).toHaveBeenCalledWith(req, res, next);
      expect(next).not.toHaveBeenCalled();
    });

    it('falls through when no interaction router is available', () => {
      const forwardingMiddleware = spyApp.use.mock.calls[0][0] as unknown as (
        req: Request,
        res: Response,
        next: NextFunction
      ) => void;
      (routesManager as any).interactionRouter = null;
      const next = vi.fn();

      forwardingMiddleware({} as Request, {} as Response, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('delegates route errors to the OIDC error handler', () => {
      const errorMiddleware = spyApp.use.mock.calls[1][0] as unknown as (
        error: Error,
        req: Request,
        res: Response,
        next: NextFunction
      ) => void;
      const error = new Error('route failure');
      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn();

      errorMiddleware(error, req, res, next);

      expect(mockError.handle).toHaveBeenCalledWith(error, req, res, next);
    });

    it('rebuilds interaction routes when configuration changes', async () => {
      expect(mockConfigManager.subscribe).toHaveBeenCalledWith(
        'OidcRoutesManager',
        expect.any(Function)
      );
      mockConfigManager.getConfig.mockReturnValue({
        oidc: { path: '/identity' },
        application: { title: 'Updated' },
        features: { multi_tenancy: { enabled: false } },
      });
      const subscriber = mockConfigManager.subscribe.mock.calls[0][1];

      await subscriber();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Rebuilding OIDC interaction routes for updated configuration'
      );
      expect(findExactRoute('GET', '/identity/interaction/:uid')).toBeDefined();
      expect(
        findExactRoute('GET', '/oidc/v1/interaction/:uid')
      ).toBeUndefined();
    });
  });

  describe('multi-tenant context', () => {
    it('rejects requests that bypass tenant context middleware', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        oidc: { path: '/oidc/v1' },
        application: { title: 'Test' },
        features: { multi_tenancy: { enabled: true } },
      });
      const handler = findExactRoute('GET', '/oidc/v1/interaction/:uid');
      const next = vi.fn();

      await handler!(
        { params: { uid: 'u1' } } as unknown as Request,
        {} as Response,
        next
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No tenant context'),
        })
      );
      expect(mockProviderService.getProviderForTenant).not.toHaveBeenCalled();
    });

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
