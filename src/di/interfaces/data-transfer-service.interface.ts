import type { Queue } from 'bullmq';
import type {
  EntityTransferConfig,
  ExportFilters,
  ExportContext,
  ImportContext,
  ImportResult,
  ValidationResult,
} from '../../services/data-transfer/types.js';

export interface IDataTransferService {
  /**
   * Validate all rows synchronously (called in web process before enqueuing).
   * Returns validation errors and duplicate check results immediately.
   */
  validateImport(
    rows: Record<string, unknown>[],
    config: EntityTransferConfig,
    ctx: ImportContext
  ): Promise<ValidationResult>;

  /**
   * Enqueue a validated import job to BullMQ (called from controller in web process).
   * Only call after validateImport returns valid=true.
   * Returns the BullMQ job ID for SSE progress tracking.
   */
  enqueueImport(
    queue: Queue,
    entityId: string,
    rows: Record<string, unknown>[],
    ctx: ImportContext
  ): Promise<string>;

  /**
   * Execute import insert phase (called inside BullMQ worker handler).
   * Rows are already validated — this only prepares and inserts.
   * Reports progress and returns ImportResult.
   */
  executeImport(
    rows: Record<string, unknown>[],
    config: EntityTransferConfig,
    ctx: ImportContext,
    reportProgress: (progress: number) => Promise<void>
  ): Promise<ImportResult>;

  /**
   * Generate export file (CSV or JSON based on entity config format).
   */
  generateExport(
    config: EntityTransferConfig,
    filters: ExportFilters,
    ctx: ExportContext
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }>;

  /**
   * Generate import template file.
   */
  generateImportTemplate(
    config: EntityTransferConfig
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }>;
}
