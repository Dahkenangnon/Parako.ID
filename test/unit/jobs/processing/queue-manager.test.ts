import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bullmq
vi.mock('bullmq', () => {
  const mockQueue = {
    name: 'test-queue',
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: 1,
      active: 2,
      completed: 10,
      failed: 0,
      delayed: 0,
    }),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    obliterate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Queue: vi.fn().mockImplementation(() => ({ ...mockQueue })),
  };
});

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
  getLogger: vi.fn(),
  flush: vi.fn(),
  shutdown: vi.fn(),
};

describe('QueueManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registerQueue() and getQueue() store and retrieve a queue', async () => {
    const { QueueManager } =
      await import('../../../../src/jobs/processing/queue-manager.js');

    const mgr = new QueueManager(mockLogger);
    const { Queue } = await import('bullmq');
    const queue = new Queue('test');

    mgr.registerQueue('test', queue);
    expect(mgr.getQueue('test')).toBe(queue);
  });

  it('getQueueNames() returns all registered queue names', async () => {
    const { QueueManager } =
      await import('../../../../src/jobs/processing/queue-manager.js');

    const mgr = new QueueManager(mockLogger);
    const { Queue } = await import('bullmq');

    mgr.registerQueue('a', new Queue('a'));
    mgr.registerQueue('b', new Queue('b'));

    expect(mgr.getQueueNames()).toEqual(['a', 'b']);
  });

  it('getStats() returns job counts for all registered queues', async () => {
    const { QueueManager } =
      await import('../../../../src/jobs/processing/queue-manager.js');

    const mgr = new QueueManager(mockLogger);
    const { Queue } = await import('bullmq');
    const queue = new Queue('test');

    mgr.registerQueue('test', queue);

    const stats = await mgr.getStats();
    expect(stats).toHaveProperty('test');
    expect(stats.test.active).toBe(2);
    expect(stats.test.waiting).toBe(1);
  });

  it('closeAll() closes all registered queues and clears the registry', async () => {
    const { QueueManager } =
      await import('../../../../src/jobs/processing/queue-manager.js');

    const mgr = new QueueManager(mockLogger);
    const { Queue } = await import('bullmq');
    const queue = new Queue('test');

    mgr.registerQueue('test', queue);
    await mgr.closeAll();

    expect(queue.close).toHaveBeenCalled();
    expect(mgr.getQueueNames()).toEqual([]);
  });

  it('logs a warning when replacing an already-registered queue', async () => {
    const { QueueManager } =
      await import('../../../../src/jobs/processing/queue-manager.js');

    const mgr = new QueueManager(mockLogger);
    const { Queue } = await import('bullmq');

    mgr.registerQueue('dup', new Queue('dup'));
    mgr.registerQueue('dup', new Queue('dup'));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already registered'),
      expect.any(Object)
    );
  });
});
