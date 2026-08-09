import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis (used by checkRedisAvailability)
vi.mock('ioredis', () => {
  const mockRedis = {
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
  const RedisCtor = vi.fn().mockImplementation(function Redis() {
    return mockRedis;
  });
  return { default: RedisCtor, Redis: RedisCtor };
});

// Mock bullmq
vi.mock('bullmq', () => {
  const mockQueue = {
    name: 'background-tasks',
    add: vi.fn().mockResolvedValue({ id: '1' }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockWorker = {
    name: 'background-tasks',
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return {
    Queue: vi.fn().mockImplementation(function Queue() {
      return mockQueue;
    }),
    Worker: vi.fn().mockImplementation(function Worker() {
      return mockWorker;
    }),
  };
});

describe('Background tasks queue factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates queues and reuses the process-level Redis reachability result', async () => {
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');

    const redisOptions = {
      host: 'localhost',
      port: 6379,
    };
    const queue = await createBackgroundTaskQueue(redisOptions);
    const secondQueue = await createBackgroundTaskQueue({ ...redisOptions });
    const { Redis } = await import('ioredis');
    const { Queue } = await import('bullmq');
    const { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, QUEUE_PREFIX } =
      await import('../../../../src/jobs/config.js');

    expect(queue).toBeDefined();
    expect(queue).toHaveProperty('add');
    expect(secondQueue).toBeDefined();
    expect(Redis).toHaveBeenCalledOnce();
    expect(Queue).toHaveBeenCalledTimes(2);
    expect(Queue).toHaveBeenLastCalledWith(QUEUE_NAMES.BACKGROUND_TASKS, {
      connection: expect.objectContaining({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
      }),
      prefix: QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  });

  it('createBackgroundTaskQueue() returns null when no config provided', async () => {
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');

    const queue = await createBackgroundTaskQueue(undefined);

    expect(queue).toBeNull();
  });

  it('does not let an unconfigured call poison later configured queue creation', async () => {
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');

    await expect(createBackgroundTaskQueue(undefined)).resolves.toBeNull();
    await expect(
      createBackgroundTaskQueue({ host: 'localhost', port: 6379 })
    ).resolves.toHaveProperty('add');
  });

  it('returns null when configured Redis is unreachable', async () => {
    const { Redis } = await import('ioredis');
    vi.mocked(Redis).mockImplementationOnce(function RedisUnavailable() {
      return {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        ping: vi.fn(),
        quit: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as never;
    });
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');

    await expect(
      createBackgroundTaskQueue({ host: 'redis.local', port: 6379 })
    ).resolves.toBeNull();
  });

  it('rechecks reachability when Redis configuration changes', async () => {
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');
    const { Redis } = await import('ioredis');

    await createBackgroundTaskQueue({ host: 'redis.local', port: 6379 });
    await createBackgroundTaskQueue({ host: 'redis.local', port: 6380 });

    expect(Redis).toHaveBeenCalledTimes(2);
  });
});

describe('Background tasks worker factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('createBackgroundTaskWorker() returns a Worker', async () => {
    const { createBackgroundTaskWorker } =
      await import('../../../../src/jobs/domains/background-tasks/worker.js');

    const worker = createBackgroundTaskWorker({
      host: 'localhost',
      port: 6379,
    });
    const { Worker } = await import('bullmq');
    const { DEFAULT_WORKER_OPTIONS, QUEUE_NAMES, QUEUE_PREFIX } =
      await import('../../../../src/jobs/config.js');

    expect(worker).toBeDefined();
    expect(worker).toHaveProperty('close');
    expect(Worker).toHaveBeenCalledWith(
      QUEUE_NAMES.BACKGROUND_TASKS,
      expect.any(Function),
      {
        connection: expect.objectContaining({
          host: 'localhost',
          port: 6379,
          maxRetriesPerRequest: null,
        }),
        prefix: QUEUE_PREFIX,
        concurrency: DEFAULT_WORKER_OPTIONS.concurrency,
        lockDuration: DEFAULT_WORKER_OPTIONS.lockDuration,
        stalledInterval: DEFAULT_WORKER_OPTIONS.stalledInterval,
      }
    );
  });

  it('registerTaskHandler() registers a handler that can be retrieved', async () => {
    const { registerTaskHandler, getTaskHandler } =
      await import('../../../../src/jobs/domains/background-tasks/worker.js');

    const handler = vi.fn().mockResolvedValue({ ok: true });
    registerTaskHandler('test-task', handler);

    const retrieved = getTaskHandler('test-task');
    expect(retrieved).toBe(handler);
  });
});
