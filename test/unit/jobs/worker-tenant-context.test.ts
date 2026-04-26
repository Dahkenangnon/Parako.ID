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
});
