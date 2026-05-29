/**
 * API-specific TypeScript types for the Parako.ID Management API v1.
 *
 * These types define the authentication context attached to every verified
 * request, the cursor-based pagination envelope, and the RFC 9457
 * Problem Detail error shape used across all error responses.
 */

// Authentication context (populated by JWT middleware)

/** Decoded access-token payload attached to `req.apiAuth` after validation. */
export interface ApiAuth {
  /** The `client_id` claim identifying the machine client. */
  client_id: string;

  /** Space-separated scope string granted to this token. */
  scope: string;

  /** Issuer URL (`iss` claim). */
  iss: string;

  /** Audience (`aud` claim). */
  aud: string;

  /** Expiration time as Unix epoch seconds. */
  exp: number;

  /** Issued-at time as Unix epoch seconds. */
  iat: number;
}

// Cursor-based pagination envelope

/** Generic cursor-paginated response wrapper. */
export interface CursorPage<T> {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
    /** Present only when the request includes `?include_count=true`. */
    total_count?: number;
  };
}

// RFC 9457 Problem Detail

/**
 * Error response body following the RFC 9457 Problem Detail format.
 *
 * Extension members (e.g. `retry_after`, `validation_errors`) are allowed
 * via the index signature.
 */
export interface ProblemDetail {
  /** URN identifying the error type, e.g. `"urn:parako:error:not-found"`. */
  type: string;

  /** Short human-readable summary. */
  title: string;

  /** HTTP status code. */
  status: number;

  /** Human-readable explanation specific to this occurrence. */
  detail: string;

  /** The request path that generated this error. */
  instance?: string;

  /** Extension members. */
  [key: string]: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own type declarations live inside `namespace Express`; module augmentation must use the same shape.
  namespace Express {
    interface Request {
      apiAuth?: ApiAuth;
    }
  }
}

export {};
