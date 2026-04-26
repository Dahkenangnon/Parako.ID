import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  buildCursorQuery,
  buildCursorResponse,
  parsePaginationParams,
} from '../../../../src/api/v1/pagination.js';
import { ApiError } from '../../../../src/api/v1/errors.js';

describe('api/v1/pagination', () => {
  // -----------------------------------------------------------------------
  // encodeCursor / decodeCursor
  // -----------------------------------------------------------------------
  describe('encodeCursor()', () => {
    it('should create a base64url string that can be decoded back', () => {
      const fields = { _id: 'abc123' };
      const cursor = encodeCursor(fields);

      // Must be a non-empty string.
      expect(typeof cursor).toBe('string');
      expect(cursor.length).toBeGreaterThan(0);

      // Must be URL-safe: no +, /, or = characters.
      expect(cursor).not.toMatch(/[+/=]/);

      // Round-trip: decode must return the original fields.
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(fields);
    });

    it('should encode compound cursor fields', () => {
      const fields = { timestamp: '2024-01-15T10:30:00Z', _id: 'def456' };
      const cursor = encodeCursor(fields);

      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(fields);
    });
  });

  describe('decodeCursor()', () => {
    it('should decode a valid cursor', () => {
      const original = { _id: '507f1f77bcf86cd799439011' };
      const cursor = encodeCursor(original);

      const result = decodeCursor(cursor);
      expect(result).toEqual(original);
    });

    it('should throw ApiError for invalid base64', () => {
      expect(() => decodeCursor('!!!not-valid-base64!!!')).toThrow(ApiError);

      try {
        decodeCursor('!!!not-valid-base64!!!');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect((err as ApiError).detail).toContain('Invalid cursor');
      }
    });

    it('should throw ApiError for non-object JSON (string)', () => {
      // Encode a raw JSON string (not an object).
      const cursor = Buffer.from(JSON.stringify('just a string'), 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(() => decodeCursor(cursor)).toThrow(ApiError);

      try {
        decodeCursor(cursor);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect((err as ApiError).detail).toContain('not a JSON object');
      }
    });

    it('should throw ApiError for non-object JSON (number)', () => {
      const cursor = Buffer.from(JSON.stringify(42), 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(() => decodeCursor(cursor)).toThrow(ApiError);

      try {
        decodeCursor(cursor);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect((err as ApiError).detail).toContain('not a JSON object');
      }
    });

    it('should throw ApiError for non-object JSON (array)', () => {
      const cursor = Buffer.from(JSON.stringify([1, 2, 3]), 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(() => decodeCursor(cursor)).toThrow(ApiError);

      try {
        decodeCursor(cursor);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect((err as ApiError).detail).toContain('not a JSON object');
      }
    });

    it('should throw ApiError for non-object JSON (null)', () => {
      const cursor = Buffer.from(JSON.stringify(null), 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(() => decodeCursor(cursor)).toThrow(ApiError);

      try {
        decodeCursor(cursor);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect((err as ApiError).detail).toContain('not a JSON object');
      }
    });
  });

  describe('round-trip', () => {
    it('should return original data after encode then decode', () => {
      const original = {
        _id: '507f1f77bcf86cd799439011',
        createdAt: '2024-06-15T08:00:00.000Z',
      };

      const cursor = encodeCursor(original);
      const decoded = decodeCursor(cursor);

      expect(decoded).toEqual(original);
    });

    it('should handle special characters in field values', () => {
      const original = { _id: 'abc+/=123', name: 'hello world' };

      const cursor = encodeCursor(original);
      const decoded = decodeCursor(cursor);

      expect(decoded).toEqual(original);
    });
  });

  // -----------------------------------------------------------------------
  // buildCursorQuery
  // -----------------------------------------------------------------------
  describe('buildCursorQuery()', () => {
    it('should return empty object when no cursor is provided', () => {
      const result = buildCursorQuery();
      expect(result).toEqual({});
    });

    it('should return empty object when cursor is undefined', () => {
      const result = buildCursorQuery(undefined, '_id', 'asc');
      expect(result).toEqual({});
    });

    it('should return correct $gt query for ascending _id sort (explicit field)', () => {
      const cursor = encodeCursor({ _id: 'abc123' });

      const result = buildCursorQuery(cursor, '_id', 'asc');

      expect(result).toEqual({ _id: { $gt: 'abc123' } });
    });

    it('should return correct $lt query for descending _id sort (explicit field)', () => {
      const cursor = encodeCursor({ _id: 'abc123' });

      const result = buildCursorQuery(cursor, '_id', 'desc');

      expect(result).toEqual({ _id: { $lt: 'abc123' } });
    });

    it('should build separate range filters for non-id sort field (desc)', () => {
      const cursor = encodeCursor({
        timestamp: '2024-01-15T10:30:00Z',
        id: 'def456',
      });

      const result = buildCursorQuery(cursor, 'timestamp', 'desc');

      expect(result).toEqual({
        timestamp: { $lt: '2024-01-15T10:30:00Z' },
        id: { $lt: 'def456' },
      });
    });

    it('should build separate range filters for non-id sort field (asc)', () => {
      const cursor = encodeCursor({
        name: 'alpha',
        id: 'ghi789',
      });

      const result = buildCursorQuery(cursor, 'name', 'asc');

      expect(result).toEqual({
        name: { $gt: 'alpha' },
        id: { $gt: 'ghi789' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // buildCursorResponse
  // -----------------------------------------------------------------------
  describe('buildCursorResponse()', () => {
    it('should return has_more=false and next_cursor=null when docs <= limit', () => {
      const docs = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];

      const result = buildCursorResponse(docs, 5);

      expect(result.data).toHaveLength(3);
      expect(result.data).toEqual(docs);
      expect(result.pagination.has_more).toBe(false);
      expect(result.pagination.next_cursor).toBeNull();
    });

    it('should return has_more=false when docs length equals limit exactly', () => {
      const docs = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];

      const result = buildCursorResponse(docs, 3);

      expect(result.data).toHaveLength(3);
      expect(result.pagination.has_more).toBe(false);
      expect(result.pagination.next_cursor).toBeNull();
    });

    it('should return has_more=true and strip extra doc when docs > limit', () => {
      // Simulate fetching limit+1 docs (4 docs with limit=3).
      const docs = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'd' }];

      const result = buildCursorResponse(docs, 3);

      // Extra doc should be stripped.
      expect(result.data).toHaveLength(3);
      expect(result.data).toEqual([{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]);
      expect(result.pagination.has_more).toBe(true);

      // next_cursor should be based on the last returned doc ('c').
      expect(result.pagination.next_cursor).not.toBeNull();

      // Cursor now uses 'id' key (falls back to _id value when no id field)
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.id).toBe('c');
    });

    it('should include total_count only when provided', () => {
      const docs = [{ _id: 'a' }];

      // Without total_count.
      const withoutCount = buildCursorResponse(docs, 10);
      expect(withoutCount.pagination).not.toHaveProperty('total_count');

      // With total_count.
      const withCount = buildCursorResponse(docs, 10, 'id', 42);
      expect(withCount.pagination.total_count).toBe(42);
    });

    it('should include total_count of 0 when explicitly provided', () => {
      const result = buildCursorResponse([], 10, 'id', 0);

      expect(result.pagination.total_count).toBe(0);
    });

    it('should handle compound cursor fields', () => {
      const docs = [
        { _id: 'x1', createdAt: '2024-01-01' },
        { _id: 'x2', createdAt: '2024-01-02' },
        { _id: 'x3', createdAt: '2024-01-03' },
        { _id: 'x4', createdAt: '2024-01-04' }, // extra doc
      ];

      const result = buildCursorResponse(docs, 3, 'createdAt');

      expect(result.data).toHaveLength(3);
      expect(result.pagination.has_more).toBe(true);

      // Cursor should contain both the cursor field and id.
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.createdAt).toBe('2024-01-03');
      expect(decoded.id).toBe('x3'); // id key with _id value fallback
    });

    it('should handle empty docs array', () => {
      const result = buildCursorResponse([], 10);

      expect(result.data).toHaveLength(0);
      expect(result.pagination.has_more).toBe(false);
      expect(result.pagination.next_cursor).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // buildCursorResponse — DB-agnostic id field
  // -----------------------------------------------------------------------
  describe('buildCursorResponse — DB-agnostic id field', () => {
    it('should default cursorField to "id" (not "_id")', () => {
      const docs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
      const result = buildCursorResponse(docs, 3);
      expect(result.pagination.has_more).toBe(true);
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.id).toBe('c');
      expect(decoded._id).toBeUndefined();
    });

    it('should encode cursor using "id" key from documents with id field', () => {
      const docs = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }, { id: 'x4' }];
      const result = buildCursorResponse(docs, 3);
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.id).toBe('x3');
    });

    it('should fall back to _id when document has _id but no id (backward compat)', () => {
      const docs = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'd' }];
      const result = buildCursorResponse(docs, 3);
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.id).toBeDefined(); // Key is "id" in cursor
      expect(decoded.id).toBe('c'); // Value comes from _id
    });

    it('should prefer id over _id when document has both', () => {
      const docs = [
        { id: 'prisma-1', _id: 'mongo-1' },
        { id: 'prisma-2', _id: 'mongo-2' },
        { id: 'prisma-3', _id: 'mongo-3' },
        { id: 'prisma-4', _id: 'mongo-4' },
      ];
      const result = buildCursorResponse(docs, 3);
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.id).toBe('prisma-3');
    });

    it('should work with custom cursor field (e.g., "client_id")', () => {
      const docs = [
        { id: 'a', client_id: 'c1' },
        { id: 'b', client_id: 'c2' },
        { id: 'c', client_id: 'c3' },
        { id: 'd', client_id: 'c4' },
      ];
      const result = buildCursorResponse(docs, 3, 'client_id');
      const decoded = decodeCursor(result.pagination.next_cursor!);
      expect(decoded.client_id).toBe('c3');
      expect(decoded.id).toBe('c');
    });
  });

  // -----------------------------------------------------------------------
  // buildCursorQuery — DB-agnostic id field
  // -----------------------------------------------------------------------
  describe('buildCursorQuery — DB-agnostic id field', () => {
    it('should default sortField to "id"', () => {
      const cursor = encodeCursor({ id: 'abc123' });
      const result = buildCursorQuery(cursor);
      expect(result).toEqual({ id: { $gt: 'abc123' } });
    });

    it('should build filter using "id" key for simple cursor', () => {
      const cursor = encodeCursor({ id: 'test-id' });
      const result = buildCursorQuery(cursor, 'id', 'desc');
      expect(result).toEqual({ id: { $lt: 'test-id' } });
    });

    it('should handle legacy cursors encoded with "_id" key (backward compat)', () => {
      // A cursor encoded with the old _id key should still work
      const cursor = encodeCursor({ _id: 'legacy-id' });
      const result = buildCursorQuery(cursor, 'id', 'asc');
      // Should extract from fields._id since fields.id is undefined
      expect(result.id).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // parsePaginationParams
  // -----------------------------------------------------------------------
  describe('parsePaginationParams()', () => {
    it('should return defaults for empty query', () => {
      const result = parsePaginationParams({});

      expect(result.limit).toBe(25);
      expect(result.cursor).toBeUndefined();
      expect(result.includeCount).toBe(false);
    });

    it('should parse a valid limit', () => {
      const result = parsePaginationParams({ limit: '50' });
      expect(result.limit).toBe(50);
    });

    it('should parse numeric limit', () => {
      const result = parsePaginationParams({ limit: 30 });
      expect(result.limit).toBe(30);
    });

    it('should clamp limit below minimum to 1', () => {
      const result = parsePaginationParams({ limit: '0' });
      expect(result.limit).toBe(1);
    });

    it('should clamp negative limit to 1', () => {
      const result = parsePaginationParams({ limit: '-5' });
      expect(result.limit).toBe(1);
    });

    it('should clamp limit above maximum to 100', () => {
      const result = parsePaginationParams({ limit: '500' });
      expect(result.limit).toBe(100);
    });

    it('should floor fractional limit values', () => {
      const result = parsePaginationParams({ limit: '25.9' });
      expect(result.limit).toBe(25);
    });

    it('should use default limit for non-numeric strings', () => {
      const result = parsePaginationParams({ limit: 'abc' });
      expect(result.limit).toBe(25);
    });

    it('should use default limit for empty string', () => {
      const result = parsePaginationParams({ limit: '' });
      expect(result.limit).toBe(25);
    });

    it('should parse after as cursor string', () => {
      const cursor = encodeCursor({ _id: 'test123' });
      const result = parsePaginationParams({ after: cursor });

      expect(result.cursor).toBe(cursor);
    });

    it('should ignore empty after string', () => {
      const result = parsePaginationParams({ after: '' });
      expect(result.cursor).toBeUndefined();
    });

    it('should ignore non-string after values', () => {
      const result = parsePaginationParams({ after: 42 });
      expect(result.cursor).toBeUndefined();
    });

    it('should parse include_count as true for string "true"', () => {
      const result = parsePaginationParams({ include_count: 'true' });
      expect(result.includeCount).toBe(true);
    });

    it('should parse include_count as true for boolean true', () => {
      const result = parsePaginationParams({ include_count: true });
      expect(result.includeCount).toBe(true);
    });

    it('should parse include_count as true for string "1"', () => {
      const result = parsePaginationParams({ include_count: '1' });
      expect(result.includeCount).toBe(true);
    });

    it('should parse include_count as false for string "false"', () => {
      const result = parsePaginationParams({ include_count: 'false' });
      expect(result.includeCount).toBe(false);
    });

    it('should parse include_count as false for missing value', () => {
      const result = parsePaginationParams({});
      expect(result.includeCount).toBe(false);
    });

    it('should parse all parameters together', () => {
      const cursor = encodeCursor({ _id: 'xyz' });
      const result = parsePaginationParams({
        limit: '10',
        after: cursor,
        include_count: 'true',
      });

      expect(result.limit).toBe(10);
      expect(result.cursor).toBe(cursor);
      expect(result.includeCount).toBe(true);
    });
  });
});
