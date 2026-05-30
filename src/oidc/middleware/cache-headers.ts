import { createHash } from 'node:crypto';
import type { Middleware } from 'koa';
import type { KoaContextWithOIDC } from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import { HARDENING } from '../../config/hardening-defaults.js';

interface CacheableRoute {
  maxAge: number;
}

const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

const stringifyBody = (body: unknown): string =>
  typeof body === 'string' ? body : JSON.stringify(body);

/**
 * Drop the entity-representation headers a 304 response is not permitted to
 * carry. RFC 7232 section 4.1 enumerates the headers a server may send with
 * a 304 and forbids the others.
 */
const strip304RepresentationHeaders = (ctx: KoaContextWithOIDC): void => {
  ctx.remove('Content-Length');
  ctx.remove('Content-Type');
  ctx.remove('Content-Encoding');
};

/**
 * Compute the JWKS Cache-Control max-age. The result is clamped so it can
 * never exceed half the published key overlap window, ensuring a cached JWKS
 * cannot point at a rotated-out key.
 */
const jwksMaxAge = (overlapWindowSeconds: number): number => {
  const halfOverlap = Math.floor(overlapWindowSeconds / 2);
  return Math.max(60, Math.min(HARDENING.oidcCache.jwksMaxAgeCap, halfOverlap));
};

const applyCacheableResponse = (
  ctx: KoaContextWithOIDC,
  route: CacheableRoute
): void => {
  const serialized = stringifyBody(ctx.body);
  const etag = `"${sha256Hex(serialized)}"`;

  ctx.set('Cache-Control', `public, max-age=${route.maxAge}`);
  ctx.set('ETag', etag);
  ctx.vary('Accept-Encoding');

  const ifNoneMatch = ctx.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    ctx.status = 304;
    ctx.body = null;
    strip304RepresentationHeaders(ctx);
  }
};

/**
 * Koa middleware that adds ETag, Cache-Control, and Vary headers to the
 * JWKS and OAuth 2.0 Authorization Server Metadata (RFC 8414) responses, and
 * handles conditional `If-None-Match` requests by returning 304 Not Modified
 * (RFC 7232 section 3.3).
 */
export const createOidcCacheMiddleware = (
  configManager: IConfigManager
): Middleware<unknown, KoaContextWithOIDC> => {
  return async (ctx, next) => {
    await next();

    if (ctx.status !== 200) return;

    const route = ctx.oidc?.route;
    if (route === 'jwks') {
      const cfg = configManager.getConfig();
      const overlap = cfg.security?.key_store?.overlap_window_seconds ?? 7200;
      applyCacheableResponse(ctx, { maxAge: jwksMaxAge(overlap) });
    } else if (route === 'discovery') {
      applyCacheableResponse(ctx, {
        maxAge: HARDENING.oidcCache.discoveryMaxAge,
      });
    }
  };
};
