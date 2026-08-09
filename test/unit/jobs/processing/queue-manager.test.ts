import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueManager } from '../../../../src/jobs/processing/queue-manager.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createQueue(counts: Record<string, number | undefined> = {}) {
  return {
    getJobCounts: vi.fn().mockResolvedValue(counts),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('QueueManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers queues and exposes their names and instances', () => {
    const manager = new QueueManager(logger as never);
    const first = createQueue();
    const second = createQueue();

    manager.registerQueue('first', first as never);
    manager.registerQueue('second', second as never);

    expect(manager.getQueue('first')).toBe(first);
    expect(manager.getQueue('missing')).toBeUndefined();
    expect(manager.getQueueNames()).toEqual(['first', 'second']);
    expect(logger.debug).toHaveBeenCalledWith('Queue registered: first', {
      component: 'QueueManager',
    });
  });

  it('warns and exposes the replacement when a queue name is registered twice', () => {
    const manager = new QueueManager(logger as never);
    const original = createQueue();
    const replacement = createQueue();

    manager.registerQueue('duplicate', original as never);
    manager.registerQueue('duplicate', replacement as never);

    expect(manager.getQueue('duplicate')).toBe(replacement);
    expect(manager.getQueueNames()).toEqual(['duplicate']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Queue "duplicate" already registered, replacing',
      { component: 'QueueManager' }
    );
  });

  it('collects all requested counts and defaults missing BullMQ counters to zero', async () => {
    const manager = new QueueManager(logger as never);
    const complete = createQueue({
      waiting: 1,
      active: 2,
      completed: 3,
      failed: 4,
      delayed: 5,
    });
    const sparse = createQueue({ waiting: undefined });
    manager.registerQueue('complete', complete as never);
    manager.registerQueue('sparse', sparse as never);

    await expect(manager.getStats()).resolves.toEqual({
      complete: { waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 },
      sparse: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
    });
    expect(complete.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed'
    );
  });

  it('continues collecting stats and logs Error and non-Error failures', async () => {
    const manager = new QueueManager(logger as never);
    const errorQueue = createQueue();
    const stringQueue = createQueue();
    const healthyQueue = createQueue({ active: 1 });
    errorQueue.getJobCounts.mockRejectedValue(new Error('redis down'));
    stringQueue.getJobCounts.mockRejectedValue('connection gone');
    manager.registerQueue('error-queue', errorQueue as never);
    manager.registerQueue('string-queue', stringQueue as never);
    manager.registerQueue('healthy-queue', healthyQueue as never);

    await expect(manager.getStats()).resolves.toEqual({
      'healthy-queue': {
        waiting: 0,
        active: 1,
        completed: 0,
        failed: 0,
        delayed: 0,
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to get stats for queue "error-queue": redis down',
      { component: 'QueueManager' }
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to get stats for queue "string-queue": connection gone',
      { component: 'QueueManager' }
    );
  });

  it('closes every queue, clears the registry, and logs clean shutdown', async () => {
    const manager = new QueueManager(logger as never);
    const first = createQueue();
    const second = createQueue();
    manager.registerQueue('first', first as never);
    manager.registerQueue('second', second as never);

    await manager.closeAll();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(manager.getQueueNames()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Some queues failed to close cleanly',
      expect.anything()
    );
    expect(logger.info).toHaveBeenCalledWith('All queues closed', {
      component: 'QueueManager',
    });
  });

  it('continues closing queues and reports Error and non-Error failures', async () => {
    const manager = new QueueManager(logger as never);
    const errorQueue = createQueue();
    const stringQueue = createQueue();
    const healthyQueue = createQueue();
    errorQueue.close.mockRejectedValue(new Error('close failed'));
    stringQueue.close.mockRejectedValue('connection gone');
    manager.registerQueue('error-queue', errorQueue as never);
    manager.registerQueue('string-queue', stringQueue as never);
    manager.registerQueue('healthy-queue', healthyQueue as never);

    await manager.closeAll();

    expect(healthyQueue.close).toHaveBeenCalledOnce();
    expect(manager.getQueueNames()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Some queues failed to close cleanly',
      {
        component: 'QueueManager',
        errors: [
          { name: 'error-queue', error: 'close failed' },
          { name: 'string-queue', error: 'connection gone' },
        ],
      }
    );
    expect(logger.info).toHaveBeenCalledWith('All queues closed', {
      component: 'QueueManager',
    });
  });
});
