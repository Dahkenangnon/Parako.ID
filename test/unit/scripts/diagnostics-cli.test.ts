import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  checkRedisAvailability: vi.fn(),
  findProjectRoot: vi.fn(() => '/project'),
  loadRuntimeEnvironment: vi.fn(),
}));

vi.mock('../../../src/jobs/redis.js', () => ({
  checkRedisAvailability: dependencies.checkRedisAvailability,
}));
vi.mock('../../../scripts/manage/database.js', () => ({
  findProjectRoot: dependencies.findProjectRoot,
  loadRuntimeEnvironment: dependencies.loadRuntimeEnvironment,
}));

import {
  buildProgram,
  checkRedis,
  resolveRedisDiagnosticConfig,
} from '../../../scripts/manage/diagnostics.js';

const ORIGINAL_ENV = { ...process.env };

describe('production diagnostics CLI', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('resolves a valid Redis configuration', () => {
    expect(
      resolveRedisDiagnosticConfig({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6380',
        REDIS_DATABASE: '2',
        REDIS_PASSWORD: 'secret',
      })
    ).toEqual({
      host: 'redis.internal',
      port: 6380,
      database: 2,
      password: 'secret',
    });
  });

  it('fails closed when Redis is not configured', () => {
    expect(() => resolveRedisDiagnosticConfig({})).toThrow(
      'REDIS_HOST is required'
    );
  });

  it('rejects invalid Redis ports and database numbers', () => {
    expect(() =>
      resolveRedisDiagnosticConfig({ REDIS_HOST: 'redis', REDIS_PORT: '0' })
    ).toThrow('REDIS_PORT');
    expect(() =>
      resolveRedisDiagnosticConfig({
        REDIS_HOST: 'redis',
        REDIS_DATABASE: '-1',
      })
    ).toThrow('REDIS_DATABASE');
    expect(() =>
      resolveRedisDiagnosticConfig({
        REDIS_HOST: 'redis',
        REDIS_DATABASE: '9007199254740992',
      })
    ).toThrow('REDIS_DATABASE');
  });

  it('loads the runtime environment and verifies Redis availability', async () => {
    process.env.PARAKO_ROOT = '/deployment';
    process.env.REDIS_HOST = 'redis.internal';
    process.env.REDIS_PORT = '6380';
    dependencies.checkRedisAvailability.mockResolvedValue({ available: true });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await checkRedis();

    expect(dependencies.findProjectRoot).toHaveBeenCalledWith('/deployment');
    expect(dependencies.loadRuntimeEnvironment).toHaveBeenCalledWith(
      '/project'
    );
    expect(dependencies.checkRedisAvailability).toHaveBeenCalledWith({
      host: 'redis.internal',
      port: 6380,
      password: undefined,
      database: 0,
    });
    expect(consoleLog).toHaveBeenCalledWith(
      'Redis is reachable at redis.internal:6380.'
    );
  });

  it('uses the module location and propagates an unavailable Redis reason', async () => {
    delete process.env.PARAKO_ROOT;
    process.env.REDIS_HOST = 'redis.internal';
    dependencies.checkRedisAvailability.mockResolvedValue({
      available: false,
      reason: 'connection refused',
    });

    await expect(checkRedis()).rejects.toThrow('connection refused');
    expect(dependencies.findProjectRoot).toHaveBeenCalledWith(
      expect.stringMatching(/scripts\/manage$/)
    );
  });

  it('registers the Redis production dependency check', () => {
    const program = buildProgram();
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    expect(program.name()).toBe('parako-diagnostics');
    expect(program.description()).toBe(
      'Check required Parako.ID production dependencies'
    );
    expect(program.version()).toBe(packageJson.version);
    expect(program.commands.map(command => command.name())).toEqual(['redis']);
    expect(program.commands[0]?.description()).toBe(
      'Connect to Redis and require a successful PING'
    );
  });
});
