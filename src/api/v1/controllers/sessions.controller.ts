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
import { buildCursorResponse, parsePaginationParams } from '../pagination.js';
import { sessionQuerySchema } from '../validators/sessions.validator.js';

/** Service and logger dependencies required by {@link SessionsController}. */
export interface SessionsControllerDeps {
  oidcAdapter: {
    session: {
      find(jti: string): Promise<any>;
      destroy(jti: string): Promise<void>;
      findAll?(filter?: any): Promise<any[]>;
      revokeByAccountId?(accountId: string): Promise<number>;
    };
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
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

  /** List sessions with cursor-based pagination and optional filters. */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const query = sessionQuerySchema.parse(req.query);

      const filter: Record<string, unknown> = {};
      if (query.username) filter.accountId = query.username;
      if (query.client_id) filter.clientId = query.client_id;
      if (query.active !== undefined) filter.active = query.active === 'true';

      const docs = this.adapter.findAll
        ? await this.adapter.findAll({ ...filter, limit: limit + 1 })
        : [];

      const page = buildCursorResponse(docs, limit);

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

      apiSuccess(res, session);
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

      if (query.username && this.adapter.revokeByAccountId) {
        revokedCount = await this.adapter.revokeByAccountId(query.username);
      } else if (this.adapter.findAll) {
        const filter: Record<string, unknown> = {};
        if (query.username) filter.accountId = query.username;
        if (query.client_id) filter.clientId = query.client_id;

        const sessions = await this.adapter.findAll(filter);

        for (const session of sessions) {
          const jti = session.jti ?? session.id;
          if (jti) {
            await this.adapter.destroy(String(jti));
            revokedCount++;
          }
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
