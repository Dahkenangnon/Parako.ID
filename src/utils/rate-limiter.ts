/**
 * Centralized Rate Limiting Utility
 *
 * This module provides centralized rate limiting for the entire application.
 * All rate limiters are defined here for easy management and visibility.
 *
 * Features:
 * - Development mode: Limits are multiplied by devMultiplier (default 10x) to avoid
 *   hitting limits during frequent restarts and testing
 * - Production mode: Strict limits with optional Redis store for distributed deployments
 * - Consistent configuration across all limiters
 */

import rateLimit, {
  type RateLimitRequestHandler,
  ipKeyGenerator,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { buildRedisKey } from '../multi-tenancy/redis-key.js';

const isDev = process.env.NODE_ENV !== 'production';

// Redis client for distributed rate limiting (production only)
let redisClient: Redis | null = null;
let redisBasePrefix = 'parako';

/** Minimal logger contract used by the rate-limiter init. */
export interface RateLimitInitLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * Initialize Redis client for rate limiting.
 * Call this during app initialization if using Redis in production.
 *
 * @param redisUrl   Redis connection URL
 * @param basePrefix Base key prefix (from deployment.redis_prefix config)
 * @param logger     Structured logger. Defaults to `console` to keep the
 *                   function callable from pre-DI bootstrap paths.
 */
export async function initRateLimitRedis(
  redisUrl?: string,
  basePrefix?: string,
  logger: RateLimitInitLogger = console
): Promise<void> {
  if (basePrefix) redisBasePrefix = basePrefix;

  if (!isDev && redisUrl) {
    try {
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      await redisClient.connect();
      logger.info('Rate-limiter Redis client connected', {
        component: 'rate-limiter',
      });
    } catch (error) {
      logger.warn(
        'Rate-limiter Redis connection failed; falling back to in-memory store',
        {
          component: 'rate-limiter',
          err: error instanceof Error ? error.message : String(error),
        }
      );
      redisClient = null;
    }
  }
}

/**
 * Get Redis client if available (for cleanup on shutdown)
 */
export function getRateLimitRedisClient(): Redis | null {
  return redisClient;
}

/**
 * Options for creating a rate limiter
 */
interface RateLimiterOptions {
  /** Unique name for this limiter (used in key generation) */
  name: string;
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests allowed in the window (production value) */
  max: number;
  /** Message to return when rate limited */
  message: string;
  /** Multiplier for max in development mode (default: 10) */
  devMultiplier?: number;
  /** Custom handler for rate limit exceeded */
  handler?: (req: Request, res: Response) => void;
}

/**
 * Factory function to create rate limiters with dev/prod awareness
 */
function createLimiter(options: RateLimiterOptions): RateLimitRequestHandler {
  const { name, windowMs, max, message, devMultiplier = 10, handler } = options;

  // In development, multiply the max by devMultiplier to avoid hitting limits
  const effectiveMax = isDev ? max * devMultiplier : max;

  return rateLimit({
    windowMs,
    max: effectiveMax,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      // Unified format: {prefix}:{tenantId}:rl:{name}:{ip}
      // buildRedisKey reads tenantId from ALS, producing consistent keys
      // across both single-tenant (tenantId='default') and multi-tenant modes.
      return buildRedisKey(
        redisBasePrefix,
        'rl',
        name,
        ipKeyGenerator(req.ip ?? '127.0.0.1')
      );
    },
    handler: handler
      ? (req, res) => handler(req, res)
      : (req, res, _next, opts) => {
          // Default handler with proper response
          res.status(429).json({
            success: false,
            error: opts.message,
            retryAfter: Math.ceil(windowMs / 1000),
          });
        },
    store: redisClient
      ? new RedisStore({
          sendCommand: (...args: string[]) =>
            (redisClient as Redis).call(args[0], ...args.slice(1)) as any,
          // No static prefix — the full key (including tenant) is built by keyGenerator
          prefix: '',
        })
      : undefined,
  });
}

// AUTH RATE LIMITERS

/**
 * Login Rate Limiter
 * Prevents brute force password attacks
 * Production: 5 attempts per 15 minutes
 * Development: 50 attempts per 15 minutes
 */
export const loginLimiter = createLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts. Please try again later.',
});

/**
 * Registration Rate Limiter
 * Prevents mass account creation
 * Production: 3 registrations per hour
 * Development: 30 registrations per hour
 */
export const registerLimiter = createLimiter({
  name: 'register',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many registration attempts. Please try again later.',
});

/**
 * MFA Verification Rate Limiter
 * Prevents brute force OTP attacks
 * Production: 5 attempts per 15 minutes
 * Development: 50 attempts per 15 minutes
 */
export const mfaVerifyLimiter = createLimiter({
  name: 'mfa-verify',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many MFA verification attempts. Please try again later.',
});

/**
 * Social Login Rate Limiter
 * Prevents OAuth abuse and enumeration attacks
 * Production: 10 attempts per 5 minutes
 * Development: 100 attempts per 5 minutes
 */
