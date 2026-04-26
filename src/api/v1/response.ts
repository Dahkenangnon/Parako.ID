import type { Response } from 'express';
import type { CursorPage } from './types.js';

/**
 * Response envelope helpers for the Parako.ID Management API v1.
 *
 * Every successful response is wrapped in a consistent envelope so that
 * consumers always find the payload under the `data` key and pagination
 * metadata under `pagination` (when applicable).
 */

/** Return a success response with the given data and HTTP status (default 200). */
export function apiSuccess(
  res: Response,
  data: unknown,
  status: number = 200
): Response {
  return res.status(status).json({ data });
}

/** Return a 201 Created response with the given data. */
export function apiCreated(res: Response, data: unknown): Response {
  return res.status(201).json({ data });
}

/** Return a cursor-paginated list response. */
export function apiList<T>(res: Response, cursorPage: CursorPage<T>): Response {
  return res.status(200).json({
    data: cursorPage.data,
    pagination: cursorPage.pagination,
  });
}

/** Return a 202 Accepted response with the given data. */
export function apiAccepted(res: Response, data: unknown): Response {
  return res.status(202).json({ data });
}

/** Return a 204 No Content response with an empty body. */
export function apiNoContent(res: Response): Response {
  return res.status(204).end();
}
