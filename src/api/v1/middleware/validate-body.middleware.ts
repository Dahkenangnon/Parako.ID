/**
 * Body-validation middleware for the Management API v1.
 *
 * Each API v1 route that mutates state (POST/PATCH/PUT) MUST run a Zod
 * schema against `req.body` so the controller can rely on the request
 * already matching the contract. On failure the middleware throws an
 * `ApiError(422)` which the central error handler serialises into an
 * RFC 9457 Problem Detail with a `errors[]` member listing every field
 * that failed.
 *
 * References:
 *   - OWASP Input Validation: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 *   - RFC 9457 Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/rfc9457/
 *   - RFC 9700 OAuth 2.0 Security BCP §2.5: https://datatracker.ietf.org/doc/rfc9700/
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validationError } from '../errors.js';

/**
 * Build an Express middleware that validates `req.body` against the supplied
 * Zod schema. On success the parsed (and possibly transformed) value
 * replaces `req.body` so controllers consume a strictly-typed payload.
 */
export function validateBody<T>(
  schema: z.ZodType<T>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Convert Zod issue list to the API's `{ field, message }[]` shape.
      const errors = result.error.issues.map(issue => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      next(
        validationError(
          'Request body failed validation',
          errors,
          req.originalUrl
        )
      );
      return;
    }
    // Express types `req.body` as `any`; safe to overwrite with the parsed
    // (typed) value so downstream controllers see the narrowed shape.
    req.body = result.data;
    next();
  };
}
