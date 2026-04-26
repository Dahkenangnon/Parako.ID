/**
 * Rate limiter middleware for the Parako.ID Management API v1.
 *
 * Provides tiered rate limiting based on endpoint sensitivity using
 * `express-rate-limit` v8. Each tier has distinct request ceilings per
 * time window, and rate-limit responses follow the RFC 9457 Problem
 * Detail format via the shared `rateLimitExceeded` error factory.
 *
 * Tiers (per 60-second window):
 * - **read**:      100 requests
 * - **write**:      30 requests
 * - **delete**:     10 requests
 * - **sensitive**:   3 requests
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { rateLimitExceeded } from '../errors.js';

const RATE_LIMIT_TIERS = {
  read: { windowMs: 60_000, limit: 100 },
  write: { windowMs: 60_000, limit: 30 },
  delete: { windowMs: 60_000, limit: 10 },
  sensitive: { windowMs: 60_000, limit: 3 },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

/**
 * Create an Express middleware that rate-limits requests according to
 * the specified tier.
 *
 * The key generator identifies callers by `req.apiAuth.client_id`
 * (set by the upstream JWT middleware) or falls back to `req.ip`.
 * When the limit is exceeded, a 429 JSON response in RFC 9457 format
 * is returned directly — no error is thrown.
 *
 * @param tier  One of `read`, `write`, `delete`, or `sensitive`.
 * @returns Express `RequestHandler`.
 */
export function apiRateLimiter(tier: RateLimitTier): RequestHandler {
  const config = RATE_LIMIT_TIERS[tier];

  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    keyGenerator: req =>
      req.apiAuth?.client_id ||
      ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? '127.0.0.1'),

    handler: (_req, res, _next, _options) => {
      const retryAfter = Math.ceil(config.windowMs / 1000);
      const error = rateLimitExceeded(
        `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        retryAfter,
        _req.path
      );
      res
        .status(error.status)
        .setHeader('Content-Type', 'application/problem+json')
        .setHeader('Retry-After', String(retryAfter))
        .json(error.toJSON());
    },
  }) as RequestHandler;
}
