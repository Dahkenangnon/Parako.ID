import { describe, it, expect } from 'vitest';
import { buildQueueRedisOptions } from '../../../src/jobs/redis.js';

describe('Jobs Redis options builder', () => {
  it('returns an options object with the provided host and port', () => {
    const opts = buildQueueRedisOptions({ host: 'redis.local', port: 6380 });

    expect(opts.host).toBe('redis.local');
    expect(opts.port).toBe(6380);
  });

  it('sets maxRetriesPerRequest to null (required by BullMQ)', () => {
    const opts = buildQueueRedisOptions({ host: 'localhost', port: 6379 });

    expect(opts.maxRetriesPerRequest).toBeNull();
  });

  it('includes password and database when provided', () => {
    const opts = buildQueueRedisOptions({
      host: 'localhost',
      port: 6379,
      password: 's3cret',
      database: 2,
    });

    expect(opts.password).toBe('s3cret');
    expect(opts.db).toBe(2);
  });

  it('defaults database to 0 when not provided', () => {
    const opts = buildQueueRedisOptions({ host: 'localhost', port: 6379 });

    expect(opts.db).toBe(0);
  });

  it('includes a retryStrategy function', () => {
    const opts = buildQueueRedisOptions({ host: 'localhost', port: 6379 });

    expect(opts.retryStrategy).toBeInstanceOf(Function);
  });

  it('retryStrategy returns null after 10 attempts', () => {
    const opts = buildQueueRedisOptions({ host: 'localhost', port: 6379 });
    const strategy = opts.retryStrategy!;

    expect(strategy(1)).toBe(200);
    expect(strategy(5)).toBe(1000);
    expect(strategy(11)).toBeNull();
  });
});
