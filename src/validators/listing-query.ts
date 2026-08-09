/**
 * Listing-query helpers and sort-field allowlists.
 *
 * Two responsibilities live here:
 *
 * 1. Pure parsing utilities (`parsePositiveInt`, `parseEnum`,
 *    `extractListingQuery`, `escapeRegExp`) that admin controllers run
 *    as defense-in-depth at the call site. They never throw, never
 *    consume a `Request`, and never coerce silently outside the
 *    documented bounds.
 *
 * 2. Per-domain sort-field allowlists (`ADMIN_USER_SORT_FIELDS`,
 *    `ADMIN_SESSION_SORT_FIELDS`, `ADMIN_ACTIVITY_SORT_FIELDS`,
 *    `SORT_ORDER_VALUES`). These are the single source of truth shared
 *    by the request-layer Zod schemas in `src/validators/admin/**`
 *    and the controller-layer `extractListingQuery` re-parse — the
 *    two layers are intentionally idempotent for defense-in-depth.
 *
 * References:
 *   - MDN Number.parseInt radix gotcha:
 *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt
 *   - ESLint radix rule:
 *     https://eslint.org/docs/latest/rules/radix
 *   - OWASP Input Validation Cheat Sheet:
 *     https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 *   - OWASP ReDoS (motivates `escapeRegExp` before Mongo `$regex`):
 *     https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 */

export interface PositiveIntOptions {
  /** Returned when the input cannot be parsed as an integer. */
  default: number;
  /** Lower bound, inclusive. Defaults to 1. */
  min?: number;
  /** Upper bound, inclusive. Required to prevent unbounded paging. */
  max?: number;
}

/**
 * Parse `value` as a positive integer in radix 10, falling back to
 * `opts.default` when the input is missing, non-numeric, or outside the
 * `[min, max]` bounds. Never throws — controllers can call this without
 * try/catch and trust the result is a finite integer within the bounds.
 */
export function parsePositiveInt(
  value: unknown,
  opts: PositiveIntOptions
): number {
  const min = opts.min ?? 1;
  const max = opts.max;

  if (typeof value !== 'string' && typeof value !== 'number') {
    return clamp(opts.default, min, max);
  }

  const normalizedValue = typeof value === 'string' ? value.trim() : value;
  if (
    typeof normalizedValue === 'string' &&
    !/^[+-]?\d+$/.test(normalizedValue)
  ) {
    return clamp(opts.default, min, max);
  }

  const parsed =
    typeof normalizedValue === 'number'
      ? Math.trunc(normalizedValue)
      : Number.parseInt(normalizedValue, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return clamp(opts.default, min, max);
  }

  return clamp(parsed, min, max);
}

function clamp(value: number, min: number, max?: number): number {
  if (value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

/**
 * Parse `value` against an allowlist of strings, falling back to
 * `fallback` if the input is missing or not in the allowlist.
 *
 * This prevents controllers from passing arbitrary user input into Mongo
 * sort fields, which would otherwise enable information disclosure by
 * sorting on internal-only fields.
 */
export function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value !== 'string') return fallback;
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Escape a string for safe insertion into a `RegExp` literal so the
 * resulting value can be passed into a Mongo `$regex` clause without
 * letting the caller inject regex metacharacters. The escape is
 * idempotent — applying it twice produces the same string — so an
 * upstream Zod transform plus this controller-layer call is genuine
 * defense-in-depth, not duplicate work.
 *
 * Callers should additionally bound the input length and prefer
 * anchored prefix matches (e.g. `^${escapeRegExp(value)}`) so Mongo
 * indexes can be used and pathological inputs are rejected early.
 */
export function escapeRegExp(value: string): string {
  const metaCharacters = new Set('.*+?^${}()|[]\\');
  let escaped = '';

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const nextCharacter = value[index + 1];

    // Preserve an existing escape sequence so request-schema validation and
    // controller-level defense in depth can safely call this helper twice.
    if (
      character === '\\' &&
      nextCharacter !== undefined &&
      metaCharacters.has(nextCharacter)
    ) {
      escaped += `\\${nextCharacter}`;
      index++;
      continue;
    }

    escaped += metaCharacters.has(character) ? `\\${character}` : character;
  }

  return escaped;
}

export interface ListingQueryDefaults {
  page?: number;
  limit?: number;
  maxLimit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  searchMaxLength?: number;
}

export interface ListingQuery<TSort extends string> {
  page: number;
  limit: number;
  search: string;
  sortBy: TSort;
  sortOrder: 'asc' | 'desc';
}

/**
 * Sort-field allowlists shared by the Zod request schemas and the
 * controller-layer `extractListingQuery` re-parse. Keeping them in one
 * place is the only way the two layers stay in sync.
 */
export const ADMIN_USER_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'username',
  'email',
  'last_login_at',
] as const;

export const ADMIN_SESSION_SORT_FIELDS = [
  'loginTime',
  'username',
  'expiresAt',
] as const;

export const ADMIN_GRANT_SORT_FIELDS = [
  'created_at',
  'payload.iat',
  'payload.accountId',
  'payload.clientId',
] as const;

export const ADMIN_OIDC_CLIENT_SORT_FIELDS = [
  'created_at',
  'client_name',
  'application_type',
  'active',
] as const;

export const ADMIN_ACTIVITY_SORT_FIELDS = [
  'timestamp',
  'created_at',
  'type',
  'status',
  'username',
] as const;

export const SORT_ORDER_VALUES = ['asc', 'desc'] as const;

/**
 * Parse the canonical listing query parameters (page, limit, search,
 * sortBy, sortOrder) into a strongly-typed object.
 *
 * The returned `search` is trimmed and length-capped but NOT regex
 * escaped — callers that pass it into a Mongo `$regex` must wrap it
 * in `escapeRegExp` themselves so the escape point stays visible at
 * the call site.
 */
export function extractListingQuery<TSort extends string>(
  query: Record<string, unknown>,
  sortFields: readonly TSort[],
  defaults: ListingQueryDefaults & { sortBy: TSort }
): ListingQuery<TSort> {
  const page = parsePositiveInt(query.page, {
    default: defaults.page ?? 1,
    min: 1,
    max: 10_000,
  });
  const limit = parsePositiveInt(query.limit, {
    default: defaults.limit ?? 20,
    min: 1,
    max: defaults.maxLimit ?? 100,
  });
  const search = (typeof query.search === 'string' ? query.search : '')
    .trim()
    .slice(0, defaults.searchMaxLength ?? 200);
  const sortBy = parseEnum(query.sortBy, sortFields, defaults.sortBy);
  const sortOrder = parseEnum(
    query.sortOrder,
    SORT_ORDER_VALUES,
    defaults.sortOrder ?? 'desc'
  );

  return { page, limit, search, sortBy, sortOrder };
}
