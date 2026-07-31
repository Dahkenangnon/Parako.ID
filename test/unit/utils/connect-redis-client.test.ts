import { describe, expect, it, vi } from 'vitest';
import { createConnectRedisClientAdapter } from '../../../src/utils/connect-redis-client.js';

describe('connect-redis ioredis adapter', () => {
  it('translates node-redis expiration options into an ioredis SET command', async () => {
    const ioredis = {
      set: vi.fn().mockResolvedValue('OK'),
    };
    const client = createConnectRedisClientAdapter(ioredis as never);

    await client.set('parako:session:id', '{}', {
      expiration: { type: 'EX', value: 120 },
    });

    expect(ioredis.set).toHaveBeenCalledWith(
      'parako:session:id',
      '{}',
      'EX',
      120
    );
  });

  it('normalizes node-redis bulk commands and command names', async () => {
    const ioredis = {
      del: vi.fn().mockResolvedValue(2),
      mget: vi.fn().mockResolvedValue(['one', 'two']),
    };
    const client = createConnectRedisClientAdapter(ioredis as never);

    await client.del(['session:one', 'session:two']);
    await client.mGet(['session:one', 'session:two']);

    expect(ioredis.del).toHaveBeenCalledWith('session:one', 'session:two');
    expect(ioredis.mget).toHaveBeenCalledWith('session:one', 'session:two');
  });

  it('adapts node-redis scan iteration to ioredis cursor scans', async () => {
    const ioredis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce(['7', ['session:one']])
        .mockResolvedValueOnce(['0', ['session:two']]),
    };
    const client = createConnectRedisClientAdapter(ioredis as never);
    const batches: string[][] = [];

    for await (const keys of client.scanIterator({
      MATCH: 'session:*',
      COUNT: 100,
    })) {
      batches.push(keys);
    }

    expect(batches).toEqual([['session:one'], ['session:two']]);
    expect(ioredis.scan).toHaveBeenNthCalledWith(
      1,
      '0',
      'MATCH',
      'session:*',
      'COUNT',
      100
    );
    expect(ioredis.scan).toHaveBeenNthCalledWith(
      2,
      '7',
      'MATCH',
      'session:*',
      'COUNT',
      100
    );
  });
});
