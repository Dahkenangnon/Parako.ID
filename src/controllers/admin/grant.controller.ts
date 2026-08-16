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
  ADMIN_GRANT_SORT_FIELDS,
  escapeRegExp,
  extractListingQuery,
} from '../../validators/listing-query.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { GuardError } from '../../utils/guard-error.js';

function firstQueryString(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' ? candidate : '';
}

type GrantClientDetails = {
  developer: string;
  id: string;
  logo: string | null;
  name: string;
  redirectUris: string[];
  uri: string;
};

function firstClientString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeGrantClient(
  rawClient: unknown,
  fallbackId: string
): GrantClientDetails {
  const client =
    rawClient && typeof rawClient === 'object'
      ? (rawClient as Record<string, unknown>)
      : {};
  const id = firstClientString(fallbackId, client.clientId, client.client_id);
  const uri = firstClientString(client.clientUri, client.client_uri);
  let developer = 'Unknown Developer';
  if (uri) {
    try {
      developer = new URL(uri).hostname || developer;
    } catch {
      // Persisted client metadata may predate current URI validation.
    }
  }
  const redirectUris = [client.redirectUris, client.redirect_uris].find(value =>
    Array.isArray(value)
  );

  return {
    id: id || 'Unknown',
    name:
      firstClientString(
        client.clientName,
        client.client_name,
        client.clientId,
        client.client_id
      ) || 'Unknown Application',
    developer,
    logo: firstClientString(client.logoUri, client.logo_uri) || null,
    uri,
    redirectUris: Array.isArray(redirectUris)
      ? redirectUris.filter(
          (value): value is string => typeof value === 'string'
        )
      : [],
  };
}

function grantClientSummary(
  rawClient: unknown,
  fallbackId: string
): Pick<GrantClientDetails, 'developer' | 'id' | 'logo' | 'name'> {
  const { id, name, developer, logo } = normalizeGrantClient(
    rawClient,
    fallbackId
  );
  return { id, name, developer, logo };
}

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

  private acceptsHtml(req: Request): boolean {
    const accept = req.headers.accept;
    return (
      typeof accept === 'string' &&
      accept.toLowerCase().includes('text/html') &&
      typeof req.accepts === 'function' &&
      req.accepts(['html', 'json']) === 'html'
    );
  }

  private redirectWithFlash(
    req: Request,
    res: Response,
    level: 'error' | 'info' | 'success',
    message: string
  ): boolean {
    if (!this.acceptsHtml(req)) return false;

    const flash = this.sessionManager.flash(req);
    if (level === 'success') flash.success(message);
    else if (level === 'info') flash.info(message);
    else flash.error(message);
    res.redirect('/admin/user-grants');
    return true;
  }

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
    const clientId = firstQueryString(req.query.clientId);
    const username = firstQueryString(req.query.username);

    const filters: any = {};

    // Escape user-controlled search input before passing to Mongo $regex
    // to neutralise ReDoS attacks. The 200-char cap above bounds parser
    // work even in pathological inputs.
    if (search) {
      const safeSearch = {
        $regex: escapeRegExp(search),
        $options: 'i',
      };
      filters.$or = [
        { 'payload.accountId': safeSearch },
        { 'payload.clientId': safeSearch },
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

        let clientInfo = grantClientSummary(undefined, payload.clientId || '');

        try {
          if (payload.clientId) {
            const client = await this.oidcAdapter.client.find(payload.clientId);
            if (client) {
              clientInfo = grantClientSummary(client, payload.clientId);
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

        return {
          id: grant._id,
          grantId: payload.jti || grant._id,
          username: payload.accountId || 'Unknown',
          client: clientInfo,
          scopes: Array.from(scopesSet),
          grantedAt: payload.iat ? new Date(payload.iat * 1000) : 'Unknown',
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
              name: normalizeGrantClient(client, clientId).name,
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
        startIndex: totalGrants > 0 ? (page - 1) * limit + 1 : 0,
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
      throw new GuardError('Grant not found', {
        status: 404,
        redirectTo: '/admin/user-grants',
        flashMessage: 'Grant not found',
      });
    }

    const payload = grant.payload as any;

    let clientInfo = normalizeGrantClient(undefined, payload.clientId || '');

    try {
      if (payload.clientId) {
        const client = await this.oidcAdapter.client.find(payload.clientId);
        if (client) {
          clientInfo = normalizeGrantClient(client, payload.clientId);
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
      grantedAt: payload.iat ? new Date(payload.iat * 1000) : 'Unknown',
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

  public revokeGrant = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const adminUser = this.sessionManager.getActiveUser(req);

      const grant = await this.oidcAdapter.grant.findGrantById(id);

      if (!grant) {
        if (this.redirectWithFlash(req, res, 'error', 'Grant not found')) {
          return;
        }
        res.status(404).json({
          success: false,
          error: 'Grant not found',
        });
        return;
      }

      const payload = grant.payload as any;
      const grantId = payload.jti as string;
      if (!grantId) {
        if (
          this.redirectWithFlash(
            req,
            res,
            'error',
            'Grant has no valid identifier'
          )
        ) {
          return;
        }
        res.status(400).json({
          success: false,
          error: 'Grant has no valid identifier',
        });
        return;
      }

      const grantToRevoke = await this.oidcAdapter.grant.find(grantId);
      if (!grantToRevoke) {
        if (
          this.redirectWithFlash(
            req,
            res,
            'error',
            'Grant not found in OIDC provider'
          )
        ) {
          return;
        }
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

      if (
        this.redirectWithFlash(
          req,
          res,
          'success',
          'Grant revoked successfully'
        )
      ) {
        return;
      }
      res.json({
        success: true,
        message: 'Grant revoked successfully',
      });
    } catch (error) {
      this.logger.error(error as Error, { context: 'grant_revocation_failed' });
      if (this.redirectWithFlash(req, res, 'error', 'Failed to revoke grant')) {
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to revoke grant',
      });
    }
  };

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
        if (
          this.redirectWithFlash(
            req,
            res,
            'info',
            'No grants found for this user'
          )
        ) {
          return;
        }
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

      const message = `Successfully revoked ${revokedCount} grant(s)`;
      if (this.redirectWithFlash(req, res, 'success', message)) return;
      res.json({
        success: true,
        message,
        revokedCount,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_grants_revocation_failed',
      });
      if (
        this.redirectWithFlash(
          req,
          res,
          'error',
          'Failed to revoke user grants'
        )
      ) {
        return;
      }
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
        if (
          this.redirectWithFlash(
            req,
            res,
            'info',
            'No grants found for this client'
          )
        ) {
          return;
        }
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

      const message = `Successfully revoked ${revokedCount} grant(s)`;
      if (this.redirectWithFlash(req, res, 'success', message)) return;
      res.json({
        success: true,
        message,
        revokedCount,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'client_grants_revocation_failed',
      });
      if (
        this.redirectWithFlash(
          req,
          res,
          'error',
          'Failed to revoke client grants'
        )
      ) {
        return;
      }
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
