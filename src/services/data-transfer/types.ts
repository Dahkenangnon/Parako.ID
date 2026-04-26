import { z } from 'zod';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

export type TransferFormat = 'csv' | 'json';

export interface EntityColumnDef {
  field: string;
  header: string;
  required?: boolean;
  group: 'core' | 'sensitive' | 'internal';
  formatter?: (value: unknown) => string;
  validator?: z.ZodType;
  aliases?: string[];
}

export interface EntityImportConfig {
  format: TransferFormat;
  columns: EntityColumnDef[];
  requiredFields: string[];
  prepareRow: (
    row: Record<string, unknown>,
    context: ImportContext
  ) => Promise<Record<string, unknown>>;
  checkDuplicate: (
    row: Record<string, unknown>,
    context: ImportContext
  ) => Promise<string | null>;
  insertRow: (
    data: Record<string, unknown>,
    context: ImportContext
  ) => Promise<void>;
  maxRows?: number;
}

export interface EntityExportConfig {
  format: TransferFormat;
  columns: EntityColumnDef[];
  loadData: (
    filters: ExportFilters,
    context: ExportContext
  ) => Promise<Record<string, unknown>[]>;
  filenamePrefix: string;
}

export interface EntityTransferConfig {
  entityId: string;
  displayName: string;
  description: string;
  importConfig?: EntityImportConfig;
  exportConfig?: EntityExportConfig;
}

export interface ImportContext {
  logger: ILogger;
  adminUser: { username: string; email?: string };
  tenantId: string;
}

export interface ExportContext {
  logger: ILogger;
  adminUser: { username: string; email?: string };
  tenantId: string;
}

export interface ExportFilters {
  includeSensitive?: boolean;
  includeSecrets?: boolean;
  dateFrom?: string;
  dateTo?: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  totalRows: number;
  validCount: number;
  errors: ImportRowError[];
  skippedCount: number;
}

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  errors: ImportRowError[];
  durationMs: number;
}

export interface ImportRowError {
  rowNumber: number;
  fields: Record<string, string>;
  error: string;
}
