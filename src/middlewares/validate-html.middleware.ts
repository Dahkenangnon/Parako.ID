/**
 * Zod-based query / body / params validation middleware for HTML
 * routes.
 *
 * On success the parsed (and possibly coerced) value REPLACES the
 * source on the request object so downstream controllers consume a
 * strongly-typed payload. The schema decides whether unknown keys are
 * stripped (default) or preserved via `.passthrough()` — HTML form
 * schemas use passthrough when the controller intentionally consumes
 * additional fields, and the controller's explicit destructuring is
 * the documented mass-assignment boundary.
 *
 * On failure the middleware:
 *   1. Logs the per-field Zod issues server-side (info level only —
 *      operator detail, not a user-visible error).
 *   2. Flashes a GENERIC message at the `error` level. Field paths
 *      and Zod messages are never reflected to the browser, so a
 *      crafted query parameter cannot use the flash text as an
 *      information-disclosure side channel.
 *   3. Issues a `flashAndRedirect` to a path-only target. Query-side
 *      failures redirect to the originating path with its query
 *      string stripped (matching the long-standing same-origin
 *      pattern); body and params failures redirect to a caller-
 *      supplied path. `flashAndRedirect` itself re-checks the
 *      same-origin rule via `isSameOriginPath`, so a misuse throws
 *      instead of producing an open redirect.
 *
 * References:
 *   - OWASP Mass Assignment Cheat Sheet:
 *     https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
 *   - OWASP Unvalidated Redirects and Forwards:
 *     https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
 *   - Zod 4 docs (default object mode strips unknown keys):
 *     https://zod.dev/api
 */

import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

import type { ILogger } from '../di/interfaces/logger.interface.js';
import {
  flashAndRedirect,
  type FlashRedirectDeps,
} from '../utils/flash-redirect.js';
import { safeParseOrIssues } from '../validators/parse.js';

/**
 * The single user-facing message shown when a request fails the
 * Zod parse. Never embed field paths, raw values, or Zod messages
 * into the flash text — those leak schema internals to anyone able
 * to influence a query string.
 */
export const GENERIC_VALIDATION_FLASH =
  'Please correct the highlighted fields and try again.';

export interface ValidateHtmlDeps extends FlashRedirectDeps<'error'> {
  logger: Pick<ILogger, 'info'>;
}

type RedirectTarget = string | ((req: Request) => string);

function resolveRedirectTarget(target: RedirectTarget, req: Request): string {
  return typeof target === 'function' ? target(req) : target;
}

/**
 * Express 5 exposes `req.query` (and to a lesser extent `req.params`) as
 * a getter-only property — a direct `req.query = ...` assignment throws
 * `TypeError: Cannot set property query of #<IncomingMessage> which has
 * only a getter`. `Object.defineProperty` overrides the accessor with a
 * data property for the lifetime of this request, so downstream
 * handlers see the parsed (coerced, defaulted) value.
 */
function overrideRequestProperty(
  req: Request,
  key: 'query' | 'params',
  value: unknown
): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/**
 * Build a query-validating middleware. On parse failure the redirect
 * target is the originating path with any query string stripped, so
 * the user is taken back to the same screen without the offending
 * parameters.
 */
export function validateHtmlQuery<T>(
  schema: z.ZodType<T>,
  deps: ValidateHtmlDeps
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = safeParseOrIssues(schema, req.query);
    if (parsed.ok) {
      overrideRequestProperty(req, 'query', parsed.data);
      next();
      return;
    }
    handleFailure(deps, req, res, parsed.issues, stripQueryString(req));
  };
}

/**
 * Build a body-validating middleware. The caller supplies the
 * redirect path for parse failures — usually the form's GET endpoint.
 */
export function validateHtmlBody<T>(
  schema: z.ZodType<T>,
  deps: ValidateHtmlDeps,
  redirectTo: RedirectTarget
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = safeParseOrIssues(schema, req.body);
    if (parsed.ok) {
      req.body = parsed.data;
      next();
      return;
    }
    handleFailure(
      deps,
      req,
      res,
      parsed.issues,
      resolveRedirectTarget(redirectTo, req)
    );
  };
}

/**
 * Build a params-validating middleware. The caller supplies the
 * redirect path for parse failures — usually a safe fallback such
 * as the section's index page or `/auth/login`.
 */
export function validateHtmlParams<T>(
  schema: z.ZodType<T>,
  deps: ValidateHtmlDeps,
  redirectTo: RedirectTarget
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = safeParseOrIssues(schema, req.params);
    if (parsed.ok) {
      overrideRequestProperty(req, 'params', parsed.data);
      next();
      return;
    }
    handleFailure(
      deps,
      req,
      res,
      parsed.issues,
      resolveRedirectTarget(redirectTo, req)
    );
  };
}

function handleFailure(
  deps: ValidateHtmlDeps,
  req: Request,
  res: Response,
  issues: ReadonlyArray<{ field: string; message: string }>,
  redirectTo: string
): void {
  deps.logger.info('Request input failed validation', {
    url: req.originalUrl,
    method: req.method,
    context: 'html_validation_failed',
    issues,
  });
  flashAndRedirect(
    deps,
    req,
    res,
    'error',
    GENERIC_VALIDATION_FLASH,
    redirectTo
  );
}

function stripQueryString(req: Request): string {
  const index = req.originalUrl.indexOf('?');
  return index === -1 ? req.originalUrl : req.originalUrl.slice(0, index);
}
