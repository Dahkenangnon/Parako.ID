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

const SAME_ORIGIN_BASE = 'https://parako.local';
const SAME_ORIGIN = new URL(SAME_ORIGIN_BASE).origin;

export type SameOriginPath = string & {
  readonly __sameOriginPath: unique symbol;
};

export function toSameOriginPath(path: string): SameOriginPath | null {
  if (typeof path !== 'string' || path.length === 0) {
    return null;
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    return null;
  }
  if (path.includes('\\') || path.includes('\0')) {
    return null;
  }

  try {
    const url = new URL(path, SAME_ORIGIN_BASE);
    if (url.origin !== SAME_ORIGIN) {
      return null;
    }
    const normalizedPath = `${url.pathname}${url.search}${url.hash}`;
    if (!normalizedPath.startsWith('/') || normalizedPath.startsWith('//')) {
      return null;
    }
    return normalizedPath as SameOriginPath;
  } catch {
    return null;
  }
}

/** Returns true when `path` is a safe same-origin pathname. */
export function isSameOriginPath(path: string): boolean {
  return toSameOriginPath(path) !== null;
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
  const safePath = toSameOriginPath(path);
  if (!safePath) {
    throw new Error(
      `flashAndRedirect: refusing to redirect to non-same-origin path "${path}"`
    );
  }

  const flash = deps.sessionManager.flash(req);
  flash[level](message);
  res.redirect(safePath);
}
