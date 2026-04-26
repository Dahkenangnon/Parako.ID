/**
 * API error handling middleware for the Parako.ID Management API v1.
 *
 * Catches all errors thrown (or passed via `next(err)`) in API routes and
 * serialises them into RFC 9457 Problem Detail responses with the
 * `application/problem+json` content type. Handles known error shapes
 * (ApiError, Zod validation, DB duplicate-key / invalid-ID errors) and falls
 * back to a generic 500 for anything unexpected — never leaking stack traces.
 * DB error detection is agnostic: supports both MongoDB (code 11000, CastError)
 * and Prisma (P2002, P2025) error shapes.
 */

import type { ErrorRequestHandler } from 'express';

import { ApiError, internal } from '../errors.js';

/** Subset of application services required by the error handler middleware. */
export interface ErrorHandlerDependencies {
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
  };
  /** When true, the catch-all 500 response includes debug info (message, stack). */
  isDevelopment?: boolean;
}

/**
 * Create an Express error-handling middleware (4 arguments) that serialises
 * errors into RFC 9457 Problem Detail JSON responses.
 */
export function createApiErrorHandler(
  deps: ErrorHandlerDependencies
): ErrorRequestHandler {
  return (err, req, res, _next) => {
    // 1. ApiError instances — serialise directly
    if (err instanceof ApiError) {
      const body = err.toJSON();
      body.instance = body.instance || req.path;

      if (err.status >= 500) {
        deps.logger.error(err, { path: req.path });
      } else {
        deps.logger.warn(`API error: ${err.title}`, {
          type: err.type,
          status: err.status,
          path: req.path,
        });
      }

      return res
        .status(err.status)
        .setHeader('Content-Type', 'application/problem+json')
        .json(body);
    }

    // 2. Zod validation errors (ZodError has `issues` array)
    if (
      err &&
      typeof err === 'object' &&
      'issues' in err &&
      Array.isArray((err as any).issues)
    ) {
      const zodErr = err as {
        issues: Array<{ path: (string | number)[]; message: string }>;
      };
      const errors = zodErr.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      deps.logger.warn('API validation error', { path: req.path, errors });

      return res
        .status(422)
        .setHeader('Content-Type', 'application/problem+json')
        .json({
          type: 'urn:parako:error:validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Request validation failed',
          instance: req.path,
          errors,
        });
    }

    // 3. Duplicate key / unique constraint error (MongoDB 11000, Prisma P2002)
    if (
      err &&
      typeof err === 'object' &&
      ((err as any).code === 11000 ||
        (err as any).code === 'P2002' ||
        ((err as any).message &&
          (err as any).message.includes('Unique constraint')))
    ) {
      deps.logger.warn('API conflict error', { path: req.path });

      return res
        .status(409)
        .setHeader('Content-Type', 'application/problem+json')
        .json({
          type: 'urn:parako:error:conflict',
          title: 'Resource Conflict',
          status: 409,
          detail: 'A resource with the same identifier already exists',
          instance: req.path,
        });
    }

    // 4. Invalid ID / cast errors (MongoDB CastError, Prisma P2025 not-found)
    if (
      err &&
      typeof err === 'object' &&
      ((err as any).name === 'CastError' || (err as any).code === 'P2025')
    ) {
      deps.logger.warn('API not-found (invalid ID)', { path: req.path });

      return res
        .status(404)
        .setHeader('Content-Type', 'application/problem+json')
        .json({
          type: 'urn:parako:error:not-found',
          title: 'Resource Not Found',
          status: 404,
          detail: 'The requested resource was not found',
          instance: req.path,
        });
    }

    // 5. Catch-all — internal server error (NO stack trace in response)
    const error = err instanceof Error ? err : new Error(String(err));
    deps.logger.error(error, {
      path: req.path,
      context: 'unhandled_api_error',
    });

    const internalError = internal('An unexpected error occurred', req.path);
    const body: Record<string, unknown> = internalError.toJSON();

    if (deps.isDevelopment) {
      body.debug = { message: error.message, stack: error.stack };
    }

    return res
      .status(500)
      .setHeader('Content-Type', 'application/problem+json')
      .json(body);
  };
}
