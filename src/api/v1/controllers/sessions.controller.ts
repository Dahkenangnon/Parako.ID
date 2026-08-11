/**
 * Sessions controller — Management API v1.
 *
 * OIDC session management: paginated listing, single-session retrieval,
 * individual revocation, and bulk revocation. Bulk revocation requires
 * at least one filter (username or client_id) to prevent accidental
 * mass invalidation of active sessions.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import { notFound, validationError } from '../errors.js';
import { apiSuccess, apiList, apiNoContent } from '../response.js';
import {
  buildCursorResponse,
  decodeCursor,
  parsePaginationParams,
} from '../pagination.js';
import { sessionQuerySchema } from '../validators/sessions.validator.js';

/** Service and logger dependencies required by {@link SessionsController}. */
export interface SessionsControllerDeps {
  oidcAdapter: {
    session: {
      find(jti: string): Promise<any>;
      destroy(jti: string): Promise<void>;
      countSessions(filter?: any): Promise<number>;
      findSessionsWithPagination(
        filter?: any,
        sortBy?: string,
        sortOrder?: number,
        skip?: number,
        limit?: number
      ): Promise<any[]>;
      deleteSessionsByAccountId(
        accountId: string
      ): Promise<{ deletedCount: number }>;
      deleteSessionsByIds(
        sessionIds: string[]
      ): Promise<{ deletedCount: number }>;
    };
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

const SESSION_SORT_FIELD = 'createdAt';
const BULK_PAGE_SIZE = 100;

function sessionId(session: any): string | undefined {
  const value = [
    session?.payload?.jti,
    session?.jti,
    session?.logical_id,
    session?.id,
    session?._id,
  ].find(
    candidate =>
      candidate !== undefined && candidate !== null && candidate !== ''
  );

  return value === undefined ? undefined : String(value);
}

/** Normalize MongoDB, Redis, and Prisma session rows to one API shape. */
function normalizeSession(session: any): Record<string, unknown> {
  const payload =
    session?.payload && typeof session.payload === 'object'
      ? session.payload
      : session;
  const id = sessionId(session);

  return id === undefined
    ? { ...payload }
    : { ...payload, id, jti: payload?.jti ? String(payload.jti) : id };
}

function buildSessionFilter(query: {
  username?: string;
  client_id?: string;
  active?: 'true' | 'false';
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    'payload.kind': 'Session',
  };

  if (query.username) filter['payload.accountId'] = query.username;
  if (query.client_id) filter['payload.clientId'] = query.client_id;

  if (query.active !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    filter['payload.exp'] =
      query.active === 'true' ? { $gt: now } : { $lte: now };
  }

  return filter;
}

export class SessionsController {
  private readonly oidcAdapter: SessionsControllerDeps['oidcAdapter'];
  private readonly logger: SessionsControllerDeps['logger'];

  constructor(deps: SessionsControllerDeps) {
    this.oidcAdapter = deps.oidcAdapter;
    this.logger = deps.logger;
  }

  /** Lazy accessor — the bridge may not be initialized at construction time. */
  private get adapter() {
    return this.oidcAdapter.session;
  }

  /**
   * Resolve an opaque session cursor to the adapter offset immediately after
   * that session. The session adapters expose offset pagination rather than a
   * shared keyset query, so scanning in bounded pages is the only portable
   * implementation across Redis, MongoDB, and Prisma-backed storage.
   */
  private async offsetAfterCursor(
    filter: Record<string, unknown>,
    cursor: string
  ): Promise<number> {
    const fields = decodeCursor(cursor);
    const cursorId = fields.jti ?? fields.id;

    if (!cursorId) {
      throw validationError(
        'Invalid cursor: cursor is missing a session identifier',
        [
          {
            field: 'after',
            message: 'Cursor must contain a jti or id field',
          },
        ]
      );
    }

    let skip = 0;

    while (true) {
      const sessions = await this.adapter.findSessionsWithPagination(
        filter,
        SESSION_SORT_FIELD,
        -1,
        skip,
        BULK_PAGE_SIZE
      );
      const index = sessions.findIndex(
        session => sessionId(session) === cursorId
      );

      if (index >= 0) return skip + index + 1;
      if (sessions.length < BULK_PAGE_SIZE) break;

      skip += BULK_PAGE_SIZE;
    }

    throw validationError(
      'Invalid cursor: cursor does not identify a session in this result set',
      [
        {
          field: 'after',
          message: 'Cursor is stale or does not match the current filters',
        },
      ]
    );
  }

  /** List sessions with cursor-based pagination and optional filters. */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit, cursor, includeCount } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const query = sessionQuerySchema.parse(req.query);
      const filter = buildSessionFilter(query);
      const skip = cursor ? await this.offsetAfterCursor(filter, cursor) : 0;
      const docs = await this.adapter.findSessionsWithPagination(
        filter,
        SESSION_SORT_FIELD,
        -1,
        skip,
        limit + 1
      );
      const totalCount = includeCount
        ? await this.adapter.countSessions(filter)
        : undefined;
      const page = buildCursorResponse(
        docs.map(normalizeSession),
        limit,
        'jti',
        totalCount
      );

      apiList(res, page);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve a single session by its JTI. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const session = await this.adapter.find(req.params.jti);

      if (!session) {
        throw notFound(`Session '${req.params.jti}' not found`);
      }

      apiSuccess(res, normalizeSession(session));
    } catch (error) {
      next(error);
    }
  };

  /** Revoke a single session by its JTI. */
  revoke = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const session = await this.adapter.find(req.params.jti);

      if (!session) {
        throw notFound(`Session '${req.params.jti}' not found`);
      }

      await this.adapter.destroy(req.params.jti);

      this.logger.info('Session revoked via API', { jti: req.params.jti });

      apiNoContent(res);
    } catch (error) {
      next(error);
    }
  };

  /** Bulk revoke sessions matching the query filters. At least one filter is required. */
  bulkRevoke = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = sessionQuerySchema.parse(req.query);

      // Require at least one filter to prevent accidental mass revocation.
      if (!query.username && !query.client_id) {
        throw validationError(
          'At least one filter (username or client_id) is required for bulk revocation',
          [
            {
              field: 'query',
              message: 'Provide username or client_id to scope the revocation',
            },
          ],
          req.path
        );
      }

      let revokedCount = 0;

      if (query.username && !query.client_id) {
        const result = await this.adapter.deleteSessionsByAccountId(
          query.username
        );
        revokedCount = result.deletedCount;
      } else {
        const filter = buildSessionFilter(query);
        const ids: string[] = [];
        let skip = 0;

        while (true) {
          const sessions = await this.adapter.findSessionsWithPagination(
            filter,
            SESSION_SORT_FIELD,
            -1,
            skip,
            BULK_PAGE_SIZE
          );

          ids.push(
            ...sessions
              .map(sessionId)
              .filter((id): id is string => id !== undefined)
          );

          if (sessions.length < BULK_PAGE_SIZE) break;
          skip += BULK_PAGE_SIZE;
        }

        if (ids.length > 0) {
          const result = await this.adapter.deleteSessionsByIds([
            ...new Set(ids),
          ]);
          revokedCount = result.deletedCount;
        }
      }

      this.logger.info('Sessions bulk-revoked via API', {
        count: revokedCount,
        filters: query,
      });

      apiSuccess(res, { revoked_count: revokedCount });
    } catch (error) {
      next(error);
    }
  };
}
