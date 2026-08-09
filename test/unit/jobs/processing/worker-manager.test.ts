import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerManager } from '../../../../src/jobs/processing/worker-manager.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createWorker() {
  const listeners = new Map<string, (...args: never[]) => void>();
  return {
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, listener);
    }),
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.(...(args as never[]));
    },
  };
}

describe('WorkerManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers workers, exposes their names, and attaches lifecycle listeners', () => {
    const manager = new WorkerManager(logger as never);
    const first = createWorker();
    const second = createWorker();

    manager.registerWorker('first', first as never);
    manager.registerWorker('second', second as never);

    expect(manager.getWorker('first')).toBe(first);
    expect(manager.getWorker('missing')).toBeUndefined();
    expect(manager.getWorkerNames()).toEqual(['first', 'second']);
    expect(first.on.mock.calls.map(([event]) => event)).toEqual([
      'completed',
      'failed',
      'stalled',
      'error',
    ]);
    expect(logger.debug).toHaveBeenCalledWith('Worker registered: first', {
      component: 'WorkerManager',
    });
  });

  it('warns and exposes the replacement when a worker name is registered twice', () => {
    const manager = new WorkerManager(logger as never);
    const original = createWorker();
    const replacement = createWorker();

    manager.registerWorker('duplicate', original as never);
    manager.registerWorker('duplicate', replacement as never);

    expect(manager.getWorker('duplicate')).toBe(replacement);
    expect(manager.getWorkerNames()).toEqual(['duplicate']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Worker "duplicate" already registered, replacing',
      { component: 'WorkerManager' }
    );
  });

  it('logs completed, failed, stalled, and worker error events with job context', () => {
    const manager = new WorkerManager(logger as never);
    const worker = createWorker();
    manager.registerWorker('background', worker as never);

    worker.emit('completed', { id: '42', name: 'data-import' });
    worker.emit(
      'failed',
      { id: '43', name: 'jwks-rotation', attemptsMade: 2 },
      new Error('rotation failed')
    );
    worker.emit('stalled', '44');
    worker.emit('error', new Error('redis unavailable'));

    expect(logger.info).toHaveBeenCalledWith(
      'Job completed: data-import [42]',
      {
        component: 'WorkerManager',
        worker: 'background',
        jobId: '42',
        jobName: 'data-import',
      }
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Job failed: jwks-rotation [43] — rotation failed',
      {
        component: 'WorkerManager',
        worker: 'background',
        jobId: '43',
        jobName: 'jwks-rotation',
        attemptsMade: 2,
      }
    );
    expect(logger.warn).toHaveBeenCalledWith('Job stalled: 44', {
      component: 'WorkerManager',
      worker: 'background',
      jobId: '44',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Worker error: redis unavailable',
      { component: 'WorkerManager', worker: 'background' }
    );
  });

  it('uses safe placeholders when BullMQ emits a failed event without a job', () => {
    const manager = new WorkerManager(logger as never);
    const worker = createWorker();
    manager.registerWorker('background', worker as never);

    worker.emit('failed', undefined, new Error('job missing'));

    expect(logger.error).toHaveBeenCalledWith(
      'Job failed: unknown [?] — job missing',
      {
        component: 'WorkerManager',
        worker: 'background',
        jobId: undefined,
        jobName: undefined,
        attemptsMade: undefined,
      }
    );
  });

  it('closes every worker, clears the registry, and logs clean shutdown', async () => {
    const manager = new WorkerManager(logger as never);
    const first = createWorker();
    const second = createWorker();
    manager.registerWorker('first', first as never);
    manager.registerWorker('second', second as never);

    await manager.closeAll();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(manager.getWorkerNames()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Some workers failed to close cleanly',
      expect.anything()
    );
    expect(logger.info).toHaveBeenCalledWith('All workers closed', {
      component: 'WorkerManager',
    });
  });

  it('continues closing workers and reports both Error and non-Error failures', async () => {
    const manager = new WorkerManager(logger as never);
    const errorWorker = createWorker();
    const stringWorker = createWorker();
    const healthyWorker = createWorker();
    errorWorker.close.mockRejectedValue(new Error('close failed'));
    stringWorker.close.mockRejectedValue('connection gone');
    manager.registerWorker('error-worker', errorWorker as never);
    manager.registerWorker('string-worker', stringWorker as never);
    manager.registerWorker('healthy-worker', healthyWorker as never);

    await manager.closeAll();

    expect(healthyWorker.close).toHaveBeenCalledOnce();
    expect(manager.getWorkerNames()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Some workers failed to close cleanly',
      {
        component: 'WorkerManager',
        errors: [
          { name: 'error-worker', error: 'close failed' },
          { name: 'string-worker', error: 'connection gone' },
        ],
      }
    );
    expect(logger.info).toHaveBeenCalledWith('All workers closed', {
      component: 'WorkerManager',
    });
  });
});
