import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisBoundary = vi.hoisted(() => ({
  constructor: vi.fn(),
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('ioredis', () => ({
  Redis: class Redis {
    readonly connect = vi.fn().mockResolvedValue(undefined);
    readonly ping = vi.fn().mockResolvedValue('PONG');

    constructor(...args: unknown[]) {
      redisBoundary.constructor(...args);
      redisBoundary.instances.push(this);
    }
  },
}));

import { connectRedis } from '../../../../../src/oidc/adapter/redis/index.js';

describe('connectRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisBoundary.instances.length = 0;
  });

  it('constructs and explicitly connects a lazy URI client', async () => {
    const client = await connectRedis({ uri: 'redis://redis.internal:6379/2' });

    expect(redisBoundary.constructor).toHaveBeenCalledWith(
      'redis://redis.internal:6379/2',
      { lazyConnect: true }
    );
    expect(redisBoundary.instances[0].connect).toHaveBeenCalledOnce();
    expect(redisBoundary.instances[0].ping).toHaveBeenCalledOnce();
    expect(client).toBe(redisBoundary.instances[0]);
  });

  it('constructs the default client and verifies it without reconnecting', async () => {
    const client = await connectRedis();

    expect(redisBoundary.constructor).toHaveBeenCalledWith();
    expect(redisBoundary.instances[0].connect).not.toHaveBeenCalled();
    expect(redisBoundary.instances[0].ping).toHaveBeenCalledOnce();
    expect(client).toBe(redisBoundary.instances[0]);
  });
});
