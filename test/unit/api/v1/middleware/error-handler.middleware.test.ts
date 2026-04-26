import { describe, it, expect, vi } from 'vitest';

import {
  createApiErrorHandler,
  type ErrorHandlerDependencies,
} from '../../../../../src/api/v1/middleware/error-handler.middleware.js';
import {
  notFound,
  internal as internalError,
} from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse() {
  const res: Record<string, unknown> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res as unknown as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

function createMockRequest(path = '/api/v1/test') {
  return { path } as any;
}

function createDeps(
  overrides: Partial<ErrorHandlerDependencies> = {}
): ErrorHandlerDependencies {
  return {
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/middleware/error-handler', () => {
  const next = vi.fn();

  // -----------------------------------------------------------------------
  // 1. ApiError — serialises with correct status, type, Content-Type
  // -----------------------------------------------------------------------
  describe('ApiError', () => {
    it('should serialise to JSON with correct status, type, and Content-Type', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const err = notFound('User not found');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json'
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'urn:parako:error:not-found',
          title: 'Resource Not Found',
          status: 404,
          detail: 'User not found',
        })
      );
    });

    // -------------------------------------------------------------------
    // 2. Sets instance to req.path when not already set
    // -------------------------------------------------------------------
    it('should set instance to req.path when not already set', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const err = notFound('Not found'); // no instance set
      const req = createMockRequest('/api/v1/users/123');
      const res = createMockResponse();

      handler(err, req, res as any, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.instance).toBe('/api/v1/users/123');
    });

    // -------------------------------------------------------------------
    // 3. Preserves existing instance
    // -------------------------------------------------------------------
    it('should preserve existing instance when already set', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const err = notFound('Not found', '/custom/instance');
      const req = createMockRequest('/api/v1/users/123');
      const res = createMockResponse();

      handler(err, req, res as any, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.instance).toBe('/custom/instance');
    });

    // -------------------------------------------------------------------
    // 4. 5xx errors call logger.error
    // -------------------------------------------------------------------
    it('should call logger.error for 5xx errors', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const err = internalError('Something broke');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      expect(deps.logger.error).toHaveBeenCalledOnce();
      expect(deps.logger.error).toHaveBeenCalledWith(err, {
        path: '/api/v1/test',
      });
      expect(deps.logger.warn).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------
    // 5. 4xx errors call logger.warn (not error)
    // -------------------------------------------------------------------
    it('should call logger.warn for 4xx errors', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const err = notFound('Not found');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      expect(deps.logger.warn).toHaveBeenCalledOnce();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'API error: Resource Not Found',
        {
          type: 'urn:parako:error:not-found',
          status: 404,
          path: '/api/v1/test',
        }
      );
      expect(deps.logger.error).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Zod-like error — 422 with validation type and errors array
  // -----------------------------------------------------------------------
  describe('Zod validation error', () => {
    it('should return 422 with validation type and errors array', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const zodError = {
        issues: [
          { path: ['body', 'email'], message: 'Invalid email' },
          { path: ['body', 'name'], message: 'Required' },
        ],
      };
      const req = createMockRequest('/api/v1/users');
      const res = createMockResponse();

      handler(zodError as any, req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json'
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'urn:parako:error:validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Request validation failed',
          instance: '/api/v1/users',
          errors: [
            { field: 'body.email', message: 'Invalid email' },
            { field: 'body.name', message: 'Required' },
          ],
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. Mongoose duplicate key error (code 11000) — 409 conflict
  // -----------------------------------------------------------------------
  describe('Mongoose duplicate key error', () => {
    it('should return 409 conflict for code 11000', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const mongoError = { code: 11000, message: 'duplicate key' };
      const req = createMockRequest('/api/v1/clients');
      const res = createMockResponse();

      handler(mongoError as any, req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json'
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'urn:parako:error:conflict',
          title: 'Resource Conflict',
          status: 409,
          detail: 'A resource with the same identifier already exists',
          instance: '/api/v1/clients',
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 8. Mongoose CastError — 404 not-found
  // -----------------------------------------------------------------------
  describe('Mongoose CastError', () => {
    it('should return 404 not-found for CastError', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const castError = {
        name: 'CastError',
        message: 'Cast to ObjectId failed',
      };
      const req = createMockRequest('/api/v1/users/invalid-id');
      const res = createMockResponse();

      handler(castError as any, req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json'
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'urn:parako:error:not-found',
          title: 'Resource Not Found',
          status: 404,
          detail: 'The requested resource was not found',
          instance: '/api/v1/users/invalid-id',
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 9. Generic Error — 500 internal, no stack trace
  // -----------------------------------------------------------------------
  describe('generic Error', () => {
    it('should return 500 internal with no stack trace in response', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const err = new Error('Something unexpected');
      const req = createMockRequest('/api/v1/settings');
      const res = createMockResponse();

      handler(err, req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json'
      );

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body).toEqual(
        expect.objectContaining({
          type: 'urn:parako:error:internal',
          title: 'Internal Server Error',
          status: 500,
          detail: 'An unexpected error occurred',
          instance: '/api/v1/settings',
        })
      );

      // Ensure no stack trace leaks into the response body
      expect(body.stack).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('Something unexpected');

      // Logger should have received the original error
      expect(deps.logger.error).toHaveBeenCalledWith(err, {
        path: '/api/v1/settings',
        context: 'unhandled_api_error',
      });
    });
  });

  // -----------------------------------------------------------------------
  // 10. Non-Error thrown (string) — 500 internal
  // -----------------------------------------------------------------------
  describe('non-Error thrown value', () => {
    it('should return 500 internal when a string is thrown', () => {
      const deps = createDeps();
      const handler = createApiErrorHandler(deps);

      const req = createMockRequest('/api/v1/health');
      const res = createMockResponse();

      handler('kaboom' as any, req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json'
      );

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.type).toBe('urn:parako:error:internal');
      expect(body.status).toBe(500);
      expect(body.detail).toBe('An unexpected error occurred');

      // Logger receives a proper Error object wrapping the string
      expect(deps.logger.error).toHaveBeenCalledOnce();
      const loggedError = (deps.logger.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(loggedError).toBeInstanceOf(Error);
      expect(loggedError.message).toBe('kaboom');
    });
  });

  // -----------------------------------------------------------------------
  // 11. Development mode debug info
  // -----------------------------------------------------------------------
  describe('development mode debug info', () => {
    it('should include debug.message and debug.stack when isDevelopment=true', () => {
      const deps = createDeps({ isDevelopment: true });
      const handler = createApiErrorHandler(deps);

      const err = new Error('Something unexpected');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.debug).toBeDefined();
      expect(body.debug.message).toBe('Something unexpected');
      expect(body.debug.stack).toBeDefined();
    });

    it('should exclude debug field when isDevelopment=false', () => {
      const deps = createDeps({ isDevelopment: false });
      const handler = createApiErrorHandler(deps);

      const err = new Error('Something unexpected');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.debug).toBeUndefined();
    });

    it('should exclude debug field when isDevelopment is undefined (default)', () => {
      const deps = createDeps(); // no isDevelopment
      const handler = createApiErrorHandler(deps);

      const err = new Error('Something unexpected');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.debug).toBeUndefined();
    });

    it('should never include stack traces in the standard error fields regardless of mode', () => {
      const deps = createDeps({ isDevelopment: true });
      const handler = createApiErrorHandler(deps);

      const err = new Error('Something unexpected');
      const req = createMockRequest();
      const res = createMockResponse();

      handler(err, req, res as any, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.stack).toBeUndefined();
      // Standard fields should not contain the error message
      expect(body.detail).toBe('An unexpected error occurred');
    });
  });
});
