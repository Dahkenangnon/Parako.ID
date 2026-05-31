import { Request, Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IAdminUserGrantsController } from '../../di/interfaces/admin-user-grants-controller.interface.js';
import { TYPES } from '../../di/types.js';
import {
  escapeRegExp,
  extractListingQuery,
} from '../../validators/listing-query.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { GuardError } from '../../utils/guard-error.js';

const ADMIN_GRANT_SORT_FIELDS = ['created_at', 'exp'] as const;

@injectable()
export class AdminUserGrantsController implements IAdminUserGrantsController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.ActivityService) private readonly activity: IActivityService,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  private get activityLoggerDeps() {
    return {
      activityService: this.activity,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

  /**
   * List all user grants with pagination, search, and filtering
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    const { page, limit, search, sortBy, sortOrder } = extractListingQuery(
      req.query,
      ADMIN_GRANT_SORT_FIELDS,
      { sortBy: 'created_at' }
    );
    const clientId = (
      Array.isArray(req.query.clientId)
        ? req.query.clientId[0]
        : (req.query.clientId as string) || ''
    ).toString();
    const username = (
      Array.isArray(req.query.username)
        ? req.query.username[0]
        : (req.query.username as string) || ''
    ).toString();

    const filters: any = {};

    // Escape user-controlled search input before passing to Mongo $regex
    // to neutralise ReDoS attacks. The 200-char cap above bounds parser
    // work even in pathological inputs.
    if (search) {
      const safeSearch = new RegExp(escapeRegExp(search), 'i');
      filters.$or = [
        { 'payload.accountId': { $regex: safeSearch } },
        { 'payload.clientId': { $regex: safeSearch } },
      ];
    }

    if (clientId) {
      filters['payload.clientId'] = clientId;
    }

    if (username) {
      filters['payload.accountId'] = username;
    }

    const totalGrants = await this.oidcAdapter.grant.countGrants(filters);
    const totalPages = Math.ceil(totalGrants / limit);
    const skip = (page - 1) * limit;
    const sortOrderNumeric = sortOrder === 'asc' ? 1 : -1;

    const grants = await this.oidcAdapter.grant.findGrantsWithPagination(
      filters,
      sortBy,
      sortOrderNumeric,
      skip,
      limit
    );

    const processedGrants = await Promise.all(
      grants.map(async (grant: any) => {
        const payload = grant.payload as any;

        let clientInfo = {
          id: payload.clientId || 'Unknown',
          name: 'Unknown Application',
          developer: 'Unknown Developer',
          logo: '/images/clav.png',
        };

        try {
          if (payload.clientId) {
            const client = await this.oidcAdapter.client.find(payload.clientId);
            if (client) {
              clientInfo = {
                id: payload.clientId,
                name:
                  (client as any).clientName ||
                  (client as any).clientId ||
                  'Unknown Application',
                developer:
                  (client as any).clientUri &&
                  typeof (client as any).clientUri === 'string'
                    ? new URL((client as any).clientUri).hostname
                    : 'Unknown Developer',
                logo: (client as any).logoUri || '/images/clav.png',
              };
            }
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'client_info_load_failed',
          });
        }

        const scopesSet = collectScopes(payload);

        const formatTime = (timestamp: number | null): string => {
          if (!timestamp) return 'Unknown';
          const date = new Date(timestamp * 1000);
          const now = new Date();
          const diff = now.getTime() - date.getTime();
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor(diff / (1000 * 60));

          if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
          if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
          if (minutes > 0)
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
          return 'Just now';
        };

        const formatDate = (timestamp: number | null): string => {
          if (!timestamp) return 'Unknown';
          return new Date(timestamp * 1000).toLocaleDateString();
        };

        return {
          id: grant._id,
          grantId: payload.jti || grant._id,
          username: payload.accountId || 'Unknown',
          client: clientInfo,
          scopes: Array.from(scopesSet),
          grantedAt: formatDate(payload.iat),
          lastUsed: formatTime(payload.iat),
          expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
          expiresIn: formatTime(payload.exp),
          isExpired: payload.exp ? Date.now() > payload.exp * 1000 : false,
          rawPayload: payload,
        };
      })
    );

    const clientIds =
      await this.oidcAdapter.grant.getDistinctValues('payload.clientId');
    const uniqueClients = await Promise.all(
      clientIds.map(async (clientId: any) => {
        try {
          const client = await this.oidcAdapter.client.find(clientId);
          if (client) {
            return {
              id: clientId,
              name: (client as any).clientName || clientId,
            };
          }

          return { id: clientId, name: clientId };
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'client_info_load_failed',
            clientId,
          });
          return { id: clientId, name: clientId };
        }
      })
    );

    const usernames =
      await this.oidcAdapter.grant.getDistinctValues('payload.accountId');
    const uniqueUsernames = usernames.map((username: any) => ({
      id: username,
      name: username,
    }));

    res.render('admin/user-grants/index', {
      title: 'User Grants Management',
      grants: processedGrants,
      pagination: {
        page,
        limit,
        totalPages,
        totalGrants,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        startIndex: (page - 1) * limit + 1,
        endIndex: Math.min(page * limit, totalGrants),
      },
      filters: {
        search,
        clientId,
        username,
        sortBy,
        sortOrder,
      },
      uniqueClients,
      uniqueUsernames,
    });
  };

  /**
   * Show detailed information about a specific grant
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const grant = await this.oidcAdapter.grant.findGrantById(id);

    if (!grant) {
      throw new GuardError('Grant not found', { status: 404 });
    }

    const payload = grant.payload as any;

    let clientInfo = {
      id: payload.clientId || 'Unknown',
      name: 'Unknown Application',
      developer: 'Unknown Developer',
      logo: '/images/clav.png',
      uri: '',
      redirectUris: [] as string[],
    };

    try {
      if (payload.clientId) {
        const client = await this.oidcAdapter.client.find(payload.clientId);
        if (client) {
          clientInfo = {
            id: payload.clientId,
            name:
              (client as any).clientName ||
              (client as any).clientId ||
              'Unknown Application',
            developer:
              (client as any).clientUri &&
              typeof (client as any).clientUri === 'string'
                ? new URL((client as any).clientUri).hostname
                : 'Unknown Developer',
            logo: (client as any).logoUri || '/images/clav.png',
            uri: (client as any).clientUri || '',
            redirectUris: (client as any).redirectUris || [],
          };
        }
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'client_info_load_failed',
      });
    }

    const scopesSet = collectScopes(payload);

    const formatDate = (timestamp: number | null): string => {
      if (!timestamp) return 'Unknown';
      return `${new Date(timestamp * 1000).toLocaleDateString()} ${new Date(
        timestamp * 1000
      ).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    };

    const grantDetails = {
      id: grant._id,
      grantId: payload.jti || grant._id,
      username: payload.accountId || 'Unknown',
      client: clientInfo,
      scopes: Array.from(scopesSet),
      grantedAt: formatDate(payload.iat),
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      expiresIn: formatDate(payload.exp),
      isExpired: payload.exp ? Date.now() > payload.exp * 1000 : false,
      rawPayload: payload,
      created_at: grant.created_at ? new Date(grant.created_at) : new Date(),
      updated_at: grant.updated_at ? new Date(grant.updated_at) : new Date(),
    };

    res.render('admin/user-grants/show', {
      title: 'Grant Details',
      grant: grantDetails,
    });
  };

  /**
   * Revoke a specific grant
   */
  public revokeGrant = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const adminUser = this.sessionManager.getActiveUser(req);

      const grant = await this.oidcAdapter.grant.findGrantById(id);

      if (!grant) {
        res.status(404).json({
          success: false,
          error: 'Grant not found',
        });
        return;
      }

      const payload = grant.payload as any;
      const grantId = payload.jti as string;
      if (!grantId) {
        res.status(400).json({
          success: false,
          error: 'Grant has no valid identifier',
        });
        return;
      }

      const grantToRevoke = await this.oidcAdapter.grant.find(grantId);
      if (!grantToRevoke) {
        res.status(404).json({
          success: false,
          error: 'Grant not found in OIDC provider',
        });
        return;
      }

      await this.oidcAdapter.grant.destroy(grantId);

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success(
        'grant_revoked_by_admin',
        null,
        'Admin revoked grant for user and client',
        {
          client_id: payload.clientId,
          target: {
            target_type: 'grant',
            entity_id: grantId,
            entity_data: {
              accountId: payload.accountId,
              clientId: payload.clientId,
            },
          },
        }
      );

      this.logger.info(
        `Admin ${adminUser?.username ?? 'unknown'} revoked grant ${grantId} for user ${payload.accountId} and client ${payload.clientId}`
      );

      res.json({
        success: true,
        message: 'Grant revoked successfully',
      });
    } catch (error) {
      this.logger.error(error as Error, { context: 'grant_revocation_failed' });
      res.status(500).json({
        success: false,
        error: 'Failed to revoke grant',
      });
    }
  };

  /**
   * Revoke all grants for a specific user
   */
  public revokeUserGrants = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { username } = req.params;
      const adminUser = this.sessionManager.getActiveUser(req);

      const userGrants =
        await this.oidcAdapter.grant.findGrantsByAccountId(username);

      if (!userGrants || userGrants.length === 0) {
        res.json({
          success: true,
          message: 'No grants found for this user',
          revokedCount: 0,
        });
        return;
      }

      let revokedCount = 0;
      for (const grantDoc of userGrants) {
        try {
          const payload = grantDoc.payload as any;
          const grantId = payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grantDoc._id} has no jti, skipping revocation`
            );
            continue;
          }

          const grant = await this.oidcAdapter.grant.find(grantId);
          if (grant) {
            await this.oidcAdapter.grant.destroy(grantId);
            revokedCount++;
            this.logger.info(
              `Successfully revoked grant ${grantId} for user ${username}`
            );
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'grant_revocation_failed',
          });
        }
      }

      if (revokedCount > 0) {
        activityLoggerFor(this.activityLoggerDeps, req, {
          defaultActorType: 'admin',
        }).success(
          'all_user_grants_revoked_by_admin',
          null,
          'Admin revoked all grants for user',
          {
            target: {
              target_type: 'grant',
              username,
              entity_data: { revokedCount },
            },
          }
        );

        this.logger.info(
          `Admin ${adminUser?.username ?? 'unknown'} revoked all grants (${revokedCount}) for user ${username}`
        );
      }

      res.json({
        success: true,
        message: `Successfully revoked ${revokedCount} grant(s)`,
        revokedCount,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_grants_revocation_failed',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to revoke user grants',
      });
    }
  };

  /**
   * Revoke all grants for a specific client
   */
  public revokeClientGrants = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { clientId } = req.params;
      const adminUser = this.sessionManager.getActiveUser(req);

      const clientGrants =
        await this.oidcAdapter.grant.findGrantsByClientId(clientId);

      if (!clientGrants || clientGrants.length === 0) {
        res.json({
          success: true,
          message: 'No grants found for this client',
          revokedCount: 0,
        });
        return;
      }

      let revokedCount = 0;
      for (const grantDoc of clientGrants) {
        try {
          const payload = grantDoc.payload as any;
          const grantId = payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grantDoc._id} has no jti, skipping revocation`
            );
            continue;
          }

          const grant = await this.oidcAdapter.grant.find(grantId);
          if (grant) {
            await this.oidcAdapter.grant.destroy(grantId);
            revokedCount++;
            this.logger.info(
              `Successfully revoked grant ${grantId} for client ${clientId}`
            );
          }
        } catch (error) {
          this.logger.error(error as Error, {
            context: 'grant_revocation_failed',
          });
        }
      }

      if (revokedCount > 0) {
        activityLoggerFor(this.activityLoggerDeps, req, {
          defaultActorType: 'admin',
        }).success(
          'all_client_grants_revoked_by_admin',
          null,
          'Admin revoked all grants for client',
          {
            target: {
              target_type: 'grant',
              entity_id: clientId,
              entity_name: clientId,
              entity_data: { revokedCount },
            },
          }
        );

        this.logger.info(
          `Admin ${adminUser?.username ?? 'unknown'} revoked all grants (${revokedCount}) for client ${clientId}`
        );
      }

      res.json({
        success: true,
        message: `Successfully revoked ${revokedCount} grant(s)`,
        revokedCount,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'client_grants_revocation_failed',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to revoke client grants',
      });
    }
  };

  /**
   * Get statistics about user grants
   */
  public getStats = async (_req: Request, res: Response): Promise<void> => {
    try {
      const stats = await this.oidcAdapter.grant.getGrantStatistics();

      res.json({
        success: true,
        stats: {
          totalGrants: stats.total,
          recentGrants: stats.recent,
          expiredGrants: stats.expired,
          grantsByClient: stats.byClient.map((item: any) => ({
            clientId: item._id,
            count: item.count,
          })),
          grantsByUser: stats.byUser.map((item: any) => ({
            username: item._id,
            count: item.count,
          })),
        },
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'grant_statistics_load_failed',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get grant statistics',
      });
    }
  };
}

/** Collect OIDC + resource-server scopes from a grant payload into one set. */
function collectScopes(payload: any): Set<string> {
  const scopes = new Set<string>();

  if (payload.openid?.scope && typeof payload.openid.scope === 'string') {
    for (const scope of payload.openid.scope.split(' ')) {
      const trimmed = scope.trim();
      if (trimmed) scopes.add(trimmed);
    }
  }

  if (payload.resources && typeof payload.resources === 'object') {
    for (const scope of Object.values(
      payload.resources as Record<string, unknown>
    )) {
      if (scope && typeof scope === 'string') {
        for (const s of scope.split(' ')) {
          const trimmed = s.trim();
          if (trimmed) scopes.add(trimmed);
        }
      }
    }
  }

  return scopes;
}
