import { Request, Response } from 'express';
import { injectable, inject } from 'inversify';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../di/interfaces/user-service.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IAdminHomeController } from '../../di/interfaces/admin-home-controller.interface.js';
import { TYPES } from '../../di/types.js';

/**
 * Admin Home Controller
 * Handles admin dashboard and overview functionality
 */
@injectable()
export class AdminHomeController implements IAdminHomeController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ActivityService) private readonly activity: IActivityService,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager
  ) {}

  /**
   * Renders the admin dashboard home page
   */
  public dashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUser = this.sessionManager.getActiveUser(req);

      if (!currentUser) {
        this.logger.error('Admin dashboard access without authenticated user');
        return res.redirect('/auth/login');
      }

      const stats = await this.getSystemStats();

      const recentActivity = await this.getRecentActivity();

      const config = this.configManager.getConfig();
      const appInfo = {
        title: config.application.title,
        environment: config.deployment.environment,
        mfaEnabled: config.security.authentication.multi_factor.enabled,
      };

      res.render('admin/home', {
        title: `Admin Dashboard`,
        stats,
        recentActivity,
        appInfo,
        layout: 'layouts/admin-layout',
      });
    } catch (error) {
      this.logger.error('Error rendering admin dashboard', { error });
      res.status(500).render('error/500', {
        title: 'Server Error',
        message: 'Unable to load admin dashboard',
      });
    }
  };

  /**
   * Get admin dashboard statistics
   */
  async getSystemStats() {
    try {
      const totalUsers = await this.userService.countDocuments({});
      const activeUsers = await this.userService.countDocuments({
        account_enabled: true,
      });
      const verifiedUsers = await this.userService.countDocuments({
        email_verified: true,
      });
      const adminUsers = await this.userService.countDocuments({
        roles: { $in: ['admin', 'superadmin'] },
      });

      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 7);

      const lastMonth = new Date(today);
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      const newUsersToday = await this.userService.countDocuments({
        created_at: { $gte: yesterday },
      });

      const newUsersThisWeek = await this.userService.countDocuments({
        created_at: { $gte: lastWeek },
      });

      const newUsersThisMonth = await this.userService.countDocuments({
        created_at: { $gte: lastMonth },
      });

      const oidcStats = await this.getOIDCStats();

      const sessionsStats = await this.getSessionsStats();

      const grantsStats = await this.getGrantsStats();

      const activityStats = await this.getActivityStats();

      return {
        users: {
          total: totalUsers,
          active: activeUsers,
          verified: verifiedUsers,
          admins: adminUsers,
          newToday: newUsersToday,
          newThisWeek: newUsersThisWeek,
          newThisMonth: newUsersThisMonth,
          verificationRate:
            totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
          activeRate:
            totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
        },
        oidc: oidcStats,
        sessions: sessionsStats,
        grants: grantsStats,
        activities: activityStats,
      };
    } catch (error) {
      this.logger.error('Error getting admin stats', { error });
      return {
        users: {
          total: 0,
          active: 0,
          verified: 0,
          admins: 0,
          newToday: 0,
          newThisWeek: 0,
          newThisMonth: 0,
          verificationRate: 0,
          activeRate: 0,
        },
        oidc: { clients: 0, activeClients: 0, totalClients: 0 },
        sessions: { total: 0, active: 0, expired: 0 },
        grants: { total: 0, active: 0, revoked: 0 },
        activities: { total: 0, today: 0, thisWeek: 0, thisMonth: 0 },
      };
    }
  }

  /**
   * Get OIDC client statistics
   */
  async getOIDCStats() {
    try {
      const stats = await this.oidcAdapter.client.getClientStatistics();
      const count = await this.oidcAdapter.client.countClients();
      return {
        clients: count,
        activeClients: stats.active,
        totalClients: stats.total || 0,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_statistics_load_failed',
      });
      return {
        clients: 0,
        activeClients: 0,
        totalClients: 0,
      };
    }
  }

  /**
   * Get user sessions statistics
   */
  async getSessionsStats() {
    try {
      const sessionStats =
        await this.oidcAdapter.session.getSessionStatistics();

      return {
        total: sessionStats.total,
        active: sessionStats.active,
        expired: sessionStats.expired,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'session_statistics_load_failed',
      });
      return {
        total: 0,
        active: 0,
        expired: 0,
      };
    }
  }

  /**
   * Get user grants statistics
   */
  async getGrantsStats() {
    try {
      const grantStats = await this.oidcAdapter.grant.getGrantStatistics();

      return {
        total: grantStats.total,
        active: grantStats.total - grantStats.expired,
        revoked: grantStats.expired, // Using expired as "revoked" for display purposes
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'grant_statistics_load_failed',
      });
      return {
        total: 0,
        active: 0,
        revoked: 0,
      };
    }
  }

  /**
   * Get activity statistics
   */
  async getActivityStats() {
    try {
      const stats = await this.activity.getActivityStats();

      return {
        total: stats.totalActivities || 0,
        today: stats.todayCount || 0,
        thisWeek: 0, // Not available in ActivityStats interface
        thisMonth: 0, // Not available in ActivityStats interface
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'activity_statistics_load_failed',
      });
      return {
        total: 0,
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
      };
    }
  }

  /**
   * Get recent activity for the dashboard
   */
  async getRecentActivity() {
    try {
      const result = await this.activity.queryActivities(
        {},
        { limit: 3, page: 1 }
      );

      return result.results.map((act: any) => ({
        type: act.type,
        message: act.description,
        timestamp: act.timestamp,
        user: act.user
          ? {
              username: act.user.username,
              email: act.user.email,
            }
          : null,
        metadata: act.metadata || {},
      }));
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'recent_activity_load_failed',
      });
      return [];
    }
  }

  public updateTheme = async (req: Request, res: Response): Promise<void> => {
    try {
      const { theme } = req.body;

      if (!theme || !['light', 'dark'].includes(theme)) {
        res.status(400).json({
          success: false,
          error: 'Invalid theme. Must be "light" or "dark".',
        });
        return;
      }

      this.sessionManager.set(req, 'userTheme', theme);

      this.logger.info('Admin theme updated to:', theme);

      res.json({
        success: true,
        theme,
        message: 'Theme updated successfully',
      });
      return;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'admin_theme_update_failed',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update theme',
      });
      return;
    }
  };
}