export const socialLoginLimiter = createLimiter({
  name: 'social-login',
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: 'Too many social login attempts. Please try again later.',
});

/**
 * Account Recovery Rate Limiter
 * Prevents brute force attacks on recovery endpoints
 * Production: 5 attempts per 15 minutes
 * Development: 50 attempts per 15 minutes
 */
export const recoveryLimiter = createLimiter({
  name: 'recovery',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many recovery attempts. Please try again later.',
});

/**
 * Forgot Password Rate Limiter
 * Stricter limit for password reset to prevent email enumeration
 * Production: 3 requests per 15 minutes
 * Development: 30 requests per 15 minutes
 */
export const forgotPasswordLimiter = createLimiter({
  name: 'forgot-password',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: 'Too many password reset requests. Please try again later.',
});

/**
 * Change Password Rate Limiter
 * Prevents brute force attacks on the change password endpoint
 * Production: 5 attempts per 15 minutes
 * Development: 50 attempts per 15 minutes
 */
export const changePasswordLimiter = createLimiter({
  name: 'change-password',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many password change attempts. Please try again later.',
});

// ADMIN RATE LIMITERS

/**
 * Configuration Update Rate Limiter
 * Prevents excessive config changes
 * Production: 20 updates per 5 minutes
 * Development: 200 updates per 5 minutes
 */
export const configUpdateLimiter = createLimiter({
  name: 'config-update',
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: 'Too many configuration updates. Please try again later.',
});

/**
 * Test Email Rate Limiter
 * Prevents email service abuse during testing
 * Production: 3 test emails per minute
 * Development: 30 test emails per minute
 */
export const testEmailLimiter = createLimiter({
  name: 'test-email',
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: 'Too many test emails. Please try again later.',
});

/**
 * Reveal Secret Rate Limiter
 * Limits secret exposure for security
 * Production: 10 reveals per minute
 * Development: 100 reveals per minute
 */
export const revealSecretLimiter = createLimiter({
  name: 'reveal-secret',
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many secret reveal attempts. Please try again later.',
});

// GLOBAL RATE LIMITER

/**
 * Create a global rate limiter with configurable options
 * Used in app.ts for application-wide rate limiting
 *
 * @param config - Configuration from the app config
 * @returns Rate limiter middleware
 */
export function createGlobalLimiter(config: {
  windowMinutes: number;
  requestsPerMinute: number;
}): RateLimitRequestHandler {
  return createLimiter({
    name: 'global',
    windowMs: config.windowMinutes * 60 * 1000,
    max: config.requestsPerMinute,
    message: `Too many requests. Please try again after ${config.windowMinutes} minutes.`,
    devMultiplier: 100, // Very relaxed in development
  });
}

// EXPORTS SUMMARY

/**
 * All available rate limiters for easy importing:
 *
 * Auth:
 * - loginLimiter: Login attempts
 * - registerLimiter: Registration attempts
 * - mfaVerifyLimiter: MFA verification attempts
 * - socialLoginLimiter: Social login attempts
 * - recoveryLimiter: Account recovery attempts
 * - forgotPasswordLimiter: Password reset requests
 * - changePasswordLimiter: Password change attempts
 *
 * Admin:
 * - configUpdateLimiter: Configuration changes
 * - testEmailLimiter: Test email sends
 * - revealSecretLimiter: Secret reveal requests
 *
 * Global:
 * - createGlobalLimiter(config): Factory for global limiter
 *
 * Utilities:
 * - initRateLimitRedis(url): Initialize Redis for distributed limiting
 * - getRateLimitRedisClient(): Get Redis client for cleanup
 * - createTenantAwareKeyGenerator(name, basePrefix?): Key generator with tenant scoping
 * - getRateLimiterStorePrefix(name, basePrefix): Redis store prefix with tenant
 *
 * Unified key format: {basePrefix}:{tenantId}:rl:{name}:{ip}
 */

// ── Tenant-aware utilities ──────────────────────────────────────────────────

/**
 * Create a tenant-aware key generator for rate limiting.
 * Unified format: {basePrefix}:{tenantId}:rl:{name}:{ip}
 */
export function createTenantAwareKeyGenerator(
  name: string,
  basePrefix: string = redisBasePrefix
): (ip: string) => string {
  return (ip: string) => {
    return buildRedisKey(basePrefix, 'rl', name, ip);
  };
}

/**
 * Get the full Redis key prefix for a rate limiter, including tenant scope.
 * Unified format: {basePrefix}:{tenantId}:rl:{name}:{ip}
 *
 * This function returns the prefix up to (but not including) the IP part:
 *   `{basePrefix}:{tenantId}:rl:{name}:`
 */
export function getRateLimiterStorePrefix(
  name: string,
  basePrefix: string
): string {
  return buildRedisKey(basePrefix, 'rl', name, '');
}
