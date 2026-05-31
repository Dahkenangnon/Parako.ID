/**
 * Zod-based body / params validation middleware for HTML-mounted
 * endpoints that respond with the legacy `{ success, error, details }`
 * JSON envelope (currently the WebAuthn endpoints at
 * `src/routes/webauthn.ts`).
 *
 * Browser callers under `src/assets/js/webauthn/**` and
 * `src/assets/js/account/**` parse `body.success` and `body.error`
 * directly, so the response shape is part of the client contract and
 * cannot move to RFC 9457 Problem Details without also updating those
 * callers.
 *
 * The `error` string is a generic, user-safe sentence. Per-field detail
 * lives in `details: { field, message }[]` so the form can highlight
 * the failing inputs — the field NAMES (e.g. `friendly_name`) are part
 * of the public client contract, not internal schema-path leakage.
 *
 * On success the parsed value REPLACES the source on the request so
 * controllers consume a strongly-typed payload; unknown keys are
 * dropped by Zod's default strip mode, closing the mass-assignment
 * hole for JSON endpoints.
 *
 * References:
 *   - OWASP Mass Assignment Cheat Sheet:
 *     https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
 *   - OWASP API Security Top 10 (BOLA / mass assignment):
 *     https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/
 */

import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

import type { ILogger } from '../di/interfaces/logger.interface.js';
import { safeParseOrIssues } from '../validators/parse.js';

/**
 * Single user-facing string returned in the `error` field of the
 * legacy JSON envelope. Generic so it never leaks schema internals;
 * per-field guidance for the form UI is carried in `details`.
 */
export const GENERIC_LEGACY_JSON_ERROR =
  'Some fields were invalid. Please review the highlighted inputs and try again.';

export interface ValidateLegacyJsonDeps {
  logger: Pick<ILogger, 'info'>;
}

export function validateLegacyJsonBody<T>(
  schema: z.ZodType<T>,
  deps: ValidateLegacyJsonDeps
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = safeParseOrIssues(schema, req.body);
    if (parsed.ok) {
      req.body = parsed.data;
      next();
      return;
    }
    respond(deps, req, res, parsed.issues);
  };
}

export function validateLegacyJsonParams<T>(
  schema: z.ZodType<T>,
  deps: ValidateLegacyJsonDeps
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = safeParseOrIssues(schema, req.params);
    if (parsed.ok) {
      // Express 5 `req.params` may be defined as a getter on the
      // IncomingMessage prototype, so a direct assignment throws
      // `TypeError: Cannot set property params...`. `defineProperty`
      // installs a per-request data property that shadows the accessor.
      Object.defineProperty(req, 'params', {
        value: parsed.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
      return;
    }
    respond(deps, req, res, parsed.issues);
  };
}

function respond(
  deps: ValidateLegacyJsonDeps,
  req: Request,
  res: Response,
  issues: ReadonlyArray<{ field: string; message: string }>
): void {
  deps.logger.info('Request input failed validation', {
    url: req.originalUrl,
    method: req.method,
    context: 'json_legacy_validation_failed',
    issues,
  });
  res.status(400).json({
    success: false,
    error: GENERIC_LEGACY_JSON_ERROR,
    details: issues,
  });
}
