import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';

export interface QueueRedisOptions {
  host: string;
  port: number;
  password?: string;
  database?: number;
}

/**
 * Check whether Redis is configured AND reachable.
 *
 * @param redisConfig - The `redis` section from BootstrapConfig.
 *   `undefined` when no REDIS_* env vars are set.
 * @returns `{ available: true }` on successful PING, or
 *   `{ available: false, reason }` explaining why.
 */
export async function checkRedisAvailability(
  redisConfig: QueueRedisOptions | undefined
): Promise<{ available: true } | { available: false; reason: string }> {
  if (!redisConfig?.host) {
    return {
      available: false,
      reason: 'Redis is not configured (no REDIS_HOST in environment)',
    };
  }

  let client: Redis | null = null;
  try {
    client = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password || undefined,
      db: redisConfig.database ?? 0,
      connectTimeout: 5_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await client.connect();
    await client.ping();
    return { available: true };
  } catch (err) {
    return {
      available: false,
      reason: `Redis at ${redisConfig.host}:${redisConfig.port} is not reachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (client) {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  }
}

/**
 * Build a BullMQ-compatible Redis options object.
 *
 * BullMQ manages its own internal ioredis connections. We provide
 * connection options rather than a pre-built Redis instance to avoid
 * type conflicts between the project's ioredis version and BullMQ's
 * bundled ioredis types.
 *
 * `maxRetriesPerRequest: null` is mandatory for BullMQ workers —
 * it allows BRPOPLPUSH to block indefinitely without ioredis
 * treating the command as timed-out.
 */
export function buildQueueRedisOptions(opts: QueueRedisOptions): RedisOptions {
  return {
    host: opts.host,
    port: opts.port,
    password: opts.password,
    db: opts.database ?? 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number): number | null {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
  };
}
