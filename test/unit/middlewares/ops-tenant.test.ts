import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// We'll import the middleware once it's created
import { OpsTenantMiddleware } from '../../../src/middlewares/ops-tenant.middleware.js';

function mockReq(
  overrides: Partial<Request> & { method?: string; path?: string } = {}
): Request {
  return {
    method: 'GET',
    path: '/',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Record<string, unknown> = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((data: unknown) => {
    res.body = data;
    return res;
  });
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

describe('OpsTenantMiddleware', () => {
  let middleware: OpsTenantMiddleware;
  let logger: {
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let next: NextFunction;

  beforeEach(() => {
    logger = {
      warn: vi.fn(),
      debug: vi.fn(),
    };
    middleware = new OpsTenantMiddleware(logger as any);
    next = vi.fn();
  });

  describe('whitelisted routes', () => {
    it('allows GET /social/:provider/callback', () => {
      const req = mockReq({ method: 'GET', path: '/social/google/callback' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows GET /health', () => {
      const req = mockReq({ method: 'GET', path: '/health' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows GET /metrics', () => {
      const req = mockReq({ method: 'GET', path: '/metrics' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('non-whitelisted routes', () => {
    it('rejects non-whitelisted route with 404', () => {
      const req = mockReq({ method: 'GET', path: '/admin/settings' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('rejects root path with 404', () => {
      const req = mockReq({ method: 'GET', path: '/' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('rejects /oidc path with 404', () => {
      const req = mockReq({ method: 'GET', path: '/oidc/.well-known' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('HTTP method enforcement', () => {
    it('rejects POST with 405', () => {
      const req = mockReq({ method: 'POST', path: '/health' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.body).toEqual({ error: 'Method not allowed' });
    });

    it('rejects PUT with 405', () => {
      const req = mockReq({ method: 'PUT', path: '/social/google/callback' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it('rejects DELETE with 405', () => {
      const req = mockReq({
        method: 'DELETE',
        path: '/social/github/callback',
      });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it('rejects PATCH with 405', () => {
      const req = mockReq({ method: 'PATCH', path: '/metrics' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(405);
    });
  });

  describe('logging', () => {
    it('logs blocked routes', () => {
      const req = mockReq({ method: 'GET', path: '/admin/users' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ops_route_blocked'),
        expect.objectContaining({ path: '/admin/users' })
      );
    });

    it('logs blocked methods', () => {
      const req = mockReq({ method: 'POST', path: '/health' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ops_method_blocked'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('social provider parameter matching', () => {
    it('allows various social providers', () => {
      for (const provider of [
        'google',
        'github',
        'facebook',
        'linkedin',
        'microsoft',
      ]) {
        const req = mockReq({
          method: 'GET',
          path: `/social/${provider}/callback`,
        });
        const res = mockRes();
        const n = vi.fn();
        middleware.handler(req, res, n);
        expect(n).toHaveBeenCalled();
      }
    });

    it('allows hyphenated provider names (e.g. azure-ad)', () => {
      for (const provider of ['azure-ad', 'apple-id', 'auth0']) {
        const req = mockReq({
          method: 'GET',
          path: `/social/${provider}/callback`,
        });
        const res = mockRes();
        const n = vi.fn();
        middleware.handler(req, res, n);
        expect(n).toHaveBeenCalled();
      }
    });

    it('rejects social path without callback suffix', () => {
      const req = mockReq({ method: 'GET', path: '/social/google' });
      const res = mockRes();
      middleware.handler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
