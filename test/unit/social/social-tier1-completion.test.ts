import { describe, it, expect, vi } from 'vitest';
import { SOCIAL_REF_REDIS_PREFIX } from '../../../src/integration/social-tier-utils.js';

/**
 * Tests for Tier 1 Social Login Completion Handler.
 *
 * Route: GET /auth/social/:provider/complete?ref={uuid}
 *
 * Flow:
 * 1. Read ref from query params
 * 2. Fetch from Redis `social:ref:{uuid}` (one-time read, delete after)
 * 3. If ref not found or expired → error
 * 4. Return parsed ref data (provider, code, tenant_id) for the caller to complete the flow
 */

/**
 * The Tier 1 completion service reads a ref from Redis and returns the stored data.
 * The actual token exchange + user integration is handled by the existing social callback handler.
 */
async function consumeRef(
  redis: { get: any; del: any },
  ref: string
): Promise<
  | {
      success: true;
      provider: string;
      code: string;
      tenant_id: string;
    }
  | {
      success: false;
      error: string;
    }
> {
  const mod =
    await import('../../../src/integration/social-tier-utils.js').catch(
      () => null
    );
  if (mod?.consumeSocialRef) {
    return mod.consumeSocialRef(redis, ref);
  }
  throw new Error('consumeSocialRef not yet implemented');
}

function makeMockRedis(store: Map<string, string> = new Map()) {
  return {
    // Atomic get-and-delete (Redis 6.2+ GETDEL)
    getdel: vi.fn(async (key: string) => {
      const val = store.get(key) ?? null;
      if (val !== null) store.delete(key);
      return val;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    _store: store,
  };
}

describe('Tier 1 Social Login Completion', () => {
  describe('consumeSocialRef()', () => {
    it('returns stored data for a valid ref', async () => {
      const store = new Map<string, string>();
      const ref = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      store.set(
        `${SOCIAL_REF_REDIS_PREFIX}${ref}`,
        JSON.stringify({
          provider: 'google',
          code: 'auth-code-xyz',
          tenant_id: 'acme',
          timestamp: Date.now(),
        })
      );
      const redis = makeMockRedis(store);

      const result = await consumeRef(redis, ref);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.provider).toBe('google');
        expect(result.code).toBe('auth-code-xyz');
        expect(result.tenant_id).toBe('acme');
      }
    });

    it('atomically reads and deletes the ref from Redis (one-time use via GETDEL)', async () => {
      const store = new Map<string, string>();
      const ref = 'delete-after-read-uuid';
      store.set(
        `${SOCIAL_REF_REDIS_PREFIX}${ref}`,
        JSON.stringify({
          provider: 'github',
          code: 'code-123',
          tenant_id: 'beta',
          timestamp: Date.now(),
        })
      );
      const redis = makeMockRedis(store);

      await consumeRef(redis, ref);

      // Should use atomic GETDEL when available
      expect(redis.getdel).toHaveBeenCalledWith(
        `${SOCIAL_REF_REDIS_PREFIX}${ref}`
      );
      // Ref should be deleted from store
      expect(store.has(`${SOCIAL_REF_REDIS_PREFIX}${ref}`)).toBe(false);
    });

    it('returns error when ref is not found (expired or invalid)', async () => {
      const redis = makeMockRedis();

      const result = await consumeRef(redis, 'nonexistent-ref');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/not found|expired/i);
      }
    });

    it('returns error when ref data is malformed JSON', async () => {
      const store = new Map<string, string>();
      store.set(`${SOCIAL_REF_REDIS_PREFIX}bad-json`, 'not-valid-json{{{');
      const redis = makeMockRedis(store);

      const result = await consumeRef(redis, 'bad-json');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/malformed|invalid/i);
      }
    });

    it('returns error when ref data is missing required fields', async () => {
      const store = new Map<string, string>();
      store.set(
        `${SOCIAL_REF_REDIS_PREFIX}missing-fields`,
        JSON.stringify({ provider: 'google' }) // missing code, tenant_id
      );
      const redis = makeMockRedis(store);

      const result = await consumeRef(redis, 'missing-fields');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/missing|invalid/i);
      }
    });

    it('second read of same ref returns not found', async () => {
      const store = new Map<string, string>();
      const ref = 'one-time-use-ref';
      store.set(
        `${SOCIAL_REF_REDIS_PREFIX}${ref}`,
        JSON.stringify({
          provider: 'google',
          code: 'code-abc',
          tenant_id: 'acme',
          timestamp: Date.now(),
        })
      );
      const redis = makeMockRedis(store);

      // First read succeeds
      const first = await consumeRef(redis, ref);
      expect(first.success).toBe(true);

      // Second read fails (ref was deleted)
      const second = await consumeRef(redis, ref);
      expect(second.success).toBe(false);
    });
  });
});
