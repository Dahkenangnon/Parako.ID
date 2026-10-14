import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => {
  const redis = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    quit: vi.fn(),
    unlink: vi.fn(),
  };
  return {
    findProjectRoot: vi.fn(() => '/project'),
    ipKeyGenerator: vi.fn((ip: string) => `ip:${ip}`),
    loadRuntimeEnvironment: vi.fn(),
    operatorAudit: vi.fn(),
    redis,
    redisConstructor: vi.fn(function () {
      return redis;
    }),
  };
});

vi.mock('ioredis', () => ({ Redis: dependencies.redisConstructor }));
vi.mock('express-rate-limit', () => ({
  ipKeyGenerator: dependencies.ipKeyGenerator,
}));
vi.mock('../../../scripts/manage/database.js', () => ({
  findProjectRoot: dependencies.findProjectRoot,
  loadRuntimeEnvironment: dependencies.loadRuntimeEnvironment,
}));
vi.mock('../../../scripts/manage/shared/operator-audit.js', () => ({
  writeOperatorAudit: dependencies.operatorAudit,
}));
vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => false,
}));

import {
  buildBootstrapRateLimitKeys,
  clearBootstrapRateLimit,
  runSecurityCli,
} from '../../../scripts/manage/security.js';

const ORIGINAL_ENV = { ...process.env };

