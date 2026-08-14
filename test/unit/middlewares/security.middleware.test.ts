import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { SecurityMiddleware } from '../../../src/middlewares/security.middleware.js';
import {
  DEFAULT_TENANT_ID,
  tenantContext,
} from '../../../src/multi-tenancy/tenant-context.js';

describe('SecurityMiddleware', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let sessionManager: Record<string, ReturnType<typeof vi.fn>>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let configManager: Record<string, ReturnType<typeof vi.fn>>;
  let middleware: SecurityMiddleware;
  let req: Request;
  let res: Response;
  let next: NextFunction;
  let flashError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = getDefaultFullConfig();
    flashError = vi.fn();
    sessionManager = {
      isAuthenticated: vi.fn().mockResolvedValue(true),
      hasRole: vi.fn().mockReturnValue(true),
      isAdmin: vi.fn().mockReturnValue(true),
      getUserProperty: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      regenerate: vi.fn().mockResolvedValue(undefined),
      generateCsrfToken: vi.fn(),
      csrfProtection: vi.fn(),
      flash: vi.fn(() => ({ error: flashError })),
    };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    configManager = { getConfig: vi.fn(() => config) };
    middleware = new SecurityMiddleware(
      sessionManager as any,
      logger as any,
      configManager as any,
      { views: { errors: { forbidden: 'errors/forbidden' } } } as any
    );
    req = {
      originalUrl: '/admin/settings?tab=oidc',
      path: '/admin/settings',
      ip: '203.0.113.4',
      headers: { 'user-agent': 'Security middleware test' },
      session: { id: 'session-123' },
    } as any;
    res = {
      locals: {},
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis(),
      render: vi.fn().mockReturnThis(),
    } as any;
    next = vi.fn();
  });

  const loginRedirect = () =>
    `${config.deployment.routes.auth}${config.deployment.routes.auth_routes.login}?continue=${encodeURIComponent(req.originalUrl)}`;

  const accountRedirect = () =>
    `${config.deployment.routes.accounts}${config.deployment.routes.account_routes.dashboard}`;

  it.each([
    'requireAuth',
    'requireRole',
    'requireAdmin',
    'requirePermissions',
  ] as const)('%s preserves the localized login route', async guard => {
    sessionManager.isAuthenticated.mockResolvedValue(false);
    res.locals.routes = { authFull: { login: '/fr/auth/login' } };

    switch (guard) {
      case 'requireAuth':
        await middleware.requireAuth(req, res, next);
        break;
      case 'requireRole':
        await middleware.requireRole('admin')(req, res, next);
        break;
      case 'requireAdmin':
        await middleware.requireAdmin(req, res, next);
        break;
      case 'requirePermissions':
        await middleware.requirePermissions(['users:read'])(req, res, next);
        break;
    }

    expect(res.redirect).toHaveBeenCalledWith(
      `/fr/auth/login?continue=${encodeURIComponent(req.originalUrl)}`
    );
  });

  it('rejects a protocol-relative localized login route override', async () => {
    sessionManager.isAuthenticated.mockResolvedValue(false);
    res.locals.routes = {
      authFull: { login: '//attacker.example/auth/login' },
    };

    await middleware.requireAuth(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(loginRedirect());
  });

  describe('requireAuth', () => {
    it('continues for an authenticated user', async () => {
      await middleware.requireAuth(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it.each([
      ['the session ID', { id: 'session-123' }, 'session-123'],
      ['the fallback session label', undefined, 'no-session'],
    ])(
      'redirects an unauthenticated user and logs %s',
      async (_label, session, expectedSessionId) => {
        sessionManager.isAuthenticated.mockResolvedValue(false);
        req.session = session as any;

        await middleware.requireAuth(req, res, next);

        expect(logger.info).toHaveBeenCalledWith(
          'Authentication required or account disabled, redirecting to login',
          {
            returnUrl: req.originalUrl,
            sessionId: expectedSessionId,
          }
        );
        expect(res.redirect).toHaveBeenCalledWith(loginRedirect());
        expect(next).not.toHaveBeenCalled();
      }
    );
  });

  describe('requireRole', () => {
    it('continues when the authenticated user has the required role', async () => {
      await middleware.requireRole('auditor')(req, res, next);

      expect(sessionManager.hasRole).toHaveBeenCalledWith(req, 'auditor');
      expect(next).toHaveBeenCalledOnce();
    });

    it('redirects an unauthenticated user to login before checking roles', async () => {
      sessionManager.isAuthenticated.mockResolvedValue(false);

      await middleware.requireRole('admin')(req, res, next);

      expect(logger.info).toHaveBeenCalledWith(
        'Authentication required or account disabled for role check, redirecting to login',
        {
          returnUrl: req.originalUrl,
          requiredRole: 'admin',
          sessionId: 'session-123',
        }
      );
      expect(res.redirect).toHaveBeenCalledWith(loginRedirect());
      expect(sessionManager.hasRole).not.toHaveBeenCalled();
    });

    it('uses the no-session label on an unauthenticated role check', async () => {
      sessionManager.isAuthenticated.mockResolvedValue(false);
      req.session = undefined as any;

      await middleware.requireRole('admin')(req, res, next);

      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: 'no-session' })
      );
    });

    it.each([
      ['the session ID', { id: 'session-123' }, 'session-123'],
      ['the fallback session label', undefined, 'no-session'],
    ])(
      'redirects a user without the role and logs %s',
      async (_label, session, expectedSessionId) => {
        sessionManager.hasRole.mockReturnValue(false);
        sessionManager.getUserProperty.mockReturnValue(['member']);
        req.session = session as any;

        await middleware.requireRole('admin')(req, res, next);

        expect(logger.warn).toHaveBeenCalledWith('Insufficient permissions', {
          requiredRole: 'admin',
          userRoles: ['member'],
          sessionId: expectedSessionId,
        });
        expect(res.redirect).toHaveBeenCalledWith(accountRedirect());
        expect(next).not.toHaveBeenCalled();
      }
    );
  });

  describe('requireAdmin', () => {
    it('continues for an authenticated administrator', async () => {
      await middleware.requireAdmin(req, res, next);

      expect(sessionManager.isAdmin).toHaveBeenCalledWith(req);
      expect(next).toHaveBeenCalledOnce();
    });

    it.each([
      ['the session ID', { id: 'session-123' }, 'session-123'],
      ['the fallback session label', undefined, 'no-session'],
    ])(
      'redirects an unauthenticated request and logs %s',
      async (_label, session, expectedSessionId) => {
        sessionManager.isAuthenticated.mockResolvedValue(false);
        req.session = session as any;

        await middleware.requireAdmin(req, res, next);

        expect(logger.info).toHaveBeenCalledWith(
          'Authentication required or account disabled for admin access, redirecting to login',
          {
            returnUrl: req.originalUrl,
            sessionId: expectedSessionId,
          }
        );
        expect(res.redirect).toHaveBeenCalledWith(loginRedirect());
        expect(sessionManager.isAdmin).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['the session ID', { id: 'session-123' }, 'session-123'],
      ['the fallback session label', undefined, 'no-session'],
    ])(
      'redirects a non-admin user and logs %s',
      async (_label, session, expectedSessionId) => {
        sessionManager.isAdmin.mockReturnValue(false);
        sessionManager.getUserProperty.mockReturnValue(['member']);
        req.session = session as any;

        await middleware.requireAdmin(req, res, next);

        expect(logger.warn).toHaveBeenCalledWith('Admin access denied', {
          userRoles: ['member'],
          sessionId: expectedSessionId,
        });
        expect(res.redirect).toHaveBeenCalledWith(accountRedirect());
        expect(next).not.toHaveBeenCalled();
      }
    );
  });

  describe('requirePlatformTenant', () => {
    it('continues without consulting tenant context in single-tenant mode', () => {
      config.features.multi_tenancy.enabled = false;

      tenantContext.run('customer-a', () =>
        middleware.requirePlatformTenant(req, res, next)
      );

      expect(next).toHaveBeenCalledOnce();
      expect(sessionManager.flash).not.toHaveBeenCalled();
    });

    it('allows the _platforms tenant in multi-tenant mode', () => {
      config.features.multi_tenancy.enabled = true;

      tenantContext.run('_platforms', () =>
        middleware.requirePlatformTenant(req, res, next)
      );

      expect(next).toHaveBeenCalledOnce();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('rejects access when no tenant context is active', () => {
      config.features.multi_tenancy.enabled = true;

      middleware.requirePlatformTenant(req, res, next);

      expect(flashError).toHaveBeenCalledWith(
        'Platform settings are only accessible from the platform admin portal.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
      expect(next).not.toHaveBeenCalled();
    });

    it.each([DEFAULT_TENANT_ID, 'customer-a'])(
      'rejects the %s tenant with a flash message',
      tenantId => {
        config.features.multi_tenancy.enabled = true;

        tenantContext.run(tenantId, () =>
          middleware.requirePlatformTenant(req, res, next)
        );

        expect(flashError).toHaveBeenCalledWith(
          'Platform settings are only accessible from the platform admin portal.'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/configuration');
        expect(next).not.toHaveBeenCalled();
      }
    );
  });

  describe('requirePermissions', () => {
    it('redirects an unauthenticated request and records request context', async () => {
      sessionManager.isAuthenticated.mockResolvedValue(false);

      await middleware.requirePermissions(['users:read'])(req, res, next);

      expect(logger.info).toHaveBeenCalledWith('Unauthorized access attempt', {
        path: req.originalUrl,
        ip: req.ip,
        userAgent: 'Security middleware test',
      });
      expect(res.redirect).toHaveBeenCalledWith(loginRedirect());
      expect(sessionManager.get).not.toHaveBeenCalled();
    });

    it('continues when all required permissions are present', async () => {
      sessionManager.get.mockReturnValue(['users:read', 'users:write']);

      await middleware.requirePermissions(['users:read', 'users:write'])(
        req,
        res,
        next
      );

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows an empty required-permissions list', async () => {
      sessionManager.get.mockReturnValue(undefined);

      await middleware.requirePermissions([])(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it.each([
      ['a partial permission set', ['users:read']],
      ['a missing session permission set', undefined],
    ])('renders forbidden for %s', async (_label, permissions) => {
      sessionManager.get.mockReturnValue(permissions);
      sessionManager.getUserProperty.mockReturnValue('user-123');

      await middleware.requirePermissions(['users:read', 'users:write'])(
        req,
        res,
        next
      );

      expect(logger.warn).toHaveBeenCalledWith('Insufficient permissions', {
        userId: 'user-123',
        path: req.originalUrl,
        requiredPermissions: ['users:read', 'users:write'],
        userPermissions: permissions || [],
      });
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.render).toHaveBeenCalledWith('errors/forbidden', {
        title: 'Access Denied',
        message: 'You do not have permission to access this resource',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('regenerateSession', () => {
    it('regenerates an authenticated session once and marks it', async () => {
      sessionManager.get.mockReturnValue(false);

      await middleware.regenerateSession(req, res, next);

      expect(sessionManager.regenerate).toHaveBeenCalledWith(req);
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'sessionRegenerated',
        true
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it('does not regenerate an unauthenticated session', async () => {
      sessionManager.isAuthenticated.mockResolvedValue(false);

      await middleware.regenerateSession(req, res, next);

      expect(sessionManager.get).not.toHaveBeenCalled();
      expect(sessionManager.regenerate).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('does not regenerate a session already marked as regenerated', async () => {
      sessionManager.get.mockReturnValue(true);

      await middleware.regenerateSession(req, res, next);

      expect(sessionManager.regenerate).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('logs regeneration failures and passes the error to Express', async () => {
      const error = new Error('session store unavailable');
      sessionManager.get.mockReturnValue(false);
      sessionManager.regenerate.mockRejectedValue(error);

      await middleware.regenerateSession(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'session_regeneration_failed',
      });
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('CSRF middleware', () => {
    it('generates a missing token and exposes the stored token to views', () => {
      sessionManager.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce('csrf-123');

      middleware.generateCsrfToken(req, res, next);

      expect(sessionManager.generateCsrfToken).toHaveBeenCalledWith(req);
      expect(res.locals.csrfToken).toBe('csrf-123');
      expect(next).toHaveBeenCalledOnce();
    });

    it('reuses an existing token', () => {
      sessionManager.get.mockReturnValue('csrf-existing');

      middleware.generateCsrfToken(req, res, next);

      expect(sessionManager.generateCsrfToken).not.toHaveBeenCalled();
      expect(res.locals.csrfToken).toBe('csrf-existing');
      expect(next).toHaveBeenCalledOnce();
    });

    it('logs token-generation failures and propagates them to fail closed', () => {
      const error = new Error('session unavailable');
      sessionManager.get.mockImplementation(() => {
        throw error;
      });

      middleware.generateCsrfToken(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'error_generating_csrf_token',
      });
      expect(next).toHaveBeenCalledWith(error);
    });

    it('delegates CSRF validation to the session manager middleware', () => {
      const csrfMiddleware = vi.fn();
      sessionManager.csrfProtection.mockReturnValue(csrfMiddleware);

      middleware.validateCsrfToken(req, res, next);

      expect(sessionManager.csrfProtection).toHaveBeenCalledOnce();
      expect(csrfMiddleware).toHaveBeenCalledWith(req, res, next);
    });
  });

  describe('setupAllSecurity', () => {
    it.each([
      ['the defaults', undefined, undefined, ['generateCsrfToken']],
      ['no authentication without CSRF', 'none', false, []],
      [
        'user authentication with CSRF',
        'user',
        true,
        ['requireAuth', 'generateCsrfToken'],
      ],
      [
        'admin authentication with CSRF',
        'admin',
        true,
        ['requireAdmin', 'generateCsrfToken'],
      ],
      ['user authentication without CSRF', 'user', false, ['requireAuth']],
      ['admin authentication without CSRF', 'admin', false, ['requireAdmin']],
    ] as const)(
      'composes %s',
      (_label, authLevel, enableCsrf, expectedNames) => {
        const result =
          authLevel === undefined
            ? middleware.setupAllSecurity()
            : middleware.setupAllSecurity(authLevel, enableCsrf);

        expect(result.map(handler => handler.name)).toEqual(expectedNames);
      }
    );
  });
});
