import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import { QueueEvents, Job } from 'bullmq';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IUserService } from '../../di/interfaces/user-service.interface.js';
import type { IPasswordUtils } from '../../di/interfaces/password-utils.interface.js';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IDataTransferService } from '../../di/interfaces/data-transfer-service.interface.js';
import type { IAdminDataTransferController } from '../../di/interfaces/admin-data-transfer-controller.interface.js';
import { TYPES } from '../../di/types.js';
import { tenantContext } from '../../multi-tenancy/tenant-context.js';
import {
  entityConfigFactories,
  ENTITY_IDS,
  type EntityConfigDeps,
} from '../../services/data-transfer/entities/index.js';
import { createBackgroundTaskQueue } from '../../jobs/domains/background-tasks/queue.js';
import {
  buildQueueRedisOptions,
  type QueueRedisOptions,
} from '../../jobs/redis.js';
import { QUEUE_NAMES, QUEUE_PREFIX } from '../../jobs/config.js';

const REDIS_UNAVAILABLE_MSG =
  'Background jobs require Redis. Configure REDIS_HOST in .env and ensure Redis is running.';

@injectable()
export class AdminDataTransferController implements IAdminDataTransferController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.UserService)
    private readonly userService: IUserService,
    @inject(TYPES.PasswordUtils)
    private readonly passwordUtils: IPasswordUtils,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapterBridge: IOIDCAdapterBridge,
    @inject(TYPES.DataTransferService)
    private readonly dataTransferService: IDataTransferService
  ) {}

  /**
   * Hub page showing all entity cards
   * GET /admin/data-transfer
   */
  public overview = async (_req: Request, res: Response): Promise<void> => {
    const entities = ENTITY_IDS.map(id => {
      const config = this.getEntityConfig(id);
      return {
        entityId: config.entityId,
        displayName: config.displayName,
        description: config.description,
        hasImport: !!config.importConfig,
        hasExport: !!config.exportConfig,
        format: config.importConfig?.format ?? config.exportConfig?.format,
      };
    });

    res.render('admin/data-transfer/index', {
      title: 'Data Transfer',
      entities,
    });
  };

  /**
   * Per-entity import/export page
   * GET /admin/data-transfer/:entityId
   */
  public entityPage = async (req: Request, res: Response): Promise<void> => {
    const { entityId } = req.params;
    const config = this.getEntityConfigSafe(entityId);

    if (!config) {
      this.sessionManager.flash(req).error('Unknown entity type');
      res.redirect('/admin/data-transfer');
      return;
    }

    const importColumns = config.importConfig?.columns.map(c => ({
      field: c.field,
      header: c.header,
      required: !!c.required,
      aliases: c.aliases ?? [],
    }));

    res.render('admin/data-transfer/entity', {
      title: `${config.displayName} - Data Transfer`,
      entity: {
        entityId: config.entityId,
        displayName: config.displayName,
        description: config.description,
        hasImport: !!config.importConfig,
        hasExport: !!config.exportConfig,
        format: config.importConfig?.format ?? config.exportConfig?.format,
      },
      importColumns,
    });
  };

  /**
   * Start import: validate rows synchronously, return errors immediately
   * or enqueue BullMQ job for the insert phase if all rows are valid.
   *
   * POST /admin/data-transfer/:entityId/import
   */
  public startImport = async (req: Request, res: Response): Promise<void> => {
    const { entityId } = req.params;
    const config = this.getEntityConfigSafe(entityId);

    if (!config || !config.importConfig) {
      res.status(400).json({ error: 'Import not supported for this entity' });
      return;
    }

    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'No rows provided' });
      return;
    }

    const maxRows = config.importConfig.maxRows ?? 5000;
    if (rows.length > maxRows) {
      res
        .status(400)
        .json({ error: `Too many rows (max ${maxRows}). Got ${rows.length}.` });
      return;
    }

    try {
      const tenantId = tenantContext.getTenantId();
      const currentUser = this.sessionManager.getActiveUser(req);
      const adminUser = {
        username: currentUser?.username ?? 'unknown',
        email: currentUser?.email,
      };
      const ctx = { logger: this.logger, adminUser, tenantId };

      // Phase 1: Synchronous validation (field validation + duplicate checks)
      const validation = await this.dataTransferService.validateImport(
        rows,
        config,
        ctx
      );

      if (!validation.valid) {
        // Return validation errors immediately — no async job needed
        res.json({
          phase: 'validation',
          valid: false,
          totalRows: validation.totalRows,
          validCount: validation.validCount,
          skippedCount: validation.skippedCount,
          errors: validation.errors,
        });
        return;
      }

      // Phase 2: All rows valid — enqueue async insert job
      const redisOpts = this.getRedisOpts();
      const queue = await createBackgroundTaskQueue(redisOpts);

      if (!queue) {
        res.status(503).json({ error: REDIS_UNAVAILABLE_MSG });
        return;
      }

      try {
        const jobId = await this.dataTransferService.enqueueImport(
          queue,
          entityId,
          rows,
          ctx
        );

        res.json({
          phase: 'enqueued',
          valid: true,
          jobId,
          totalRows: validation.totalRows,
          validCount: validation.validCount,
        });
      } finally {
        await queue.close();
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'data_import_failed',
        entityId,
      });
      res.status(500).json({ error: 'Failed to process import' });
    }
  };

  /**
   * Poll import job status (non-SSE fallback).
   * GET /admin/data-transfer/:entityId/import/:jobId/status
   */
  public importStatus = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params;
    const currentTenantId = tenantContext.getTenantId();

    const redisOpts = this.getRedisOpts();
    const queue = await createBackgroundTaskQueue(redisOpts);

    if (!queue) {
      res.status(503).json({ error: REDIS_UNAVAILABLE_MSG });
      return;
    }

    try {
      const job = await Job.fromId(queue, jobId);
      if (!job || job.data.tenantId !== currentTenantId) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      const state = await job.getState();
      const progress = typeof job.progress === 'number' ? job.progress : 0;

      if (state === 'completed') {
        res.json({ state: 'completed', result: job.returnvalue });
      } else if (state === 'failed') {
        res.json({ state: 'failed', error: job.failedReason });
      } else {
        res.json({ state, progress });
      }
    } finally {
      await queue.close();
    }
  };

  /**
   * SSE stream for import job progress
   * GET /admin/data-transfer/:entityId/import/:jobId/progress
   */
  public importProgress = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const { jobId } = req.params;
    const currentTenantId = tenantContext.getTenantId();

    const redisOpts = this.getRedisOpts();
    const queue = await createBackgroundTaskQueue(redisOpts);

    if (!queue) {
      res.status(503).json({ error: REDIS_UNAVAILABLE_MSG });
      return;
    }

    const job = await Job.fromId(queue, jobId);
    if (!job || job.data.tenantId !== currentTenantId) {
      await queue.close();
      res.status(404).json({ error: 'Import job not found' });
      return;
    }

    const state = await job.getState();
    if (state === 'completed') {
      const result = job.returnvalue;
      await queue.close();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: completed\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
      return;
    }
    if (state === 'failed') {
      await queue.close();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(
        `event: failed\ndata: ${JSON.stringify({ error: job.failedReason })}\n\n`
      );
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ jobId })}\n\n`);

    const queueEvents = new QueueEvents(QUEUE_NAMES.BACKGROUND_TASKS, {
      connection: buildQueueRedisOptions(redisOpts),
      prefix: QUEUE_PREFIX,
    });

    let cleaned = false;
    let sseTimeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      if (sseTimeout) clearTimeout(sseTimeout);
      try {
        await queueEvents.close();
        await queue.close();
      } catch {
        // best-effort: the SSE client already disconnected — closing
        // already-closed queue handles can throw but is harmless here.
      }
      res.end();
    };

    queueEvents.on(
      'progress',
      ({ jobId: jId, data }: { jobId: string; data: unknown }) => {
        if (jId === jobId) {
          res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
        }
      }
    );

    queueEvents.on(
      'completed',
      ({ jobId: jId, returnvalue }: { jobId: string; returnvalue: string }) => {
        if (jId === jobId) {
          res.write(`event: completed\ndata: ${returnvalue}\n\n`);
          cleanup();
        }
      }
    );

    queueEvents.on(
      'failed',
      ({
        jobId: jId,
        failedReason,
      }: {
        jobId: string;
        failedReason: string;
      }) => {
        if (jId === jobId) {
          res.write(
            `event: failed\ndata: ${JSON.stringify({ error: failedReason })}\n\n`
          );
          cleanup();
        }
      }
    );

    req.on('close', cleanup);

    // Timeout after 5 minutes
    sseTimeout = setTimeout(
      () => {
        res.write(`event: timeout\ndata: {}\n\n`);
        cleanup();
      },
      5 * 60 * 1000
    );
  };

  /**
   * Export data as file download
   * GET /admin/data-transfer/:entityId/export
   */
  public exportData = async (req: Request, res: Response): Promise<void> => {
    const { entityId } = req.params;
    const config = this.getEntityConfigSafe(entityId);

    if (!config || !config.exportConfig) {
      this.sessionManager
        .flash(req)
        .error('Export not supported for this entity');
      res.redirect('/admin/data-transfer');
      return;
    }

    try {
      const tenantId = tenantContext.getTenantId();
      const currentUser = this.sessionManager.getActiveUser(req);
      const adminUser = {
        username: currentUser?.username ?? 'unknown',
        email: currentUser?.email,
      };
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      const filters = {
        includeSensitive: req.query.includeSensitive === 'true',
        includeSecrets: req.query.includeSecrets === 'true',
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        type: req.query.type as string | undefined,
        status: req.query.status as string | undefined,
        username: req.query.username as string | undefined,
      };

      if (filters.includeSecrets) {
        this.activityService.warning(
          'sensitive_data_export',
          `Admin exported ${config.displayName} with secrets/internal data`,
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              ...currentUser,
              actor_type: 'admin',
            },
            target: {
              target_type: 'system',
              entity_data: { entityId, filters },
            },
          }
        );
      }

      const { buffer, filename, contentType } =
        await this.dataTransferService.generateExport(config, filters, {
          logger: this.logger,
          adminUser,
          tenantId,
        });

      this.activityService.success(
        `${entityId}_exported_by_admin`,
        `Admin exported ${config.displayName}`,
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'system',
            entity_data: { entityId, filename },
          },
        }
      );

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );
      res.send(buffer);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'data_export_failed',
        entityId,
      });
      this.sessionManager.flash(req).error('Failed to export data');
      res.redirect(`/admin/data-transfer/${entityId}`);
    }
  };

  /**
   * Download import template
   * GET /admin/data-transfer/:entityId/import/template
   */
  public downloadTemplate = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const { entityId } = req.params;
    const config = this.getEntityConfigSafe(entityId);

    if (!config || !config.importConfig) {
      this.sessionManager
        .flash(req)
        .error('Import not supported for this entity');
      res.redirect('/admin/data-transfer');
      return;
    }

    try {
      const { buffer, filename, contentType } =
        await this.dataTransferService.generateImportTemplate(config);

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );
      res.send(buffer);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'template_download_failed',
        entityId,
      });
      this.sessionManager.flash(req).error('Failed to generate template');
      res.redirect(`/admin/data-transfer/${entityId}`);
    }
  };

  // ── Private helpers ──────────────────────────────────────────────────────

  private getEntityConfigDeps(): EntityConfigDeps {
    return {
      userService: this.userService,
      activityService: this.activityService,
      oidcAdapterBridge: this.oidcAdapterBridge,
      passwordUtils: this.passwordUtils,
      logger: this.logger,
    };
  }

  private getEntityConfig(entityId: string) {
    if (
      !Object.prototype.hasOwnProperty.call(entityConfigFactories, entityId)
    ) {
      throw new Error(`Unknown entity: ${entityId}`);
    }
    const factory = entityConfigFactories[entityId];
    if (typeof factory !== 'function') {
      throw new Error(`Unknown entity: ${entityId}`);
    }
    return factory(this.getEntityConfigDeps());
  }

  private getEntityConfigSafe(entityId: string) {
    if (
      typeof entityId !== 'string' ||
      !Object.prototype.hasOwnProperty.call(entityConfigFactories, entityId)
    ) {
      return null;
    }
    const factory = entityConfigFactories[entityId];
    if (typeof factory !== 'function') return null;
    return factory(this.getEntityConfigDeps());
  }

  private getRedisOpts(): QueueRedisOptions {
    const config = this.configManager.getConfig();
    const redis = config.oidc_storage.oidc_adapter.redis;
    return {
      host: redis.host,
      port: redis.port,
      password: redis.password,
      database: redis.database,
    };
  }
}
