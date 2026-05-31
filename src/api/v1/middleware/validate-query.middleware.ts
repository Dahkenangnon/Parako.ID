/**
 * Query-validation middleware for the Management API v1.
 *
 * Mirrors `validate-body.middleware.ts` for `req.query`. Routes that
 * accept query parameters MAY run a Zod schema against `req.query` so
 * controllers can rely on the request already matching the contract.
 * On failure the middleware throws an `ApiError(422)` which the central
 * error handler serialises into an RFC 9457 Problem Detail with an
 * `errors[]` member listing every field that failed.
 *
 * References:
 *   - OWASP Input Validation: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 *   - RFC 9457 Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/rfc9457/
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validationError } from '../errors.js';

/**
 * Build an Express middleware that validates `req.query` against the
 * supplied Zod schema. On success the parsed (and possibly transformed)
 * value replaces `req.query` so controllers consume a strictly-typed
 * payload.
 */
export function validateQuery<T>(
  schema: z.ZodType<T>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.issues.map(issue => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      next(
        validationError(
          'Request query failed validation',
          errors,
          req.originalUrl
        )
      );
      return;
    }
    // Express 5 exposes `req.query` as a getter-only accessor on the
    // IncomingMessage prototype, so a direct assignment throws
    // `TypeError: Cannot set property query...`. `defineProperty`
    // installs a per-request data property that shadows the getter.
    Object.defineProperty(req, 'query', {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
