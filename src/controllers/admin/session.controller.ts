import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import { randomUUID } from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IOIDCUtils } from '../../di/interfaces/oidc-utils.interface.js';
import type { IAdminSessionsController } from '../../di/interfaces/admin-sessions-controller.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { IRedisPubSubService } from '../../di/interfaces/redis-pubsub-service.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import { TYPES } from '../../di/types.js';
import {
  parsePositiveInt,
  parseEnum,
  escapeRegExp,
} from '../../utils/query-parse.js';
import {
  ADMIN_SESSION_SORT_FIELDS,
  SORT_ORDER_VALUES,
} from '../../middlewares/validation.middleware.js';

/**
 * Admin Sessions Controller
 * Handles displaying and managing all user sessions (OIDC + Express) for admin panel
 */
@injectable()
export class AdminSessionsController implements IAdminSessionsController {
  private readonly originId = randomUUID();

  private get redisPrefix(): string {
    return this.configManager.getConfig().deployment?.redis_prefix || 'parako';
  }

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.RedisPubSubService)
    private readonly pubsub: IRedisPubSubService,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager
  ) {}

  /**
   * Display all user sessions with pagination, search, and filtering
   * GET /admin/sessions
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parsePositiveInt(req.query.page, {
        default: 1,
        min: 1,
        max: 10_000,
      });
      const limit = parsePositiveInt(req.query.limit, {
        default: 20,
        min: 1,
        max: 100,
      });
      const search = ((req.query.search as string) || '').trim();
      const username = ((req.query.username as string) || '')
        .trim()
        .slice(0, 100);
      const status = ((req.query.status as string) || 'all').trim();
      const sortBy = parseEnum(
        req.query.sortBy,
        ADMIN_SESSION_SORT_FIELDS,
        'loginTime'
      );
      const sortOrder = parseEnum(
        req.query.sortOrder,
        SORT_ORDER_VALUES,
        'desc'
      );

      // Express sessions pagination (separate from OIDC)
      const expressPage = parsePositiveInt(req.query.expressPage, {
        default: 1,
        min: 1,
        max: 10_000,
      });
      const expressLimit = parsePositiveInt(req.query.expressLimit, {
        default: 20,
        min: 1,
        max: 100,
      });

      const filters: any = {
        'payload.kind': 'Session',
      };

      // Anchored prefix match with the username escaped to neutralise the
      // canonical ReDoS attack patterns (e.g. `(a+)+$`). The length cap above
      // bounds parser work even if the escape were ever bypassed.
      // Reference: https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
      if (username) {
        filters['payload.accountId'] = {
          $regex: new RegExp(`^${escapeRegExp(username)}`, 'i'),
        };
      }

      if (status === 'active') {
        const now = Math.floor(Date.now() / 1000);
        filters['payload.exp'] = { $gt: now };
      } else if (status === 'expired') {
        const now = Math.floor(Date.now() / 1000);
        filters['payload.exp'] = { $lte: now };
      }

      const totalSessions =
        await this.oidcAdapter.session.countSessions(filters);
      const totalPages = Math.ceil(totalSessions / limit);
      const skip = (page - 1) * limit;

      const sort: any = {};
      if (sortBy === 'loginTime') {
        sort['payload.loginTs'] = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'username') {
        sort['payload.accountId'] = sortOrder === 'desc' ? -1 : 1;
      } else if (sortBy === 'expiresAt') {
        sort['payload.exp'] = sortOrder === 'desc' ? -1 : 1;
      } else {
        sort['payload.loginTs'] = -1; // Default sort
      }

      const sessions =
        await this.oidcAdapter.session.findSessionsWithPagination(
          filters,
          sortBy,
          sortOrder === 'desc' ? -1 : 1,
          skip,
          limit
        );

      let filteredSessions: any[] = [];
      if (sessions && sessions.length > 0) {
        const processedSessions = await Promise.all(
          sessions.map(async session => {
            const processed = await this.oidcUtils.processSessionData(session);
            processed.sessionType = 'oidc';
            return processed;
          })
        );

        filteredSessions = processedSessions;
        if (search) {
          const searchLower = search.toLowerCase();
          filteredSessions = processedSessions.filter(
            session =>
              session.userInfo.username.toLowerCase().includes(searchLower) ||
              session.userInfo.full_name.toLowerCase().includes(searchLower) ||
              session.userInfo.email.toLowerCase().includes(searchLower) ||
              session.device.toLowerCase().includes(searchLower) ||
              session.ip.toLowerCase().includes(searchLower)
          );
        }
      }

      const expressSkip = (expressPage - 1) * expressLimit;
      const [rawExpressSessions, totalExpressSessions] = await Promise.all([
        this.sessionManager.findAllExpressSessions({
          limit: expressLimit,
          offset: expressSkip,
          search: search || username || undefined,
        }),
        this.sessionManager.countAllExpressSessions(),
      ]);

      const expressSessions =
        await this.processExpressSessions(rawExpressSessions);

      const expressTotalPages = Math.ceil(totalExpressSessions / expressLimit);

      const hasNext = page < totalPages;
      const hasPrev = page > 1;

      res.render('admin/sessions/index', {
        title: 'User Sessions',
        sessions: filteredSessions,
        pagination: {
          page,
          limit,
          totalPages,
          totalSessions,
          hasNext,
          hasPrev,
          startIndex: filteredSessions.length > 0 ? (page - 1) * limit + 1 : 0,
          endIndex:
            filteredSessions.length > 0
              ? Math.min(page * limit, totalSessions)
              : 0,
        },
        expressSessions,
        expressPagination: {
          page: expressPage,
          limit: expressLimit,
          totalPages: expressTotalPages,
          totalSessions: totalExpressSessions,
          hasNext: expressPage < expressTotalPages,
          hasPrev: expressPage > 1,
          startIndex:
            expressSessions.length > 0
              ? (expressPage - 1) * expressLimit + 1
              : 0,
          endIndex:
            expressSessions.length > 0
              ? Math.min(expressPage * expressLimit, totalExpressSessions)
              : 0,
        },
        filters: { search, username, status, sortBy, sortOrder },
        userTheme: res.locals.userTheme || 'light',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'admin_sessions_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load user sessions');
      res.redirect('/admin');
    }
  };

  /**
   * Display session details
   * GET /admin/sessions/:id
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.id;
      const sessionType = (req.query.type as string) || 'oidc';

      if (sessionType === 'express') {
        const allExpressSessions =
          await this.sessionManager.findAllExpressSessions({ limit: 1000 });
        const expressSession = allExpressSessions.find(
          s => s._id === sessionId
        );

        if (!expressSession) {
          this.sessionManager.flash(req).error('Session not found');
          res.redirect('/admin/sessions');
          return;
        }

        const processed = await this.processExpressSessions([expressSession]);
        const sessionDetails = processed[0];
        if (!sessionDetails) {
          this.sessionManager.flash(req).error('Session not found');
          res.redirect('/admin/sessions');
          return;
        }

        sessionDetails.authorizations = {};
        sessionDetails.created_at = expressSession.session?.authTime
          ? new Date(expressSession.session.authTime)
          : new Date();
        sessionDetails.updated_at = expressSession.session?.lastActivity
          ? new Date(expressSession.session.lastActivity)
          : sessionDetails.created_at;

        res.render('admin/sessions/show', {
          title: 'Session details',
          session: sessionDetails,
          userTheme: res.locals.userTheme || 'light',
        });
        return;
      }

      // Default: OIDC session
      const session = await this.oidcAdapter.session.findSessionById(sessionId);

      if (!session) {
        this.sessionManager.flash(req).error('Session not found');
        res.redirect('/admin/sessions');
        return;
      }

      const sessionDetails = await this.oidcUtils.processSessionData(session);
      sessionDetails.sessionType = 'oidc';

      sessionDetails.authorizations = session.payload.authorizations || {};
      sessionDetails.created_at = session.created_at
        ? new Date(session.created_at)
        : new Date();
      sessionDetails.updated_at = session.updated_at
        ? new Date(session.updated_at)
        : new Date();

      res.render('admin/sessions/show', {
        title: `Session details`,
        session: sessionDetails,
        userTheme: res.locals.userTheme || 'light',
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'session_details_load_failed',
      });
      this.sessionManager.flash(req).error('Failed to load session details');
      res.redirect('/admin/sessions');
    }
  };

  /**
   * Revoke a specific session
   * POST /admin/sessions/:id/revoke
   */
  public revokeSession = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.id;
      const sessionType = (req.body.sessionType as string) || 'oidc';

      if (sessionType === 'express') {
        const allExpressSessions =
          await this.sessionManager.findAllExpressSessions({ limit: 1000 });
        const expressSession = allExpressSessions.find(
          s => s._id === sessionId
        );
        const targetUsername = expressSession?.session?.accountId || 'unknown';

        const revoked =
          await this.sessionManager.revokeExpressSession(sessionId);

        if (revoked) {
          const adminUser = this.sessionManager.getActiveUser(req);
          this.activityService.success(
            'admin_session_revoked',
            `Admin revoked Express session for user ${targetUsername}`,
            null,
            {
              ip_address: req.ip,
              user_agent: req.get('User-Agent'),
              actor: adminUser
                ? { ...adminUser, actor_type: 'admin' }
                : undefined,
              target: {
                target_type: 'session',
                entity_id: sessionId,
                entity_name: targetUsername,
              },
              device_infos:
                this.clientDeviceInfoManager.getClientInfoFromRequest(req),
            }
          );

          if (this.pubsub?.isConnected()) {
            this.pubsub
              .publish(`${this.redisPrefix}:session:revoked`, {
                originId: this.originId,
                username: targetUsername,
                sessionId,
              })
              .catch(() => {});
          }

          this.sessionManager
            .flash(req)
            .success('Session revoked successfully');
        } else {
          this.sessionManager
            .flash(req)
            .error('Session not found or already expired');
        }
      } else {
        // OIDC session revocation (existing logic)
        const session =
          await this.oidcAdapter.session.findSessionById(sessionId);
        const targetUsername = session?.payload?.accountId || 'unknown';

        const revoked = await this.oidcAdapter.session.revokeSession(sessionId);

        if (revoked) {
          const adminUser = this.sessionManager.getActiveUser(req);
          this.activityService.success(
            'admin_session_revoked',
            `Admin revoked session for user ${targetUsername}`,
            null,
            {
              ip_address: req.ip,
              user_agent: req.get('User-Agent'),
              actor: adminUser
                ? { ...adminUser, actor_type: 'admin' }
                : undefined,
              target: {
                target_type: 'session',
                entity_id: sessionId,
                entity_name: targetUsername,
              },
              device_infos:
                this.clientDeviceInfoManager.getClientInfoFromRequest(req),
            }
          );

          if (this.pubsub?.isConnected()) {
            this.pubsub
              .publish(`${this.redisPrefix}:session:revoked`, {
                originId: this.originId,
                username: targetUsername,
                sessionId,
              })
              .catch(() => {});
          }

          this.sessionManager
            .flash(req)
            .success('Session revoked successfully');
        } else {
          this.sessionManager
            .flash(req)
            .error('Session not found or already expired');
        }
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'session_revocation_failed',
      });
      this.sessionManager.flash(req).error('Failed to revoke session');
    }

    res.redirect('/admin/sessions');
  };

  /**
   * Revoke all sessions for a specific user
   * POST /admin/sessions/revoke-user/:username
   */
  public revokeUserSessions = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const username = req.params.username;

      const userSessions =
        await this.oidcAdapter.session.findByAccountId(username);

      let oidcRevokedCount = 0;
      for (const session of userSessions) {
        const sessionId = session.payload.jti;
        if (sessionId) {
          const revoked =
            await this.oidcAdapter.session.revokeSession(sessionId);
          if (revoked) oidcRevokedCount++;
        }
      }

      // Also revoke Express sessions for the same user
      const expressRevokedCount =
        await this.sessionManager.revokeAllSessionsForUser(username);

      const totalRevoked = oidcRevokedCount + expressRevokedCount;

      if (totalRevoked > 0) {
        const adminUser = this.sessionManager.getActiveUser(req);
        this.activityService.success(
          'admin_sessions_bulk_revoked',
          `Admin revoked all sessions for user ${username}`,
          null,
          {
            ip_address: req.ip,
            user_agent: req.get('User-Agent'),
            actor: adminUser
              ? { ...adminUser, actor_type: 'admin' }
              : undefined,
            target: {
              target_type: 'session',
              entity_name: username,
              entity_data: {
                oidcRevokedCount,
                expressRevokedCount,
                totalRevoked,
              },
            },
            device_infos:
              this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          }
        );

        if (this.pubsub?.isConnected()) {
          this.pubsub
            .publish(`${this.redisPrefix}:session:revoked`, {
              originId: this.originId,
              username,
              action: 'revoke_all',
            })
            .catch(() => {});
        }

        this.sessionManager
          .flash(req)
          .success(
            `Successfully revoked ${totalRevoked} session(s) for user ${username}`
          );
      } else {
        this.sessionManager
          .flash(req)
          .info('No active sessions found for this user');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_sessions_revocation_failed',
      });
      this.sessionManager.flash(req).error('Failed to revoke user sessions');
    }

    res.redirect('/admin/sessions');
  };

  /**
   * Get session statistics
   * GET /admin/sessions/stats
   */
  public getStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionStats =
        await this.oidcAdapter.session.getSessionStatistics();
      const now = Math.floor(Date.now() / 1000);

      const uniqueUsers = await this.oidcAdapter.session.getDistinctValues(
        'payload.accountId',
        {
          'payload.kind': 'Session',
          'payload.exp': { $gt: now },
        }
      );

      const expressTotal = await this.sessionManager.countAllExpressSessions();

      const stats = {
        total: sessionStats.total + expressTotal,
        oidcTotal: sessionStats.total,
        oidcActive: sessionStats.active,
        oidcExpired: sessionStats.expired,
        expressTotal,
        uniqueUsers: uniqueUsers.length,
        averageSessionsPerUser:
          uniqueUsers.length > 0
            ? (sessionStats.active / uniqueUsers.length).toFixed(2)
            : '0',
      };

      res.json(stats);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'session_statistics_load_failed',
      });
      res.status(500).json({ error: 'Failed to get session statistics' });
    }
  };

  /**
   * Process raw Express session documents into the same shape as OIDC sessions
   */
  private async processExpressSessions(rawSessions: any[]): Promise<any[]> {
    const results: any[] = [];

    for (const sessDoc of rawSessions) {
      const sessData = sessDoc.session;
      if (!sessData) continue;

      const metadata = sessData._metadata || {};
      const authTimeMs = sessData.authTime
        ? new Date(sessData.authTime).getTime()
        : Date.now();
      const lastActivityMs = sessData.lastActivity
        ? new Date(sessData.lastActivity).getTime()
        : authTimeMs;

      let browser = 'Unknown';
      let os = 'Unknown';
      if (metadata.browser?.name) {
        browser = metadata.browser.name;
        os = metadata.os?.name || 'Unknown';
      } else if (sessData.userAgent) {
        const parser = new UAParser(sessData.userAgent);
        const result = parser.getResult();
        browser = result.browser.name || 'Unknown';
        os = result.os.name || 'Unknown';
      }

      const device = `${browser} on ${os}`;
      const ip = sessData.ipAddress || metadata.createdIp || 'Unknown';
      const accountId = sessData.accountId || 'Unknown';

      let userInfo = {
        username: accountId,
        email: 'Unknown',
        full_name: 'Unknown User',
        given_name: '',
        family_name: '',
      };

      try {
        const loginTimeSec = Math.floor(authTimeMs / 1000);
        const userActivities =
          await this.activityService.findActivitiesAroundTime(
            accountId,
            loginTimeSec,
            300
          );

        if (userActivities.length > 0) {
          const latestActivity = userActivities[0];
          userInfo = {
            username: accountId,
            email: latestActivity.actor?.email || 'Unknown',
            full_name: latestActivity.actor?.full_name || 'Unknown User',
            given_name: latestActivity.actor?.given_name || '',
            family_name: latestActivity.actor?.family_name || '',
          };
        }
      } catch {
        // User info lookup failed, use defaults
      }

      const ageMs = Date.now() - authTimeMs;
      const ageMinutes = Math.floor(ageMs / 60000);
      let sessionAge: string;
      if (ageMinutes < 60) {
        sessionAge = `${ageMinutes}m ago`;
      } else if (ageMinutes < 1440) {
        sessionAge = `${Math.floor(ageMinutes / 60)}h ago`;
      } else {
        sessionAge = `${Math.floor(ageMinutes / 1440)}d ago`;
      }

      const startTime = new Date(authTimeMs).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const lastActive = new Date(lastActivityMs).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      results.push({
        id: sessDoc._id as string,
        sessionType: 'express' as const,
        accountId,
        userInfo,
        device,
        location: ip && ip !== 'Unknown' ? 'Online' : 'Unknown',
        ip,
        startTime,
        lastActive,
        loginTimestamp: authTimeMs,
        sessionAge,
        expiresIn: 'Session-based',
        expiresAt: null,
        status: 'active',
        clients: [],
        amr: [],
        acr: '',
        user_agent: sessData.userAgent || 'Unknown',
      });
    }

    return results;
  }
}
