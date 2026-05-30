import { injectable, inject } from 'inversify';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IRedisPubSubService } from '../../di/interfaces/redis-pubsub-service.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import { TYPES } from '../../di/types.js';
import { parsePositiveInt, parseEnum } from '../../utils/query-parse.js';
import { SORT_ORDER_VALUES } from '../../middlewares/validation.middleware.js';

const ADMIN_OIDC_CLIENT_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'client_name',
  'application_type',
] as const;
import {
  APP_TYPE_PRESETS,
  GRANT_TYPES,
  RESPONSE_TYPES,
  AUTH_METHODS,
  SIGNING_ALGORITHMS,
  SUBJECT_TYPES,
} from '../../oidc/adapter/client.interface.js';
import {
  SCOPE_DEFINITIONS,
  MANAGEMENT_API_RESOURCE_URI,
  isPlatformOnlyScope,
} from '../../api/v1/scopes.js';
import type { ScopeDefinition } from '../../api/v1/scopes.js';
import type {
  OidcClientData,
  ClientFilters,
  ClientPreset,
} from '../../oidc/adapter/client.interface.js';
import { validateClientData } from '../../oidc/adapter/client-crud-utils.js';
import { tenantContext } from '../../multi-tenancy/tenant-context.js';

/**
 * Admin OIDC Client Controller
 * Handles all OIDC client management operations for admin panel
 */
@injectable()
export class AdminOidcClientController {
  private readonly originId = randomUUID();