describe('bootstrap rate-limit recovery', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      PARAKO_ROOT: '/project',
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6380',
      REDIS_DATABASE: '2',
      REDIS_PASSWORD: 'redis-password',
      MULTI_TENANCY_ENABLED: 'false',
    };
    dependencies.redis.connect.mockResolvedValue(undefined);
    dependencies.redis.unlink.mockResolvedValue(3);
    dependencies.redis.quit.mockResolvedValue('OK');
    dependencies.operatorAudit.mockResolvedValue(undefined);
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('builds only the exact login buckets for one IP and identifier', () => {
    expect(
      buildBootstrapRateLimitKeys(
        'parako',
        'default',
        '2001:db8::1',
        'Admin@Example.com'
      )
    ).toEqual([
      'parako:default:rl:login:ip:2001:db8::1',
      'parako:default:rl:login-brute-ip:ip:2001:db8::1',
      'parako:default:rl:login-brute-identifier:ip:2001:db8::1:admin@example.com',
    ]);
  });

  it('deletes exact Redis keys, records the operation, and returns a restart requirement', async () => {
    const result = await clearBootstrapRateLimit({
      ip: '192.0.2.10',
      email: 'Admin@Example.com',
      reason: 'Recovering a bootstrap administrator after deployment',
      confirmed: true,
    });

    expect(dependencies.redisConstructor).toHaveBeenCalledWith({
      host: 'redis.internal',
      port: 6380,
      password: 'redis-password',
      db: 2,
      connectTimeout: 5_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: expect.any(Function),
    });
    expect(dependencies.redis.unlink).toHaveBeenCalledWith(
      'parako:default:rl:login:ip:192.0.2.10',
      'parako:default:rl:login-brute-ip:ip:192.0.2.10',
      'parako:default:rl:login-brute-identifier:ip:192.0.2.10:admin@example.com'
    );
    expect(result).toEqual({ deletedKeys: 3, restartRequired: true });
    expect(dependencies.operatorAudit).toHaveBeenNthCalledWith(
      1,
      '/project',
      expect.objectContaining({ status: 'attempt' })
    );
    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({ status: 'success' })
    );
    expect(dependencies.redis.quit).toHaveBeenCalledOnce();
    const redisOptions = (
      dependencies.redisConstructor.mock.calls as unknown[][]
    )[0]?.[0] as {
      retryStrategy: () => null;
    };
    expect(redisOptions.retryStrategy()).toBeNull();
  });

  it('uses a normalized custom prefix and resolves the release root when no override is set', async () => {
    delete process.env.PARAKO_ROOT;

    await clearBootstrapRateLimit({
      ip: '192.0.2.10',
      email: ' Admin@Example.com ',
      reason: ' Recovering\na bootstrap administrator ',
      prefix: ' custom-prefix ',
      confirmed: true,
    });

    expect(dependencies.findProjectRoot).toHaveBeenCalledWith(
      expect.stringContaining('/scripts/manage')
    );
    expect(dependencies.redis.unlink).toHaveBeenCalledWith(
      'custom-prefix:default:rl:login:ip:192.0.2.10',
      'custom-prefix:default:rl:login-brute-ip:ip:192.0.2.10',
      'custom-prefix:default:rl:login-brute-identifier:ip:192.0.2.10:admin@example.com'
    );
    expect(dependencies.operatorAudit).toHaveBeenNthCalledWith(
      1,
      '/project',
      expect.objectContaining({
        reason: 'Recovering a bootstrap administrator',
      })
    );
  });

  it.each([
    [
      { ip: 'not-an-ip', email: 'admin@example.com', confirmed: true },
      'valid IPv4 or IPv6',
    ],
    [{ ip: '192.0.2.10', email: 'invalid', confirmed: true }, 'valid email'],
    [
      { ip: '192.0.2.10', email: 'admin@example.com', confirmed: false },
      '--yes',
    ],
  ])('rejects unsafe input before connecting %#', async (input, message) => {
    await expect(
      clearBootstrapRateLimit({
        ...input,
        reason: 'Authorized bootstrap recovery operation',
      })
    ).rejects.toThrow(message);
    expect(dependencies.redisConstructor).not.toHaveBeenCalled();
    expect(dependencies.operatorAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['short', undefined],
    ['x'.repeat(501), undefined],
    ['Authorized bootstrap recovery operation', 'invalid prefix'],
  ])('rejects an unsafe reason or Redis prefix %#', async (reason, prefix) => {
    await expect(
      clearBootstrapRateLimit({
        ip: '192.0.2.10',
        email: 'admin@example.com',
        reason,
        prefix,
        confirmed: true,
      })
    ).rejects.toThrow(prefix ? '--prefix' : '--reason');
    expect(dependencies.redisConstructor).not.toHaveBeenCalled();
  });

  it('refuses multi-tenant recovery because the tenant scope would be ambiguous', async () => {
    process.env.MULTI_TENANCY_ENABLED = 'true';

    await expect(
      clearBootstrapRateLimit({
        ip: '192.0.2.10',
        email: 'admin@example.com',
        reason: 'Authorized bootstrap recovery operation',
        confirmed: true,
      })
    ).rejects.toThrow('single-tenant');
    expect(dependencies.redisConstructor).not.toHaveBeenCalled();
  });

  it('rejects malformed tenancy configuration before connecting', async () => {
    process.env.MULTI_TENANCY_ENABLED = 'truthy';

    await expect(
      clearBootstrapRateLimit({
        ip: '192.0.2.10',
        email: 'admin@example.com',
        reason: 'Authorized bootstrap recovery operation',
        confirmed: true,
      })
    ).rejects.toThrow('MULTI_TENANCY_ENABLED must be true or false');
    expect(dependencies.redisConstructor).not.toHaveBeenCalled();
  });

  it('records a failed recovery and closes Redis when deletion fails', async () => {
    dependencies.redis.unlink.mockRejectedValueOnce(
      new Error('Redis deletion failed')
    );

    await expect(
      clearBootstrapRateLimit({
        ip: '192.0.2.10',
        email: 'admin@example.com',
        reason: 'Authorized bootstrap recovery operation',
        confirmed: true,
      })
    ).rejects.toThrow('Redis deletion failed');

    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({ status: 'failed' })
    );
    expect(dependencies.redis.quit).toHaveBeenCalledOnce();
  });

  it('disconnects forcefully when graceful Redis shutdown fails', async () => {
    dependencies.redis.quit.mockRejectedValueOnce(new Error('quit failed'));

    await clearBootstrapRateLimit({
      ip: '192.0.2.10',
      email: 'admin@example.com',
      reason: 'Authorized bootstrap recovery operation',
      confirmed: true,
    });

    expect(dependencies.redis.disconnect).toHaveBeenCalledOnce();
  });

  it('runs the security command and reports its operator-facing result', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runSecurityCli([
      'node',
      'parako-security',
      'clear-bootstrap-rate-limit',
      '--ip',
      '192.0.2.10',
      '--email',
      'admin@example.com',
      '--reason',
      'Authorized bootstrap recovery operation',
      '--yes',
    ]);

    expect(consoleLog).toHaveBeenCalledWith(
      'Removed 3 matching Redis rate-limit keys.'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      'The application process must be restarted to clear its in-memory global limiter.'
    );
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [new Error('audit unavailable'), 'audit unavailable'],
    ['audit unavailable', 'audit unavailable'],
  ])('reports command failure safely %#', async (failure, message) => {
    dependencies.operatorAudit.mockRejectedValueOnce(failure);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runSecurityCli([
      'node',
      'parako-security',
      'clear-bootstrap-rate-limit',
      '--ip',
      '192.0.2.10',
      '--email',
      'admin@example.com',
      '--reason',
      'Authorized bootstrap recovery operation',
      '--yes',
    ]);

    expect(consoleError).toHaveBeenCalledWith(
      `Security recovery failed: ${message}`
    );
    expect(process.exitCode).toBe(1);
  });
});
