import { type IBaseModel } from '../../models/base.model.js';

/**
 * Generic record used as a query filter — intentionally db-agnostic.
 * Callers may embed MongoDB-style operators ($in, $gte, …) when targeting
 * a Mongoose backend; those are transparently forwarded. For Prisma backends,
 * the repository layer translates the filter into the appropriate WHERE clause.
 */
type FilterInput = Record<string, unknown>;

/** Result of a bulk-update operation */
export interface BulkWriteResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount?: number;
}

/** Result of a bulk-delete operation */
export interface BulkDeleteResult {
  deletedCount: number;
}

/**
 * Interface for BaseService — provides common CRUD operations for all services.
 * All types are db-agnostic: no Mongoose, MongoDB-driver, or Prisma references.
 */
export interface IBaseService<T extends IBaseModel> {
  createOne(data: Partial<T>, options?: { ordered?: boolean }): Promise<T>;

  createMany(data: Partial<T>[], options?: { ordered?: boolean }): Promise<T[]>;

  findOne(
    filter: FilterInput | string,
    options?: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      skip?: number;
    }
  ): Promise<T | null>;

  findMany(
    filter?: FilterInput,
    options?: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      limit?: number;
      skip?: number;
    }
  ): Promise<T[]>;

  updateById(
    id: string,
    data: Partial<T>,
    options?: {
      upsert?: boolean;
      runValidators?: boolean;
    }
  ): Promise<T | null>;

  updateMany(
    filter: FilterInput,
    data: Partial<T>,
    options?: {
      upsert?: boolean;
      runValidators?: boolean;
    }
  ): Promise<BulkWriteResult>;

  deleteOne(filter: FilterInput | string): Promise<T | null>;

  deleteMany(filter: FilterInput): Promise<BulkDeleteResult>;

  // ===== PAGINATION =====

  findWithPagination(
    filter?: FilterInput,
    options?: {
      page: number;
      limit: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
    }
  ): Promise<{
    results: T[];
    page: number;
    limit: number;
    totalResults: number;
    totalPages: number;
  }>;

  countDocuments(filter?: FilterInput): Promise<number>;

  // ===== UTILITY =====

  /** Raw aggregation — implementation may throw for non-MongoDB backends. */
  aggregate(pipeline: unknown[]): Promise<unknown[]>;
}
