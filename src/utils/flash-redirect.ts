import type { Request, Response } from 'express';

import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';

/**
 * Set a flash message at the given severity and issue a same-origin
 * redirect.
 *
 * Open-redirect protection: `path` MUST be a single-leading-slash
 * pathname on this origin. Inputs starting with `//`, any URL scheme
 * (`http:`, `https:`, `javascript:`, `data:`, etc.), or anything not
 * starting with `/` are rejected. A rejected path throws so the global
 * error handler can render the operator-facing error view — open-redirect
 * misuse is an operator bug, never a user-facing failure mode.
 *
 * See OWASP ASVS V5.1.5 (Unvalidated Redirects and Forwards).
 */
export type FlashLevel = 'success' | 'error' | 'warning' | 'info';

const SAME_ORIGIN_PATH = /^\/[^/]/;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

/** Returns true when `path` is a safe same-origin pathname. */
export function isSameOriginPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  if (path === '/') {
    return true;
  }
  if (!SAME_ORIGIN_PATH.test(path)) {
    return false;
  }
  if (SCHEME_PREFIX.test(path)) {
    return false;
  }
  return true;
}

export interface FlashRedirectDeps {
  sessionManager: Pick<ISessionManager, 'flash'>;
}

export function flashAndRedirect(
  deps: FlashRedirectDeps,
  req: Request,
  res: Response,
  level: FlashLevel,
  message: string,
  path: string
): void {
  if (!isSameOriginPath(path)) {
    throw new Error(
      `flashAndRedirect: refusing to redirect to non-same-origin path "${path}"`
    );
  }

  const flash = deps.sessionManager.flash(req);
  flash[level](message);
  res.redirect(path);
}
