import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpsSocialCallbackService } from '../../../src/services/ops-social-callback.service.js';
import { createHmacState } from '../../../src/utils/hmac-state.js';

const TEST_SECRET = 'ops-test-secret-32-chars-long!!';
const TEST_BASE_DOMAIN = 'parako.id';

function makeMockRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(
      async (key: string, value: string, _mode?: string, _ttl?: number) => {
        store.set(key, value);
        return 'OK';
      }
    ),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    _store: store,
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockConfigManager() {
  return {
    getConfig: vi.fn(() => ({
      deployment: {
        url: `https://${TEST_BASE_DOMAIN}`,
      },
      security: {
        secrets: {
          hmac_secret: TEST_SECRET,
        },
      },
    })),
  };
}

function makeService() {
  const redis = makeMockRedis();
  const logger = makeMockLogger();
  const configManager = makeMockConfigManager();

  const service = new OpsSocialCallbackService(
    logger as any,
    configManager as any,
    redis as any
  );

  return { service, redis, logger, configManager };
}

describe('OpsSocialCallbackService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleCallback()', () => {
    it('rejects invalid HMAC state', async () => {
      const { service } = makeService();
      const result = await service.handleCallback(
        'google',
        'auth-code-123',
        'invalid-state'
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/state/i);
      }
    });

    it('rejects expired HMAC state', async () => {
      const { service } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      // Advance time past 10-minute window
      vi.advanceTimersByTime(11 * 60 * 1000);

      const result = await service.handleCallback(
        'google',
        'auth-code-123',
        state
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/expired|state/i);
      }
    });

    it('extracts tenant_id from valid HMAC state', async () => {
      const { service } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      const result = await service.handleCallback(
        'google',
        'auth-code-123',
        state
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.redirectUrl).toContain('acme');
      }
    });

    it('stores profile data in Redis with 2-minute TTL', async () => {
      const { service, redis } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      await service.handleCallback('google', 'auth-code-123', state);

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^social:ref:/),
        expect.any(String),
        'EX',
        120
      );
    });

    it('generates UUID ref in the redirect URL', async () => {
      const { service } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      const result = await service.handleCallback(
        'google',
        'auth-code-123',
        state
      );
      expect(result.success).toBe(true);
      if (result.success) {
        // UUID v4 pattern in the ref query param
        expect(result.redirectUrl).toMatch(/ref=[0-9a-f-]{36}/);
      }
    });

    it('builds correct redirect URL with tenant subdomain', async () => {
      const { service } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      const result = await service.handleCallback(
        'github',
        'auth-code-123',
        state
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.redirectUrl).toMatch(
          /^https:\/\/acme\.parako\.id\/auth\/social\/github\/complete\?ref=/
        );
      }
    });

    it('stores provider and code in the Redis profile data', async () => {
      const { service, redis } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      await service.handleCallback('google', 'auth-code-xyz', state);

      // Verify the stored data contains the provider and code
      const storedCall = redis.set.mock.calls[0];
      const storedData = JSON.parse(storedCall[1]);
      expect(storedData.provider).toBe('google');
      expect(storedData.code).toBe('auth-code-xyz');
      expect(storedData.tenant_id).toBe('acme');
    });

    it('returns error when Redis is not bound (null)', async () => {
      const logger = makeMockLogger();
      const configManager = makeMockConfigManager();
      const service = new OpsSocialCallbackService(
        logger as any,
        configManager as any,
        null as any
      );
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      const result = await service.handleCallback('google', 'code-123', state);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/unavailable/i);
      }
      expect(logger.error).toHaveBeenCalledWith(
        'ops_social_callback_no_redis',
        expect.any(Object)
      );
    });

    it('returns error when HMAC secret is not configured', async () => {
      const redis = makeMockRedis();
      const logger = makeMockLogger();
      const configManager = {
        getConfig: vi.fn(() => ({
          deployment: { url: 'https://parako.id' },
          security: { secrets: {} },
        })),
      };
      const service = new OpsSocialCallbackService(
        logger as any,
        configManager as any,
        redis as any
      );
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      const result = await service.handleCallback('google', 'code-123', state);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/misconfigured/i);
      }
      expect(logger.error).toHaveBeenCalledWith(
        'ops_social_callback_no_hmac_secret',
        expect.any(Object)
      );
    });

    it('logs the callback processing', async () => {
      const { service, logger } = makeService();
      const state = createHmacState(
        { tenant_id: 'acme', nonce: 'n1', timestamp: Date.now() },
        TEST_SECRET
      );

      await service.handleCallback('google', 'auth-code-123', state);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('ops_social_callback'),
        expect.objectContaining({
          provider: 'google',
          tenant_id: 'acme',
        })
      );
    });
  });
});
