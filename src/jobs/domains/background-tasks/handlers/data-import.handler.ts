import { z } from 'zod';
import type { BackgroundJobData } from '../worker.js';
import type { IDataTransferService } from '../../../../di/interfaces/data-transfer-service.interface.js';
import type { ILogger } from '../../../../di/interfaces/logger.interface.js';
import type { ImportContext } from '../../../../services/data-transfer/types.js';
import {
  entityConfigFactories,
  type EntityConfigDeps,
} from '../../../../services/data-transfer/entities/index.js';

/**
 * Zod schema to validate data import job payload.
 */
const DataImportJobSchema = z.object({
  type: z.string(),
  name: z.literal('data-import'),
  entityId: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  tenantId: z.string().optional(),
  adminUser: z.object({
    username: z.string(),
    email: z.string().optional(),
  }),
});

/**
 * Data import handler for the background-tasks worker.
 *
 * tenantId is already set in AsyncLocalStorage by the worker processor
 * (see src/jobs/domains/background-tasks/worker.ts:87).
 * All downstream service/repository calls auto-scope to this tenant.
 */
export function createDataImportHandler(
  dataTransferService: IDataTransferService,
  entityConfigDeps: EntityConfigDeps,
  logger: ILogger
) {
  return async (
    data: BackgroundJobData,
    reportProgress: (progress: number) => Promise<void>
  ): Promise<unknown> => {
    const parsed = DataImportJobSchema.parse(data);
    const { entityId, rows, adminUser, tenantId } = parsed;

    const configFactory = entityConfigFactories[entityId];
    if (!configFactory) {
      throw new Error(`Unknown entity: ${entityId}`);
    }

    const entityConfig = configFactory(entityConfigDeps);
    const ctx: ImportContext = {
      logger,
      adminUser,
      tenantId: tenantId ?? 'default',
    };

    return dataTransferService.executeImport(
      rows,
      entityConfig,
      ctx,
      reportProgress
    );
  };
}
