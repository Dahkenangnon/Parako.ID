import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IClientRegistryManager } from '../../../di/interfaces/client-registry-manager.interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IOIDCAdapterBridge } from '../../../di/interfaces/oidc-adapter-bridge.interface.js';
import { KoaContextWithOIDC } from 'oidc-provider';
import { Client } from 'oidc-provider';
import { errors } from 'oidc-provider';
import { ResourceServer, ExtendedClient } from '../../interfaces/interface.js';
import {
  MANAGEMENT_API_RESOURCE_URI,
  ALL_MANAGEMENT_API_SCOPES,
} from '../../../api/v1/scopes.js';

/**
 * Factory function to create resource indicator configuration
 * @param configManager - Configuration manager instance
 * @param clientRegistryManager - ParakoRP configuration manager instance
 * @param logger - Logger instance
 * @param oidcAdapterBridge - OIDC adapter bridge for DB client discovery
 * @returns Resource indicator configuration object
 */
export default function ResourceIndicator(
  configManager: IConfigManager,
  clientRegistryManager: IClientRegistryManager,
  logger: ILogger,
  oidcAdapterBridge: IOIDCAdapterBridge
) {
  const config = configManager.getConfig();

  /**
   * Add clients that qualify as resource servers to the resource list.
   * Shared logic used by both static and DB client loading.
   *
   * @param clients - Array of client objects to evaluate
   * @param resourcesList - Target map to populate
   */
  function addClientsToResourceList(
    clients: any[],
    resourcesList: Record<string, ResourceServer>
  ): void {
    const resourceServerClients = clients.filter(client => {
      const hasClientCredentials =
        Array.isArray(client.grant_types) &&
        client.grant_types.includes('client_credentials');

      const hasResourceScopes =
        client.scope &&
        (client.scope.includes('api:') ||
          client.scope.includes('service:') ||
          client.scope.includes('resource:') ||
          client.scope.includes('parako:'));

      const isNotUserFacingClient =
        !Array.isArray(client.grant_types) ||
        !client.grant_types.includes('authorization_code');

      return (
        hasClientCredentials && (hasResourceScopes || isNotUserFacingClient)
      );
    });

    resourceServerClients.forEach(client => {
      const resourceId = client.audience || `urn:resource:${client.client_id}`;

      if (resourcesList[resourceId]) return;

      const audience = client.audience || resourceId;

      resourcesList[resourceId] = {
        scope: client.scope || 'api:read',
        audience,
        accessTokenFormat:
          (client.accessTokenFormat as 'opaque' | 'jwt') || 'jwt',
      };

      logger.info(
        `[RESOURCE SERVER] Registered: ${client.client_name || client.client_id} -> ${resourceId}`
      );
      logger.debug(`[RESOURCE SERVER] - Audience: ${audience}`);
      logger.debug(`[RESOURCE SERVER] - Scope: ${client.scope || 'api:read'}`);
      logger.debug(
        `[RESOURCE SERVER] - Token Format: ${client.accessTokenFormat || 'jwt'}`
      );
    });
  }

  /**
   * Build resource servers list from static clients (synchronous)
   *
   * @returns Record of resource servers
   */
  function buildResourceServersList(): Record<string, ResourceServer> {
    const resourcesList: Record<string, ResourceServer> = {};

    // This allows M2M clients to request access tokens scoped to the
    // Management API by passing `resource=urn:parako:api:v1`.
    resourcesList[MANAGEMENT_API_RESOURCE_URI] = {
      scope: ALL_MANAGEMENT_API_SCOPES,
      audience: MANAGEMENT_API_RESOURCE_URI,
      accessTokenFormat: 'jwt',
    };

    logger.info(
      `[RESOURCE SERVER] Registered built-in Management API: ${MANAGEMENT_API_RESOURCE_URI}`
    );

    try {
      const allClients = clientRegistryManager.getOidcProviderClients();
      addClientsToResourceList(allClients, resourcesList);

      logger.info(
        `[RESOURCE SERVER] Registered ${Object.keys(resourcesList).length} resource servers from static clients`
      );
    } catch (error) {
      logger.error(
        `[RESOURCE SERVER] Error building resource servers list: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return resourcesList;
  }

  let resourcesList: Record<string, ResourceServer> =
    buildResourceServersList();

  /**
   * Load resource servers from DB clients (async).
   * Called after adapter initialization to discover dynamically registered clients.
   */
  async function loadDbClients(): Promise<void> {
    try {
      if (!oidcAdapterBridge?.isInitialized) return;

      const dbClients = await oidcAdapterBridge.client.findAllClients();
      addClientsToResourceList(dbClients as any[], resourcesList);

      logger.info(
        `[RESOURCE SERVER] Loaded ${dbClients.length} DB clients, total resource servers: ${Object.keys(resourcesList).length}`
      );
    } catch (error) {
      logger.error(
        `[RESOURCE SERVER] Error loading DB clients: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Refresh the resource servers list from both static and DB sources
   */
  async function refreshResourceServersList(): Promise<void> {
    resourcesList = buildResourceServersList();
    await loadDbClients();
    logger.info(
      `[RESOURCE SERVER] Refreshed resource servers list, total: ${Object.keys(resourcesList).length}`
    );
  }

  /**
   * Get the current resource servers list
   *
   * @returns Current resource servers configuration
   */
  function getResourceServersList(): Record<string, ResourceServer> {
    return { ...resourcesList };
  }

  return {
    enabled: config.features.oidc.resource_indicators.enabled,

    /**
     * Selects the default resource when multiple resources are requested.
     * This function is called when the client requests multiple resources
     * and the authorization server needs to select one.
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {Client} client - The client making the request
     * @param {string[]} oneOf - Array of requested resources
     * @returns {string} The selected resource identifier
     */
    defaultResource(
      ctx: KoaContextWithOIDC,
      _client: Client,
      _oneOf?: string[]
    ) {
      logger.debug('>>----ctx.oidc.params?.resource:', {
        data: ctx.oidc.params?.resource,
      });
      return Array.isArray(ctx.oidc.params?.resource)
        ? ctx.oidc.params?.resource[0]
        : (ctx.oidc.params?.resource as string);
    },

    /**
     * Determines if a resource should be granted to the client.
     * This function is called for each requested resource during token issuance.
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {Object} model - The token model (AuthorizationCode, RefreshToken, etc.)
     * @returns {Promise<boolean>} Whether the resource should be granted
     */
    useGrantedResource: async function useGrantedResource(
      _ctx: KoaContextWithOIDC,
      _model: any
    ) {
      return true;
    },

    /**
     * Retrieves the configuration for a requested resource server.
     * This function validates the resource request and returns the resource
     * server configuration including scopes and audience.
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {string} resourceIndicator - The requested resource identifier
     * @param {Client} client - The client making the request
     * @returns {Object} Resource server configuration
     * @throws {errors.InvalidRequest} When resource is invalid
     * @throws {errors.InvalidClientMetadata} When client is not authorized
     */
    getResourceServerInfo(
      _ctx: KoaContextWithOIDC,
      resourceIndicator: string,
      client: ExtendedClient
    ) {
      if (!resourceIndicator || !resourcesList[resourceIndicator]) {
        throw new errors.InvalidRequest('Invalid resource server');
      }

      const targetResourceServer = resourcesList[resourceIndicator];

      // Client request access_token for api must defined these 2 metadata: allowResources, ressourcesScopes
      if (
        !Array.isArray(client.allowedResources) ||
        !client.allowedResources.includes(resourceIndicator)
      ) {
        throw new errors.InvalidClientMetadata(
          'allowedResources & resourcesScopes are mandatory or you cannot request access token for this server'
        );
      }

      // Now ensure client get access_token for scope it not defined
      let clientAllowedScope: string[] = [];
      if (
        client.resourcesScopes &&
        typeof client.resourcesScopes === 'string'
      ) {
        const scopesList = client.resourcesScopes.split(' ');
        clientAllowedScope = scopesList.filter((scopeItem: string) => {
          return targetResourceServer.scope.includes(scopeItem);
        });
      } else {
        throw new errors.InvalidClientMetadata(
          'Please specify at least one scope'
        );
      }

      logger.debug('>>----Client ressource allowed:', {
        data: client.allowedResources,
      });
      logger.debug('>>----Client ressource scopes:', {
        data: client.resourcesScopes,
      });
      logger.debug('>>----Target ressource server is:', {
        data: targetResourceServer,
      });
      logger.debug('>>----resourceIndicator is :', { data: resourceIndicator });
      logger.debug('>>----Client Scope allowed:', {
        data: clientAllowedScope.join(' '),
      });

      targetResourceServer.scope = clientAllowedScope.join(' ');
      return targetResourceServer;
    },

    // Utility functions for external use
    refreshResourceServersList,
    getResourceServersList,
    loadDbClients,
  };
}
