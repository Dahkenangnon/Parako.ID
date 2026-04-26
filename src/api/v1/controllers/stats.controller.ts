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

import { apiSuccess } from '../response.js';

/** Service and logger dependencies required by {@link StatsController}. */
export interface StatsControllerDeps {
  userService: {
    count?(filter?: any): Promise<number>;
    findWithPagination?(filter: any, options: any): Promise<any>;
  };
  oidcAdapter: {
    client: {
      countClients(): Promise<number>;
      getClientStatistics(): Promise<Record<string, unknown>>;
    };
    session: {
      getSessionStatistics?(): Promise<Record<string, unknown>>;
    };
    grant: {
      getGrantStatistics?(): Promise<Record<string, unknown>>;
    };
  };
  activityService: {
    getActivityStats(): Promise<{
      totalActivities: number;
      uniqueUsers: number;
      todayCount: number;
      successfulLogins: number;
      failedLogins: number;
    }>;
  };
  configManager: {
    getConfig(): any;
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
  };
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

      // --- Users ---
      try {
        if (this.userService.count) {
          stats.users = { total: await this.userService.count() };
        } else {
          stats.users = { total: null };
        }
      } catch (err) {
        this.logger.error(err as Error, { section: 'users' });
        stats.users = { error: 'Failed to retrieve user statistics' };
      }

      // --- Clients ---
      try {
        const clientCount = await this.oidcAdapter.client.countClients();
        const clientStats = await this.oidcAdapter.client.getClientStatistics();
        stats.clients = { total: clientCount, ...clientStats };
      } catch (err) {
        this.logger.error(err as Error, { section: 'clients' });
        stats.clients = { error: 'Failed to retrieve client statistics' };
      }

      // --- Sessions ---
      try {
        if (this.oidcAdapter.session.getSessionStatistics) {
          stats.sessions =
            await this.oidcAdapter.session.getSessionStatistics();
        } else {
          stats.sessions = { available: false };
        }
      } catch (err) {
        this.logger.error(err as Error, { section: 'sessions' });
        stats.sessions = { error: 'Failed to retrieve session statistics' };
      }

      // --- Grants ---
      try {
        if (this.oidcAdapter.grant.getGrantStatistics) {
          stats.grants = await this.oidcAdapter.grant.getGrantStatistics();
        } else {
          stats.grants = { available: false };
        }
      } catch (err) {
        this.logger.error(err as Error, { section: 'grants' });
        stats.grants = { error: 'Failed to retrieve grant statistics' };
      }

      // --- Activity ---
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

      // --- Database connectivity (via user count query) ---
      try {
        if (this.userService.count) {
          await this.userService.count();
          checks.database = { status: 'healthy' };
        } else if (this.userService.findWithPagination) {
          await this.userService.findWithPagination({}, { page: 1, limit: 1 });
          checks.database = { status: 'healthy' };
        } else {
          checks.database = {
            status: 'unknown',
            message: 'No probe method available',
          };
        }
      } catch (err) {
        this.logger.error(err as Error, { check: 'database' });
        checks.database = {
          status: 'unhealthy',
          message: 'Database connection failed',
        };
      }

      // --- OIDC adapter connectivity ---
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

      // --- Configuration loaded ---
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

      // --- Overall status ---
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
