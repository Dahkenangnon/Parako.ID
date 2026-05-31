import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IAdminActivitiesController } from '../../di/interfaces/admin-activities-controller.interface.js';
import { TYPES } from '../../di/types.js';
import {
  ADMIN_ACTIVITY_SORT_FIELDS,
  escapeRegExp,
  extractListingQuery,
  parsePositiveInt,
} from '../../validators/listing-query.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { flashAndRedirect } from '../../utils/flash-redirect.js';
import { GuardError } from '../../utils/guard-error.js';

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
    const type = ((req.query.type as string) || '').trim();
    const status = ((req.query.status as string) || '').trim();
    const username = ((req.query.username as string) || '')
      .trim()
      .slice(0, 100);
    const dateFrom = ((req.query.dateFrom as string) || '').trim();
    const dateTo = ((req.query.dateTo as string) || '').trim();

    const filter: any = {};

    // Anchored prefix match with escaped user input — closes the ReDoS
    // sink that `$regex: search` would otherwise create.
    // https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
    if (search) {
      const safeSearch = new RegExp(escapeRegExp(search), 'i');
      filter.$or = [
        { description: { $regex: safeSearch } },
        { username: { $regex: safeSearch } },
      ];
    }

    if (type && type !== 'all') {
      filter.type = type;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (username) {
      filter.username = {
        $regex: new RegExp(`^${escapeRegExp(username)}`, 'i'),
      };
    }

    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) {
        filter.timestamp.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        filter.timestamp.$lte = new Date(`${dateTo}T23:59:59.999Z`);
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
