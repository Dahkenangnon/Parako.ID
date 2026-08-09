import type { Queue } from 'bullmq';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IActivityService } from '../../../../src/di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import { DataTransferService } from '../../../../src/services/data-transfer/data-transfer.service.js';
import type {
  EntityColumnDef,
  EntityTransferConfig,
  ExportContext,
  ImportContext,
} from '../../../../src/services/data-transfer/types.js';

function createLogger(): ILogger {
  return {
    getLogger: vi.fn(),
    child: vi.fn(),
    flush: vi.fn(),
    shutdown: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as ILogger;
}

function createActivityService(): IActivityService {
  return {
    success: vi.fn(),
    failed: vi.fn(),
  } as unknown as IActivityService;
}

const columns: EntityColumnDef[] = [
  {
    field: 'name',
    header: 'Name',
    required: true,
    group: 'core',
    validator: z.string().min(2),
  },
  {
    field: 'email',
    header: 'Email',
    group: 'sensitive',
    validator: z.string().email(),
  },
  {
    field: 'secret',
    header: 'Secret',
    group: 'internal',
  },
  {
    field: 'ignored',
    header: 'Ignored',
    group: 'unknown' as EntityColumnDef['group'],
  },
];

function createConfig(
  overrides: Partial<EntityTransferConfig> = {}
): EntityTransferConfig {
  return {
    entityId: 'users',
    displayName: 'users',
    description: 'User transfer',
    importConfig: {
      format: 'csv',
      columns,
      requiredFields: ['name'],
      prepareRow: vi.fn(async row => ({ ...row, prepared: true })),
      checkDuplicate: vi.fn(async () => null),
      insertRow: vi.fn(async () => undefined),
    },
    exportConfig: {
      format: 'csv',
      columns,
      loadData: vi.fn(async () => []),
      filenamePrefix: 'users',
    },
    ...overrides,
  };
}

describe('DataTransferService', () => {
  let logger: ILogger;
  let activityService: IActivityService;
  let service: DataTransferService;
  let importContext: ImportContext;
  let exportContext: ExportContext;

  beforeEach(() => {
    logger = createLogger();
    activityService = createActivityService();
    service = new DataTransferService(logger, activityService);
    importContext = {
      logger,
      adminUser: { username: 'admin', email: 'admin@example.test' },
      tenantId: 'tenant-a',
    };
    exportContext = { ...importContext };
  });

  describe('enqueueImport', () => {
    it('enqueues a non-retrying import and returns its job ID', async () => {
      const queue = {
        add: vi.fn(async () => ({ id: 'job-42' })),
      } as unknown as Queue;
      const rows = [{ email: 'one@example.test' }];

      await expect(
        service.enqueueImport(queue, 'users', rows, importContext)
      ).resolves.toBe('job-42');

      expect(queue.add).toHaveBeenCalledWith(
        'data-import',
        {
          type: 'process',
          name: 'data-import',
          entityId: 'users',
          rows,
          tenantId: 'tenant-a',
          adminUser: importContext.adminUser,
        },
        {
          attempts: 1,
          removeOnComplete: { age: 3600, count: 50 },
          removeOnFail: { age: 86400, count: 100 },
        }
      );
      expect(logger.info).toHaveBeenCalledWith('Data import job enqueued', {
        component: 'data-transfer',
        jobId: 'job-42',
        entityId: 'users',
        rowCount: 1,
        tenantId: 'tenant-a',
      });
    });

    it.each([undefined, null, '', '   '])(
      'rejects a queue job without a usable ID (%s)',
      async id => {
        const queue = {
          add: vi.fn(async () => ({ id })),
        } as unknown as Queue;

        await expect(
          service.enqueueImport(queue, 'users', [], importContext)
        ).rejects.toThrow('BullMQ job was created without an ID');
      }
    );

    it('propagates queue failures without logging a successful enqueue', async () => {
      const failure = new Error('queue unavailable');
      const queue = {
        add: vi.fn(async () => {
          throw failure;
        }),
      } as unknown as Queue;

      await expect(
        service.enqueueImport(queue, 'users', [], importContext)
      ).rejects.toBe(failure);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('validateImport', () => {
    it('rejects entities that do not support import', async () => {
      const config = createConfig({ importConfig: undefined });

      await expect(
        service.validateImport([], config, importContext)
      ).rejects.toThrow('Entity "users" does not support import');
    });

    it('enforces both configured and default row limits', async () => {
      const configured = createConfig();
      configured.importConfig!.maxRows = 1;

      await expect(
        service.validateImport([{}, {}], configured, importContext)
      ).rejects.toThrow('Row count 2 exceeds maximum 1 for users');

      const defaultLimit = createConfig();
      await expect(
        service.validateImport(
          Array.from({ length: 5001 }, () => ({})),
          defaultLimit,
          importContext
        )
      ).rejects.toThrow('Row count 5001 exceeds maximum 5000 for users');
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid maxRows setting (%s)',
      async maxRows => {
        const config = createConfig();
        config.importConfig!.maxRows = maxRows;

        await expect(
          service.validateImport([], config, importContext)
        ).rejects.toThrow('Invalid maximum row count for users');
      }
    );

    it('reports required and schema errors without duplicate checks', async () => {
      const config = createConfig();

      const result = await service.validateImport(
        [
          { name: '', email: '' },
          { name: 'x', email: 'not-an-email' },
        ],
        config,
        importContext
      );

      expect(result).toEqual({
        valid: false,
        totalRows: 2,
        validCount: 0,
        errors: [
          {
            rowNumber: 1,
            fields: { name: 'Name is required' },
            error: 'Validation failed',
          },
          {
            rowNumber: 2,
            fields: {
              name: expect.any(String),
              email: expect.any(String),
            },
            error: 'Validation failed',
          },
        ],
        skippedCount: 0,
      });
      expect(config.importConfig!.checkDuplicate).not.toHaveBeenCalled();
    });

    it('counts valid and duplicate rows and leaves optional empty values alone', async () => {
      const config = createConfig();
      vi.mocked(config.importConfig!.checkDuplicate)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('Email already exists');

      const result = await service.validateImport(
        [
          { name: 'Maria', email: null },
          { name: 'Ada', email: 'ada@example.test' },
        ],
        config,
        importContext
      );

      expect(result).toEqual({
        valid: false,
        totalRows: 2,
        validCount: 1,
        errors: [
          {
            rowNumber: 2,
            fields: { email: 'ada@example.test' },
            error: 'Email already exists',
          },
        ],
        skippedCount: 1,
      });
      expect(logger.info).toHaveBeenCalledWith(
        'Data import validation completed',
        {
          component: 'data-transfer',
          entityId: 'users',
          totalRows: 2,
          validCount: 1,
          errorCount: 1,
          skippedCount: 1,
        }
      );
    });

    it('returns a valid result for an empty import', async () => {
      const result = await service.validateImport(
        [],
        createConfig(),
        importContext
      );

      expect(result).toMatchObject({
        valid: true,
        totalRows: 0,
        validCount: 0,
        errors: [],
        skippedCount: 0,
      });
    });

    it('uses an empty field value when a duplicate row has no email', async () => {
      const config = createConfig();
      vi.mocked(config.importConfig!.checkDuplicate).mockResolvedValue(
        'Duplicate row'
      );

      const result = await service.validateImport(
        [{ name: 'Maria' }],
        config,
        importContext
      );

      expect(result.errors).toEqual([
        {
          rowNumber: 1,
          fields: { email: '' },
          error: 'Duplicate row',
        },
      ]);
    });

    it('caps returned validation errors at 100 while logging the full count', async () => {
      const config = createConfig();
      const result = await service.validateImport(
        Array.from({ length: 101 }, () => ({})),
        config,
        importContext
      );

      expect(result.errors).toHaveLength(100);
      expect(result.errors.at(-1)?.rowNumber).toBe(100);
      expect(logger.info).toHaveBeenCalledWith(
        'Data import validation completed',
        expect.objectContaining({ errorCount: 101 })
      );
    });
  });

  describe('executeImport', () => {
    it('rejects entities that do not support import', async () => {
      await expect(
        service.executeImport(
          [],
          createConfig({ importConfig: undefined }),
          importContext,
          vi.fn()
        )
      ).rejects.toThrow('Entity "users" does not support import');
    });

    it('enforces the configured row limit at the worker execution boundary', async () => {
      const config = createConfig();
      config.importConfig!.maxRows = 1;

      await expect(
        service.executeImport(
          [{ name: 'Maria' }, { name: 'Ada' }],
          config,
          importContext,
          vi.fn()
        )
      ).rejects.toThrow('Row count 2 exceeds maximum 1 for users');

      expect(config.importConfig!.prepareRow).not.toHaveBeenCalled();
      expect(config.importConfig!.insertRow).not.toHaveBeenCalled();
    });

    it('revalidates queued rows before preparing or inserting them', async () => {
      const config = createConfig();
      const reportProgress = vi.fn(async () => undefined);

      const result = await service.executeImport(
        [
          { name: 'x', email: 'not-an-email' },
          { name: 'Maria', email: 'maria@example.test' },
        ],
        config,
        importContext,
        reportProgress
      );

      expect(result).toMatchObject({
        totalRows: 2,
        successCount: 1,
        errorCount: 1,
        errors: [
          {
            rowNumber: 1,
            fields: {
              name: expect.any(String),
              email: expect.any(String),
            },
            error: 'Validation failed',
          },
        ],
      });
      expect(config.importConfig!.prepareRow).toHaveBeenCalledOnce();
      expect(config.importConfig!.prepareRow).toHaveBeenCalledWith(
        { name: 'Maria', email: 'maria@example.test' },
        importContext
      );
      expect(config.importConfig!.insertRow).toHaveBeenCalledOnce();
      expect(reportProgress).toHaveBeenCalledWith(100);
    });

    it('prepares and inserts rows, reports progress, and audits success', async () => {
      const config = createConfig();
      const rows = Array.from({ length: 11 }, (_, index) => ({
        name: `User ${index}`,
      }));
      const reportProgress = vi.fn(async () => undefined);

      const result = await service.executeImport(
        rows,
        config,
        importContext,
        reportProgress
      );

      expect(result).toMatchObject({
        totalRows: 11,
        successCount: 11,
        errorCount: 0,
        skippedCount: 0,
        errors: [],
        durationMs: expect.any(Number),
      });
      expect(config.importConfig!.prepareRow).toHaveBeenCalledTimes(11);
      expect(config.importConfig!.insertRow).toHaveBeenCalledWith(
        { name: 'User 0', prepared: true },
        importContext
      );
      expect(reportProgress).toHaveBeenNthCalledWith(1, 91);
      expect(reportProgress).toHaveBeenNthCalledWith(2, 100);
      expect(activityService.success).toHaveBeenCalledWith(
        'data_imported_by_admin',
        'Admin imported 11 users (0 errors)',
        null,
        expect.objectContaining({
          actor: {
            username: 'admin',
            email: 'admin@example.test',
            actor_type: 'admin',
          },
          target: expect.objectContaining({
            target_type: 'system',
            entity_data: expect.objectContaining({
              entityId: 'users',
              totalRows: 11,
              successCount: 11,
              errorCount: 0,
              durationMs: expect.any(Number),
            }),
          }),
        })
      );
      expect(activityService.failed).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Data import completed',
        expect.objectContaining({
          component: 'data-transfer',
          entityId: 'users',
          successCount: 11,
        })
      );
    });

    it('records Error and non-Error row failures while preserving partial success', async () => {
      const config = createConfig();
      vi.mocked(config.importConfig!.prepareRow)
        .mockRejectedValueOnce(new Error('bad preparation'))
        .mockResolvedValueOnce({ email: 'insert@example.test' })
        .mockResolvedValueOnce({ email: 'ok@example.test' });
      vi.mocked(config.importConfig!.insertRow)
        .mockRejectedValueOnce('insert rejected')
        .mockResolvedValueOnce(undefined);

      const result = await service.executeImport(
        [
          { name: 'Prepare', email: 'prepare@example.test' },
          { name: 'Insert', email: 'insert@example.test' },
          { name: 'Valid', email: 'ok@example.test' },
        ],
        config,
        importContext,
        vi.fn(async () => undefined)
      );

      expect(result).toMatchObject({
        totalRows: 3,
        successCount: 1,
        errorCount: 2,
        errors: [
          {
            rowNumber: 1,
            fields: { email: 'prepare@example.test' },
            error: 'bad preparation',
          },
          {
            rowNumber: 2,
            fields: { email: 'insert@example.test' },
            error: 'insert rejected',
          },
        ],
      });
      expect(activityService.success).toHaveBeenCalledWith(
        'data_imported_by_admin',
        'Admin imported 1 users (2 errors)',
        null,
        expect.any(Object)
      );
    });

    it('does not write row-level errors or email addresses to operational logs', async () => {
      const config = createConfig();
      vi.mocked(config.importConfig!.insertRow).mockRejectedValue(
        new Error('private database detail')
      );

      await service.executeImport(
        [{ name: 'Maria', email: 'maria@example.test' }],
        config,
        importContext,
        vi.fn(async () => undefined)
      );

      expect(logger.info).toHaveBeenCalledWith('Data import completed', {
        component: 'data-transfer',
        entityId: 'users',
        totalRows: 1,
        successCount: 0,
        errorCount: 1,
        skippedCount: 0,
        durationMs: expect.any(Number),
      });
      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
        'maria@example.test'
      );
      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
        'private database detail'
      );
    });

    it('audits a fully failed or empty import as failed', async () => {
      const failedConfig = createConfig();
      vi.mocked(failedConfig.importConfig!.prepareRow).mockRejectedValue(
        new Error('invalid')
      );

      await service.executeImport(
        [{ name: 'bad' }],
        failedConfig,
        importContext,
        vi.fn(async () => undefined)
      );
      await service.executeImport(
        [],
        createConfig(),
        importContext,
        vi.fn(async () => undefined)
      );

      expect(activityService.failed).toHaveBeenNthCalledWith(
        1,
        'data_import_failed',
        'Admin imported 0 users (1 errors)',
        null,
        expect.any(Object)
      );
      expect(activityService.failed).toHaveBeenNthCalledWith(
        2,
        'data_import_failed',
        'Admin imported 0 users (0 errors)',
        null,
        expect.any(Object)
      );
    });

    it('caps returned row errors at 100 and keeps the full error count', async () => {
      const config = createConfig();
      vi.mocked(config.importConfig!.insertRow).mockRejectedValue(
        new Error('rejected')
      );

      const result = await service.executeImport(
        Array.from({ length: 101 }, (_, index) => ({ email: String(index) })),
        config,
        importContext,
        vi.fn(async () => undefined)
      );

      expect(result.errorCount).toBe(101);
      expect(result.errors).toHaveLength(100);
      expect(result.errors.at(-1)?.rowNumber).toBe(100);
    });

    it('propagates progress reporting failures and stops processing', async () => {
      const config = createConfig();
      const failure = new Error('progress backend unavailable');

      await expect(
        service.executeImport(
          Array.from({ length: 11 }, (_, index) => ({
            name: `User ${index}`,
          })),
          config,
          importContext,
          vi.fn(async progress => {
            if (progress === 91) throw failure;
          })
        )
      ).rejects.toBe(failure);
      expect(config.importConfig!.insertRow).toHaveBeenCalledTimes(10);
      expect(activityService.success).not.toHaveBeenCalled();
      expect(activityService.failed).not.toHaveBeenCalled();
    });
  });

  describe('generateExport', () => {
    it('rejects entities that do not support export', async () => {
      await expect(
        service.generateExport(
          createConfig({ exportConfig: undefined }),
          {},
          exportContext
        )
      ).rejects.toThrow('Entity "users" does not support export');
    });

    it('exports only core CSV columns by default', async () => {
      const config = createConfig();
      vi.mocked(config.exportConfig!.loadData).mockResolvedValue([
        {
          name: 'Maria',
          email: 'maria@example.test',
          secret: 'hidden',
          ignored: 'ignored',
        },
      ]);

      const result = await service.generateExport(
        config,
        { dateFrom: '2026-01-01' },
        exportContext
      );

      expect(config.exportConfig!.loadData).toHaveBeenCalledWith(
        { dateFrom: '2026-01-01' },
        exportContext
      );
      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.filename).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(result.buffer.toString('utf8')).toContain('Name');
      expect(result.buffer.toString('utf8')).not.toContain('Email');
      expect(result.buffer.toString('utf8')).not.toContain('Secret');
    });

    it('includes sensitive and internal CSV columns only when requested', async () => {
      const config = createConfig();
      vi.mocked(config.exportConfig!.loadData).mockResolvedValue([
        { name: 'Maria', email: 'maria@example.test', secret: 'visible' },
      ]);

      const sensitive = await service.generateExport(
        config,
        { includeSensitive: true },
        exportContext
      );
      const secret = await service.generateExport(
        config,
        { includeSecrets: true },
        exportContext
      );

      expect(sensitive.filename).toContain('users-SENSITIVE-');
      expect(sensitive.buffer.toString('utf8')).toContain('Email');
      expect(sensitive.buffer.toString('utf8')).not.toContain('Secret');
      expect(secret.filename).toContain('users-SENSITIVE-');
      expect(secret.buffer.toString('utf8')).toContain('Secret');
      expect(secret.buffer.toString('utf8')).not.toContain('Email');
    });

    it('requires literal booleans before exporting protected columns', async () => {
      const config = createConfig();
      vi.mocked(config.exportConfig!.loadData).mockResolvedValue([
        { name: 'Maria', email: 'maria@example.test', secret: 'hidden' },
      ]);

      const result = await service.generateExport(
        config,
        {
          includeSensitive: 'false' as unknown as boolean,
          includeSecrets: 1 as unknown as boolean,
        },
        exportContext
      );

      expect(result.filename).not.toContain('SENSITIVE');
      expect(result.buffer.toString('utf8')).not.toContain('Email');
      expect(result.buffer.toString('utf8')).not.toContain('Secret');
    });

    it('filters JSON fields to the active column allowlist', async () => {
      const config = createConfig();
      config.exportConfig!.format = 'json';
      vi.mocked(config.exportConfig!.loadData).mockResolvedValue([
        {
          name: 'Maria',
          email: 'maria@example.test',
          secret: 'visible',
          ignored: 'ignored',
          injected: 'must not leak',
        },
      ]);

      const result = await service.generateExport(
        config,
        { includeSensitive: true, includeSecrets: true },
        exportContext
      );

      expect(result).toMatchObject({
        filename: expect.stringMatching(
          /^users-SENSITIVE-\d{4}-\d{2}-\d{2}\.json$/
        ),
        contentType: 'application/json; charset=utf-8',
      });
      expect(JSON.parse(result.buffer.toString('utf8'))).toEqual([
        {
          name: 'Maria',
          email: 'maria@example.test',
          secret: 'visible',
        },
      ]);
    });

    it('propagates data loading failures', async () => {
      const config = createConfig();
      const failure = new Error('database unavailable');
      vi.mocked(config.exportConfig!.loadData).mockRejectedValue(failure);

      await expect(
        service.generateExport(config, {}, exportContext)
      ).rejects.toBe(failure);
    });
  });

  describe('generateImportTemplate', () => {
    it('rejects entities that do not support import', async () => {
      await expect(
        service.generateImportTemplate(
          createConfig({ importConfig: undefined })
        )
      ).rejects.toThrow('Entity "users" does not support import');
    });

    it('generates CSV and JSON templates with format-specific metadata', async () => {
      const csv = await service.generateImportTemplate(createConfig());
      expect(csv).toMatchObject({
        filename: 'users-import-template.csv',
        contentType: 'text/csv; charset=utf-8',
      });
      expect(csv.buffer.toString('utf8')).toContain('<required>');

      const jsonConfig = createConfig();
      jsonConfig.importConfig!.format = 'json';
      const json = await service.generateImportTemplate(jsonConfig);
      expect(json).toMatchObject({
        filename: 'users-import-template.json',
        contentType: 'application/json; charset=utf-8',
      });
      expect(JSON.parse(json.buffer.toString('utf8'))).toEqual([
        { name: '<required>', email: '', secret: '', ignored: '' },
      ]);
    });
  });
});
