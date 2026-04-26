/**
 * Cursor-based pagination utilities for the Parako.ID Management API v1.
 *
 * Implements opaque cursor encoding/decoding, DB-agnostic query construction
 * for keyset pagination, and response envelope building following Decision 9.
 *
 * Cursors are URL-safe base64 encoded JSON objects containing the sort field
 * value(s) needed to resume iteration.
 */

import type { CursorPage } from './types.js';
import { ApiError, ERROR_TYPES } from './errors.js';

// Cursor encoding / decoding

/**
 * Encode a set of cursor fields into a URL-safe, opaque cursor string.
 *
 * The cursor is a base64url-encoded JSON object — callers should never need
 * to inspect or construct cursors manually.
 */
export function encodeCursor(fields: Record<string, string>): string {
  const json = JSON.stringify(fields);
  return Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a cursor string back into its constituent fields.
 *
 * @throws {ApiError} 422 if the cursor is malformed or does not decode to a
 *   valid JSON object.
 */
export function decodeCursor(cursor: string): Record<string, string> {
  let parsed: unknown;

  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    parsed = JSON.parse(json);
  } catch {
    throw new ApiError({
      type: ERROR_TYPES.VALIDATION,
      title: 'Validation Error',
      status: 422,
      detail: 'Invalid cursor: unable to decode cursor string',
      errors: [
        {
          field: 'after',
          message: 'Cursor is not valid base64url-encoded JSON',
        },
      ],
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError({
      type: ERROR_TYPES.VALIDATION,
      title: 'Validation Error',
      status: 422,
      detail: 'Invalid cursor: decoded value is not a JSON object',
      errors: [
        { field: 'after', message: 'Cursor must decode to a JSON object' },
      ],
    });
  }

  return parsed as Record<string, string>;
}

/**
 * Build a filter for cursor-based keyset pagination.
 *
 * Uses the `{ $gt }` / `{ $lt }` range-filter convention that both
 * repository backends already understand:
 * - MongoDB (Mongoose): passes through natively
 * - Prisma: translated by the repository's `buildWhere()` method
 *   (maps `$gte` → `gte`, `$lte` → `lte`, etc.)
 *
 * For simple `id`-only cursors the query uses a single comparison operator.
 * For compound cursors (e.g. `timestamp` + `id`) the query uses the same
 * range convention on both fields — the repository layer handles the
 * DB-specific compound ordering logic.
 *
 * @param cursor        - Opaque cursor string from a previous response.
 * @param sortField     - The primary sort field name (default `id`).
 * @param sortDirection - `asc` or `desc` (default `asc`).
 * @returns A filter object to merge into the query pipeline.
 */
export function buildCursorQuery(
  cursor?: string,
  sortField: string = 'id',
  sortDirection: 'asc' | 'desc' = 'asc'
): Record<string, unknown> {
  if (!cursor) {
    return {};
  }

  const fields = decodeCursor(cursor);
  const op = sortDirection === 'asc' ? '$gt' : '$lt';

  // Simple cursor — sorting by a single field only.
  if (sortField === 'id') {
    return { id: { [op]: fields.id ?? fields._id } };
  }
  // Backward compatibility: explicit _id sort field still works.
  if (sortField === '_id') {
    return { _id: { [op]: fields._id ?? fields.id } };
  }

  // Compound cursor — return both range filters separately.
  // The repository layer is responsible for combining these into
  // the appropriate compound query for the active database.
  const result: Record<string, unknown> = {};
  const sortValue = fields[sortField];
  const idValue = fields.id ?? fields._id;

  if (sortValue !== undefined) {
    result[sortField] = { [op]: sortValue };
  }
  if (idValue !== undefined) {
    result.id = { [op]: idValue };
  }

  return result;
}

/**
 * Build a cursor-paginated response envelope from a set of documents.
 *
 * Callers should fetch `limit + 1` documents and pass all of them here.
 * If the extra document exists, `has_more` is set to `true` and the extra
 * document is stripped from the returned `data` array.
 *
 * @param docs        - Documents fetched from the database (up to `limit + 1`).
 * @param limit       - The requested page size.
 * @param cursorField - The primary sort field used for cursor construction
 *                      (default `id`).
 * @param totalCount  - Optional total count to include when the caller
 *                      requested `?include_count=true`.
 */
export function buildCursorResponse<T extends { _id?: unknown; id?: unknown }>(
  docs: T[],
  limit: number,
  cursorField: string = 'id',
  totalCount?: number
): CursorPage<T> {
  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  let nextCursor: string | null = null;

  if (hasMore && data.length > 0) {
    const lastDoc = data[data.length - 1];
    const cursorFields: Record<string, string> = {};

    if (cursorField !== 'id') {
      cursorFields[cursorField] = String(
        (lastDoc as Record<string, unknown>)[cursorField]
      );
    }

    // Support both Prisma (id) and MongoDB (_id) document shapes
    cursorFields.id = String(lastDoc.id ?? lastDoc._id);
    nextCursor = encodeCursor(cursorFields);
  }

  const pagination: CursorPage<T>['pagination'] = {
    has_more: hasMore,
    next_cursor: nextCursor,
  };

  if (totalCount !== undefined) {
    pagination.total_count = totalCount;
  }

  return { data, pagination };
}

/**
 * Parse and validate pagination-related query parameters from a request.
 *
 * - `limit`  — page size, clamped to `[1, 100]`, default `25`.
 * - `after`  — opaque cursor string from a previous response.
 * - `include_count` — whether to include `total_count` in the response.
 */
export function parsePaginationParams(query: Record<string, unknown>): {
  limit: number;
  cursor?: string;
  includeCount: boolean;
} {
  // --- limit ---
  let limit = 25;
  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const parsed = Number(query.limit);
    if (!Number.isNaN(parsed)) {
      limit = Math.max(1, Math.min(100, Math.floor(parsed)));
    }
  }

  // --- cursor (after) ---
  let cursor: string | undefined;
  if (typeof query.after === 'string' && query.after.length > 0) {
    cursor = query.after;
  }

  // --- include_count ---
  let includeCount = false;
  const raw = query.include_count;
  if (raw === true || raw === 'true' || raw === '1') {
    includeCount = true;
  }

  return { limit, cursor, includeCount };
}
