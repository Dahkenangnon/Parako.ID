import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redisClient, Redis } = vi.hoisted(() => {
  const client = {
    connect: vi.fn(),
    ping: vi.fn(),
    quit: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    redisClient: client,
    Redis: vi.fn(function RedisMock(_options?: { retryStrategy: () => null }) {
      return client;
    }),
  };
});

vi.mock('ioredis', () => ({ Redis }));

import {
  buildQueueRedisOptions,
  checkRedisAvailability,
} from '../../../src/jobs/redis.js';

describe('jobs Redis utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisClient.connect.mockResolvedValue(undefined);
    redisClient.ping.mockResolvedValue('PONG');
    redisClient.quit.mockResolvedValue(undefined);
  });

  it('reports an explicit reason when Redis is not configured', async () => {
    await expect(checkRedisAvailability(undefined)).resolves.toEqual({
      available: false,
      reason: 'Redis is not configured (no REDIS_HOST in environment)',
    });
    await expect(
      checkRedisAvailability({ host: '', port: 6379 })
    ).resolves.toEqual({
      available: false,
      reason: 'Redis is not configured (no REDIS_HOST in environment)',
    });
    expect(Redis).not.toHaveBeenCalled();
  });

  it('connects, pings, and cleanly quits a configured Redis instance', async () => {
    await expect(
      checkRedisAvailability({
        host: 'redis.local',
        port: 6380,
        password: 'secret',
        database: 2,
      })
    ).resolves.toEqual({ available: true });

    expect(Redis).toHaveBeenCalledWith({
      host: 'redis.local',
      port: 6380,
      password: 'secret',
      db: 2,
      connectTimeout: 5_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: expect.any(Function),
    });
    expect(redisClient.connect).toHaveBeenCalledOnce();
    expect(redisClient.ping).toHaveBeenCalledOnce();
    expect(redisClient.quit).toHaveBeenCalledOnce();
    const constructorOptions = Redis.mock.calls[0]![0]!;
    expect(constructorOptions.retryStrategy()).toBeNull();
  });

  it('normalizes an empty password and absent database for the probe', async () => {
    await checkRedisAvailability({
      host: 'redis.local',
      port: 6379,
      password: '',
    });

    expect(Redis).toHaveBeenCalledWith(
      expect.objectContaining({ password: undefined, db: 0 })
    );
  });

  it.each([
    [new Error('connection refused'), 'connection refused'],
    ['socket closed', 'socket closed'],
  ])(
    'reports probe failure %# and still closes the client',
    async (failure, message) => {
      redisClient.connect.mockRejectedValue(failure);

      await expect(
        checkRedisAvailability({ host: 'redis.local', port: 6379 })
      ).resolves.toEqual({
        available: false,
        reason: `Redis at redis.local:6379 is not reachable: ${message}`,
      });
      expect(redisClient.ping).not.toHaveBeenCalled();
      expect(redisClient.quit).toHaveBeenCalledOnce();
    }
  );

  it('reports constructor failures without attempting cleanup on a missing client', async () => {
    Redis.mockImplementationOnce(function RedisFailure() {
      throw new Error('invalid Redis options');
    });

    await expect(
      checkRedisAvailability({ host: 'redis.local', port: 6379 })
    ).resolves.toEqual({
      available: false,
      reason:
        'Redis at redis.local:6379 is not reachable: invalid Redis options',
    });
    expect(redisClient.quit).not.toHaveBeenCalled();
    expect(redisClient.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects forcefully when graceful probe cleanup fails', async () => {
    redisClient.quit.mockRejectedValue(new Error('quit failed'));

    await expect(
      checkRedisAvailability({ host: 'redis.local', port: 6379 })
    ).resolves.toEqual({ available: true });

    expect(redisClient.disconnect).toHaveBeenCalledOnce();
  });

  it('builds BullMQ-compatible connection options', () => {
    const opts = buildQueueRedisOptions({
      host: 'redis.local',
      port: 6380,
      password: 'secret',
      database: 2,
    });

    expect(opts).toMatchObject({
      host: 'redis.local',
      port: 6380,
      password: 'secret',
      db: 2,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: expect.any(Function),
    });
  });

  it('defaults the BullMQ database and applies bounded retry backoff', () => {
    const opts = buildQueueRedisOptions({ host: 'localhost', port: 6379 });
    const strategy = opts.retryStrategy!;

    expect(opts.db).toBe(0);
    expect(strategy(1)).toBe(200);
    expect(strategy(5)).toBe(1000);
    expect(strategy(30)).toBeNull();
  });
});
