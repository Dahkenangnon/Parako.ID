/**
 * Audit log controller — Management API v1.
 *
 * Read-only access to the platform activity log: paginated listing with
 * optional filters, single-entry retrieval, activity-type enumeration,
 * and aggregate statistics.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import { notFound } from '../errors.js';
import { apiSuccess, apiList } from '../response.js';
import {
  buildCursorQuery,
  buildCursorResponse,
  parsePaginationParams,
} from '../pagination.js';
import { auditQuerySchema } from '../validators/audit.validator.js';

/** Service and logger dependencies required by {@link AuditController}. */
export interface AuditControllerDeps {
  activityService: {
    queryActivities(
      filter: Record<string, unknown>,
      options: Record<string, unknown>
    ): Promise<{
      results: any[];
      totalResults: number;
      totalPages: number;
      page: number;
      limit: number;
    }>;
    findOne(filter: Record<string, unknown> | string): Promise<any | null>;
    getActivityTypes(): Promise<string[]>;
    getActivityStats(): Promise<{
      totalActivities: number;
      uniqueUsers: number;
      todayCount: number;
      successfulLogins: number;
      failedLogins: number;
    }>;
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
  };
}

export class AuditController {
  private readonly activityService: AuditControllerDeps['activityService'];
  private readonly logger: AuditControllerDeps['logger'];

  constructor(deps: AuditControllerDeps) {
    this.activityService = deps.activityService;
    this.logger = deps.logger;
  }

  /** List audit log entries with cursor-based pagination and optional filters. */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit, cursor, includeCount } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const query = auditQuerySchema.parse(req.query);

      const filter: Record<string, unknown> = {
        ...buildCursorQuery(cursor),
      };

      if (query.type) {
        filter.type = query.type;
      }
      if (query.status) {
        filter.status = query.status;
      }
      if (query.username) {
        filter['actor.username'] = query.username;
      }
      if (query.client_id) {
        filter.client_id = query.client_id;
      }

      // Date range filters (DB-agnostic — repository translates to the
      // appropriate operator for MongoDB or Prisma)
      if (query.from || query.to) {
        filter.timestampRange = {
          ...(query.from ? { from: new Date(query.from) } : {}),
          ...(query.to ? { to: new Date(query.to) } : {}),
        };
      }

      const result = await this.activityService.queryActivities(filter, {
        limit: limit + 1,
        page: 1,
      });

      const docs = result.results ?? [];
      const totalCount = includeCount ? result.totalResults : undefined;

      const page = buildCursorResponse(docs, limit, 'id', totalCount);

      apiList(res, page);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve a single audit log entry by its ID. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const entry = await this.activityService.findOne(req.params.id);

      if (!entry) {
        throw notFound(`Audit entry '${req.params.id}' not found`);
      }

      apiSuccess(res, entry);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve all distinct activity types in the audit log. */
  types = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const activityTypes = await this.activityService.getActivityTypes();

      apiSuccess(res, activityTypes);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve aggregate statistics from the audit log. */
  stats = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const activityStats = await this.activityService.getActivityStats();

      apiSuccess(res, activityStats);
    } catch (error) {
      next(error);
    }
  };
}
