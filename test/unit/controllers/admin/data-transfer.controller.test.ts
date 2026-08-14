/**
 * TDD — AdminDataTransferController
 *
 * Exercises the controller through its public Express handlers. BullMQ and
 * Redis are mocked only at the background-job infrastructure boundary.
 */
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
  create: vi.fn(),
  fromId: vi.fn(),
  buildRedisOptions: vi.fn((options: unknown) => options),
  queueEventsError: undefined as Error | undefined,
  queueEventsArgs: [] as unknown[][],
  queueEvents: [] as Array<{
    handlers: Map<string, (...args: any[]) => void>;
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    getTenantId: vi.fn().mockReturnValue('tenant-a'),
  },
}));

vi.mock('../../../../src/jobs/domains/background-tasks/queue.js', () => ({
  createBackgroundTaskQueue: queueMocks.create,
}));

vi.mock('../../../../src/jobs/redis.js', () => ({
  buildQueueRedisOptions: queueMocks.buildRedisOptions,
}));

vi.mock('bullmq', () => {
  class QueueEvents {
    public readonly handlers = new Map<string, (...args: any[]) => void>();
    public readonly close = vi.fn().mockResolvedValue(undefined);

    constructor(...args: unknown[]) {
      if (queueMocks.queueEventsError) throw queueMocks.queueEventsError;
      queueMocks.queueEventsArgs.push(args);
      queueMocks.queueEvents.push(this);
    }

    public on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }
  }

  return {
    Job: { fromId: queueMocks.fromId },
    QueueEvents,
  };
});

import { AdminDataTransferController } from '../../../../src/controllers/admin/data-transfer.controller.js';
import * as entityRegistry from '../../../../src/services/data-transfer/entities/index.js';

function makeMocks() {
  const flash = { error: vi.fn(), success: vi.fn() };
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const activityService = {
    warning: vi.fn(),
    success: vi.fn(),
    getActivities: vi.fn(),
  };
  const sessionManager = {
    flash: vi.fn(() => flash),
    getActiveUser: vi.fn(() => ({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
    })),
  };
  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn(() => ({
      ip: '127.0.0.1',
      user_agent: 'vitest',
    })),
  };
  const configManager = {
    getConfig: vi.fn(() => ({
      oidc_storage: {
        oidc_adapter: {
          redis: {
            host: 'redis.test',
            port: 6380,
            password: 'secret',
            database: 4,
          },
        },
      },
    })),
  };
  const userService = {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    findUserByEmail: vi.fn(),
  };
  const passwordUtils = { hash: vi.fn() };
  const oidcAdapterBridge = { getAdapter: vi.fn() };
  const dataTransferService = {
    validateImport: vi.fn(),
    enqueueImport: vi.fn(),
    executeImport: vi.fn(),
    generateExport: vi.fn(),
    generateImportTemplate: vi.fn(),
  };

  return {
    flash,
    logger,
    activityService,
    sessionManager,
    clientDeviceInfoManager,
    configManager,
    userService,
    passwordUtils,
    oidcAdapterBridge,
    dataTransferService,
  };
}

function makeController(mocks = makeMocks()) {
  const controller = new AdminDataTransferController(
    mocks.logger as any,
    mocks.activityService as any,
    mocks.sessionManager as any,
    mocks.clientDeviceInfoManager as any,
    mocks.configManager as any,
    mocks.userService as any,
    mocks.passwordUtils as any,
    mocks.oidcAdapterBridge as any,
    mocks.dataTransferService as any
  );
  return { controller, ...mocks };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  const req = Object.assign(new EventEmitter(), {
    params: {},
    body: {},
    query: {},
    ...overrides,
  });
  return req as any;
}

function makeRes() {
  const res = Object.assign(new EventEmitter(), {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }) as any;
  res.status.mockReturnValue(res);
  return res;
}

