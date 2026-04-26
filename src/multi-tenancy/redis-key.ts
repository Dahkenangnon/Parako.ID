import { tenantContext } from './tenant-context.js';

/**
 * Unified Redis key format: {prefix}:{tenantId}:{segments...}
 *
 * All Redis keys in the application follow this pattern to ensure:
 * 1. Key isolation per tenant (even in single-tenant mode, where tenantId = 'default')
 * 2. Namespace isolation via the global prefix (deployment.redis_prefix)
 * 3. Consistent, auditable key structure across all subsystems
 *
 * Subsystem identifiers:
 * - `oidc`     — OIDC adapter storage (tokens, sessions, grants)
 * - `rl`       — Rate limiter counters
 * - `jwks`     — JWKS rotation/promotion PubSub channels
 * - `activity` — Tenant activity tracking (provider pool coordination)
 * - `session`  — Express session store (EXCEPTION: no tenant segment — see below)
 *
 * Exception: Express sessions use `{prefix}:session:{sid}` WITHOUT a tenant segment
 * because session middleware runs BEFORE tenant context is established (the session
 * contains the tenant ID, creating a bootstrap dependency).
 */

/**
 * Build a Redis key using the current ALS tenant context.
 *
 * @param prefix   - Global Redis prefix (deployment.redis_prefix, e.g. 'parako')
 * @param segments - Key segments after tenantId (e.g. 'oidc', 'Session', 'abc123')
 * @returns Key in format `{prefix}:{tenantId}:{segments...}`
 *
 * @example
 * // Inside ALS context for tenant 'acme':
 * buildRedisKey('parako', 'oidc', 'Session', 'abc123')
 * // => 'parako:acme:oidc:Session:abc123'
 *
 * @example
 * // Outside ALS context (single-tenant mode):
 * buildRedisKey('parako', 'jwks', 'rotated')
 * // => 'parako:default:jwks:rotated'
 */
export function buildRedisKey(prefix: string, ...segments: string[]): string {
  const tenantId = tenantContext.getTenantId();
  return [prefix, tenantId, ...segments].join(':');
}

/**
 * Build a Redis key with an explicit tenant ID (no ALS read).
 *
 * Use in contexts where ALS is unavailable:
 * - Redis PubSub message callbacks (fired outside ALS)
 * - Worker bootstrap before tenant context is set
 * - When the tenant ID is already resolved and captured in a closure
 *
 * @param prefix   - Global Redis prefix
 * @param tenantId - Explicit tenant ID
 * @param segments - Key segments after tenantId
 * @returns Key in format `{prefix}:{tenantId}:{segments...}`
 */
export function buildRedisKeyForTenant(
  prefix: string,
  tenantId: string,
  ...segments: string[]
): string {
  return [prefix, tenantId, ...segments].join(':');
}
