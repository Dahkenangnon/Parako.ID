import { describe, it, expect } from 'vitest';
import {
  ApiError,
  ERROR_TYPES,
  unauthorized,
  tokenExpired,
  tokenInvalid,
  forbidden,
  scopeInsufficient,
  notFound,
  tenantNotFound,
  conflict,
  validationError,
  rateLimitExceeded,
  internal,
  sectionNotAllowed,
  constraintViolation,
  bodyTooLarge,
} from '../../../../src/api/v1/errors.js';

describe('api/v1/errors', () => {
  // -----------------------------------------------------------------------
  // ApiError class
  // -----------------------------------------------------------------------
  describe('ApiError', () => {
    it('should be an instance of Error', () => {
      const err = new ApiError({
        type: 'urn:parako:error:internal',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Something went wrong',
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.name).toBe('ApiError');
    });

    it('should expose core ProblemDetail properties', () => {
      const err = new ApiError({
        type: 'urn:parako:error:not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: 'User abc123 not found',
        instance: '/api/v1/users/abc123',
      });

      expect(err.type).toBe('urn:parako:error:not-found');
      expect(err.title).toBe('Resource Not Found');
      expect(err.status).toBe(404);
      expect(err.detail).toBe('User abc123 not found');
      expect(err.instance).toBe('/api/v1/users/abc123');
    });

    it('should set the Error message to the detail string', () => {
      const err = new ApiError({
        type: 'urn:parako:error:internal',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Disk full',
      });

      expect(err.message).toBe('Disk full');
    });

    it('should leave instance undefined when not provided', () => {
      const err = new ApiError({
        type: 'urn:parako:error:internal',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Something went wrong',
      });

      expect(err.instance).toBeUndefined();
    });

    it('should capture extension members', () => {
      const err = new ApiError({
        type: 'urn:parako:error:rate-limit-exceeded',
        title: 'Rate Limit Exceeded',
        status: 429,
        detail: 'Too many requests',
        retry_after: 60,
      });

      expect(err.extensions).toEqual({ retry_after: 60 });
    });

    describe('toJSON()', () => {
      it('should return a valid ProblemDetail object', () => {
        const err = new ApiError({
          type: 'urn:parako:error:conflict',
          title: 'Resource Conflict',
          status: 409,
          detail: 'Client already exists',
          instance: '/api/v1/clients',
        });

        const json = err.toJSON();

        expect(json).toEqual({
          type: 'urn:parako:error:conflict',
          title: 'Resource Conflict',
          status: 409,
          detail: 'Client already exists',
          instance: '/api/v1/clients',
        });
      });

      it('should omit instance when not provided', () => {
        const err = new ApiError({
          type: 'urn:parako:error:internal',
          title: 'Internal Server Error',
          status: 500,
          detail: 'Something went wrong',
        });

        const json = err.toJSON();

        expect(json).not.toHaveProperty('instance');
        expect(Object.keys(json)).toEqual([
          'type',
          'title',
          'status',
          'detail',
        ]);
      });

      it('should include extension members at the top level', () => {
        const err = new ApiError({
          type: 'urn:parako:error:validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Invalid input',
          errors: [{ field: 'email', message: 'Required' }],
        });

        const json = err.toJSON();

        expect(json.errors).toEqual([{ field: 'email', message: 'Required' }]);
      });
    });
  });

  // -----------------------------------------------------------------------
  // ERROR_TYPES constant
  // -----------------------------------------------------------------------
  describe('ERROR_TYPES', () => {
    it('should contain all 14 URN strings', () => {
      const keys = Object.keys(ERROR_TYPES);
      expect(keys).toHaveLength(14);
    });

    it('should map each key to the correct URN', () => {
      expect(ERROR_TYPES.UNAUTHORIZED).toBe('urn:parako:error:unauthorized');
      expect(ERROR_TYPES.FORBIDDEN).toBe('urn:parako:error:forbidden');
      expect(ERROR_TYPES.NOT_FOUND).toBe('urn:parako:error:not-found');
      expect(ERROR_TYPES.CONFLICT).toBe('urn:parako:error:conflict');
      expect(ERROR_TYPES.VALIDATION).toBe('urn:parako:error:validation');
      expect(ERROR_TYPES.RATE_LIMIT_EXCEEDED).toBe(
        'urn:parako:error:rate-limit-exceeded'
      );
      expect(ERROR_TYPES.INTERNAL).toBe('urn:parako:error:internal');
      expect(ERROR_TYPES.TENANT_NOT_FOUND).toBe(
        'urn:parako:error:tenant-not-found'
      );
      expect(ERROR_TYPES.SCOPE_INSUFFICIENT).toBe(
        'urn:parako:error:scope-insufficient'
      );
      expect(ERROR_TYPES.TOKEN_EXPIRED).toBe('urn:parako:error:token-expired');
      expect(ERROR_TYPES.TOKEN_INVALID).toBe('urn:parako:error:token-invalid');
      expect(ERROR_TYPES.SECTION_NOT_ALLOWED).toBe(
        'urn:parako:error:section-not-allowed'
      );
      expect(ERROR_TYPES.CONSTRAINT_VIOLATION).toBe(
        'urn:parako:error:constraint-violation'
      );
      expect(ERROR_TYPES.BODY_TOO_LARGE).toBe(
        'urn:parako:error:body-too-large'
      );
    });

    it('should have all URN values starting with urn:parako:error:', () => {
      for (const value of Object.values(ERROR_TYPES)) {
        expect(value).toMatch(/^urn:parako:error:/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Factory functions
  // -----------------------------------------------------------------------
  describe('unauthorized()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = unauthorized('Bearer token missing');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.UNAUTHORIZED);
      expect(err.title).toBe('Unauthorized');
      expect(err.status).toBe(401);
      expect(err.detail).toBe('Bearer token missing');
    });

    it('should include instance when provided', () => {
      const err = unauthorized('Bearer token missing', '/api/v1/users');
      expect(err.instance).toBe('/api/v1/users');
    });

    it('should leave instance undefined when not provided', () => {
      const err = unauthorized('Bearer token missing');
      expect(err.instance).toBeUndefined();
    });
  });

  describe('tokenExpired()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = tokenExpired('Access token has expired');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.TOKEN_EXPIRED);
      expect(err.title).toBe('Token Expired');
      expect(err.status).toBe(401);
      expect(err.detail).toBe('Access token has expired');
    });

    it('should include instance when provided', () => {
      const err = tokenExpired('Expired', '/api/v1/clients');
      expect(err.instance).toBe('/api/v1/clients');
    });
  });

  describe('tokenInvalid()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = tokenInvalid('Signature verification failed');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.TOKEN_INVALID);
      expect(err.title).toBe('Invalid Token');
      expect(err.status).toBe(401);
      expect(err.detail).toBe('Signature verification failed');
    });

    it('should include instance when provided', () => {
      const err = tokenInvalid('Bad token', '/api/v1/sessions');
      expect(err.instance).toBe('/api/v1/sessions');
    });
  });

  describe('forbidden()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = forbidden('Insufficient permissions for this resource');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.FORBIDDEN);
      expect(err.title).toBe('Insufficient Scope');
      expect(err.status).toBe(403);
      expect(err.detail).toBe('Insufficient permissions for this resource');
    });

    it('should include instance when provided', () => {
      const err = forbidden('Forbidden', '/api/v1/config');
      expect(err.instance).toBe('/api/v1/config');
    });
  });

  describe('scopeInsufficient()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = scopeInsufficient('Token is missing required scopes', [
        'parako:users:read',
        'parako:users:write',
      ]);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.SCOPE_INSUFFICIENT);
      expect(err.title).toBe('Required Scope Missing');
      expect(err.status).toBe(403);
      expect(err.detail).toBe('Token is missing required scopes');
    });

    it('should include required_scopes extension', () => {
      const scopes = ['parako:clients:read', 'parako:clients:write'];
      const err = scopeInsufficient('Missing scopes', scopes);

      expect(err.extensions.required_scopes).toEqual(scopes);

      const json = err.toJSON();
      expect(json.required_scopes).toEqual(scopes);
    });

    it('should include instance when provided', () => {
      const err = scopeInsufficient(
        'Missing scopes',
        ['parako:users:read'],
        '/api/v1/users'
      );
      expect(err.instance).toBe('/api/v1/users');
    });
  });

  describe('notFound()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = notFound('Client with ID xyz not found');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.NOT_FOUND);
      expect(err.title).toBe('Resource Not Found');
      expect(err.status).toBe(404);
      expect(err.detail).toBe('Client with ID xyz not found');
    });

    it('should include instance when provided', () => {
      const err = notFound('Not found', '/api/v1/clients/xyz');
      expect(err.instance).toBe('/api/v1/clients/xyz');
    });
  });

  describe('tenantNotFound()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = tenantNotFound('Tenant acme-corp does not exist');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.TENANT_NOT_FOUND);
      expect(err.title).toBe('Tenant Not Found');
      expect(err.status).toBe(404);
      expect(err.detail).toBe('Tenant acme-corp does not exist');
    });

    it('should include instance when provided', () => {
      const err = tenantNotFound('Not found', '/api/v1/tenants/acme-corp');
      expect(err.instance).toBe('/api/v1/tenants/acme-corp');
    });
  });

  describe('conflict()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = conflict('A client with this redirect_uri already exists');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.CONFLICT);
      expect(err.title).toBe('Resource Conflict');
      expect(err.status).toBe(409);
      expect(err.detail).toBe('A client with this redirect_uri already exists');
    });

    it('should include instance when provided', () => {
      const err = conflict('Conflict', '/api/v1/clients');
      expect(err.instance).toBe('/api/v1/clients');
    });
  });

  describe('validationError()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = validationError('Request body validation failed', [
        { field: 'email', message: 'Must be a valid email address' },
      ]);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.VALIDATION);
      expect(err.title).toBe('Validation Error');
      expect(err.status).toBe(422);
      expect(err.detail).toBe('Request body validation failed');
    });

    it('should include errors array extension', () => {
      const fieldErrors = [
        { field: 'name', message: 'Required' },
        { field: 'redirect_uris', message: 'Must contain at least one URI' },
      ];
      const err = validationError('Validation failed', fieldErrors);

      expect(err.extensions.errors).toEqual(fieldErrors);

      const json = err.toJSON();
      expect(json.errors).toEqual(fieldErrors);
    });

    it('should include instance when provided', () => {
      const err = validationError(
        'Invalid',
        [{ field: 'name', message: 'Required' }],
        '/api/v1/clients'
      );
      expect(err.instance).toBe('/api/v1/clients');
    });
  });

  describe('rateLimitExceeded()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = rateLimitExceeded('Too many requests', 60);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.RATE_LIMIT_EXCEEDED);
      expect(err.title).toBe('Rate Limit Exceeded');
      expect(err.status).toBe(429);
      expect(err.detail).toBe('Too many requests');
    });

    it('should include retry_after extension', () => {
      const err = rateLimitExceeded('Slow down', 120);

      expect(err.extensions.retry_after).toBe(120);

      const json = err.toJSON();
      expect(json.retry_after).toBe(120);
    });

    it('should include instance when provided', () => {
      const err = rateLimitExceeded('Too many requests', 30, '/api/v1/users');
      expect(err.instance).toBe('/api/v1/users');
    });
  });

  describe('internal()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = internal('An unexpected error occurred');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.INTERNAL);
      expect(err.title).toBe('Internal Server Error');
      expect(err.status).toBe(500);
      expect(err.detail).toBe('An unexpected error occurred');
    });

    it('should include instance when provided', () => {
      const err = internal('Unexpected error', '/api/v1/stats');
      expect(err.instance).toBe('/api/v1/stats');
    });
  });

  describe('sectionNotAllowed()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = sectionNotAllowed('Section "secrets" cannot be read via API');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.SECTION_NOT_ALLOWED);
      expect(err.title).toBe('Configuration Section Not Allowed');
      expect(err.status).toBe(400);
      expect(err.detail).toBe('Section "secrets" cannot be read via API');
    });

    it('should include instance when provided', () => {
      const err = sectionNotAllowed('Not allowed', '/api/v1/config/secrets');
      expect(err.instance).toBe('/api/v1/config/secrets');
    });
  });

  describe('constraintViolation()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = constraintViolation(
        'Value 0 is below the minimum floor of 1'
      );

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.CONSTRAINT_VIOLATION);
      expect(err.title).toBe('Floor/Ceiling Constraint Violation');
      expect(err.status).toBe(422);
      expect(err.detail).toBe('Value 0 is below the minimum floor of 1');
    });

    it('should include instance when provided', () => {
      const err = constraintViolation(
        'Constraint violated',
        '/api/v1/config/session'
      );
      expect(err.instance).toBe('/api/v1/config/session');
    });
  });

  describe('bodyTooLarge()', () => {
    it('should return an ApiError with correct type, title, and status', () => {
      const err = bodyTooLarge('Request body exceeds 1MB limit');

      expect(err).toBeInstanceOf(ApiError);
      expect(err.type).toBe(ERROR_TYPES.BODY_TOO_LARGE);
      expect(err.title).toBe('Request Body Too Large');
      expect(err.status).toBe(413);
      expect(err.detail).toBe('Request body exceeds 1MB limit');
    });

    it('should include instance when provided', () => {
      const err = bodyTooLarge('Too large', '/api/v1/clients');
      expect(err.instance).toBe('/api/v1/clients');
    });
  });
});
