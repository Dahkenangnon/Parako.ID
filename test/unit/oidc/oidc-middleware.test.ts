import type { Express, NextFunction, Request, Response } from 'express';
import type { Provider } from 'oidc-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OIDCMiddleware } from '../../../src/oidc/flows/middleware/oidc.middleware.js';

interface OidcSessionFixture {
  accountId?: string;
  authorizations?: Record<string, unknown>;
  jti?: string;
  loginTs?: number;
  uid?: string;
}

function createHarness() {
  const sessionManager = {
    destroy: vi.fn(async () => undefined),
    isAuthenticated: vi.fn(async () => false),
    set: vi.fn(),
    setAuthenticated: vi.fn(),
  };
  const authService = {
    findUserByUsername: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const provider = {
    createContext: vi.fn(() => ({ request: {}, response: {} })),
    Session: {
      get: vi.fn<(context: unknown) => Promise<OidcSessionFixture | null>>(
        async () => null
      ),
    },
  };
  const middleware = new OIDCMiddleware(
    sessionManager as never,
    authService as never,
    logger as never
  );

  return {
    authService,
    logger,
    middleware,
    provider,
    sessionManager,
  };
}

describe('OIDCMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('safelyDestroySession', () => {
    it('awaits session destruction before invoking the callback', async () => {
      const { middleware, sessionManager } = createHarness();
      const order: string[] = [];
      sessionManager.destroy.mockImplementation(async () => {
        order.push('destroy');
      });
      const callback = vi.fn(() => {
        order.push('callback');
      });

      await middleware.safelyDestroySession({} as Request, callback);

      expect(order).toEqual(['destroy', 'callback']);
      expect(callback).toHaveBeenCalledOnce();
    });

    it('logs destruction failures and still invokes the callback', async () => {
      const { logger, middleware, sessionManager } = createHarness();
      const destroyError = new Error('session store unavailable');
      sessionManager.destroy.mockRejectedValue(destroyError);
      const callback = vi.fn();

      await middleware.safelyDestroySession({} as Request, callback);

      expect(logger.error).toHaveBeenCalledWith(destroyError, {
        context: 'Error destroying session',
      });
      expect(callback).toHaveBeenCalledOnce();
    });
  });

  describe('applyOidcMiddleware', () => {
    it.each([
      { app: null, provider: {} },
      { app: {}, provider: null },
    ])(
      'requires both an Express app and an OIDC provider',
      ({ app, provider }) => {
        const { middleware } = createHarness();

        expect(() =>
          middleware.applyOidcMiddleware(
            app as unknown as Express,
            provider as unknown as Provider
          )
        ).toThrow(
          'applyOidcMiddleware requires both app and provider parameters'
        );
      }
    );

    it('continues with initialized locals when no OIDC session exists', async () => {
      const { authService, middleware, provider, sessionManager } =
        createHarness();
      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;
      const handler = middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      );

      await handler(req, res, next);

      expect(res.locals).toEqual({});
      expect(provider.createContext).toHaveBeenCalledWith(req, res);
      expect(provider.Session.get).toHaveBeenCalledWith(
        provider.createContext.mock.results[0]?.value
      );
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(authService.findUserByUsername).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();
    });

    it('contains provider-session lookup failures and continues unauthenticated', async () => {
      const { logger, middleware, provider, sessionManager } = createHarness();
      const sessionError = new Error('provider session unavailable');
      provider.Session.get.mockRejectedValue(sessionError);
      const next = vi.fn() as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, next);

      expect(logger.error).toHaveBeenCalledWith(sessionError, {
        context: 'Error retrieving OIDC session',
      });
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('mirrors all provider-session identifiers into the application session', async () => {
      const { middleware, provider, sessionManager } = createHarness();
      sessionManager.isAuthenticated.mockResolvedValue(true);
      const oidcSession = {
        accountId: 'user-123',
        authorizations: { 'rp-client': { sid: 'sid-123' } },
        jti: 'jti-123',
        loginTs: 1_785_000_000,
        uid: 'session-uid',
      };
      provider.Session.get.mockResolvedValue(oidcSession);
      const locals = { requestId: 'request-123' };
      const response = { locals } as unknown as Response;
      const request = {} as Request;
      const next = vi.fn() as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )(request, response, next);

      expect(response.locals).toBe(locals);
      expect(sessionManager.set.mock.calls).toEqual([
        [request, 'oidcAccountId', 'user-123'],
        [request, 'oidcLoginTs', 1_785_000_000],
        [request, 'oidcUid', 'session-uid'],
        [request, 'oidcAuthorizations', oidcSession.authorizations],
        [request, 'oidcJti', 'jti-123'],
      ]);
      expect(sessionManager.setAuthenticated).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('does not mirror absent optional provider-session fields', async () => {
      const { authService, middleware, provider, sessionManager } =
        createHarness();
      provider.Session.get.mockResolvedValue({});
      const next = vi.fn() as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, next);

      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(authService.findUserByUsername).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('reconstructs an administrative Express session from the OIDC account', async () => {
      const { authService, logger, middleware, provider, sessionManager } =
        createHarness();
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_785_123_456_789);
      provider.Session.get.mockResolvedValue({ accountId: 'maria' });
      authService.findUserByUsername.mockResolvedValue({
        _id: { toString: () => 'mongo-user-id' },
        email: 'maria@example.test',
        family_name: 'Doe',
        given_name: 'Maria',
        picture: 'https://cdn.example.test/maria.png',
        roles: ['admin'],
        username: 'maria',
      });
      const request = {} as Request;
      const next = vi.fn() as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )(request, { locals: {} } as Response, next);

      expect(authService.findUserByUsername).toHaveBeenCalledWith('maria');
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(request, {
        currentActiveLoggedUser: {
          id: 'mongo-user-id',
          username: 'maria',
          email: 'maria@example.test',
          given_name: 'Maria',
          family_name: 'Doe',
          full_name: 'Maria Doe',
          roles: ['admin'],
          picture: 'https://cdn.example.test/maria.png',
          is_admin: true,
          last_used: 1_785_123_456_789,
        },
      });
      expect(logger.info).toHaveBeenCalledWith(
        'User maria (Maria Doe) authenticated via OIDC'
      );
      expect(next).toHaveBeenCalledWith();
      now.mockRestore();
    });

    it('normalizes a sparse superadmin profile using its portable id', async () => {
      const { authService, middleware, provider, sessionManager } =
        createHarness();
      provider.Session.get.mockResolvedValue({ accountId: 'root' });
      authService.findUserByUsername.mockResolvedValue({
        id: { toString: () => 'portable-user-id' },
        roles: ['superadmin'],
      });

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, vi.fn());

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({
            id: 'portable-user-id',
            username: '',
            email: '',
            given_name: '',
            family_name: '',
            full_name: '',
            roles: ['superadmin'],
            picture: '',
            is_admin: true,
          }),
        }
      );
    });

    it('uses empty identity defaults for a sparse non-admin account', async () => {
      const { authService, middleware, provider, sessionManager } =
        createHarness();
      provider.Session.get.mockResolvedValue({ accountId: 'legacy-user' });
      authService.findUserByUsername.mockResolvedValue({});

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, vi.fn());

      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(
        expect.anything(),
        {
          currentActiveLoggedUser: expect.objectContaining({
            id: '',
            roles: [],
            is_admin: false,
          }),
        }
      );
    });

    it('warns and continues when the OIDC account no longer exists', async () => {
      const { authService, logger, middleware, provider, sessionManager } =
        createHarness();
      provider.Session.get.mockResolvedValue({ accountId: 'deleted-user' });
      authService.findUserByUsername.mockResolvedValue(null);
      const next = vi.fn() as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, next);

      expect(logger.warn).toHaveBeenCalledWith(
        'User with accountId deleted-user not found'
      );
      expect(sessionManager.setAuthenticated).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('contains user lookup failures and continues processing', async () => {
      const { authService, logger, middleware, provider, sessionManager } =
        createHarness();
      const lookupError = new Error('user repository unavailable');
      provider.Session.get.mockResolvedValue({ accountId: 'maria' });
      authService.findUserByUsername.mockRejectedValue(lookupError);
      const next = vi.fn() as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, next);

      expect(logger.error).toHaveBeenCalledWith(lookupError, {
        context: 'Error retrieving user data',
      });
      expect(sessionManager.setAuthenticated).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('destroys the application session before forwarding fatal middleware errors', async () => {
      const { logger, middleware, provider, sessionManager } = createHarness();
      const authenticationError = new Error('session authentication failed');
      sessionManager.isAuthenticated.mockRejectedValue(authenticationError);
      const order: string[] = [];
      sessionManager.destroy.mockImplementation(async () => {
        order.push('destroy');
      });
      const next = vi.fn((error?: unknown) => {
        expect(error).toBe(authenticationError);
        order.push('next');
      }) as NextFunction;

      await middleware.applyOidcMiddleware(
        {} as Express,
        provider as unknown as Provider
      )({} as Request, { locals: {} } as Response, next);

      expect(logger.error).toHaveBeenCalledWith(authenticationError, {
        context: 'OIDC middleware error',
      });
      expect(sessionManager.destroy).toHaveBeenCalledOnce();
      expect(order).toEqual(['destroy', 'next']);
      expect(next).toHaveBeenCalledWith(authenticationError);
    });
  });

  describe('postMiddleware', () => {
    it('clears the application session after successful RP-initiated logout', async () => {
      const { middleware, sessionManager } = createHarness();
      const req = { session: { id: 'express-session' } } as unknown as Request;
      const ctx = {
        get: vi.fn().mockReturnValue('browser'),
        ip: '203.0.113.10',
        method: 'POST',
        oidc: { route: 'end_session_confirm' },
        path: '/session/end/confirm',
        req,
        status: 303,
      } as any;

      await middleware.postMiddleware(ctx);

      expect(sessionManager.destroy).toHaveBeenCalledOnce();
      expect(sessionManager.destroy).toHaveBeenCalledWith(req);
    });

    it.each([
      { route: 'end_session_confirm', status: 400 },
      { route: 'end_session', status: 200 },
      { route: 'authorization', status: 303 },
    ])(
      'preserves the application session for $route with status $status',
      async ({ route, status }) => {
        const { middleware, sessionManager } = createHarness();
        await middleware.postMiddleware({
          get: vi.fn().mockReturnValue('browser'),
          ip: '203.0.113.10',
          method: 'POST',
          oidc: { route },
          path: '/oidc',
          req: { session: { id: 'express-session' } },
          status,
        } as any);

        expect(sessionManager.destroy).not.toHaveBeenCalled();
      }
    );
  });

  describe.each([
    ['preMiddleware', 'oidc_pre_processing'],
    ['postMiddleware', 'oidc_post_processing'],
  ] as const)('%s', (method, eventName) => {
    it.each([
      {
        description: 'with client and session metadata',
        oidc: {
          client: { clientId: 'rp-client' },
          session: { uid: 'session-uid' },
        },
        expectedClientId: 'rp-client',
        expectedSessionId: 'session-uid',
      },
      {
        description: 'without optional OIDC metadata',
        oidc: undefined,
        expectedClientId: undefined,
        expectedSessionId: undefined,
      },
    ])('logs protocol activity $description', async testCase => {
      const { logger, middleware } = createHarness();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-07T10:00:00.000Z'));
      const get = vi.fn(() => 'openid-client/v6.8.4');
      const ctx = {
        get,
        ip: '203.0.113.10',
        method: 'POST',
        oidc: testCase.oidc,
        path: '/token',
      } as any;

      try {
        await middleware[method](ctx);
      } finally {
        vi.useRealTimers();
      }

      expect(logger.info).toHaveBeenCalledWith(eventName, {
        endpoint: '/token',
        method: 'POST',
        client_id: testCase.expectedClientId,
        session_id: testCase.expectedSessionId,
        ip_address: '203.0.113.10',
        user_agent: 'openid-client/v6.8.4',
        timestamp: '2026-08-07T10:00:00.000Z',
      });
      expect(get).toHaveBeenCalledWith('user-agent');
    });
  });
});
