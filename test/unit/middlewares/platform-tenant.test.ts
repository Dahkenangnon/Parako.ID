import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

/**
 * Tests for PlatformTenantMiddleware
 *
 * The _platforms tenant guard restricts access to users with platform_admin
 * or platform_viewer roles. It checks authentication status and role
 * membership before allowing requests through.
 */

// We'll import after implementing. For now, test the contract.
// import { PlatformTenantMiddleware } from '../../../src/middlewares/platform-tenant.middleware.js';

/** Minimal mock logger matching ILogger interface */
function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/** Minimal mock session manager matching the subset we need */
function makeMockSessionManager(
  overrides: {
    authenticated?: boolean;
    roles?: string[];
  } = {}
) {
  const { authenticated = false, roles = [] } = overrides;
  return {
    isAuthenticated: vi.fn(async () => authenticated),
    getActiveUser: vi.fn(() =>
      authenticated ? { id: 'user-1', username: 'admin', roles } : undefined
    ),
    hasRole: vi.fn((_req: unknown, role: string) => roles.includes(role)),
    getUserProperty: vi.fn((_req: unknown, prop: string) => {
      if (prop === 'roles') return roles;
      return undefined;
    }),
  };
}

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/tenants',
    originalUrl: '/tenants',
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
  };
  return res as unknown as Response;
}

describe('PlatformTenantMiddleware', () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  describe('authentication checks', () => {
    it('rejects unauthenticated users with 401', async () => {
      const sessionManager = makeMockSessionManager({ authenticated: false });

      // Dynamic import to allow TDD — file doesn't exist yet
      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('role checks', () => {
    it('allows admin role as platform_admin fallback', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['admin'], // regular admin, treated as platform_admin
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect((req as any).platformRole).toBe('platform_admin');
    });

    it('rejects authenticated users without any admin or platform roles with 403', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['user'], // no admin or platform roles
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('allows platform_admin users through', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_admin'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows platform_viewer users through', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_viewer'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('platform role annotation', () => {
    it('sets platformRole on request for platform_admin', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_admin'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect((req as any).platformRole).toBe('platform_admin');
    });

    it('sets platformRole on request for platform_viewer', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_viewer'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect((req as any).platformRole).toBe('platform_viewer');
    });

    it('prefers platform_admin when user has both roles', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_viewer', 'platform_admin'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect((req as any).platformRole).toBe('platform_admin');
    });
  });

  describe('write protection for viewers', () => {
    it('rejects POST from platform_viewer with 403', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_viewer'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq({ method: 'POST' });
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows POST from platform_admin', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_admin'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq({ method: 'POST' });
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('allows GET from platform_viewer', async () => {
      const sessionManager = makeMockSessionManager({
        authenticated: true,
        roles: ['platform_viewer'],
      });

      const { PlatformTenantMiddleware } =
        await import('../../../src/middlewares/platform-tenant.middleware.js');
      const middleware = new PlatformTenantMiddleware(
        logger as any,
        sessionManager as any
      );

      const req = makeMockReq({ method: 'GET' });
      const res = makeMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });
});
