import type { Redis } from 'ioredis';

type ExpirationType = 'EX' | 'PX' | 'EXAT' | 'PXAT';

interface ConnectRedisSetOptions {
  readonly expiration?: {
    readonly type: ExpirationType;
    readonly value: number;
  };
}

interface ConnectRedisScanOptions {
  readonly MATCH: string;
  readonly COUNT: number;
}

/**
 * The current connect-redis release uses the node-redis command API, while
 * the rest of Parako.ID deliberately uses ioredis. Keep one Redis connection
 * and translate the small command surface connect-redis needs instead of
 * passing an incompatible client through and producing malformed SET calls.
 */
export function createConnectRedisClientAdapter(client: Redis) {
  return {
    get: (key: string) => client.get(key),

    set: (key: string, value: string, options?: ConnectRedisSetOptions) => {
      const expiration = options?.expiration;
      if (!expiration) return client.set(key, value);

      switch (expiration.type) {
        case 'EX':
          return client.set(key, value, 'EX', expiration.value);
        case 'PX':
          return client.set(key, value, 'PX', expiration.value);
        case 'EXAT':
          return client.set(key, value, 'EXAT', expiration.value);
        case 'PXAT':
          return client.set(key, value, 'PXAT', expiration.value);
        default:
          throw new Error(
            `Unsupported Redis expiration type: ${String(
              (expiration as { type: unknown }).type
            )}`
          );
      }
    },

    expire: (key: string, seconds: number) => client.expire(key, seconds),

    del: (keys: string | readonly string[]) => {
      const normalized = typeof keys === 'string' ? [keys] : [...keys];
      return client.del(...normalized);
    },

    mGet: (keys: readonly string[]) => client.mget(...keys),

    async *scanIterator(options: ConnectRedisScanOptions) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          options.MATCH,
          'COUNT',
          options.COUNT
        );
        cursor = nextCursor;
        yield keys;
      } while (cursor !== '0');
    },
  };
}
