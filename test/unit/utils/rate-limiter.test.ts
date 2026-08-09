import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const createdHandlers: ReturnType<typeof vi.fn>[] = [];
  const redisInstances: Array<{
    connect: ReturnType<typeof vi.fn>;
    call: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    createdHandlers,
    redisInstances,
    rateLimit: vi.fn((_options: unknown) => {
      const handler = Object.assign(vi.fn(), {
        resetKey: vi.fn(),
        getKey: vi.fn().mockResolvedValue({ totalHits: 1 }),
      });
      createdHandlers.push(handler);
      return handler;
    }),
    ipKeyGenerator: vi.fn((ip: string) => `ip:${ip}`),
    RedisStore: vi.fn(function MockRedisStore(options: unknown) {
      return { options };
    }),
    Redis: vi.fn(function MockRedis() {
      const instance = {
        connect: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      };
      redisInstances.push(instance);
      return instance;
    }),
    buildRedisKey: vi.fn(
      (base: string, category: string, name: string, key: string) =>
        `${base}:default:${category}:${name}:${key}`
    ),
  };
});

vi.mock('express-rate-limit', () => ({
  default: mocks.rateLimit,
  ipKeyGenerator: mocks.ipKeyGenerator,
}));

vi.mock('rate-limit-redis', () => ({ RedisStore: mocks.RedisStore }));
vi.mock('ioredis', () => ({ Redis: mocks.Redis }));
vi.mock('../../../src/multi-tenancy/redis-key.js', () => ({
  buildRedisKey: mocks.buildRedisKey,
}));

async function loadRateLimiter(environment: 'development' | 'production') {
  process.env.NODE_ENV = environment;
  vi.resetModules();
  return import('../../../src/utils/rate-limiter.js');
}

