/**
 * Defense-in-depth query-string helpers for controllers.
 *
 * Admin routes already run through express-validator chains
 * (src/middlewares/validation.middleware.ts) which coerce + bound-check
 * inputs, but controllers must never assume the middleware ran — these
 * helpers provide a second layer of validation directly at the call site
 * and avoid the `parseInt(req.query.x as string)` pattern that the
 * MDN docs warn against (the radix omission is also flagged by the
 * ESLint `radix` rule).
 *
 * References:
 *   - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt
 *   - https://eslint.org/docs/latest/rules/radix
 *   - https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 *   - https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
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

  const parsed =
    typeof value === 'number' ? Math.trunc(value) : Number.parseInt(value, 10);

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
 * Escape a string for safe insertion into a `RegExp` literal. Without this,
 * controllers that feed `req.query.foo` into `{ $regex: foo }` create a
 * canonical Regular-Expression DoS (ReDoS) sink:
 *   https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 *
 * Callers should additionally bound the input length and prefer anchored
 * prefix matches (e.g. `^${escapeRegExp(value)}`) so Mongo indexes can be
 * used and pathological inputs are rejected early.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
