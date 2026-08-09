import { describe, it, expect } from 'vitest';

import {
  ADMIN_ACTIVITY_SORT_FIELDS,
  ADMIN_SESSION_SORT_FIELDS,
  ADMIN_USER_SORT_FIELDS,
  SORT_ORDER_VALUES,
  escapeRegExp,
  extractListingQuery,
  parseEnum,
  parsePositiveInt,
} from '../../../src/validators/listing-query.js';

const SORT_FIELDS = ['created_at', 'username', 'email'] as const;

describe('parsePositiveInt', () => {
  it('returns the default when the input is missing', () => {
    expect(parsePositiveInt(undefined, { default: 5 })).toBe(5);
  });

  it('returns the default when the input is non-numeric', () => {
    expect(parsePositiveInt('abc', { default: 7 })).toBe(7);
  });

  it('returns the default when only a numeric prefix can be parsed', () => {
    expect(parsePositiveInt('12px', { default: 7, max: 100 })).toBe(7);
  });

  it('returns the default for non-finite numeric input', () => {
    expect(parsePositiveInt(Number.POSITIVE_INFINITY, { default: 7 })).toBe(7);
  });

  it('parses a valid numeric string in radix 10', () => {
    expect(parsePositiveInt('42', { default: 1, min: 1, max: 100 })).toBe(42);
  });

  it('truncates a finite number rather than rounding', () => {
    expect(parsePositiveInt(3.9, { default: 1, min: 1, max: 100 })).toBe(3);
  });

  it('clamps below the minimum', () => {
    expect(parsePositiveInt('-5', { default: 1, min: 2, max: 10 })).toBe(2);
  });

  it('clamps above the maximum', () => {
    expect(parsePositiveInt('500', { default: 1, max: 100 })).toBe(100);
  });
});

describe('parseEnum', () => {
  it('returns the fallback when the input is not in the allowlist', () => {
    expect(parseEnum('nope', ['a', 'b'], 'a')).toBe('a');
  });

  it('returns the input when it is in the allowlist', () => {
    expect(parseEnum('b', ['a', 'b'], 'a')).toBe('b');
  });

  it('returns the fallback when the input is not a string', () => {
    expect(parseEnum(undefined, ['a'], 'a')).toBe('a');
    expect(parseEnum(42, ['a'], 'a')).toBe('a');
  });
});

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe(
      '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\'
    );
  });

  it('leaves plain alphanumeric input untouched', () => {
    expect(escapeRegExp('abc123')).toBe('abc123');
  });

  it('is idempotent (escape of escape equals escape)', () => {
    const once = escapeRegExp('a.b*c');
    expect(escapeRegExp(once)).toBe(once);
  });
});

describe('extractListingQuery', () => {
  it('returns the configured defaults on empty input', () => {
    const result = extractListingQuery({}, SORT_FIELDS, {
      sortBy: 'created_at',
    });
    expect(result).toEqual({
      page: 1,
      limit: 20,
      search: '',
      sortBy: 'created_at',
      sortOrder: 'desc',
    });
  });

  it('parses valid page / limit / sort inputs', () => {
    const result = extractListingQuery(
      { page: '3', limit: '50', sortBy: 'email', sortOrder: 'asc' },
      SORT_FIELDS,
      { sortBy: 'created_at' }
    );
    expect(result).toEqual({
      page: 3,
      limit: 50,
      search: '',
      sortBy: 'email',
      sortOrder: 'asc',
    });
  });

  it('clamps page above the maximum and below the minimum', () => {
    const high = extractListingQuery({ page: '999999' }, SORT_FIELDS, {
      sortBy: 'created_at',
    });
    expect(high.page).toBe(10_000);

    const low = extractListingQuery({ page: '0' }, SORT_FIELDS, {
      sortBy: 'created_at',
    });
    expect(low.page).toBe(1);
  });

  it('clamps limit at the configured maxLimit', () => {
    const result = extractListingQuery({ limit: '500' }, SORT_FIELDS, {
      sortBy: 'created_at',
      maxLimit: 100,
    });
    expect(result.limit).toBe(100);
  });

  it('rejects sortBy values outside the allowlist', () => {
    const result = extractListingQuery({ sortBy: 'password' }, SORT_FIELDS, {
      sortBy: 'created_at',
    });
    expect(result.sortBy).toBe('created_at');
  });

  it('rejects invalid sortOrder values', () => {
    const result = extractListingQuery({ sortOrder: 'sideways' }, SORT_FIELDS, {
      sortBy: 'created_at',
    });
    expect(result.sortOrder).toBe('desc');
  });

  it('trims and truncates search to the configured cap', () => {
    const result = extractListingQuery(
      { search: `  ${'x'.repeat(500)}  ` },
      SORT_FIELDS,
      { sortBy: 'created_at', searchMaxLength: 50 }
    );
    expect(result.search).toBe('x'.repeat(50));
  });

  it('returns empty search for non-string inputs', () => {
    const result = extractListingQuery(
      { search: 42 as unknown as string },
      SORT_FIELDS,
      { sortBy: 'created_at' }
    );
    expect(result.search).toBe('');
  });

  it('does NOT regex-escape the returned search', () => {
    const result = extractListingQuery({ search: '.*evil' }, SORT_FIELDS, {
      sortBy: 'created_at',
    });
    expect(result.search).toBe('.*evil');
  });
});

describe('sort-field allowlists', () => {
  it('includes the canonical user list fields', () => {
    expect(ADMIN_USER_SORT_FIELDS).toContain('created_at');
    expect(ADMIN_USER_SORT_FIELDS).toContain('email');
  });

  it('includes the canonical session list fields', () => {
    expect(ADMIN_SESSION_SORT_FIELDS).toContain('loginTime');
    expect(ADMIN_SESSION_SORT_FIELDS).toContain('expiresAt');
  });

  it('includes the canonical activity list fields', () => {
    expect(ADMIN_ACTIVITY_SORT_FIELDS).toContain('timestamp');
    expect(ADMIN_ACTIVITY_SORT_FIELDS).toContain('status');
  });

  it('exposes both sort orders', () => {
    expect(SORT_ORDER_VALUES).toEqual(['asc', 'desc']);
  });
});