describe('centralized rate limiter', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createdHandlers.length = 0;
    mocks.redisInstances.length = 0;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('binds an exported limiter to Redis after startup initialization', async () => {
    const rateLimiters = await loadRateLimiter('production');
    const logger = { info: vi.fn(), warn: vi.fn() };

    await rateLimiters.initRateLimitRedis(
      'redis://redis.example:6379/0',
      'deployment',
      logger
    );
    rateLimiters.loginLimiter(
      { ip: '203.0.113.10' } as Request,
      { locals: {} } as Response,
      vi.fn() as NextFunction
    );

    expect(mocks.RedisStore).toHaveBeenCalledTimes(12);
    expect(mocks.rateLimit.mock.calls[12]?.[0]).toEqual(
      expect.objectContaining({ max: 5, store: expect.any(Object) })
    );
    expect(mocks.createdHandlers[12]).toHaveBeenCalledOnce();
  });

  it('configures every static limiter with its documented development budget', async () => {
    const rateLimiters = await loadRateLimiter('development');
    const request = { ip: '203.0.113.10', body: {} } as Request;
    const response = { locals: {} } as Response;
    const next = vi.fn() as NextFunction;
    const definitions = [
      [rateLimiters.loginLimiter, 15 * 60_000, 50],
      [rateLimiters.loginBruteForceByIdentifierAndIp, 60 * 60_000, 50],
      [rateLimiters.loginBruteForceByIp, 24 * 60 * 60_000, 1000],
      [rateLimiters.registerLimiter, 60 * 60_000, 30],
      [rateLimiters.mfaVerifyLimiter, 15 * 60_000, 50],
      [rateLimiters.socialLoginLimiter, 5 * 60_000, 100],
      [rateLimiters.recoveryLimiter, 15 * 60_000, 50],
      [rateLimiters.forgotPasswordLimiter, 15 * 60_000, 30],
      [rateLimiters.changePasswordLimiter, 15 * 60_000, 50],
      [rateLimiters.configUpdateLimiter, 5 * 60_000, 200],
      [rateLimiters.testEmailLimiter, 60_000, 30],
      [rateLimiters.revealSecretLimiter, 60_000, 100],
    ] as const;

    definitions.forEach(([limiter, windowMs, max], index) => {
      limiter(request, response, next);
      expect(mocks.rateLimit.mock.calls[index]?.[0]).toEqual(
        expect.objectContaining({
          windowMs,
          max,
          standardHeaders: true,
          legacyHeaders: false,
        })
      );
      expect(mocks.createdHandlers[index]).toHaveBeenCalledOnce();
    });

    expect(mocks.rateLimit).toHaveBeenCalledTimes(definitions.length);
    expect(mocks.RedisStore).not.toHaveBeenCalled();
  });

  it('delegates reset and lookup operations to one lazily created limiter', async () => {
    const rateLimiters = await loadRateLimiter('development');

    rateLimiters.registerLimiter.resetKey('client-key');
    await expect(
      rateLimiters.registerLimiter.getKey('client-key')
    ).resolves.toEqual({ totalHits: 1 });
    rateLimiters.registerLimiter(
      { ip: '203.0.113.10' } as Request,
      { locals: {} } as Response,
      vi.fn() as NextFunction
    );

    const handler = mocks.createdHandlers[3] as any;
    expect(mocks.rateLimit).toHaveBeenCalledTimes(12);
    expect(handler.resetKey).toHaveBeenCalledWith('client-key');
    expect(handler.getKey).toHaveBeenCalledWith('client-key');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('builds normalized IP and identifier keys for login protection', async () => {
    const rateLimiters = await loadRateLimiter('production');
    rateLimiters.loginLimiter(
      { ip: undefined } as Request,
      { locals: {} } as Response,
      vi.fn() as NextFunction
    );
    const ipOnlyOptions = mocks.rateLimit.mock.calls[0]?.[0] as any;

    expect(ipOnlyOptions.keyGenerator({ ip: undefined })).toBe(
      'parako:default:rl:login:ip:127.0.0.1'
    );

    rateLimiters.loginBruteForceByIdentifierAndIp(
      { ip: '203.0.113.10', body: {} } as Request,
      { locals: {} } as Response,
      vi.fn() as NextFunction
    );
    const identifierOptions = mocks.rateLimit.mock.calls[1]?.[0] as any;

    expect(
      identifierOptions.keyGenerator({
        ip: '203.0.113.10',
        body: { login: '  User@Example.Test ' },
      })
    ).toBe(
      'parako:default:rl:login-brute-identifier:ip:203.0.113.10:user@example.test'
    );
    expect(
      identifierOptions.keyGenerator({
        ip: '203.0.113.10',
        body: { login: '   ' },
      })
    ).toContain(':missing');
    expect(
      identifierOptions.keyGenerator({
        ip: '203.0.113.10',
        body: { login: 42 },
      })
    ).toContain(':missing');
    expect(identifierOptions.skipSuccessfulRequests).toBe(true);
    expect(identifierOptions.requestWasSuccessful({}, { locals: {} })).toBe(
      true
    );
    expect(
      identifierOptions.requestWasSuccessful(
        {},
        { locals: { [rateLimiters.LOGIN_FAILED_RES_LOCAL]: true } }
      )
    ).toBe(false);
  });

  it('returns the standard JSON throttle response from a configured limiter', async () => {
    const rateLimiters = await loadRateLimiter('production');
    rateLimiters.loginLimiter(
      { ip: '203.0.113.10' } as Request,
      { locals: {} } as Response,
      vi.fn() as NextFunction
    );
    const options = mocks.rateLimit.mock.calls[0]?.[0] as any;
    const response = {
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);

    options.handler({}, response, vi.fn(), {
      message: 'Configured limit reached',
    });

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'Configured limit reached',
      retryAfter: 900,
    });
  });

  it('creates a relaxed global limiter in development', async () => {
    const rateLimiters = await loadRateLimiter('development');

    rateLimiters.createGlobalLimiter({
      windowMinutes: 2,
      requestsPerMinute: 7,
    });

    expect(mocks.rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        windowMs: 120_000,
        max: 700,
        message: 'Too many requests. Please try again after 2 minutes.',
      })
    );
  });

  it('adapts Redis commands for a limiter created after initialization', async () => {
    const rateLimiters = await loadRateLimiter('production');
    await rateLimiters.initRateLimitRedis(
      'redis://redis.example:6379/0',
      undefined,
      { info: vi.fn(), warn: vi.fn() }
    );

    rateLimiters.createGlobalLimiter({
      windowMinutes: 1,
      requestsPerMinute: 10,
    });
    const storeOptions = mocks.RedisStore.mock.calls.at(-1)?.[0] as any;
    await storeOptions.sendCommand('INCR', 'rate-key');

    expect(storeOptions.prefix).toBe('');
    expect(mocks.redisInstances[0]?.call).toHaveBeenCalledWith(
      'INCR',
      'rate-key'
    );
  });

  it('updates tenant key defaults without connecting Redis in development', async () => {
    const rateLimiters = await loadRateLimiter('development');

    await rateLimiters.initRateLimitRedis(
      'redis://redis.example:6379/0',
      'custom'
    );

    expect(mocks.Redis).not.toHaveBeenCalled();
    expect(rateLimiters.getRateLimitRedisClient()).toBeNull();
    expect(rateLimiters.createTenantAwareKeyGenerator('login')('ip-key')).toBe(
      'custom:default:rl:login:ip-key'
    );
    expect(
      rateLimiters.createTenantAwareKeyGenerator('login', 'explicit')('ip-key')
    ).toBe('explicit:default:rl:login:ip-key');
    expect(rateLimiters.getRateLimiterStorePrefix('login', 'base')).toBe(
      'base:default:rl:login:'
    );
  });

  it('does not allocate Redis in production without a URL', async () => {
    const rateLimiters = await loadRateLimiter('production');

    await rateLimiters.initRateLimitRedis(undefined, '');

    expect(mocks.Redis).not.toHaveBeenCalled();
    expect(rateLimiters.getRateLimitRedisClient()).toBeNull();
  });

  it('disconnects a failed Redis client before falling back to memory', async () => {
    const failedClient = {
      connect: vi.fn().mockRejectedValue(new Error('connection refused')),
      call: vi.fn(),
      disconnect: vi.fn(),
    };
    mocks.Redis.mockImplementationOnce(function MockFailedRedis() {
      mocks.redisInstances.push(failedClient);
      return failedClient;
    });
    const rateLimiters = await loadRateLimiter('production');
    const logger = { info: vi.fn(), warn: vi.fn() };

    await rateLimiters.initRateLimitRedis(
      'redis://redis.example:6379/0',
      'deployment',
      logger
    );

    expect(failedClient.disconnect).toHaveBeenCalledOnce();
    expect(rateLimiters.getRateLimitRedisClient()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Rate-limiter Redis connection failed; falling back to in-memory store',
      {
        component: 'rate-limiter',
        err: 'connection refused',
      }
    );
  });

  it('reports primitive connection and cleanup failures while falling back', async () => {
    const failedClient = {
      connect: vi.fn().mockRejectedValue('offline'),
      call: vi.fn(),
      disconnect: vi.fn(() => {
        throw 'cleanup failed';
      }),
    };
    mocks.Redis.mockImplementationOnce(function MockFailedRedis() {
      mocks.redisInstances.push(failedClient);
      return failedClient;
    });
    const rateLimiters = await loadRateLimiter('production');
    const logger = { info: vi.fn(), warn: vi.fn() };

    await rateLimiters.initRateLimitRedis(
      'redis://redis.example:6379/0',
      undefined,
      logger
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to clean up Rate-limiter Redis client',
      { component: 'rate-limiter', err: 'cleanup failed' }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Rate-limiter Redis connection failed; falling back to in-memory store',
      { component: 'rate-limiter', err: 'offline' }
    );
    expect(rateLimiters.getRateLimitRedisClient()).toBeNull();
  });

  it('reports an Error thrown while cleaning up a failed Redis client', async () => {
    const failedClient = {
      connect: vi.fn().mockRejectedValue(new Error('offline')),
      call: vi.fn(),
      disconnect: vi.fn(() => {
        throw new Error('cleanup failed');
      }),
    };
    mocks.Redis.mockImplementationOnce(function MockFailedRedis() {
      mocks.redisInstances.push(failedClient);
      return failedClient;
    });
    const rateLimiters = await loadRateLimiter('production');
    const logger = { info: vi.fn(), warn: vi.fn() };

    await rateLimiters.initRateLimitRedis(
      'redis://redis.example:6379/0',
      undefined,
      logger
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to clean up Rate-limiter Redis client',
      { component: 'rate-limiter', err: 'cleanup failed' }
    );
  });

  it('falls back when Redis construction itself throws', async () => {
    mocks.Redis.mockImplementationOnce(function MockInvalidRedis() {
      throw new Error('invalid Redis URL');
    });
    const rateLimiters = await loadRateLimiter('production');
    const logger = { info: vi.fn(), warn: vi.fn() };

    await rateLimiters.initRateLimitRedis('not-a-redis-url', undefined, logger);

    expect(rateLimiters.getRateLimitRedisClient()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Rate-limiter Redis connection failed; falling back to in-memory store',
      { component: 'rate-limiter', err: 'invalid Redis URL' }
    );
  });
});
