import { injectable, inject } from 'inversify';
import type { Queue } from 'bullmq';
import { TYPES } from '../../di/types.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { IDataTransferService } from '../../di/interfaces/data-transfer-service.interface.js';
import type {
  EntityTransferConfig,
  ExportFilters,
  ExportContext,
  ImportContext,
  ImportResult,
  ImportRowError,
  ValidationResult,
} from './types.js';
import {
  formatCsvExport,
  formatJsonExport,
  generateCsvTemplate,
  generateJsonTemplate,
} from './format-utils.js';

@injectable()
export class DataTransferService implements IDataTransferService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService
  ) {}

  async enqueueImport(
    queue: Queue,
    entityId: string,
    rows: Record<string, unknown>[],
    ctx: ImportContext
  ): Promise<string> {
    const job = await queue.add(
      'data-import',
      {
        type: 'process',
        name: 'data-import',
        entityId,
        rows,
        tenantId: ctx.tenantId,
        adminUser: ctx.adminUser,
      },
      {
        attempts: 1, // No retries — partial success + retry = duplicates
        removeOnComplete: { age: 3600, count: 50 },
        removeOnFail: { age: 86400, count: 100 },
      }
    );

    this.logger.info('Data import job enqueued', {
      component: 'data-transfer',
      jobId: job.id,
      entityId,
      rowCount: rows.length,
      tenantId: ctx.tenantId,
    });

    if (!job.id) {
      throw new Error('BullMQ job was created without an ID');
    }
    return job.id;
  }

  async validateImport(
    rows: Record<string, unknown>[],
    config: EntityTransferConfig,
    ctx: ImportContext
  ): Promise<ValidationResult> {
    const importConfig = config.importConfig;

    if (!importConfig) {
      throw new Error(`Entity "${config.entityId}" does not support import`);
    }

    const maxRows = importConfig.maxRows ?? 5000;
    if (rows.length > maxRows) {
      throw new Error(
        `Row count ${rows.length} exceeds maximum ${maxRows} for ${config.entityId}`
      );
    }

    const errors: ImportRowError[] = [];
    let validCount = 0;
    let skippedCount = 0;
    const total = rows.length;

    for (let i = 0; i < total; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      const fieldErrors: Record<string, string> = {};
      for (const col of importConfig.columns) {
        const value = row[col.field];
        const isEmpty = value === undefined || value === null || value === '';

        if (col.required && isEmpty) {
          fieldErrors[col.field] = `${col.header} is required`;
        } else if (col.validator && !isEmpty) {
          const result = col.validator.safeParse(value);
          if (!result.success) {
            fieldErrors[col.field] = result.error.issues
              .map(issue => issue.message)
              .join(', ');
          }
        }
      }

      if (Object.keys(fieldErrors).length > 0) {
        errors.push({
          rowNumber,
          fields: fieldErrors,
          error: 'Validation failed',
        });
        continue;
      }

      const dupError = await importConfig.checkDuplicate(row, ctx);
      if (dupError) {
        skippedCount++;
        errors.push({
          rowNumber,
          fields: { email: String(row.email ?? '') },
          error: dupError,
        });
        continue;
      }

      validCount++;
    }

    this.logger.info('Data import validation completed', {
      component: 'data-transfer',
      entityId: config.entityId,
      totalRows: total,
      validCount,
      errorCount: errors.length,
      skippedCount,
    });

    return {
      valid: errors.length === 0,
      totalRows: total,
      validCount,
      errors: errors.slice(0, 100),
      skippedCount,
    };
  }

  async executeImport(
    rows: Record<string, unknown>[],
    config: EntityTransferConfig,
    ctx: ImportContext,
    reportProgress: (progress: number) => Promise<void>
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const importConfig = config.importConfig;

    if (!importConfig) {
      throw new Error(`Entity "${config.entityId}" does not support import`);
    }

    const errors: ImportRowError[] = [];
    let successCount = 0;
    const total = rows.length;

    for (let i = 0; i < total; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      try {
        const prepared = await importConfig.prepareRow(row, ctx);
        await importConfig.insertRow(prepared, ctx);
        successCount++;
      } catch (err) {
        errors.push({
          rowNumber,
          fields: { email: String(row.email ?? '') },
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Report progress every 10 rows or on last row
      if ((i + 1) % 10 === 0 || i === total - 1) {
        await reportProgress(Math.round(((i + 1) / total) * 100));
      }
    }

    const durationMs = Date.now() - startTime;
    const result: ImportResult = {
      totalRows: total,
      successCount,
      errorCount: errors.length,
      skippedCount: 0,
      errors: errors.slice(0, 100),
      durationMs,
    };

    const activityType =
      successCount > 0 ? 'data_imported_by_admin' : 'data_import_failed';
    const logMethod = successCount > 0 ? 'success' : 'failed';
    this.activityService[logMethod](
      activityType,
      `Admin imported ${successCount} ${config.displayName} (${errors.length} errors)`,
      null,
      {
        actor: {
          ...ctx.adminUser,
          actor_type: 'admin',
        },
        target: {
          target_type: 'system',
          entity_data: {
            entityId: config.entityId,
            totalRows: total,
            successCount,
            errorCount: errors.length,
            durationMs,
          },
        },
      }
    );

    this.logger.info('Data import completed', {
      component: 'data-transfer',
      entityId: config.entityId,
      ...result,
    });

    return result;
  }

  async generateExport(
    config: EntityTransferConfig,
    filters: ExportFilters,
    ctx: ExportContext
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const exportConfig = config.exportConfig;

    if (!exportConfig) {
      throw new Error(`Entity "${config.entityId}" does not support export`);
    }

    const data = await exportConfig.loadData(filters, ctx);

    const activeColumns = exportConfig.columns.filter(col => {
      if (col.group === 'core') return true;
      if (col.group === 'sensitive') return !!filters.includeSensitive;
      if (col.group === 'internal') return !!filters.includeSecrets;
      return false;
    });

    let buffer: Buffer;
    let contentType: string;
    let filenameExt: string;

    if (exportConfig.format === 'csv') {
      const headers = activeColumns.map(c => c.header);
      buffer = await formatCsvExport(headers, data, activeColumns);
      contentType = 'text/csv; charset=utf-8';
      filenameExt = '.csv';
    } else {
      // JSON: filter fields based on active columns
      const fieldSet = new Set(activeColumns.map(c => c.field));
      const filtered = data.map(row => {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(row)) {
          if (fieldSet.has(key)) out[key] = val;
        }
        return out;
      });
      buffer = formatJsonExport(filtered, { pretty: true });
      contentType = 'application/json; charset=utf-8';
      filenameExt = '.json';
    }

    let filename = exportConfig.filenamePrefix;
    if (filters.includeSensitive || filters.includeSecrets) {
      filename += '-SENSITIVE';
    }
    filename += `-${new Date().toISOString().split('T')[0]}${filenameExt}`;

    return { buffer, filename, contentType };
  }

  async generateImportTemplate(
    config: EntityTransferConfig
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const importConfig = config.importConfig;

    if (!importConfig) {
      throw new Error(`Entity "${config.entityId}" does not support import`);
    }

    let buffer: Buffer;
    let contentType: string;
    let filenameExt: string;

    if (importConfig.format === 'csv') {
      buffer = await generateCsvTemplate(importConfig.columns);
      contentType = 'text/csv; charset=utf-8';
      filenameExt = '.csv';
    } else {
      buffer = generateJsonTemplate(importConfig.columns);
      contentType = 'application/json; charset=utf-8';
      filenameExt = '.json';
    }

    const filename = `${config.entityId}-import-template${filenameExt}`;
    return { buffer, filename, contentType };
  }
}
