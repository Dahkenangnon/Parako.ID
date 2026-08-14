import { randomUUID } from 'node:crypto';

import express from 'express';
import { Redis } from 'ioredis';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import {
  consumeSocialRef,
  SOCIAL_REF_REDIS_PREFIX,
} from '../../../src/integration/social-tier-utils.js';
import { OpsTenantMiddleware } from '../../../src/middlewares/ops-tenant.middleware.js';
import { opsRoutes } from '../../../src/routes/ops.js';
import { OpsSocialCallbackService } from '../../../src/services/ops-social-callback.service.js';
import { createHmacState } from '../../../src/utils/hmac-state.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/0';
// gitleaks:allow -- deterministic HMAC key for disposable integration data.
const TEST_HMAC_SECRET = 'ops-integration-hmac-secret-32-chars';

function createLogger(): ILogger {
  return {
    child: vi.fn().mockReturnThis(),
    debug: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    getLogger: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as ILogger;
}

function createConfigManager(): IConfigManager {
  return {
    getConfig: () => ({
      deployment: { url: 'https://example.test' },
      security: { secrets: { hmac_secret: TEST_HMAC_SECRET } },
    }),
  } as unknown as IConfigManager;
}

describe('_ops social callback Redis integration', () => {
  const createdKeys = new Set<string>();
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await redis.connect();
    await redis.ping();
  });

  afterEach(async () => {
    const keys = [...createdKeys];
    createdKeys.clear();
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  });

  it('persists and atomically relays one callback through the public HTTP boundary', async () => {
    const logger = createLogger();
    const callbackService = new OpsSocialCallbackService(
      logger,
      createConfigManager(),
      redis
    );
    const app = express();
    app.use(opsRoutes(new OpsTenantMiddleware(logger), callbackService));
    const suffix = randomUUID().slice(0, 8);
    const tenantId = `ops-acme-${suffix}`;
    const code = `authorization-code-${suffix}`;
    const state = createHmacState(
      { tenant_id: tenantId, nonce: randomUUID(), timestamp: Date.now() },
      TEST_HMAC_SECRET
    );
    const requestStartedAt = Date.now();

    const response = await request(app)
      .get('/social/google/callback')
      .query({ code, state })
      .redirects(0)
      .expect(302);

    const redirect = new URL(response.headers.location);
    const ref = redirect.searchParams.get('ref');
    expect(redirect.hostname).toBe(`${tenantId}.example.test`);
    expect(redirect.pathname).toBe('/auth/social/google/complete');
    expect(ref).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    const key = `${SOCIAL_REF_REDIS_PREFIX}${ref}`;
    createdKeys.add(key);
    const stored = await redis.get(key);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({
      provider: 'google',
      code,
      tenant_id: tenantId,
      timestamp: expect.any(Number),
    });
    expect(JSON.parse(stored!).timestamp).toBeGreaterThanOrEqual(
      requestStartedAt
    );
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(120);

    await expect(consumeSocialRef(redis, ref!)).resolves.toEqual({
      success: true,
      provider: 'google',
      code,
      tenant_id: tenantId,
    });
    await expect(consumeSocialRef(redis, ref!)).resolves.toEqual({
      success: false,
      error: 'Ref not found or expired',
    });
  });
});
