import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IAdminActivitiesController } from '../../di/interfaces/admin-activities-controller.interface.js';
import { TYPES } from '../../di/types.js';
import {
  parsePositiveInt,
  parseEnum,
  escapeRegExp,
} from '../../utils/query-parse.js';
import {
  ADMIN_ACTIVITY_SORT_FIELDS,
  SORT_ORDER_VALUES,
} from '../../middlewares/validation.middleware.js';

/**
 * Admin Activities Controller
 * Handles viewing and managing user activities for admin panel
 */
@injectable()
export class AdminActivitiesController implements IAdminActivitiesController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * List all user activities with pagination, search, and filtering
   * GET /admin/activities
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parsePositiveInt(req.query.page, {
        default: 1,
        min: 1,
        max: 10_000,
      });
      const limit = parsePositiveInt(req.query.limit, {
        default: 50,
        min: 1,
        max: 100,
      });
      const search = ((req.query.search as string) || '').trim().slice(0, 200);
      const type = ((req.query.type as string) || '').trim();
      const status = ((req.query.status as string) || '').trim();
      const username = ((req.query.username as string) || '')
        .trim()
        .slice(0, 100);
      const dateFrom = ((req.query.dateFrom as string) || '').trim();
      const dateTo = ((req.query.dateTo as string) || '').trim();
      const sortBy = parseEnum(
        req.query.sortBy,
        ADMIN_ACTIVITY_SORT_FIELDS,
        'timestamp'
      );
      const sortOrder = parseEnum(
        req.query.sortOrder,
        SORT_ORDER_VALUES,
        'desc'
      );

      const filter: any = {};

      // Anchored prefix match with escaped user input — closes the ReDoS
      // sink that `$regex: search` would otherwise create. See OWASP:
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
        // Anchored prefix match + escaped input (OWASP ReDoS).
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
          search: search || '',
          type: type || 'all',
          status: status || 'all',
          username: username || '',
          dateFrom: dateFrom || '',
          dateTo: dateTo || '',
          sortBy,
          sortOrder,
        },
        activityTypes: ['all', ...activityTypes],
        statuses: ['all', 'success', 'failed', 'info', 'warning'],
        stats,
        userTheme: res.locals.userTheme || 'light',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'activities_listing_failed',
      });
      this.sessionManager.flash(req).error('Failed to load activities');
      res.redirect('/admin');
    }
  };

  /**
   * Show activity details
   * GET /admin/activities/:id
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const activity = await this.activityService.findOne({ _id: id });

      if (!activity) {
        this.sessionManager.flash(req).error('Activity not found');
        res.redirect('/admin/activities');
        return;
      }

      res.render('admin/activities/show', {
        title: `Activity details`,
        activity,
        userTheme: res.locals.userTheme || 'light',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'activity_showing_failed',
        activityId: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to load activity details');
      res.redirect('/admin/activities');
    }
  };

  /**
   * Clear old activities
   * POST /admin/activities/clear-old
   */
  public clearOldActivities = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { days } = req.body;
      const olderThanDays = parsePositiveInt(days, {
        default: 90,
        min: 1,
        max: 36500,
      });

      const result =
        await this.activityService.deleteOldActivities(olderThanDays);

      const currentUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activityService.success(
        'old_activities_cleared_by_admin',
        'Admin cleared old activities',
        null,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'system',
            entity_data: {
              deletedCount: result.deletedCount,
              olderThanDays,
            },
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(`Successfully cleared ${result.deletedCount} old activities`);
      res.redirect('/admin/activities');
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'old_activities_clearing_failed',
      });
      this.sessionManager.flash(req).error('Failed to clear old activities');
      res.redirect('/admin/activities');
    }
  };
}
