/**
 * Client Transformer Utility
 * Handles transformation of OIDC clients from different sources into a unified structure.
 *
 * After the client-source unification, there are exactly two sources:
 * - static: Read-only clients from parako-rp.jsonc
 * - adapter: Mutable clients stored in the OIDC adapter (auto-discovered by provider)
 */

import type { OidcClientData } from '../oidc/adapter/client.interface.js';
import type { StaticClient, UnifiedClient } from '../oidc/client.types.js';

export type {
  ClientMetadata,
  StaticClient,
  UnifiedClient,
} from '../oidc/client.types.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneOptionalArray<T>(
  values: readonly T[] | undefined
): T[] | undefined {
  return values ? [...values] : undefined;
}

function cloneArrayOrEmpty<T>(values: readonly T[] | undefined): T[] {
  return cloneOptionalArray(values) ?? [];
}

export class ClientTransformer {
  /**
   * Transform static client to unified structure
   */
  static transformStaticClient(client: StaticClient): UnifiedClient {
    return {
      ...client,
      grant_types: cloneOptionalArray(client.grant_types),
      response_types: cloneOptionalArray(client.response_types),
      redirect_uris: cloneOptionalArray(client.redirect_uris),
      post_logout_redirect_uris: cloneOptionalArray(
        client.post_logout_redirect_uris
      ),
      allowedResources: cloneOptionalArray(client.allowedResources),
      tags: cloneArrayOrEmpty(client.tags),
      contacts: cloneArrayOrEmpty(client.contacts),
      source: 'static',
      isStatic: true,
      isEditable: false,

      metadata: {
        client_id: client.client_id,
        client_name: client.client_name,
        application_type: client.application_type,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: cloneOptionalArray(client.grant_types),
        response_types: cloneOptionalArray(client.response_types),
        redirect_uris: cloneOptionalArray(client.redirect_uris),
        post_logout_redirect_uris: cloneOptionalArray(
          client.post_logout_redirect_uris
        ),
        scope: client.scope,
        id_token_signed_response_alg: client.id_token_signed_response_alg,
        contacts: cloneOptionalArray(client.contacts),
      },

      active: client.active !== undefined ? client.active : true,
      require_pkce: client.require_pkce || false,
      isInternalClient: client.isInternalClient || false,
      created_at: client.created_at || null,
      updated_at: client.updated_at || null,
    };
  }

  /**
   * Transform adapter client (from OIDC adapter storage) to unified structure
   */
  static transformAdapterClient(client: OidcClientData): UnifiedClient {
    return {
      ...client,
      grant_types: cloneOptionalArray(client.grant_types),
      response_types: cloneOptionalArray(client.response_types),
      redirect_uris: cloneOptionalArray(client.redirect_uris),
      post_logout_redirect_uris: cloneOptionalArray(
        client.post_logout_redirect_uris
      ),
      allowedResources: cloneOptionalArray(client.allowedResources),
      tags: cloneArrayOrEmpty(client.tags),
      contacts: cloneArrayOrEmpty(client.contacts),
      source: 'adapter',
      isStatic: false,
      isEditable: true,

      metadata: {
        client_id: client.client_id,
        client_name: client.client_name,
        application_type: client.application_type,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: cloneOptionalArray(client.grant_types),
        response_types: cloneOptionalArray(client.response_types),
        redirect_uris: cloneOptionalArray(client.redirect_uris),
        post_logout_redirect_uris: cloneOptionalArray(
          client.post_logout_redirect_uris
        ),
        scope: client.scope,
        client_uri: client.client_uri,
        logo_uri: client.logo_uri,
        policy_uri: client.policy_uri,
        tos_uri: client.tos_uri,
        id_token_signed_response_alg: client.id_token_signed_response_alg,
        contacts: cloneOptionalArray(client.contacts),
      },

      active: client.active !== undefined ? client.active : true,
      require_pkce: client.require_pkce || false,
      isInternalClient: client.isInternalClient || false,
      created_at: client.created_at || null,
      updated_at: client.updated_at || null,
    };
  }

  /**
   * Transform any client to unified structure based on source
   */
  static transformClient(
    client: any,
    source: 'static' | 'adapter'
  ): UnifiedClient {
    switch (source) {
      case 'static':
        return this.transformStaticClient(client as StaticClient);
      case 'adapter':
        return this.transformAdapterClient(client as OidcClientData);
      default:
        throw new Error(`Unknown client source: ${source}`);
    }
  }

  /**
   * Transform array of clients from a specific source
   */
  static transformClients(
    clients: any[],
    source: 'static' | 'adapter'
  ): UnifiedClient[] {
    return clients.map(client => this.transformClient(client, source));
  }

  static getClientDebugInfo(client: UnifiedClient): any {
    return {
      client_id: client.client_id,
      client_name: client.client_name,
      application_type: client.application_type,
      active: client.active,
      source: client.source,
      isEditable: client.isEditable,
      keys: Object.keys(client),
      hasMetadata: !!client.metadata,
      metadataKeys: client.metadata ? Object.keys(client.metadata) : [],
      created_at: client.created_at,
      updated_at: client.updated_at,
    };
  }

  static getClientsDebugInfo(clients: UnifiedClient[]): any[] {
    return clients.map(client => this.getClientDebugInfo(client));
  }

  static validateClient(client: UnifiedClient): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!isNonEmptyString(client.client_id))
      errors.push('client_id is required');
    if (!isNonEmptyString(client.client_name))
      errors.push('client_name is required');
    if (!isNonEmptyString(client.application_type))
      errors.push('application_type is required');
    if (!client.metadata) errors.push('metadata is required');
    if (!client.source) errors.push('source is required');

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  static getClientStatistics(clients: UnifiedClient[]): {
    total: number;
    static: number;
    adapter: number;
    active: number;
    inactive: number;
    byType: Record<string, number>;
  } {
    const stats = {
      total: clients.length,
      static: 0,
      adapter: 0,
      active: 0,
      inactive: 0,
      byType: {} as Record<string, number>,
    };

    clients.forEach(client => {
      stats[client.source]++;

      if (client.active) {
        stats.active++;
      } else {
        stats.inactive++;
      }

      const currentCount = Object.prototype.hasOwnProperty.call(
        stats.byType,
        client.application_type
      )
        ? stats.byType[client.application_type]
        : 0;

      Object.defineProperty(stats.byType, client.application_type, {
        value: currentCount + 1,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });

    return stats;
  }
}
