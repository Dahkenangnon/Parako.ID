/**
 * JWT authentication middleware for the Parako.ID Management API v1.
 *
 * Validates Bearer tokens against the tenant's JWKS, enforces algorithm
 * allowlists, issuer/audience constraints, and platform-only scope
 * restrictions. Uses an in-process cache with a 5-minute TTL for the
 * jose verifier function created from each tenant's public JWKS.
 */

import type { RequestHandler, Request, Response, NextFunction } from 'express';
import * as jose from 'jose';

import type { ApiAuth } from '../types.js';
import {
  ApiError,
  ERROR_TYPES,
  tokenExpired,
  tokenInvalid,
  unauthorized,
  forbidden,
} from '../errors.js';
import { isPlatformOnlyScope, MANAGEMENT_API_RESOURCE_URI } from '../scopes.js';

/** Subset of application services required by the JWT auth middleware. */
export interface JwtAuthDependencies {
  keyStore: {
    getPublicJWKS(tenantId?: string): Promise<{ keys: JsonWebKey[] }>;
  };
  configManager: {
    getConfig(): { oidc: { issuer: string } };
  };
  logger: {
    warn(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
  };
  /** Returns the current tenant identifier from the request context. */
  getTenantId: () => string;
}

// JWKS in-process cache

interface JwksCache {
  /** Pre-built verifier function from `jose.createLocalJWKSet`. */
  verifier: ReturnType<typeof jose.createLocalJWKSet>;
  /** Timestamp (ms) when this entry was last populated. */
  loadedAt: number;
}

/** Time-to-live for cached JWKS verifier entries (5 minutes). */
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of tenant JWKS entries to cache in-process. */
const JWKS_CACHE_MAX_SIZE = 100;

/** Keyed by tenant identifier. */
const jwksCache = new Map<string, JwksCache>();

/**
 * Clear the entire JWKS cache.
 *
 * Intended for:
 * - Test teardown (deterministic behaviour between test runs)
 * - Redis pub/sub key-rotation events
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}

/** Algorithms explicitly allowed for token verification. */
const ALLOWED_ALGORITHMS: string[] = ['RS256', 'PS256', 'ES256'];

/**
 * Expected audience claim for Management API v1 tokens.
 * Matches the resource indicator URI registered with the OIDC provider.
 */
const EXPECTED_AUDIENCE = MANAGEMENT_API_RESOURCE_URI;

/** Clock tolerance in seconds to accommodate minor server time drift. */
const CLOCK_TOLERANCE = 30;

/**
 * Create an Express middleware that validates JWT Bearer tokens.
 *
 * On success the decoded token payload is attached to `req.apiAuth`.
 * On failure a JSON RFC 9457 Problem Detail response is returned directly
 * (the middleware never calls `next()` with an error).
 */
export function createJwtAuthMiddleware(
  deps: JwtAuthDependencies
): RequestHandler {
  const { keyStore, configManager, logger, getTenantId } = deps;

  /** Send an RFC 9457 Problem Detail error response with correct Content-Type. */
  function sendProblem(res: Response, err: ApiError): void {
    const response = res
      .status(err.status)
      .setHeader('Content-Type', 'application/problem+json');

    if (err.status === 401) {
      const errorCode =
        err.type === ERROR_TYPES.TOKEN_EXPIRED
          ? 'invalid_token'
          : err.type === ERROR_TYPES.TOKEN_INVALID
            ? 'invalid_token'
            : 'invalid_request';
      response.setHeader(
        'WWW-Authenticate',
        `Bearer realm="parako-management-api", error="${errorCode}"`
      );
    }

    response.json(err.toJSON());
  }

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // 1. Extract Bearer token
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      sendProblem(res, unauthorized('Missing Authorization header', req.path));
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      sendProblem(
        res,
        unauthorized(
          'Authorization header must use the Bearer scheme',
          req.path
        )
      );
      return;
    }

    const token = authHeader.slice(7); // length of "Bearer "

    if (!token) {
      sendProblem(res, unauthorized('Bearer token is empty', req.path));
      return;
    }

    // 2. Resolve tenant
    const tenantId = getTenantId();

    // 3. Load (or cache-hit) the tenant JWKS verifier
    let verifier: ReturnType<typeof jose.createLocalJWKSet>;

    try {
      const cached = jwksCache.get(tenantId);
      const now = Date.now();

      if (cached && now - cached.loadedAt < JWKS_CACHE_TTL_MS) {
        verifier = cached.verifier;
        logger.debug('JWKS cache hit', { tenantId });
      } else {
        const { keys } = await keyStore.getPublicJWKS(tenantId);
        verifier = jose.createLocalJWKSet({ keys } as jose.JSONWebKeySet);

        // Evict oldest entry when cache exceeds max size.
        if (jwksCache.size >= JWKS_CACHE_MAX_SIZE) {
          const oldestKey = jwksCache.keys().next().value;
          if (oldestKey) jwksCache.delete(oldestKey);
        }

        jwksCache.set(tenantId, { verifier, loadedAt: now });
        logger.debug('JWKS cache miss — loaded fresh keys', {
          tenantId,
          keyCount: keys.length,
        });
      }
    } catch (cause) {
      logger.warn('Failed to load JWKS for tenant', {
        tenantId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      sendProblem(
        res,
        tokenInvalid('Unable to verify token — key store unavailable', req.path)
      );
      return;
    }

    // 4. Verify the JWT
    const issuer = configManager.getConfig().oidc.issuer;

    let payload: jose.JWTPayload;

    try {
      const result = await jose.jwtVerify(token, verifier, {
        algorithms: ALLOWED_ALGORITHMS,
        issuer,
        audience: EXPECTED_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE,
      });
      payload = result.payload;
    } catch (cause) {
      if (cause instanceof jose.errors.JWTExpired) {
        sendProblem(res, tokenExpired('Access token has expired', req.path));
        return;
      }

      // All other jose verification failures (bad signature, wrong aud, etc.)
      logger.debug('JWT verification failed', {
        error: cause instanceof Error ? cause.message : String(cause),
        expectedIssuer: issuer,
        tenantId,
      });
      sendProblem(
        res,
        tokenInvalid('Access token verification failed', req.path)
      );
      return;
    }

    // 5. Build ApiAuth from verified claims
    const apiAuth: ApiAuth = {
      client_id: (payload.client_id as string) ?? '',
      scope: (payload.scope as string) ?? '',
      iss: payload.iss ?? '',
      aud: Array.isArray(payload.aud) ? payload.aud[0] : (payload.aud ?? ''),
      exp: payload.exp ?? 0,
      iat: payload.iat ?? 0,
    };

    // 6. Platform-only scope check (H-3)
    const scopes = apiAuth.scope.split(' ').filter(Boolean);
    const hasPlatformScope = scopes.some(s => isPlatformOnlyScope(s));

    if (hasPlatformScope && !apiAuth.iss.endsWith('/_platforms')) {
      logger.warn('Non-platform issuer attempted platform-only scope', {
        client_id: apiAuth.client_id,
        scopes: apiAuth.scope,
        issuer: apiAuth.iss,
      });
      sendProblem(
        res,
        forbidden(
          'Platform-only scopes require a platform-level issuer',
          req.path
        )
      );
      return;
    }

    // 7. Attach auth context and proceed
    req.apiAuth = apiAuth;
    next();
  };
}
