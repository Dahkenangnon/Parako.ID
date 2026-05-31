/**
 * Shared Zod base schemas for common input types.
 *
 * Centralises the canonical validation rules so every route enforces
 * the same constraints. Each schema documents the spec or
 * security-cheatsheet reference that motivates its rule. Add new
 * shared schemas here rather than duplicating the rules inline.
 *
 * URL-trust policy (allow-list, scheme, host, length) is owned by
 * `RedirectAuthority.validateUrl` at the controller layer — schemas
 * here perform structural checks only and never reimplement trust
 * decisions.
 *
 * References:
 *   - OWASP Input Validation Cheat Sheet:
 *     https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 *   - RFC 3696 §3 (email length cap):
 *     https://datatracker.ietf.org/doc/html/rfc3696#section-3
 *   - RFC 4122 (UUID):
 *     https://datatracker.ietf.org/doc/html/rfc4122
 *   - OWASP ReDoS / NoSQL injection (motivates regex escaping before
 *     Mongo `$regex`):
 *     https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 *   - Zod 4 docs (coerce caveats, `z.coerce.boolean()` truthy-only):
 *     https://zod.dev/api
 */

import { z } from 'zod';

import { SORT_ORDER_VALUES, escapeRegExp } from './listing-query.js';

/**
 * RFC 5322-lite email validator with a 254-char cap (RFC 3696 §3).
 * Trims surrounding whitespace before the format check so form inputs
 * with stray spaces validate correctly.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Email is required')
  .max(254, 'Email must be 254 characters or fewer')
  .pipe(z.email('Email must be a valid address'));

/** RFC 4122 UUID (any version). */
export const uuidSchema = z.uuid('Must be a valid UUID');

/**
 * URL-safe slug: lowercase alphanumeric, hyphens, underscores, 1-63
 * characters. Matches the tenant-slug pattern used elsewhere in the
 * codebase.
 */
export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(63, 'Slug must be 63 characters or fewer')
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    'Slug must contain only lowercase letters, digits, hyphens, or underscores and start with an alphanumeric character'
  );

/** HTTP(S) URL with explicit protocol; rejects javascript:, data:, file:, etc. */
export const urlSchema = z
  .url('Must be a valid URL')
  .trim()
  .refine(
    value => {
      try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    { message: 'URL must use http or https' }
  );

/**
 * Pagination `page` parameter. Coerces a numeric string (Express's
 * `req.query` values are always strings) into an integer in the
 * inclusive range [1, 10_000]. Defaults to 1 when absent.
 */
export const pageSchema = z.coerce
  .number()
  .int('Page must be an integer')
  .min(1, 'Page must be at least 1')
  .max(10_000, 'Page must be at most 10000')
  .default(1);

/**
 * Pagination `limit` parameter. Capped at 100 to prevent unbounded
 * result sets.
 */
export const limitSchema = z.coerce
  .number()
  .int('Limit must be an integer')
  .min(1, 'Limit must be at least 1')
  .max(100, 'Limit must be at most 100')
  .default(20);

/** Listing-query sort direction. */
export const sortOrderSchema = z.enum(SORT_ORDER_VALUES);

/**
 * Free-text search field. Trims whitespace, caps the length at 200,
 * and applies `escapeRegExp` so the value is safe to insert into a
 * Mongo `$regex` clause. Idempotent with the controller-layer
 * `escapeRegExp` call inside `extractListingQuery`.
 */
export const searchSchema = z
  .string()
  .trim()
  .max(200, 'Search must be 200 characters or fewer')
  .optional()
  .transform(value => (value !== undefined ? escapeRegExp(value) : value));

/**
 * Free-text username filter (admin listing screens). Same regex-escape
 * treatment as `searchSchema`; rejects empty strings since an empty
 * username filter is just no filter (use undefined).
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(1, 'Username is required')
  .max(100, 'Username must be 100 characters or fewer')
  .transform(escapeRegExp);

/**
 * Query parameters that carry boolean intent through a URL must use a
 * literal `'true'` / `'false'` string. `z.coerce.boolean()` is unsafe
 * because `Boolean('false')` is `true`; `z.stringbool()` would change
 * the runtime type and silently break downstream `=== 'true'`
 * comparisons (for example in the consent / logout / select-account
 * flows).
 */
export const stringBoolSchema = z.enum(['true', 'false']);

/**
 * Structural validation for redirect-target query parameters
 * (`continue`, `redirectTo`, `cancel_url`, `next`, `redirect_uri`).
 *
 * This schema only enforces type-and-length. Trust policy
 * (allow-listed hosts, scheme rules, internal-vs-external routing)
 * is the job of `RedirectAuthority.validateUrl()` at the controller
 * boundary. The 2048-character cap matches the RedirectAuthority
 * `MAX_URL_LENGTH` so the two layers reject the same out-of-band
 * inputs.
 */
export const redirectStringSchema = z
  .string()
  .trim()
  .max(2048, 'Redirect target must be 2048 characters or fewer')
  .optional();
