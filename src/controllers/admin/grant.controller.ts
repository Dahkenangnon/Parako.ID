import { Request, Response } from 'express';
import { injectable, inject } from 'inversify';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IAdminUserGrantsController } from '../../di/interfaces/admin-user-grants-controller.interface.js';
import { TYPES } from '../../di/types.js';

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

  /**
   * List all user grants with pagination, search, and filtering
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = Array.isArray(req.query.search)
        ? req.query.search[0]
        : (req.query.search as string) || '';
      const clientId = Array.isArray(req.query.clientId)
        ? req.query.clientId[0]
        : (req.query.clientId as string) || '';
      const username = Array.isArray(req.query.username)
        ? req.query.username[0]
        : (req.query.username as string) || '';
      const sortBy = (req.query.sortBy as string) || 'created_at';
      const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1;

      const filters: any = {};

      if (search) {
        filters.$or = [
          { 'payload.accountId': { $regex: search, $options: 'i' } },
          { 'payload.clientId': { $regex: search, $options: 'i' } },
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

      const grants = await this.oidcAdapter.grant.findGrantsWithPagination(
        filters,
        sortBy,
        sortOrder,
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
              const client = await this.oidcAdapter.client.find(
                payload.clientId
              );
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

          const scopesSet = new Set<string>();
          if (
            payload.openid?.scope &&
            typeof payload.openid.scope === 'string'
          ) {
            const scopeArray = payload.openid.scope.split(' ');
            for (const scope of scopeArray) {
              const trimmedScope = scope.trim();
              if (trimmedScope) scopesSet.add(trimmedScope);
            }
          }

          if (payload.resources && typeof payload.resources === 'object') {
            const resources = payload.resources as Record<string, any>;
            for (const scope of Object.values(resources)) {
              if (scope && typeof scope === 'string') {
                const scopeArray = scope.split(' ');
                for (const s of scopeArray) {
                  const trimmedScope = s.trim();
                  if (trimmedScope) scopesSet.add(trimmedScope);
                }
              }
            }
          }

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
    } catch (error) {
      this.logger.error(error as Error, { context: 'user_grants_load_failed' });
      res.status(500).render('admin/error', {
        title: 'Error',
        message: 'Failed to load user grants',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * Show detailed information about a specific grant
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const grant = await this.oidcAdapter.grant.findGrantById(id);

      if (!grant) {
        res.status(404).render('admin/error', {
          title: 'Grant Not Found',
          message: 'The requested grant could not be found',
          error: 'Grant not found',
        });
        return;
      }

      const payload = grant.payload as any;

      let clientInfo = {
        id: payload.clientId || 'Unknown',
        name: 'Unknown Application',
        developer: 'Unknown Developer',
        logo: '/images/clav.png',
        uri: '',
        redirectUris: [],
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

      const scopesSet = new Set<string>();
      if (payload.openid?.scope && typeof payload.openid.scope === 'string') {
        const scopeArray = payload.openid.scope.split(' ');
        for (const scope of scopeArray) {
          const trimmedScope = scope.trim();
          if (trimmedScope) scopesSet.add(trimmedScope);
        }
      }

      if (payload.resources && typeof payload.resources === 'object') {
        const resources = payload.resources as Record<string, any>;
        for (const scope of Object.values(resources)) {
          if (scope && typeof scope === 'string') {
            const scopeArray = scope.split(' ');
            for (const s of scopeArray) {
              const trimmedScope = s.trim();
              if (trimmedScope) scopesSet.add(trimmedScope);
            }
          }
        }
      }

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
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'grant_details_load_failed',
      });
      res.status(500).render('admin/error', {
        title: 'Error',
        message: 'Failed to load grant details',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * Revoke a specific grant
   */
  public revokeGrant = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const adminUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      if (!adminUser) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const grant = await this.oidcAdapter.grant.findGrantById(id);

      if (!grant) {
        res.status(404).json({
          success: false,
          error: 'Grant not found',
        });
        return;
      }

      const payload = grant.payload as any;

      try {
        // Use the jti field as the grant identifier
        const grantId = payload.jti as string;
        if (!grantId) {
          res.status(400).json({
            success: false,
            error: 'Grant has no valid identifier',
          });
          return;
        }

        // Use the provider's Grant model to find and revoke the grant
        const grantToRevoke = await this.oidcAdapter.grant.find(grantId);
        if (grantToRevoke) {
          await this.oidcAdapter.grant.destroy(grantId);

          this.activity.success(
            'grant_revoked_by_admin',
            'Admin revoked grant for user and client',
            null,
            {
              client_id: payload.clientId,
              ip_address: deviceInfos.ip,
              user_agent: deviceInfos.user_agent,
              device_infos: deviceInfos,
              actor: {
                ...adminUser,
                actor_type: 'admin',
              },
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
            `Admin ${adminUser.username} revoked grant ${grantId} for user ${payload.accountId} and client ${payload.clientId}`
          );

          res.json({
            success: true,
            message: 'Grant revoked successfully',
          });
        } else {
          res.status(404).json({
            success: false,
            error: 'Grant not found in OIDC provider',
          });
        }
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'grant_revocation_failed',
        });
        res.status(500).json({
          success: false,
          error: 'Failed to revoke grant',
        });
      }
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
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      if (!adminUser) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

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
          // Use the jti field as the grant identifier
          const grantId = payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grantDoc._id} has no jti, skipping revocation`
            );
            continue;
          }

          // Use the provider's Grant model to find and revoke the grant
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
          // Continue with other grants even if one fails
        }
      }

      if (revokedCount > 0) {
        this.activity.success(
          'all_user_grants_revoked_by_admin',
          'Admin revoked all grants for user',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              ...adminUser,
              actor_type: 'admin',
            },
            target: {
              target_type: 'grant',
              username,
              entity_data: {
                revokedCount,
              },
            },
          }
        );

        this.logger.info(
          `Admin ${adminUser.username} revoked all grants (${revokedCount}) for user ${username}`
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
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);
      if (!adminUser) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

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
          // Use the jti field as the grant identifier
          const grantId = payload.jti as string;
          if (!grantId) {
            this.logger.warn(
              `Grant ${grantDoc._id} has no jti, skipping revocation`
            );
            continue;
          }

          // Use the provider's Grant model to find and revoke the grant
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
          // Continue with other grants even if one fails
        }
      }

      if (revokedCount > 0) {
        this.activity.success(
          'all_client_grants_revoked_by_admin',
          'Admin revoked all grants for client',
          null,
          {
            ip_address: deviceInfos.ip,
            user_agent: deviceInfos.user_agent,
            device_infos: deviceInfos,
            actor: {
              ...adminUser,
              actor_type: 'admin',
            },
            target: {
              target_type: 'grant',
              entity_id: clientId,
              entity_name: clientId,
              entity_data: {
                revokedCount,
              },
            },
          }
        );

        this.logger.info(
          `Admin ${adminUser.username} revoked all grants (${revokedCount}) for client ${clientId}`
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
  public getStats = async (req: Request, res: Response): Promise<void> => {
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
