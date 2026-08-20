/**
 * Stats controller — Management API v1.
 *
 * Aggregate platform overview (users, clients, sessions, grants, activity)
 * and per-component health checks. Each data section is isolated so that
 * a failure in one service does not suppress results from the others.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../../di/interfaces/user-service.interface.js';
import type {
  IOidcClientAdmin,
  IOidcGrantAdmin,
  IOidcSessionAdmin,
} from '../../../oidc/adapter/admin.contract.js';

import { apiSuccess } from '../response.js';

/** Service and logger dependencies required by {@link StatsController}. */
export interface StatsControllerDeps {
  userService: Pick<IUserService, 'countDocuments'>;
  oidcAdapter: {
    readonly client: Pick<
      IOidcClientAdmin,
      'countClients' | 'getClientStatistics'
    >;
    readonly session: Pick<IOidcSessionAdmin, 'getSessionStatistics'>;
    readonly grant: Pick<IOidcGrantAdmin, 'getGrantStatistics'>;
  };
  activityService: Pick<IActivityService, 'getActivityStats'>;
  configManager: Pick<IConfigManager, 'getConfig'>;
  logger: Pick<ILogger, 'error'>;
}

export class StatsController {
  private readonly userService: StatsControllerDeps['userService'];
  private readonly oidcAdapter: StatsControllerDeps['oidcAdapter'];
  private readonly activityService: StatsControllerDeps['activityService'];
  private readonly configManager: StatsControllerDeps['configManager'];
  private readonly logger: StatsControllerDeps['logger'];

  constructor(deps: StatsControllerDeps) {
    this.userService = deps.userService;
    this.oidcAdapter = deps.oidcAdapter;
    this.activityService = deps.activityService;
    this.configManager = deps.configManager;
    this.logger = deps.logger;
  }

  /**
   * Aggregate overview statistics from all services.
   *
   * Each section is wrapped in its own try/catch so that a failure in
   * one area (e.g. sessions) does not block the rest of the response.
   */
  overview = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const stats: Record<string, unknown> = {};

      try {
        stats.users = { total: await this.userService.countDocuments() };
      } catch (err) {
        this.logger.error(err as Error, { section: 'users' });
        stats.users = { error: 'Failed to retrieve user statistics' };
      }

      try {
        stats.clients = await this.oidcAdapter.client.getClientStatistics();
      } catch (err) {
        this.logger.error(err as Error, { section: 'clients' });
        stats.clients = { error: 'Failed to retrieve client statistics' };
      }

      try {
        stats.sessions = await this.oidcAdapter.session.getSessionStatistics();
      } catch (err) {
        this.logger.error(err as Error, { section: 'sessions' });
        stats.sessions = { error: 'Failed to retrieve session statistics' };
      }

      try {
        stats.grants = await this.oidcAdapter.grant.getGrantStatistics();
      } catch (err) {
        this.logger.error(err as Error, { section: 'grants' });
        stats.grants = { error: 'Failed to retrieve grant statistics' };
      }

      try {
        stats.activity = await this.activityService.getActivityStats();
      } catch (err) {
        this.logger.error(err as Error, { section: 'activity' });
        stats.activity = { error: 'Failed to retrieve activity statistics' };
      }

      apiSuccess(res, stats);
    } catch (error) {
      next(error);
    }
  };

  /**
   * System health check.
   *
   * Probes database and service connectivity and returns an aggregate
   * health status. Individual check failures are reported per-component
   * rather than causing the overall endpoint to fail.
   */
  health = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const checks: Record<string, { status: string; message?: string }> = {};

      try {
        await this.userService.countDocuments();
        checks.database = { status: 'healthy' };
      } catch (err) {
        this.logger.error(err as Error, { check: 'database' });
        checks.database = {
          status: 'unhealthy',
          message: 'Database connection failed',
        };
      }

      try {
        await this.oidcAdapter.client.countClients();
        checks.oidc = { status: 'healthy' };
      } catch (err) {
        this.logger.error(err as Error, { check: 'oidc' });
        checks.oidc = {
          status: 'unhealthy',
          message: 'OIDC adapter connection failed',
        };
      }

      try {
        const config = this.configManager.getConfig();
        checks.config = config
          ? { status: 'healthy' }
          : { status: 'unhealthy', message: 'Configuration not loaded' };
      } catch (err) {
        this.logger.error(err as Error, { check: 'config' });
        checks.config = {
          status: 'unhealthy',
          message: 'Configuration check failed',
        };
      }

      const allHealthy = Object.values(checks).every(
        c => c.status === 'healthy'
      );
      const overallStatus = allHealthy ? 'healthy' : 'degraded';

      const statusCode = allHealthy ? 200 : 503;

      apiSuccess(
        res,
        { status: overallStatus, checks, timestamp: new Date().toISOString() },
        statusCode
      );
    } catch (error) {
      next(error);
    }
  };
}
