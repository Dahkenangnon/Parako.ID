/**
 * Scope guard middleware for the Parako.ID Management API v1.
 *
 * A higher-order function that returns Express middleware to enforce
 * scope requirements on incoming requests. The middleware inspects
 * `req.apiAuth.scope` (populated by the upstream JWT auth middleware)
 * and throws an `ApiError` when the required scope is not present.
 *
 * Thrown errors are caught by the error-handler middleware (Phase 2d)
 * and serialised into RFC 9457 Problem Detail responses.
 */

import type { RequestHandler } from 'express';

import { scopeInsufficient } from '../errors.js';
import { hasAnyScope } from '../scopes.js';

/**
 * Create middleware that enforces at least one of the given scopes.
 *
 * @param scopes  One or more scope strings — the request must carry
 *                at least one of them in `req.apiAuth.scope`.
 * @returns Express middleware that calls `next()` on success or throws
 *          an `ApiError` (403) on failure.
 */
export function requireScope(...scopes: string[]): RequestHandler {
  return (req, _res, next) => {
    const apiAuth = req.apiAuth;

    if (!apiAuth) {
      throw scopeInsufficient('No authentication context', scopes);
    }

    if (!hasAnyScope(apiAuth.scope, ...scopes)) {
      throw scopeInsufficient(
        `Token lacks required scope. Required one of: ${scopes.join(', ')}`,
        scopes,
        req.path
      );
    }

    next();
  };
}
