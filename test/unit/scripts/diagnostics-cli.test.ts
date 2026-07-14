import { afterEach, describe, expect, it } from 'vitest';
import { resolveRedisDiagnosticConfig } from '../../../scripts/manage/diagnostics.js';

const ORIGINAL_ENV = { ...process.env };

describe('production diagnostics CLI', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
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
  });
});