  private get redisPrefix(): string {
    return this.configManager.getConfig().deployment?.redis_prefix || 'parako';
  }

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.RedisPubSubService)
    private readonly pubsub: IRedisPubSubService,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * Broadcast client cache invalidation to other instances via Redis pub/sub.
   */
  private invalidateClientCache(
    clientId: string,
    action: 'created' | 'updated' | 'deleted'
  ): void {
    if (this.pubsub?.isConnected()) {
      this.pubsub
        .publish(`${this.redisPrefix}:oidc:client:invalidated`, {
          originId: this.originId,
          clientId,
          action,
          timestamp: Date.now(),
        })
        .catch(() => {});
    }
  }

  /**
   * Whether the current tenant is the platform tenant.
   * In single-tenant mode all scopes are available (the single tenant IS the platform).
   */
  private isPlatformTenant(): boolean {
    const config = this.configManager.getConfig();
    const isMultiTenant = config.features?.multi_tenancy?.enabled === true;
    return !isMultiTenant || tenantContext.getTenantId() === '_platforms';
  }

  /**
   * Return scope definitions filtered for the current tenant.
   * Non-platform tenants never see platform-only scopes (tenants, cross-tenant, settings).
   */
  private getScopeDefinitions(): readonly ScopeDefinition[] {
    if (this.isPlatformTenant()) return SCOPE_DEFINITIONS;
    return SCOPE_DEFINITIONS.filter(s => !isPlatformOnlyScope(s.value));
  }

  /**
   * Strip platform-only scopes from client data (defense in depth).
   * Mutates the data object in place.
   */
  private stripPlatformOnlyScopes(data: Partial<OidcClientData>): void {
    if (this.isPlatformTenant()) return;

    if (data.resourcesScopes) {
      const filtered = data.resourcesScopes
        .split(' ')
        .filter(s => !isPlatformOnlyScope(s))
        .join(' ');
      data.resourcesScopes = filtered || undefined;
    }
  }

  /**
   * List all OIDC clients with pagination and filtering
   * GET /admin/oidc-clients
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
      const search = (
        Array.isArray(req.query.search)
          ? req.query.search[0]
          : (req.query.search as string) || ''
      )
        .toString()
        .slice(0, 200);
      const applicationType = (
        Array.isArray(req.query.application_type)
          ? req.query.application_type[0]
          : (req.query.application_type as string) || ''
      ).toString();
      const status = (
        Array.isArray(req.query.status)
          ? req.query.status[0]
          : (req.query.status as string) || ''
      ).toString();
      const sortBy = parseEnum(
        req.query.sortBy,
        ADMIN_OIDC_CLIENT_SORT_FIELDS,
        'created_at'
      );
      const sortOrder = parseEnum(
        req.query.sortOrder,
        SORT_ORDER_VALUES,
        'desc'
      );

      const filters: ClientFilters = {};
      if (applicationType) {
        filters.application_type =
          applicationType as ClientFilters['application_type'];
      }
      if (status) {
        filters.active = status === 'active';
      }

      // Load clients: search first if provided, otherwise use filters
      let clients: OidcClientData[];
      if (search && typeof search === 'string') {
        clients = await this.oidcAdapter.client.searchClients(search);

        if (applicationType) {
          clients = clients.filter(c => c.application_type === applicationType);
        }
        if (status) {
          const isActive = status === 'active';
          clients = clients.filter(c => c.active === isActive);
        }
      } else {
        clients = await this.oidcAdapter.client.findAllClients(filters);
      }

      clients.sort((a: OidcClientData, b: OidcClientData) => {
        const aValue = (a as any)[sortBy] || '';
        const bValue = (b as any)[sortBy] || '';

        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      const totalItems = clients.length;
      const totalPages = Math.ceil(totalItems / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedClients = clients.slice(startIndex, endIndex);

      const stats = await this.oidcAdapter.client.getClientStatistics();

      res.render('admin/oidc-clients/index', {
        title: 'OIDC Clients',
        clients: paginatedClients,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        filters: {
          search,
          applicationType,
          status,
        },
        appTypePresets: APP_TYPE_PRESETS,
        sortOptions: {
          sortBy,
          sortOrder,
        },
        stats,
        staticClientsNote:
          !this.configManager.getConfig().features?.multi_tenancy?.enabled,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_clients_list_failed',
      });
      this.sessionManager.flash(req).error('Failed to load OIDC clients');
      res.redirect('/admin');
    }
  };

  /**
   * Show OIDC client details
   * GET /admin/oidc-clients/:id
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const client = await this.oidcAdapter.client.findClientById(id);

      if (!client) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      // Strip client_secret from template data — secrets must not appear in HTML.
      // Admins reveal the secret via the /reveal-secret/:id API endpoint.
      const { client_secret: _stripped, ...safeClient } = client;

      res.render('admin/oidc-clients/show', {
        title: 'Client details',
        client: safeClient,
        hasSecret: !!_stripped,
        appTypePresets: APP_TYPE_PRESETS,
        grantTypes: GRANT_TYPES,
        responseTypes: RESPONSE_TYPES,
        authMethods: AUTH_METHODS,
        signingAlgorithms: SIGNING_ALGORITHMS,
        subjectTypes: SUBJECT_TYPES,
        scopeDefinitions: this.getScopeDefinitions(),
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_show_failed',
        id: req.params.id,
      });
      this.sessionManager
        .flash(req)
        .error('Failed to load OIDC client details');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Show create OIDC client form
   * GET /admin/oidc-clients/create
   */
  public create = async (req: Request, res: Response): Promise<void> => {
    try {
      res.render('admin/oidc-clients/create', {
        title: 'Create OIDC Client',
        appTypePresets: APP_TYPE_PRESETS,
        grantTypes: GRANT_TYPES,
        responseTypes: RESPONSE_TYPES,
        authMethods: AUTH_METHODS,
        signingAlgorithms: SIGNING_ALGORITHMS,
        subjectTypes: SUBJECT_TYPES,
        scopeDefinitions: this.getScopeDefinitions(),
        managementApiResourceUri: MANAGEMENT_API_RESOURCE_URI,
        client: {},
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_create_form_failed',
      });
      this.sessionManager.flash(req).error('Failed to load create form');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Store new OIDC client
   * POST /admin/oidc-clients
   */
  public store = async (req: Request, res: Response): Promise<void> => {
    try {
      const clientData = this.processFormData(req.body);
      this.stripPlatformOnlyScopes(clientData);

      // Auto-set allowedResources for Management API preset
      if (
        clientData.preset === 'api_management' &&
        (!clientData.allowedResources ||
          clientData.allowedResources.length === 0)
      ) {
        clientData.allowedResources = [MANAGEMENT_API_RESOURCE_URI];
      }

      const validation = validateClientData(clientData);
      if (!validation.isValid) {
        this.sessionManager
          .flash(req)
          .error(`Validation failed: ${validation.errors.join(', ')}`);
        return res.redirect('/admin/oidc-clients/create');
      }

      const client = await this.oidcAdapter.client.createClient(clientData);

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_created',
        'Admin created OIDC client',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: client.client_name,
          },
        }
      );

      this.invalidateClientCache(client.client_id, 'created');

      this.sessionManager
        .flash(req)
        .success(`OIDC client "${client.client_name}" created successfully`);
      res.redirect(`/admin/oidc-clients/view/${client.client_id}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_store_failed',
        body: req.body,
      });
      this.sessionManager.flash(req).error('Failed to create OIDC client');
      res.redirect('/admin/oidc-clients/create');
    }
  };

  /**
   * Show edit OIDC client form
   * GET /admin/oidc-clients/:id/edit
   */
  public edit = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const client = await this.oidcAdapter.client.findClientById(id);

      if (!client) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      res.render('admin/oidc-clients/edit', {
        title: 'Edit Client',
        client,
        appTypePresets: APP_TYPE_PRESETS,
        grantTypes: GRANT_TYPES,
        responseTypes: RESPONSE_TYPES,
        authMethods: AUTH_METHODS,
        signingAlgorithms: SIGNING_ALGORITHMS,
        subjectTypes: SUBJECT_TYPES,
        scopeDefinitions: this.getScopeDefinitions(),
        managementApiResourceUri: MANAGEMENT_API_RESOURCE_URI,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_edit_form_failed',
        id: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to load edit form');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Update OIDC client
   * PUT /admin/oidc-clients/:id
   */
  public update = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const clientData = this.processFormData(req.body);
      this.stripPlatformOnlyScopes(clientData);

      // Immutable fields — preset and application_type cannot change after creation
      delete clientData.preset;
      delete clientData.application_type;

      const validation = validateClientData(clientData);
      if (!validation.isValid) {
        this.sessionManager
          .flash(req)
          .error(`Validation failed: ${validation.errors.join(', ')}`);
        return res.redirect(`/admin/oidc-clients/${id}/edit`);
      }

      const client = await this.oidcAdapter.client.updateClient(id, clientData);

      if (!client) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_updated',
        'Admin updated OIDC client',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: client.client_name,
          },
        }
      );

      this.invalidateClientCache(client.client_id, 'updated');

      this.sessionManager
        .flash(req)
        .success(`OIDC client "${client.client_name}" updated successfully`);
      res.redirect(`/admin/oidc-clients/view/${client.client_id}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_update_failed',
        id: req.params.id,
        body: req.body,
      });
      this.sessionManager.flash(req).error('Failed to update OIDC client');
      res.redirect(`/admin/oidc-clients/${req.params.id}/edit`);
    }
  };

  /**
   * Activate OIDC client
   * POST /admin/oidc-clients/:id/activate
   */
  public activate = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const client = await this.oidcAdapter.client.activateClient(id);

      if (!client) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_activated',
        'Admin activated OIDC client',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: client.client_name,
          },
        }
      );

      this.invalidateClientCache(client.client_id, 'updated');

      this.sessionManager
        .flash(req)
        .success(`OIDC client "${client.client_name}" activated successfully`);
      res.redirect(`/admin/oidc-clients/view/${client.client_id}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_activate_failed',
        id: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to activate OIDC client');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Deactivate OIDC client
   * POST /admin/oidc-clients/:id/deactivate
   */
  public deactivate = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const client = await this.oidcAdapter.client.deactivateClient(id);

      if (!client) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_deactivated',
        'Admin deactivated OIDC client',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: client.client_name,
          },
        }
      );

      this.invalidateClientCache(client.client_id, 'updated');

      this.sessionManager
        .flash(req)
        .success(
          `OIDC client "${client.client_name}" deactivated successfully`
        );
      res.redirect(`/admin/oidc-clients/view/${client.client_id}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_deactivate_failed',
        id: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to deactivate OIDC client');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Regenerate client secret
   * POST /admin/oidc-clients/:id/regenerate-secret
   */
  public regenerateSecret = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.oidcAdapter.client.regenerateClientSecret(id);

      if (!result) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      const { client } = result;

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_secret_regenerated',
        'Admin regenerated client secret',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: client.client_name,
          },
        }
      );

      this.invalidateClientCache(client.client_id, 'updated');

      this.sessionManager
        .flash(req)
        .success(`Client secret regenerated for "${client.client_name}"`);
      res.redirect(`/admin/oidc-clients/view/${client.client_id}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_regenerate_secret_failed',
        id: req.params.id,
      });
      this.sessionManager
        .flash(req)
        .error('Failed to regenerate client secret');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Delete OIDC client
   * DELETE /admin/oidc-clients/:id
   */
  public destroy = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const client = await this.oidcAdapter.client.findClientById(id);

      if (!client) {
        this.sessionManager.flash(req).error('OIDC client not found');
        res.redirect('/admin/oidc-clients');
        return;
      }

      const clientName = client.client_name || 'Unknown Client';

      const deleted = await this.oidcAdapter.client.deleteClient(id);

      if (!deleted) {
        this.sessionManager.flash(req).error('Failed to delete OIDC client');
        res.redirect('/admin/oidc-clients');
        return;
      }

      this.invalidateClientCache(client.client_id, 'deleted');

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_deleted',
        'Admin deleted OIDC client',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: clientName,
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(`OIDC client "${clientName}" deleted successfully`);
      res.redirect('/admin/oidc-clients');
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_destroy_failed',
        id: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to delete OIDC client');
      res.redirect('/admin/oidc-clients');
    }
  };

  /**
   * Get client statistics
   * GET /admin/oidc-clients/statistics
   */
  public statistics = async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = await this.oidcAdapter.client.getClientStatistics();
      res.json(stats);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_statistics_failed',
      });
      res.status(500).json({ error: 'Failed to get client statistics' });
    }
  };

  /**
   * Search OIDC clients
   * GET /admin/oidc-clients/search
   */
  public search = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q: query } = req.query;

      if (!query) {
        res.json([]);
        return;
      }

      const clients = await this.oidcAdapter.client.searchClients(
        query as string
      );

      res.json(
        clients.map((client: OidcClientData) => ({
          client_id: client.client_id,
          client_name: client.client_name,
          application_type: client.application_type,
          active: client.active,
        }))
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_search_failed',
        query: req.query,
      });
      res.status(500).json({ error: 'Search failed' });
    }
  };

  /**
   * Reveal client secret via API (on-demand, not embedded in HTML)
   * POST /admin/oidc-clients/:id/reveal-secret
   */
  public revealSecret = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const client = await this.oidcAdapter.client.findClientById(id);

      if (!client || !client.client_secret) {
        res.status(404).json({ error: 'Client or secret not found' });
        return;
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      this.activityService.success(
        'oidc_client_secret_viewed',
        'Admin viewed client secret',
        null,
        {
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          device_infos:
            this.clientDeviceInfoManager.getClientInfoFromRequest(req),
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'client',
            entity_id: client.client_id,
            entity_name: client.client_name,
          },
        }
      );

      res.json({ client_secret: client.client_secret });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'oidc_client_reveal_secret_failed',
        id: req.params.id,
      });
      res.status(500).json({ error: 'Failed to reveal client secret' });
    }
  };

  /**
   * Return undefined for empty/whitespace-only strings so they are omitted
   * from the client data rather than being stored as empty strings.
   */
  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Parse allowedResources from form body.
   * Auto-adds the Management API resource URI when api_scopes checkboxes are checked.
   */
  private parseAllowedResources(
    rawResources: unknown,
    rawApiScopes: unknown
  ): string[] {
    const resources: string[] = rawResources
      ? Array.isArray(rawResources)
        ? rawResources
        : String(rawResources)
            .split(/[\n,]+/)
            .map((r: string) => r.trim())
            .filter(Boolean)
      : [];

    const apiScopes = this.normalizeArray(rawApiScopes);
    if (
      apiScopes.length > 0 &&
      !resources.includes(MANAGEMENT_API_RESOURCE_URI)
    ) {
      resources.push(MANAGEMENT_API_RESOURCE_URI);
    }

    return [...new Set(resources)];
  }

  /**
   * Merge resourcesScopes textarea value with api_scopes checkbox values.
   * Ensures both custom scopes and Management API scopes are persisted
   * even if the client-side merge didn't execute.
   */
  private mergeResourcesScopes(
    rawScopes: unknown,
    rawApiScopes: unknown
  ): string | undefined {
    const textareaScopes =
      typeof rawScopes === 'string'
        ? rawScopes
            .split(/\s+/)
            .map(s => s.trim())
            .filter(Boolean)
        : [];
    const apiScopes = this.normalizeArray(rawApiScopes);

    // Merge: keep all textarea scopes (custom + any parako:) + add checked api_scopes
    const merged = [...new Set([...textareaScopes, ...apiScopes])];

    return merged.length > 0 ? merged.join(' ') : undefined;
  }

  /**
   * Normalize a form field that may be a string, array, or undefined into a string array.
   */
  private normalizeArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return [String(value)].filter(Boolean);
  }

  /**
   * Process form data and convert to flat OidcClientData structure
   */
  private processFormData(body: any): Partial<OidcClientData> {
    const defaultMaxAge = parseInt(body.default_max_age, 10);

    return {
      client_name: body.client_name,
      description: this.optionalString(body.description),
      application_type: body.application_type,
      preset: (body.preset as ClientPreset) || undefined,
      redirect_uris: body.redirect_uris
        ? body.redirect_uris
            .split('\n')
            .map((uri: string) => uri.trim())
            .filter(Boolean)
        : [],
      post_logout_redirect_uris: body.post_logout_redirect_uris
        ? body.post_logout_redirect_uris
            .split('\n')
            .map((uri: string) => uri.trim())
            .filter(Boolean)
        : [],
      grant_types: Array.isArray(body.grant_types)
        ? body.grant_types
        : body.grant_types
          ? [body.grant_types]
          : [],
      response_types: Array.isArray(body.response_types)
        ? body.response_types
        : body.response_types
          ? [body.response_types]
          : [],
      scope: this.optionalString(body.scope),
      token_endpoint_auth_method: body.token_endpoint_auth_method,
      client_uri: this.optionalString(body.client_uri),
      logo_uri: this.optionalString(body.logo_uri),
      policy_uri: this.optionalString(body.policy_uri),
      tos_uri: this.optionalString(body.tos_uri),
      require_pkce: body.require_pkce === 'on',
      active: body.active === 'on',
      id_token_signed_response_alg: this.optionalString(
        body.id_token_signed_response_alg
      ),
      subject_type: this.optionalString(body.subject_type),
      default_max_age: Number.isFinite(defaultMaxAge)
        ? defaultMaxAge
        : undefined,
      tags: body.tags
        ? body.tags
            .split(',')
            .map((tag: string) => tag.trim())
            .filter(Boolean)
        : [],
      contacts: body.contacts
        ? body.contacts
            .split(',')
            .map((contact: string) => contact.trim())
            .filter(Boolean)
        : [],
      isInternalClient: body.isInternalClient === 'on',
      allowedResources: this.parseAllowedResources(
        body.allowedResources,
        body.api_scopes
      ),
      resourcesScopes: this.mergeResourcesScopes(
        body.resourcesScopes,
        body.api_scopes
      ),
    };
  }
}
