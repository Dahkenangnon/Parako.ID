import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IAdminActivitiesController } from '../../di/interfaces/admin-activities-controller.interface.js';
import { TYPES } from '../../di/types.js';
import {
  ADMIN_ACTIVITY_SORT_FIELDS,
  extractListingQuery,
  parsePositiveInt,
} from '../../validators/listing-query.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { flashAndRedirect } from '../../utils/flash-redirect.js';
import { GuardError } from '../../utils/guard-error.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function scalarQueryValue(value: unknown, maxLength = 100): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseActivityDate(value: string, endOfDay: boolean): Date | null {
  if (!value) return null;

  if (DATE_ONLY_PATTERN.test(value)) {
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    const date = new Date(`${value}T${time}Z`);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString().slice(0, 10) === value ? date : null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

@injectable()
export class AdminActivitiesController implements IAdminActivitiesController {
  constructor(
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * List all user activities with pagination, search, and filtering.
   * GET /admin/activities
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    const { page, limit, search, sortBy, sortOrder } = extractListingQuery(
      req.query,
      ADMIN_ACTIVITY_SORT_FIELDS,
      { sortBy: 'timestamp', limit: 50 }
    );
    const type = scalarQueryValue(req.query.type, 50);
    const status = scalarQueryValue(req.query.status, 20);
    const username = scalarQueryValue(req.query.username);
    const rawDateFrom = scalarQueryValue(req.query.dateFrom, 40);
    const rawDateTo = scalarQueryValue(req.query.dateTo, 40);
    const parsedDateFrom = parseActivityDate(rawDateFrom, false);
    const parsedDateTo = parseActivityDate(rawDateTo, true);
    const dateFrom = parsedDateFrom ? rawDateFrom : '';
    const dateTo = parsedDateTo ? rawDateTo : '';

    const filter: any = {};

    if (search) {
      // Repository adapters translate this portable text search into their
      // native query language. Do not leak Mongo operators from controllers.
      filter.search = search;
    }

    if (type && type !== 'all') {
      filter.type = type;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (username) {
      filter['actor.username'] = username;
    }

    if (parsedDateFrom || parsedDateTo) {
      filter.timestamp = {};
      if (parsedDateFrom) {
        filter.timestamp.$gte = parsedDateFrom;
      }
      if (parsedDateTo) {
        filter.timestamp.$lte = parsedDateTo;
      }
    }

    const sort: any = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const result = await this.activityService.queryActivities(filter, {
      page,
      limit,
      sort,
    });

    const stats = await this.activityService.getActivityStats();
    const activityTypes = await this.activityService.getActivityTypes();

    res.render('admin/activities/index', {
      title: 'User Activities',
      activities: result.results,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalResults: result.totalResults,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
        nextPage: result.page + 1,
        prevPage: result.page - 1,
      },
      filters: {
        search,
        type: type || 'all',
        status: status || 'all',
        username,
        dateFrom,
        dateTo,
        sortBy,
        sortOrder,
      },
      activityTypes: ['all', ...activityTypes],
      statuses: ['all', 'success', 'failed', 'info', 'warning'],
      stats,
    });
  };

  /**
   * Show activity details.
   * GET /admin/activities/:id
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const activity = await this.activityService.findOne({ _id: id });

    if (!activity) {
      throw new GuardError('Activity not found', {
        status: 404,
        redirectTo: '/admin/activities',
        flashMessage: 'Activity not found',
      });
    }

    res.render('admin/activities/show', {
      title: 'Activity details',
      activity,
    });
  };

  /**
   * Clear old activities.
   * POST /admin/activities/clear-old
   */
  public clearOldActivities = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const { days } = req.body as { days?: unknown };
    const olderThanDays = parsePositiveInt(days, {
      default: 90,
      min: 1,
      max: 36500,
    });

    const result =
      await this.activityService.deleteOldActivities(olderThanDays);

    activityLoggerFor(
      {
        activityService: this.activityService,
        sessionManager: this.sessionManager,
        clientDeviceInfoManager: this.clientDeviceInfoManager,
      },
      req,
      { defaultActorType: 'admin' }
    ).success(
      'old_activities_cleared_by_admin',
      null,
      'Admin cleared old activities',
      {
        target: {
          target_type: 'system',
          entity_data: {
            deletedCount: result.deletedCount,
            olderThanDays,
          },
        },
      }
    );

    flashAndRedirect(
      { sessionManager: this.sessionManager },
      req,
      res,
      'success',
      `Successfully cleared ${result.deletedCount} old activities`,
      '/admin/activities'
    );
  };
}
