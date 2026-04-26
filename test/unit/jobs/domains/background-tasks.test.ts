import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis (used by checkRedisAvailability)
vi.mock('ioredis', () => {
  const mockRedis = {
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
  return { default: vi.fn().mockImplementation(() => mockRedis) };
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
    Queue: vi.fn().mockImplementation(() => mockQueue),
    Worker: vi.fn().mockImplementation(() => mockWorker),
  };
});

describe('Background tasks queue factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('createBackgroundTaskQueue() returns a Queue when Redis is reachable', async () => {
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');

    const queue = await createBackgroundTaskQueue({
      host: 'localhost',
      port: 6379,
    });

    expect(queue).toBeDefined();
    expect(queue).toHaveProperty('add');
  });

  it('createBackgroundTaskQueue() returns null when no config provided', async () => {
    const { createBackgroundTaskQueue } =
      await import('../../../../src/jobs/domains/background-tasks/queue.js');

    const queue = await createBackgroundTaskQueue(undefined);

    expect(queue).toBeNull();
  });
});

describe('Background tasks worker factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('createBackgroundTaskWorker() returns a Worker', async () => {
    const { createBackgroundTaskWorker } =
      await import('../../../../src/jobs/domains/background-tasks/worker.js');

    const worker = createBackgroundTaskWorker({
      host: 'localhost',
      port: 6379,
    });

    expect(worker).toBeDefined();
    expect(worker).toHaveProperty('close');
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
