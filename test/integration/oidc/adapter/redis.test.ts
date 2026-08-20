import { randomBytes, randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, vi } from 'vitest';

import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';
import { RedisOidcAdminService } from '../../../../src/oidc/adapter/redis/admin-service.js';
import { defineOidcClientAdminContract } from '../../../contract/support/oidc-client-admin-contract.js';

const keyPrefix = `parako-oidc-contract-${process.pid}-${randomUUID()}`;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;
let redis: Redis;

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

function createRedisClient(): Redis {
  const configuredUrl = process.env.TEST_REDIS_URL?.trim();
  const commonOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  } as const;
  if (configuredUrl) return new Redis(configuredUrl, commonOptions);

  return new Redis({
    ...commonOptions,
    host:
      process.env.PARAKO_E2E_REDIS_HOST ??
      process.env.REDIS_HOST ??
      '127.0.0.1',
    port: Number(
      process.env.PARAKO_E2E_REDIS_PORT ?? process.env.REDIS_PORT ?? 6379
    ),
    db: Number(process.env.PARAKO_E2E_REDIS_DATABASE ?? 0),
    password:
      process.env.PARAKO_E2E_REDIS_PASSWORD ?? process.env.REDIS_PASSWORD,
  });
}

async function clearContractKeys(): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${keyPrefix}:*`,
      'COUNT',
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) await redis.unlink(...keys);
  } while (cursor !== '0');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
});

afterAll(async () => {
  if (originalEncryptionKey) {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  } else {
    delete process.env.ENCRYPTION_KEY;
  }
});

defineOidcClientAdminContract({
  backend: 'Redis',
  async createHarness() {
    redis = createRedisClient();
    await redis.connect();
    await redis.ping();
    return {
      client: new RedisOidcAdminService(
        'Client',
        redis,
        createLogger(),
        keyPrefix
      ),
      supportsTenantIsolation: true,
      reset: clearContractKeys,
      runAsTenant: (tenantId, operation) =>
        tenantContext.run(tenantId, operation),
      async close() {
        await clearContractKeys();
        if (redis.status === 'ready') {
          await redis.quit();
        } else {
          redis.disconnect();
        }
      },
    };
  },
});
