import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';

/**
 * Verify that BullMQ worker wraps job execution in tenantContext.run()
 * so that all downstream operations (DB queries, Redis keys, etc.)
 * execute within the correct tenant context.
 */

// Mock BullMQ Worker to capture the processor function
let capturedProcessor: ((job: any) => Promise<unknown>) | null = null;

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: any, _opts: any) {
      capturedProcessor = processor;
    }
    on() {
      return this;
    }
    close() {
      return Promise.resolve();
    }
  },
  Job: class MockJob {},
}));

// Mock redis options builder
vi.mock('../../../src/jobs/redis.js', () => ({
  buildQueueRedisOptions: vi.fn().mockReturnValue({}),
}));

describe('BullMQ Worker Tenant Context', () => {
  beforeEach(() => {
    capturedProcessor = null;
  });

  it('wraps job execution in tenantContext.run() with job tenantId', async () => {
    const { registerTaskHandler, createBackgroundTaskWorker } =
      await import('../../../src/jobs/domains/background-tasks/worker.js');

    // Track the tenant ID inside the handler
    let capturedTenantId: string | null = null;
    registerTaskHandler('test-task', async (_data, _reportProgress) => {
      capturedTenantId = tenantContext.getTenantId();
      return { ok: true };
    });

    createBackgroundTaskWorker({ host: 'localhost', port: 6379 });

    expect(capturedProcessor).not.toBeNull();

    // Simulate processing a job with tenantId
    const mockJob = {
      id: 'job-1',
      data: { type: 'test', name: 'test-task', tenantId: 'acme' },
      updateProgress: vi.fn(),
    };

    await capturedProcessor!(mockJob);

    expect(capturedTenantId).toBe('acme');
  });

  it('uses DEFAULT_TENANT_ID when job has no tenantId', async () => {
    const { registerTaskHandler, createBackgroundTaskWorker } =
      await import('../../../src/jobs/domains/background-tasks/worker.js');

    let capturedTenantId: string | null = null;
    registerTaskHandler('test-task-2', async (_data, _reportProgress) => {
      capturedTenantId = tenantContext.getTenantId();
      return { ok: true };
    });

    createBackgroundTaskWorker({ host: 'localhost', port: 6379 });

    const mockJob = {
      id: 'job-2',
      data: { type: 'test', name: 'test-task-2' },
      updateProgress: vi.fn(),
    };

    await capturedProcessor!(mockJob);

    expect(capturedTenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('different jobs with different tenants run in isolated contexts', async () => {
    const { registerTaskHandler, createBackgroundTaskWorker } =
      await import('../../../src/jobs/domains/background-tasks/worker.js');

    const capturedTenants: string[] = [];
    registerTaskHandler('track-tenant', async (_data, _reportProgress) => {
      capturedTenants.push(tenantContext.getTenantId());
      return {};
    });

    createBackgroundTaskWorker({ host: 'localhost', port: 6379 });

    // Process two jobs sequentially with different tenants
    await capturedProcessor!({
      id: 'j1',
      data: { type: 'test', name: 'track-tenant', tenantId: 'alpha' },
      updateProgress: vi.fn(),
    });

    await capturedProcessor!({
      id: 'j2',
      data: { type: 'test', name: 'track-tenant', tenantId: 'beta' },
      updateProgress: vi.fn(),
    });

    expect(capturedTenants).toEqual(['alpha', 'beta']);
  });

  it.each([
    [{ id: 'missing-data', data: undefined, updateProgress: vi.fn() }],
    [{ id: 'missing-name', data: { type: 'test' }, updateProgress: vi.fn() }],
  ])(
    'rejects jobs without a task name before entering tenant context',
    async job => {
      const { createBackgroundTaskWorker } =
        await import('../../../src/jobs/domains/background-tasks/worker.js');
      createBackgroundTaskWorker({ host: 'localhost', port: 6379 });

      await expect(capturedProcessor!(job as any)).rejects.toThrow(
        `Job ${job.id} is missing "name" in data payload`
      );
    }
  );

  it('rejects unknown task names without reporting progress', async () => {
    const { createBackgroundTaskWorker } =
      await import('../../../src/jobs/domains/background-tasks/worker.js');
    createBackgroundTaskWorker({ host: 'localhost', port: 6379 });
    const updateProgress = vi.fn();

    await expect(
      capturedProcessor!({
        id: 'unknown-task',
        data: { type: 'test', name: 'not-registered' },
        updateProgress,
      })
    ).rejects.toThrow(
      'No handler registered for task "not-registered" (job unknown-task)'
    );
    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('returns the handler result and forwards progress updates to BullMQ', async () => {
    const { registerTaskHandler, createBackgroundTaskWorker } =
      await import('../../../src/jobs/domains/background-tasks/worker.js');
    registerTaskHandler('progress-task', async (_data, reportProgress) => {
      await reportProgress(60);
      return { processed: true };
    });
    createBackgroundTaskWorker({ host: 'localhost', port: 6379 });
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await expect(
      capturedProcessor!({
        id: 'progress-job',
        data: { type: 'test', name: 'progress-task', tenantId: '' },
        updateProgress,
      })
    ).resolves.toEqual({ processed: true });
    expect(updateProgress).toHaveBeenCalledWith(60);
  });
});
