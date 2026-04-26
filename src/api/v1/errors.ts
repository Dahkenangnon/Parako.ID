/**
 * API error factory for the Parako.ID Management API v1.
 *
 * All errors follow the RFC 9457 Problem Detail format and use URN-based
 * type identifiers from the `urn:parako:error:*` namespace. Factory
 * functions provide a concise, type-safe way to construct error responses
 * with the correct HTTP status, title, and optional extension members.
 */

import type { ProblemDetail } from './types.js';

// URN catalog

/** URN type identifiers for every API error category. */
export const ERROR_TYPES = {
  UNAUTHORIZED: 'urn:parako:error:unauthorized',
  FORBIDDEN: 'urn:parako:error:forbidden',
  NOT_FOUND: 'urn:parako:error:not-found',
  CONFLICT: 'urn:parako:error:conflict',
  VALIDATION: 'urn:parako:error:validation',
  RATE_LIMIT_EXCEEDED: 'urn:parako:error:rate-limit-exceeded',
  INTERNAL: 'urn:parako:error:internal',
  TENANT_NOT_FOUND: 'urn:parako:error:tenant-not-found',
  SCOPE_INSUFFICIENT: 'urn:parako:error:scope-insufficient',
  TOKEN_EXPIRED: 'urn:parako:error:token-expired',
  TOKEN_INVALID: 'urn:parako:error:token-invalid',
  SECTION_NOT_ALLOWED: 'urn:parako:error:section-not-allowed',
  CONSTRAINT_VIOLATION: 'urn:parako:error:constraint-violation',
  BODY_TOO_LARGE: 'urn:parako:error:body-too-large',
} as const;

// ApiError class

/**
 * Structured API error carrying a full RFC 9457 Problem Detail payload.
 *
 * Extends `Error` so it can be thrown and caught like any standard error
 * while also exposing `toJSON()` for direct serialisation into an HTTP
 * response body.
 */
export class ApiError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string | undefined;

  /** Any RFC 9457 extension members (e.g. `retry_after`, `errors`). */
  readonly extensions: Record<string, unknown>;

  constructor(problem: ProblemDetail) {
    super(problem.detail);
    this.name = 'ApiError';

    this.type = problem.type;
    this.title = problem.title;
    this.status = problem.status;
    this.detail = problem.detail;
    this.instance = problem.instance;

    // Collect extension members — everything that is not a core field.
    const coreKeys = new Set(['type', 'title', 'status', 'detail', 'instance']);
    const extensions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(problem)) {
      if (!coreKeys.has(key)) {
        extensions[key] = value;
      }
    }
    this.extensions = extensions;
  }

  /** Serialise to a plain RFC 9457 Problem Detail object. */
  toJSON(): ProblemDetail {
    const json: ProblemDetail = {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
    };

    if (this.instance !== undefined) {
      json.instance = this.instance;
    }

    for (const [key, value] of Object.entries(this.extensions)) {
      json[key] = value;
    }

    return json;
  }
}

/** 401 — Missing or invalid credentials. */
export function unauthorized(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.UNAUTHORIZED,
    title: 'Unauthorized',
    status: 401,
    detail,
    instance,
  });
}

/** 401 — Access token has expired. */
export function tokenExpired(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.TOKEN_EXPIRED,
    title: 'Token Expired',
    status: 401,
    detail,
    instance,
  });
}

/** 401 — Access token is malformed or has an invalid signature. */
export function tokenInvalid(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.TOKEN_INVALID,
    title: 'Invalid Token',
    status: 401,
    detail,
    instance,
  });
}

/** 403 — Authenticated but lacking required permissions. */
export function forbidden(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.FORBIDDEN,
    title: 'Insufficient Scope',
    status: 403,
    detail,
    instance,
  });
}

/** 403 — One or more required scopes are missing from the token. */
export function scopeInsufficient(
  detail: string,
  requiredScopes: string[],
  instance?: string
): ApiError {
  return new ApiError({
    type: ERROR_TYPES.SCOPE_INSUFFICIENT,
    title: 'Required Scope Missing',
    status: 403,
    detail,
    instance,
    required_scopes: requiredScopes,
  });
}

/** 404 — Requested resource does not exist. */
export function notFound(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.NOT_FOUND,
    title: 'Resource Not Found',
    status: 404,
    detail,
    instance,
  });
}

/** 404 — The specified tenant could not be found. */
export function tenantNotFound(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.TENANT_NOT_FOUND,
    title: 'Tenant Not Found',
    status: 404,
    detail,
    instance,
  });
}

/** 409 — Resource already exists or state conflict. */
export function conflict(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.CONFLICT,
    title: 'Resource Conflict',
    status: 409,
    detail,
    instance,
  });
}

/** 422 — Request body failed validation. */
export function validationError(
  detail: string,
  errors: Array<{ field: string; message: string }>,
  instance?: string
): ApiError {
  return new ApiError({
    type: ERROR_TYPES.VALIDATION,
    title: 'Validation Error',
    status: 422,
    detail,
    instance,
    errors,
  });
}

/** 429 — Too many requests; retry after the given number of seconds. */
export function rateLimitExceeded(
  detail: string,
  retryAfter: number,
  instance?: string
): ApiError {
  return new ApiError({
    type: ERROR_TYPES.RATE_LIMIT_EXCEEDED,
    title: 'Rate Limit Exceeded',
    status: 429,
    detail,
    instance,
    retry_after: retryAfter,
  });
}

/** 500 — Unexpected server error. */
export function internal(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.INTERNAL,
    title: 'Internal Server Error',
    status: 500,
    detail,
    instance,
  });
}

/** 400 — The requested configuration section is not allowed. */
export function sectionNotAllowed(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.SECTION_NOT_ALLOWED,
    title: 'Configuration Section Not Allowed',
    status: 400,
    detail,
    instance,
  });
}

/** 422 — A floor/ceiling constraint was violated. */
export function constraintViolation(
  detail: string,
  instance?: string
): ApiError {
  return new ApiError({
    type: ERROR_TYPES.CONSTRAINT_VIOLATION,
    title: 'Floor/Ceiling Constraint Violation',
    status: 422,
    detail,
    instance,
  });
}

/** 413 — Request body exceeds the maximum allowed size. */
export function bodyTooLarge(detail: string, instance?: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.BODY_TOO_LARGE,
    title: 'Request Body Too Large',
    status: 413,
    detail,
    instance,
  });
}
