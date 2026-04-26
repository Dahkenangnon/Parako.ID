import { describe, it, expect, vi } from 'vitest';

import { requireScope } from '../../../../../src/api/v1/middleware/scope-guard.middleware.js';
import { ApiError, ERROR_TYPES } from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRequest(apiAuth?: { scope: string; client_id?: string }) {
  const req: Record<string, unknown> = {
    path: '/api/v1/test',
  };
  if (apiAuth !== undefined) {
    req.apiAuth = {
      client_id: apiAuth.client_id ?? 'test-client',
      scope: apiAuth.scope,
      iss: 'https://test.parako.id/oidc/v1',
      aud: 'urn:parako:api:v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
  }
  return req as unknown as Express.Request & { path: string };
}

function createMockResponse() {
  const res: Record<string, unknown> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/middleware/scope-guard', () => {
  // -------------------------------------------------------------------------
  // 1. Calls next() when required scope is present
  // -------------------------------------------------------------------------
  describe('single required scope present', () => {
    it('should call next() when the required scope is present in req.apiAuth.scope', () => {
      const middleware = requireScope('parako:clients:read');

      const req = createMockRequest({ scope: 'parako:clients:read' });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Calls next() when any of multiple required scopes is present
  // -------------------------------------------------------------------------
  describe('multiple required scopes (any match)', () => {
    it('should call next() when at least one of the required scopes is present', () => {
      const middleware = requireScope(
        'parako:clients:write',
        'parako:clients:read'
      );

      const req = createMockRequest({ scope: 'parako:clients:read' });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Throws ApiError with status 403 when scope is missing
  // -------------------------------------------------------------------------
  describe('missing required scope', () => {
    it('should throw ApiError with status 403 when scope is missing', () => {
      const middleware = requireScope('parako:clients:write');

      const req = createMockRequest({ scope: 'parako:clients:read' });
      const res = createMockResponse();
      const next = vi.fn();

      expect(() => middleware(req as any, res as any, next)).toThrow(ApiError);

      try {
        middleware(req as any, res as any, next);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(403);
        expect(apiError.type).toBe(ERROR_TYPES.SCOPE_INSUFFICIENT);
      }

      expect(next).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Thrown error includes required_scopes extension
  // -------------------------------------------------------------------------
  describe('error extensions', () => {
    it('should include required_scopes in the thrown ApiError extensions', () => {
      const middleware = requireScope(
        'parako:users:write',
        'parako:users:delete'
      );

      const req = createMockRequest({ scope: 'parako:clients:read' });
      const res = createMockResponse();
      const next = vi.fn();

      try {
        middleware(req as any, res as any, next);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;

        expect(apiError.extensions.required_scopes).toEqual([
          'parako:users:write',
          'parako:users:delete',
        ]);

        // Also verify the serialised JSON contains required_scopes
        const json = apiError.toJSON();
        expect(json.required_scopes).toEqual([
          'parako:users:write',
          'parako:users:delete',
        ]);
      }

      expect(next).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Throws when req.apiAuth is undefined (no auth context)
  // -------------------------------------------------------------------------
  describe('no authentication context', () => {
    it('should throw ApiError with status 403 when req.apiAuth is undefined', () => {
      const middleware = requireScope('parako:clients:read');

      const req = createMockRequest(); // no apiAuth
      const res = createMockResponse();
      const next = vi.fn();

      expect(() => middleware(req as any, res as any, next)).toThrow(ApiError);

      try {
        middleware(req as any, res as any, next);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(403);
        expect(apiError.type).toBe(ERROR_TYPES.SCOPE_INSUFFICIENT);
        expect(apiError.detail).toBe('No authentication context');
      }

      expect(next).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Works with space-separated multiple scopes in req.apiAuth.scope
  // -------------------------------------------------------------------------
  describe('space-separated scopes in token', () => {
    it('should match when the required scope is among multiple space-separated scopes', () => {
      const middleware = requireScope('parako:users:read');

      const req = createMockRequest({
        scope: 'parako:clients:read parako:users:read parako:audit:read',
      });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should throw when none of the space-separated scopes match', () => {
      const middleware = requireScope('parako:users:write');

      const req = createMockRequest({
        scope: 'parako:clients:read parako:users:read parako:audit:read',
      });
      const res = createMockResponse();
      const next = vi.fn();

      expect(() => middleware(req as any, res as any, next)).toThrow(ApiError);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
