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

function invalidCursorFields(detail: string, message: string): ApiError {
  return new ApiError({
    type: ERROR_TYPES.VALIDATION,
    title: 'Validation Error',
    status: 422,
    detail,
    errors: [{ field: 'after', message }],
  });
}

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

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw invalidCursorFields(
      'Invalid cursor: cursor must contain at least one field',
      'Cursor must contain at least one field'
    );
  }
  if (entries.some(([, value]) => typeof value !== 'string')) {
    throw invalidCursorFields(
      'Invalid cursor: cursor field values must be strings',
      'Cursor field values must be strings'
    );
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
  const idValue = fields.id ?? fields._id;

  // Simple cursor — sorting by a single field only.
  if (sortField === 'id') {
    if (idValue === undefined) {
      throw invalidCursorFields(
        'Invalid cursor: cursor is missing an id field',
        'Cursor must contain an id or _id field'
      );
    }
    return { id: { [op]: idValue } };
  }
  // Backward compatibility: explicit _id sort field still works.
  if (sortField === '_id') {
    if (idValue === undefined) {
      throw invalidCursorFields(
        'Invalid cursor: cursor is missing an id field',
        'Cursor must contain an id or _id field'
      );
    }
    return { _id: { [op]: idValue } };
  }

  // Compound cursor — return both range filters separately.
  // The repository layer is responsible for combining these into
  // the appropriate compound query for the active database.
  const result: Record<string, unknown> = {};
  const sortValue = fields[sortField];

  if (sortValue === undefined) {
    throw invalidCursorFields(
      `Invalid cursor: cursor is missing the '${sortField}' sort field`,
      `Cursor must contain the '${sortField}' sort field`
    );
  }
  if (idValue === undefined) {
    throw invalidCursorFields(
      'Invalid cursor: compound cursor is missing an id field',
      'Compound cursor must contain an id or _id field'
    );
  }

  result[sortField] = { [op]: sortValue };
  result.id = { [op]: idValue };

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
 * @param getStableIdentifier - Optional selector for records whose stable
 *                              identifier is not exposed as `id` or `_id`.
 */
type PersistedDocument = { _id?: unknown; id?: unknown };

export function buildCursorResponse<T extends PersistedDocument>(
  docs: T[],
  limit: number,
  cursorField?: string,
  totalCount?: number
): CursorPage<T>;
export function buildCursorResponse<T extends object>(
  docs: T[],
  limit: number,
  cursorField: string,
  totalCount: number | undefined,
  getStableIdentifier: (document: T) => unknown
): CursorPage<T>;
export function buildCursorResponse<T extends object>(
  docs: T[],
  limit: number,
  cursorField: string = 'id',
  totalCount?: number,
  getStableIdentifier: (document: T) => unknown = document => {
    const persistedDocument = document as PersistedDocument;
    return persistedDocument.id ?? persistedDocument._id;
  }
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
    cursorFields.id = String(getStableIdentifier(lastDoc));
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
  let limit = 25;
  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const parsed = Number(query.limit);
    if (!Number.isNaN(parsed)) {
      limit = Math.max(1, Math.min(100, Math.floor(parsed)));
    }
  }

  let cursor: string | undefined;
  if (typeof query.after === 'string' && query.after.length > 0) {
    cursor = query.after;
  }

  let includeCount = false;
  const raw = query.include_count;
  if (raw === true || raw === 'true' || raw === '1') {
    includeCount = true;
  }

  return { limit, cursor, includeCount };
}
