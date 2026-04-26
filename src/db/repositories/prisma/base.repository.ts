import type { PrismaClient } from '@prisma/client';
import type {
  PaginatedResult,
  PaginationOptions,
} from '../interfaces/base.repository.js';

export function toOrderBy(
  sort: Record<string, 1 | -1 | 'asc' | 'desc'>
): Record<string, 'asc' | 'desc'> {
  return Object.fromEntries(
    Object.entries(sort).map(([k, v]) => [
      k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`),
      v === 1 || v === 'asc' ? 'asc' : 'desc',
    ])
  );
}

/**
 * MongoDB `$`-prefixed operator → Prisma operator mapping.
 *
 * The cross-DB filter convention used by repository interfaces (e.g.
 * `ActivityFilter.timestamp: { $gte?: Date; $lte?: Date }`) and by the
 * Management API pagination module uses `$`-prefixed operators.  Mongoose
 * repos pass these natively; Prisma repos must strip the prefix.
 *
 * This mapping is applied automatically in `paginateDelegate` so that
 * callers don't need to know which database backend is active.
 */
const MONGO_OP_TO_PRISMA: Record<string, string> = {
  $gt: 'gt',
  $gte: 'gte',
  $lt: 'lt',
  $lte: 'lte',
  $ne: 'not',
  $in: 'in',
  $nin: 'notIn',
};

/**
 * Translate a filter from the cross-DB `$`-prefix convention into
 * Prisma-native format.
 *
 * - `_id` key is renamed to `id`.
 * - Operator objects like `{ $gt: v }` become `{ gt: v }`.
 * - Already-Prisma-format filters pass through unchanged (idempotent).
 */
function normalizeToPrisma(
  filter: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filter)) {
    const pKey = key === '_id' ? 'id' : key;

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const inner = value as Record<string, unknown>;
      const hasMongoOps = Object.keys(inner).some(k => k in MONGO_OP_TO_PRISMA);

      if (hasMongoOps) {
        const mapped: Record<string, unknown> = {};
        for (const [op, val] of Object.entries(inner)) {
          const pOp = MONGO_OP_TO_PRISMA[op];
          mapped[pOp ?? op] = val;
        }
        out[pKey] = mapped;
      } else {
        out[pKey] = value;
      }
    } else {
      out[pKey] = value;
    }
  }

  return out;
}

/**
 * Shared utilities for all Prisma repository implementations.
 * Does NOT attempt to provide a generic delegate-based CRUD layer, because
 * most models require complex joins that must be typed per-model.
 * Subclasses implement the IBaseRepository interface directly.
 */
export abstract class AbstractPrismaRepository {
  constructor(protected readonly prisma: PrismaClient) {}

  protected async paginateDelegate<T>(
    delegate: {
      findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
      count: (args?: Record<string, unknown>) => Promise<number>;
    },
    filter: Record<string, unknown>,
    opts?: PaginationOptions,
    mapper?: (row: unknown) => T
  ): Promise<PaginatedResult<T>> {
    const page = opts?.page ?? 1;
    const limit = opts?.limit ?? 20;
    const skip = (page - 1) * limit;
    const orderBy = opts?.sort ? toOrderBy(opts.sort) : { created_at: 'desc' };
    const where = normalizeToPrisma(filter);

    const [rows, totalResults] = await Promise.all([
      delegate.findMany({ where, take: limit, skip, orderBy }),
      delegate.count({ where }),
    ]);

    const totalPages = Math.ceil(totalResults / limit);
    const results = (mapper ? rows.map(mapper) : rows) as T[];
    return {
      results,
      totalResults,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }

  protected incrementPatch(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }
}
