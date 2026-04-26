import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bullmq
vi.mock('bullmq', () => {
  const mockWorker = {
    name: 'test-worker',
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return {
    Worker: vi.fn().mockImplementation(() => ({ ...mockWorker })),
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

describe('WorkerManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registerWorker() and getWorker() store and retrieve a worker', async () => {
    const { WorkerManager } =
      await import('../../../../src/jobs/processing/worker-manager.js');

    const mgr = new WorkerManager(mockLogger);
    const { Worker } = await import('bullmq');
    const worker = new Worker('test', async () => {});

    mgr.registerWorker('test', worker);
    expect(mgr.getWorker('test')).toBe(worker);
  });

  it('registerWorker() attaches event handlers to the worker', async () => {
    const { WorkerManager } =
      await import('../../../../src/jobs/processing/worker-manager.js');

    const mgr = new WorkerManager(mockLogger);
    const { Worker } = await import('bullmq');
    const worker = new Worker('test', async () => {});

    mgr.registerWorker('test', worker);

    // Should attach completed, failed, stalled, error handlers
    expect(worker.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('stalled', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('closeAll() closes all registered workers and clears the registry', async () => {
    const { WorkerManager } =
      await import('../../../../src/jobs/processing/worker-manager.js');

    const mgr = new WorkerManager(mockLogger);
    const { Worker } = await import('bullmq');
    const worker = new Worker('test', async () => {});

    mgr.registerWorker('test', worker);
    await mgr.closeAll();

    expect(worker.close).toHaveBeenCalled();
    expect(mgr.getWorkerNames()).toEqual([]);
  });

  it('getWorkerNames() returns all registered worker names', async () => {
    const { WorkerManager } =
      await import('../../../../src/jobs/processing/worker-manager.js');

    const mgr = new WorkerManager(mockLogger);
    const { Worker } = await import('bullmq');

    mgr.registerWorker('a', new Worker('a', async () => {}));
    mgr.registerWorker('b', new Worker('b', async () => {}));

    expect(mgr.getWorkerNames()).toEqual(['a', 'b']);
  });
});
