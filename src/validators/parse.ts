/**
 * Pure Zod parse-to-issue-list helper.
 *
 * The shape `{ field, message }[]` is the single internal representation
 * of a validation failure used by every Express middleware in the
 * codebase (HTML flash-redirect, legacy JSON, RFC 9457 Problem Detail,
 * OIDC handler render). Funnelling all of them through this helper
 * means the parse logic and the field-path formatting never drift
 * between response types.
 *
 * This module is intentionally free of Express types — it takes any
 * `unknown` input and returns a discriminated result so it can be
 * called from controllers, OIDC handlers, and middlewares alike.
 */

import type { z } from 'zod';

/** A single field-scoped validation failure. */
export interface FieldIssue {
  /** Dot-joined path to the failing field, or `'(root)'` for a top-level failure. */
  field: string;
  /** Human-readable message taken verbatim from the Zod issue. */
  message: string;
}

/** Successful parse outcome carrying the schema-typed value. */
export interface ParseOk<T> {
  ok: true;
  data: T;
}

/** Failed parse outcome carrying the per-field issue list. */
export interface ParseFail {
  ok: false;
  issues: FieldIssue[];
}

export type ParseResult<T> = ParseOk<T> | ParseFail;

/**
 * Parse `input` through `schema` and return a discriminated result.
 *
 * Never throws — the caller decides how to react (flash + redirect,
 * JSON response, view render, etc.). Field paths come from
 * `ZodIssue.path` joined with `.`; an empty path is rendered as
 * `'(root)'` so a top-level type mismatch still produces a stable
 * identifier downstream.
 */
export function safeParseOrIssues<T>(
  schema: z.ZodType<T>,
  input: unknown
): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map(issue => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  };
}