describe('AdminDataTransferController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueMocks.queueEvents.length = 0;
    queueMocks.queueEventsArgs.length = 0;
    queueMocks.queueEventsError = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('overview()', () => {
    it('renders the stable data-transfer capability cards', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.overview(makeReq(), res);

      expect(res.render).toHaveBeenCalledWith('admin/data-transfer/index', {
        title: 'Data Transfer',
        entities: [
          expect.objectContaining({
            entityId: 'users',
            hasImport: true,
            hasExport: true,
            hasSensitiveFields: true,
            hasSecretFields: true,
          }),
          expect.objectContaining({
            entityId: 'oidc-clients',
            hasImport: true,
            hasExport: true,
          }),
          expect.objectContaining({
            entityId: 'activities',
            hasImport: false,
            hasExport: true,
            hasSensitiveFields: false,
            hasSecretFields: false,
          }),
        ],
      });
    });

    it('fails explicitly if the advertised entity registry is inconsistent', async () => {
      vi.spyOn(entityRegistry, 'getEntityConfigFactory').mockReturnValueOnce(
        null
      );
      const { controller } = makeController();

      await expect(controller.overview(makeReq(), makeRes())).rejects.toThrow(
        'Unknown entity: users'
      );
    });
  });

  describe('entityPage()', () => {
    it('renders import metadata for a supported entity', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.entityPage(
        makeReq({ params: { entityId: 'users' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith(
        'admin/data-transfer/entity',
        expect.objectContaining({
          title: 'Users - Data Transfer',
          entity: expect.objectContaining({
            entityId: 'users',
            hasImport: true,
            hasExport: true,
          }),
          importColumns: expect.arrayContaining([
            expect.objectContaining({
              field: 'email',
              required: true,
              aliases: expect.any(Array),
            }),
          ]),
        })
      );
    });

    it('renders export-only entities without import columns', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.entityPage(
        makeReq({ params: { entityId: 'activities' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith(
        'admin/data-transfer/entity',
        expect.objectContaining({
          entity: expect.objectContaining({
            entityId: 'activities',
            hasImport: false,
            hasExport: true,
          }),
          importColumns: undefined,
        })
      );
    });

    it('advertises only the field groups supported by OIDC client exports', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.entityPage(
        makeReq({ params: { entityId: 'oidc-clients' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith(
        'admin/data-transfer/entity',
        expect.objectContaining({
          entity: expect.objectContaining({
            hasSensitiveFields: false,
            hasSecretFields: true,
          }),
        })
      );
    });

    it.each([['unknown'], [undefined]])(
      'rejects unsupported entity identifiers (%s)',
      async entityId => {
        const { controller, flash } = makeController();
        const req = makeReq({ params: { entityId } });
        const res = makeRes();

        await controller.entityPage(req, res);

        expect(flash.error).toHaveBeenCalledWith('Unknown entity type');
        expect(res.redirect).toHaveBeenCalledWith('/admin/data-transfer');
        expect(res.render).not.toHaveBeenCalled();
      }
    );
  });

  describe('startImport()', () => {
    it.each([
      ['activities', [{ type: 'login' }]],
      ['unknown', [{ email: 'user@example.com' }]],
    ])('rejects an unsupported import for %s', async (entityId, rows) => {
      const { controller, dataTransferService } = makeController();
      const res = makeRes();

      await controller.startImport(
        makeReq({ params: { entityId }, body: { rows } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Import not supported for this entity',
      });
      expect(dataTransferService.validateImport).not.toHaveBeenCalled();
    });

    it.each([undefined, null, {}, [], 'rows'])(
      'rejects a missing or malformed rows payload (%s)',
      async rows => {
        const { controller, dataTransferService } = makeController();
        const res = makeRes();

        await controller.startImport(
          makeReq({ params: { entityId: 'users' }, body: { rows } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'No rows provided' });
        expect(dataTransferService.validateImport).not.toHaveBeenCalled();
      }
    );

    it('enforces the entity-specific row limit before validation', async () => {
      const { controller, dataTransferService } = makeController();
      const rows = Array.from({ length: 501 }, () => ({ name: 'Client' }));
      const res = makeRes();

      await controller.startImport(
        makeReq({ params: { entityId: 'oidc-clients' }, body: { rows } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Too many rows (max 500). Got 501.',
      });
      expect(dataTransferService.validateImport).not.toHaveBeenCalled();
    });

    it('uses the safe default row limit when an entity omits one', async () => {
      vi.spyOn(entityRegistry, 'getEntityConfigFactory').mockReturnValueOnce(
        () =>
          ({
            entityId: 'users',
            displayName: 'Users',
            description: 'Users',
            importConfig: { format: 'csv', columns: [] },
          }) as any
      );
      const { controller, dataTransferService } = makeController();
      const rows = Array.from({ length: 5001 }, () => ({ email: 'a@b.test' }));
      const res = makeRes();

      await controller.startImport(
        makeReq({ params: { entityId: 'users' }, body: { rows } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Too many rows (max 5000). Got 5001.',
      });
      expect(dataTransferService.validateImport).not.toHaveBeenCalled();
    });

    it('returns synchronous row validation failures without touching Redis', async () => {
      const { controller, dataTransferService } = makeController();
      const rows = [{ email: 'invalid' }];
      const validation = {
        valid: false,
        totalRows: 1,
        validCount: 0,
        skippedCount: 0,
        errors: [{ row: 1, field: 'email', message: 'Invalid email' }],
      };
      dataTransferService.validateImport.mockResolvedValue(validation);
      const res = makeRes();

      await controller.startImport(
        makeReq({ params: { entityId: 'users' }, body: { rows } }),
        res
      );

      expect(dataTransferService.validateImport).toHaveBeenCalledWith(
        rows,
        expect.objectContaining({ entityId: 'users' }),
        {
          logger: expect.any(Object),
          adminUser: { username: 'admin', email: 'admin@example.com' },
          tenantId: 'tenant-a',
        }
      );
      expect(res.json).toHaveBeenCalledWith({
        phase: 'validation',
        ...validation,
      });
      expect(queueMocks.create).not.toHaveBeenCalled();
    });

    it('uses a non-identifying actor fallback and reports unavailable Redis', async () => {
      const mocks = makeMocks();
      mocks.sessionManager.getActiveUser.mockReturnValue(undefined as any);
      mocks.dataTransferService.validateImport.mockResolvedValue({
        valid: true,
        totalRows: 1,
        validCount: 1,
        skippedCount: 0,
        errors: [],
      });
      queueMocks.create.mockResolvedValue(null);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.startImport(
        makeReq({
          params: { entityId: 'users' },
          body: { rows: [{ email: 'user@example.com' }] },
        }),
        res
      );

      expect(mocks.dataTransferService.validateImport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.objectContaining({
          adminUser: { username: 'unknown', email: undefined },
          tenantId: 'tenant-a',
        })
      );
      expect(queueMocks.create).toHaveBeenCalledWith({
        host: 'redis.test',
        port: 6380,
        password: 'secret',
        database: 4,
      });
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('Background jobs require Redis'),
      });
    });

    it('enqueues validated rows and closes the queue', async () => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      const { controller, dataTransferService } = makeController();
      dataTransferService.validateImport.mockResolvedValue({
        valid: true,
        totalRows: 1,
        validCount: 1,
        skippedCount: 0,
        errors: [],
      });
      dataTransferService.enqueueImport.mockResolvedValue('job-123');
      const rows = [{ email: 'user@example.com' }];
      const res = makeRes();

      await controller.startImport(
        makeReq({ params: { entityId: 'users' }, body: { rows } }),
        res
      );

      expect(dataTransferService.enqueueImport).toHaveBeenCalledWith(
        queue,
        'users',
        rows,
        expect.objectContaining({ tenantId: 'tenant-a' })
      );
      expect(res.json).toHaveBeenCalledWith({
        phase: 'enqueued',
        valid: true,
        jobId: 'job-123',
        totalRows: 1,
        validCount: 1,
      });
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it('returns a sanitized server error when validation or enqueueing fails', async () => {
      const failure = new Error('database details must remain private');
      const { controller, dataTransferService, logger } = makeController();
      dataTransferService.validateImport.mockRejectedValue(failure);
      const res = makeRes();

      await controller.startImport(
        makeReq({
          params: { entityId: 'users' },
          body: { rows: [{ email: 'user@example.com' }] },
        }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'data_import_failed',
        entityId: 'users',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to process import',
      });
      expect(JSON.stringify(res.json.mock.calls)).not.toContain(
        'database details'
      );
    });

    it('does not overwrite a successful response when queue cleanup fails', async () => {
      const closeFailure = new Error('Redis connection already closed');
      const queue = { close: vi.fn().mockRejectedValue(closeFailure) };
      queueMocks.create.mockResolvedValue(queue);
      const { controller, dataTransferService, logger } = makeController();
      dataTransferService.validateImport.mockResolvedValue({
        valid: true,
        totalRows: 1,
        validCount: 1,
        skippedCount: 0,
        errors: [],
      });
      dataTransferService.enqueueImport.mockResolvedValue('job-123');
      const res = makeRes();

      await controller.startImport(
        makeReq({
          params: { entityId: 'users' },
          body: { rows: [{ email: 'user@example.com' }] },
        }),
        res
      );

      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalledWith(closeFailure, {
        context: 'data_import_queue_close_failed',
        entityId: 'users',
      });
    });
  });

  describe('importStatus()', () => {
    it('returns 503 when the background queue is unavailable', async () => {
      queueMocks.create.mockResolvedValue(null);
      const { controller } = makeController();
      const res = makeRes();

      await controller.importStatus(
        makeReq({ params: { jobId: 'job-1' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('Background jobs require Redis'),
      });
      expect(queueMocks.fromId).not.toHaveBeenCalled();
    });

    it.each([
      ['missing job', null],
      [
        'another tenant job',
        {
          data: { tenantId: 'tenant-b' },
          getState: vi.fn(),
          progress: 25,
        },
      ],
      [
        'another entity job',
        {
          data: { tenantId: 'tenant-a', entityId: 'oidc-clients' },
          getState: vi.fn(),
          progress: 25,
        },
      ],
    ])('does not disclose a %s', async (_label, job) => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue(job);
      const { controller } = makeController();
      const res = makeRes();

      await controller.importStatus(
        makeReq({ params: { entityId: 'users', jobId: 'job-1' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Import job not found' });
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it.each([
      [
        'completed',
        { returnvalue: { imported: 2 } },
        { state: 'completed', result: { imported: 2 } },
      ],
      [
        'failed',
        { failedReason: 'insert failed' },
        { state: 'failed', error: 'insert failed' },
      ],
      ['active', { progress: 42 }, { state: 'active', progress: 42 }],
      [
        'waiting',
        { progress: { current: 2 } },
        { state: 'waiting', progress: 0 },
      ],
    ])('returns the %s job state', async (state, properties, response) => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a', entityId: 'users' },
        getState: vi.fn().mockResolvedValue(state),
        progress: 0,
        ...properties,
      });
      const { controller } = makeController();
      const res = makeRes();

      await controller.importStatus(
        makeReq({ params: { entityId: 'users', jobId: 'job-1' } }),
        res
      );

      expect(queueMocks.fromId).toHaveBeenCalledWith(queue, 'job-1');
      expect(res.json).toHaveBeenCalledWith(response);
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it('closes the queue when loading job state fails', async () => {
      const failure = new Error('BullMQ lookup failed');
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockRejectedValue(failure);
      const { controller } = makeController();

      await expect(
        controller.importStatus(
          makeReq({ params: { jobId: 'job-1' } }),
          makeRes()
        )
      ).rejects.toBe(failure);
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it('does not reject or overwrite a response when queue cleanup fails', async () => {
      const closeFailure = new Error('Redis connection already closed');
      const queue = { close: vi.fn().mockRejectedValue(closeFailure) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { imported: 1 },
        progress: 100,
      });
      const { controller, logger } = makeController();
      const res = makeRes();

      await expect(
        controller.importStatus(makeReq({ params: { jobId: 'job-1' } }), res)
      ).resolves.toBeUndefined();
      expect(res.json).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(closeFailure, {
        context: 'data_import_status_queue_close_failed',
        jobId: 'job-1',
      });
    });
  });

  describe('importProgress()', () => {
    it('returns 503 when the background queue is unavailable', async () => {
      queueMocks.create.mockResolvedValue(null);
      const { controller } = makeController();
      const res = makeRes();

      await controller.importProgress(
        makeReq({ params: { jobId: 'job-1' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('Background jobs require Redis'),
      });
    });

    it.each([
      ['missing job', null],
      [
        'another tenant job',
        { data: { tenantId: 'tenant-b' }, getState: vi.fn() },
      ],
      [
        'another entity job',
        {
          data: { tenantId: 'tenant-a', entityId: 'oidc-clients' },
          getState: vi.fn(),
        },
      ],
    ])('does not stream a %s', async (_label, job) => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue(job);
      const { controller } = makeController();
      const res = makeRes();

      await controller.importProgress(
        makeReq({ params: { entityId: 'users', jobId: 'job-1' } }),
        res
      );

      expect(queue.close).toHaveBeenCalledOnce();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Import job not found' });
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it.each([
      [
        'completed',
        { returnvalue: { imported: 2 } },
        'event: completed\ndata: {"imported":2}\n\n',
      ],
      [
        'failed',
        { failedReason: 'insert failed' },
        'event: failed\ndata: {"error":"insert failed"}\n\n',
      ],
    ])('sends an immediate SSE %s event', async (state, values, message) => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a', entityId: 'users' },
        getState: vi.fn().mockResolvedValue(state),
        ...values,
      });
      const { controller } = makeController();
      const res = makeRes();

      await controller.importProgress(
        makeReq({ params: { entityId: 'users', jobId: 'job-1' } }),
        res
      );

      expect(queue.close).toHaveBeenCalledOnce();
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      expect(res.write).toHaveBeenCalledWith(message);
      expect(res.end).toHaveBeenCalledOnce();
      expect(queueMocks.queueEvents).toHaveLength(0);
    });

    it('closes the queue if loading the job or state fails', async () => {
      const failure = new Error('BullMQ lookup failed');
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockRejectedValue(failure);
      const { controller } = makeController();

      await expect(
        controller.importProgress(
          makeReq({ params: { jobId: 'job-1' } }),
          makeRes()
        )
      ).rejects.toBe(failure);
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it('closes the queue if reading the job state fails', async () => {
      const failure = new Error('BullMQ state lookup failed');
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockRejectedValue(failure),
      });
      const { controller } = makeController();

      await expect(
        controller.importProgress(
          makeReq({ params: { jobId: 'job-1' } }),
          makeRes()
        )
      ).rejects.toBe(failure);
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it('sets up a tenant-scoped live event stream and filters other jobs', async () => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a', entityId: 'users' },
        getState: vi.fn().mockResolvedValue('active'),
      });
      const { controller } = makeController();
      const req = makeReq({
        params: { entityId: 'users', jobId: 'job-1' },
      });
      const res = makeRes();

      await controller.importProgress(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'text/event-stream' })
      );
      expect(res.write).toHaveBeenCalledWith(
        'event: connected\ndata: {"jobId":"job-1"}\n\n'
      );
      expect(queueMocks.queueEventsArgs).toEqual([
        [
          'background-tasks',
          expect.objectContaining({
            connection: {
              host: 'redis.test',
              port: 6380,
              password: 'secret',
              database: 4,
            },
          }),
        ],
      ]);

      const events = queueMocks.queueEvents[0]!;
      events.handlers.get('progress')?.({ jobId: 'other', data: 10 });
      events.handlers.get('progress')?.({ jobId: 'job-1', data: 50 });
      expect(res.write).toHaveBeenCalledTimes(2);
      expect(res.write).toHaveBeenLastCalledWith(
        'event: progress\ndata: 50\n\n'
      );

      req.emit('close');
      expect(res.end).not.toHaveBeenCalled();
      res.emit('close');
      await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());
      expect(events.close).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(queue.close).toHaveBeenCalledOnce());
    });

    it.each([
      [
        'completed',
        { jobId: 'job-1', returnvalue: '{"imported":3}' },
        'event: completed\ndata: {"imported":3}\n\n',
      ],
      [
        'failed',
        { jobId: 'job-1', failedReason: 'write failed' },
        'event: failed\ndata: {"error":"write failed"}\n\n',
      ],
    ])(
      'forwards a matching live %s event and cleans up once',
      async (event, payload, message) => {
        const queue = { close: vi.fn().mockResolvedValue(undefined) };
        queueMocks.create.mockResolvedValue(queue);
        queueMocks.fromId.mockResolvedValue({
          data: { tenantId: 'tenant-a' },
          getState: vi.fn().mockResolvedValue('active'),
        });
        const { controller } = makeController();
        const req = makeReq({ params: { jobId: 'job-1' } });
        const res = makeRes();

        await controller.importProgress(req, res);
        const events = queueMocks.queueEvents[0]!;
        events.handlers.get(event)?.({ jobId: 'other' });
        expect(res.write).toHaveBeenCalledOnce();

        events.handlers.get(event)?.(payload);
        await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());

        expect(res.write).toHaveBeenLastCalledWith(message);
        expect(events.close).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(queue.close).toHaveBeenCalledOnce());
        res.emit('close');
        expect(res.end).toHaveBeenCalledOnce();
      }
    );

    it('ends a terminal live response before awaiting resource shutdown', async () => {
      let releaseEvents!: () => void;
      const eventsClosed = new Promise<void>(resolve => {
        releaseEvents = resolve;
      });
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockResolvedValue('active'),
      });
      const { controller } = makeController();
      const res = makeRes();

      await controller.importProgress(
        makeReq({ params: { jobId: 'job-1' } }),
        res
      );
      const events = queueMocks.queueEvents[0]!;
      events.close.mockReturnValue(eventsClosed);
      events.handlers.get('failed')?.({
        jobId: 'job-1',
        failedReason: 'write failed',
      });

      expect(res.end).toHaveBeenCalledOnce();
      expect(queue.close).not.toHaveBeenCalled();
      releaseEvents();
      await vi.waitFor(() => expect(queue.close).toHaveBeenCalledOnce());
    });

    it('times out an inactive stream and releases resources', async () => {
      vi.useFakeTimers();
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockResolvedValue('waiting'),
      });
      const { controller } = makeController();
      const res = makeRes();

      await controller.importProgress(
        makeReq({ params: { jobId: 'job-1' } }),
        res
      );
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(res.write).toHaveBeenLastCalledWith(
        'event: timeout\ndata: {}\n\n'
      );
      expect(res.end).toHaveBeenCalledOnce();
      expect(queue.close).toHaveBeenCalledOnce();
    });

    it('closes queue and QueueEvents independently when cleanup partially fails', async () => {
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockResolvedValue('active'),
      });
      const { controller } = makeController();
      const req = makeReq({ params: { jobId: 'job-1' } });
      const res = makeRes();

      await controller.importProgress(req, res);
      const events = queueMocks.queueEvents[0]!;
      events.close.mockRejectedValue(new Error('events close failed'));
      res.emit('close');
      await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());

      expect(events.close).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(queue.close).toHaveBeenCalledOnce());
    });

    it('closes the queue when QueueEvents setup fails before streaming', async () => {
      const failure = new Error('QueueEvents connection failed');
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockResolvedValue('active'),
      });
      queueMocks.queueEventsError = failure;
      const { controller } = makeController();
      const res = makeRes();

      await expect(
        controller.importProgress(makeReq({ params: { jobId: 'job-1' } }), res)
      ).rejects.toBe(failure);
      expect(queue.close).toHaveBeenCalledOnce();
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('closes both resources if opening the HTTP event stream fails', async () => {
      const failure = new Error('client disconnected before headers');
      const queue = { close: vi.fn().mockResolvedValue(undefined) };
      queueMocks.create.mockResolvedValue(queue);
      queueMocks.fromId.mockResolvedValue({
        data: { tenantId: 'tenant-a' },
        getState: vi.fn().mockResolvedValue('active'),
      });
      const { controller } = makeController();
      const res = makeRes();
      res.writeHead.mockImplementation(() => {
        throw failure;
      });

      await expect(
        controller.importProgress(makeReq({ params: { jobId: 'job-1' } }), res)
      ).rejects.toBe(failure);
      expect(queueMocks.queueEvents[0]!.close).toHaveBeenCalledOnce();
      expect(queue.close).toHaveBeenCalledOnce();
    });
  });

  describe('exportData()', () => {
    it.each(['unknown', 'missing'])(
      'redirects unsupported exports for %s',
      async entityId => {
        const { controller, flash, dataTransferService } = makeController();
        const req = makeReq({ params: { entityId } });
        const res = makeRes();

        await controller.exportData(req, res);

        expect(flash.error).toHaveBeenCalledWith(
          'Export not supported for this entity'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/data-transfer');
        expect(dataTransferService.generateExport).not.toHaveBeenCalled();
      }
    );

    it('generates a private download and records a standard audit event', async () => {
      const file = {
        buffer: Buffer.from('csv-data'),
        filename: 'users.csv',
        contentType: 'text/csv',
      };
      const { controller, dataTransferService, activityService } =
        makeController();
      dataTransferService.generateExport.mockResolvedValue(file);
      const req = makeReq({
        params: { entityId: 'users' },
        query: {
          includeSensitive: 'true',
          includeSecrets: 'false',
          dateFrom: '2026-08-01',
          dateTo: '2026-08-02',
          type: 'login',
          status: 'success',
          username: 'alice',
        },
      });
      const res = makeRes();

      await controller.exportData(req, res);

      expect(dataTransferService.generateExport).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'users' }),
        {
          includeSensitive: true,
          includeSecrets: false,
          dateFrom: '2026-08-01',
          dateTo: '2026-08-02',
          type: 'login',
          status: 'success',
          username: 'alice',
        },
        {
          logger: expect.any(Object),
          adminUser: { username: 'admin', email: 'admin@example.com' },
          tenantId: 'tenant-a',
        }
      );
      expect(activityService.warning).not.toHaveBeenCalled();
      expect(activityService.success).toHaveBeenCalledWith(
        'users_exported_by_admin',
        'Admin exported Users',
        null,
        expect.objectContaining({
          ip_address: '127.0.0.1',
          user_agent: 'vitest',
          actor: expect.objectContaining({
            username: 'admin',
            actor_type: 'admin',
          }),
          target: expect.objectContaining({
            entity_data: { entityId: 'users', filename: 'users.csv' },
          }),
        })
      );
      expect(res.setHeader).toHaveBeenNthCalledWith(
        1,
        'Content-Type',
        'text/csv'
      );
      expect(res.setHeader).toHaveBeenNthCalledWith(
        2,
        'Cache-Control',
        'no-store'
      );
      expect(res.setHeader).toHaveBeenNthCalledWith(
        3,
        'Content-Disposition',
        'attachment; filename="users.csv"'
      );
      expect(res.send).toHaveBeenCalledWith(file.buffer);
    });

    it('records a warning audit when secrets are explicitly exported', async () => {
      const { controller, dataTransferService, activityService } =
        makeController();
      dataTransferService.generateExport.mockResolvedValue({
        buffer: Buffer.from('{}'),
        filename: 'clients.json',
        contentType: 'application/json',
      });
      const req = makeReq({
        params: { entityId: 'oidc-clients' },
        query: { includeSecrets: 'true' },
      });

      await controller.exportData(req, makeRes());

      expect(activityService.warning).toHaveBeenCalledWith(
        'sensitive_data_export',
        'Admin exported OIDC Clients with secrets/internal data',
        null,
        expect.objectContaining({
          target: expect.objectContaining({
            entity_data: {
              entityId: 'oidc-clients',
              filters: expect.objectContaining({ includeSecrets: true }),
            },
          }),
        })
      );
    });

    it('uses a non-identifying actor fallback when the admin session has no user', async () => {
      const mocks = makeMocks();
      mocks.sessionManager.getActiveUser.mockReturnValue(undefined as any);
      mocks.dataTransferService.generateExport.mockResolvedValue({
        buffer: Buffer.from('data'),
        filename: 'users.csv',
        contentType: 'text/csv',
      });
      const { controller } = makeController(mocks);

      await controller.exportData(
        makeReq({ params: { entityId: 'users' } }),
        makeRes()
      );

      expect(mocks.dataTransferService.generateExport).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          adminUser: { username: 'unknown', email: undefined },
        })
      );
    });

    it('ignores non-scalar filter query values before calling persistence', async () => {
      const { controller, dataTransferService } = makeController();
      dataTransferService.generateExport.mockResolvedValue({
        buffer: Buffer.from('data'),
        filename: 'activities.csv',
        contentType: 'text/csv',
      });
      const res = makeRes();

      await controller.exportData(
        makeReq({
          params: { entityId: 'activities' },
          query: {
            dateFrom: ['2026-08-01', '2026-08-02'],
            dateTo: { nested: 'value' },
            type: ['login', 'logout'],
            status: { nested: 'success' },
            username: '   ',
          },
        }),
        res
      );

      expect(dataTransferService.generateExport).toHaveBeenCalledWith(
        expect.any(Object),
        {
          includeSensitive: false,
          includeSecrets: false,
          dateFrom: undefined,
          dateTo: undefined,
          type: undefined,
          status: undefined,
          username: undefined,
        },
        expect.any(Object)
      );
    });

    it('logs a sanitized failure and redirects back to the entity page', async () => {
      const failure = new Error('private database detail');
      const { controller, dataTransferService, logger, flash } =
        makeController();
      dataTransferService.generateExport.mockRejectedValue(failure);
      const req = makeReq({ params: { entityId: 'users' } });
      const res = makeRes();

      await controller.exportData(req, res);

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'data_export_failed',
        entityId: 'users',
      });
      expect(flash.error).toHaveBeenCalledWith('Failed to export data');
      expect(res.redirect).toHaveBeenCalledWith('/admin/data-transfer/users');
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  describe('downloadTemplate()', () => {
    it.each(['activities', 'unknown'])(
      'redirects when import templates are unsupported for %s',
      async entityId => {
        const { controller, flash, dataTransferService } = makeController();
        const req = makeReq({ params: { entityId } });
        const res = makeRes();

        await controller.downloadTemplate(req, res);

        expect(flash.error).toHaveBeenCalledWith(
          'Import not supported for this entity'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/data-transfer');
        expect(
          dataTransferService.generateImportTemplate
        ).not.toHaveBeenCalled();
      }
    );

    it('downloads a generated template without caching', async () => {
      const file = {
        buffer: Buffer.from('email,first_name,last_name'),
        filename: 'users-template.csv',
        contentType: 'text/csv',
      };
      const { controller, dataTransferService } = makeController();
      dataTransferService.generateImportTemplate.mockResolvedValue(file);
      const res = makeRes();

      await controller.downloadTemplate(
        makeReq({ params: { entityId: 'users' } }),
        res
      );

      expect(dataTransferService.generateImportTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'users' })
      );
      expect(res.setHeader).toHaveBeenNthCalledWith(
        1,
        'Content-Type',
        'text/csv'
      );
      expect(res.setHeader).toHaveBeenNthCalledWith(
        2,
        'Cache-Control',
        'no-store'
      );
      expect(res.setHeader).toHaveBeenNthCalledWith(
        3,
        'Content-Disposition',
        'attachment; filename="users-template.csv"'
      );
      expect(res.send).toHaveBeenCalledWith(file.buffer);
    });

    it('logs a sanitized generation failure and redirects back', async () => {
      const failure = new Error('private template failure');
      const { controller, dataTransferService, logger, flash } =
        makeController();
      dataTransferService.generateImportTemplate.mockRejectedValue(failure);
      const req = makeReq({ params: { entityId: 'users' } });
      const res = makeRes();

      await controller.downloadTemplate(req, res);

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'template_download_failed',
        entityId: 'users',
      });
      expect(flash.error).toHaveBeenCalledWith('Failed to generate template');
      expect(res.redirect).toHaveBeenCalledWith('/admin/data-transfer/users');
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
