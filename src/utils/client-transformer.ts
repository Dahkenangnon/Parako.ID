/**
 * Client Transformer Utility
 * Handles transformation of OIDC clients from different sources into a unified structure.
 *
 * After the client-source unification, there are exactly two sources:
 * - static: Read-only clients from parako-rp.jsonc
 * - adapter: Mutable clients stored in the OIDC adapter (auto-discovered by provider)
 */

import type { OidcClientData } from '../oidc/adapter/client.interface.js';

// Source-specific client interfaces

/**
 * Static client from parako-rp.jsonc configuration
 */
export interface StaticClient {
  client_id: string;
  client_name: string;
  application_type: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  scope?: string;
  accessTokenFormat?: string;
  id_token_signed_response_alg?: string;
  allowedResources?: string[];
  resourcesScopes?: string[];
  isInternalClient?: boolean;
  contacts?: string[];
  active?: boolean;
  require_pkce?: boolean;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ClientMetadata {
  client_id: string;
  client_name: string;
  client_uri?: string;
  logo_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
  application_type: string;
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  response_modes?: string[];
  scope?: string;
  subject_type?: string;
  token_endpoint_auth_method?: string;
  require_auth_time?: boolean;
  default_acr_values?: string[];
  id_token_signed_response_alg?: string;
  id_token_encrypted_response_alg?: string;
  id_token_encrypted_response_enc?: string;
  userinfo_signed_response_alg?: string;
  userinfo_encrypted_response_alg?: string;
  userinfo_encrypted_response_enc?: string;
  authorization_signed_response_alg?: string;
  authorization_encrypted_response_alg?: string;
  authorization_encrypted_response_enc?: string;
  introspection_signed_response_alg?: string;
  introspection_encrypted_response_alg?: string;
  introspection_encrypted_response_enc?: string;
  request_object_signing_alg?: string;
  request_object_encryption_alg?: string;
  request_object_encryption_enc?: string;
  tls_client_auth_subject_dn?: string;
  tls_client_auth_san_dns?: string;
  tls_client_auth_san_uri?: string;
  tls_client_auth_san_ip?: string;
  tls_client_auth_san_email?: string;
  token_endpoint_auth_signing_alg?: string;
  backchannel_logout_session_required?: boolean;
  backchannel_logout_uri?: string;
  backchannel_user_code_parameter?: boolean;
  backchannel_authentication_request_signing_alg?: string;
  backchannel_client_notification_endpoint?: string;
  backchannel_token_delivery_mode?: string;
  require_signed_request_object?: boolean;
  require_pushed_authorization_requests?: boolean;
  jwks?: any;
  contacts?: string[];
  sector_identifier_uri?: string;
  initiate_login_uri?: string;
  client_id_issued_at?: number;
}

export interface UnifiedClient {
  client_id: string;
  client_name: string;
  application_type: string;

  source: 'static' | 'adapter';
  isEditable: boolean;
  isStatic: boolean;

  // Normalized fields (with defaults)
  active: boolean;
  require_pkce: boolean;
  tags: string[];
  contacts: string[];
  isInternalClient: boolean;
  created_at: string | null;
  updated_at: string | null;

  // Metadata (always present)
  metadata: ClientMetadata;

  description?: string;
  client_secret?: string;

  // Source-specific fields (preserved)
  [key: string]: any;
}

export class ClientTransformer {
  /**
   * Transform static client to unified structure
   */
  static transformStaticClient(client: StaticClient): UnifiedClient {
    return {
      ...client,
      source: 'static',
      isStatic: true,
      isEditable: false,

      metadata: {
        client_id: client.client_id,
        client_name: client.client_name,
        application_type: client.application_type,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: client.grant_types,
        response_types: client.response_types,
        redirect_uris: client.redirect_uris,
        post_logout_redirect_uris: client.post_logout_redirect_uris,
        scope: client.scope,
        id_token_signed_response_alg: client.id_token_signed_response_alg,
        contacts: client.contacts,
      },

      active: client.active !== undefined ? client.active : true,
      require_pkce: client.require_pkce || false,
      tags: client.tags || [],
      contacts: client.contacts || [],
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
      source: 'adapter',
      isStatic: false,
      isEditable: true,

      metadata: {
        client_id: client.client_id,
        client_name: client.client_name,
        application_type: client.application_type,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: client.grant_types,
        response_types: client.response_types,
        redirect_uris: client.redirect_uris,
        post_logout_redirect_uris: client.post_logout_redirect_uris,
        scope: client.scope,
        client_uri: client.client_uri,
        logo_uri: client.logo_uri,
        policy_uri: client.policy_uri,
        tos_uri: client.tos_uri,
        id_token_signed_response_alg: client.id_token_signed_response_alg,
        contacts: client.contacts,
      },

      active: client.active !== undefined ? client.active : true,
      require_pkce: client.require_pkce || false,
      tags: client.tags || [],
      contacts: client.contacts || [],
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

  /**
   * Get client debug information for logging
   */
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

  /**
   * Get array of clients debug information for logging
   */
  static getClientsDebugInfo(clients: UnifiedClient[]): any[] {
    return clients.map(client => this.getClientDebugInfo(client));
  }

  /**
   * Validate if client has required fields
   */
  static validateClient(client: UnifiedClient): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!client.client_id) errors.push('client_id is required');
    if (!client.client_name) errors.push('client_name is required');
    if (!client.application_type) errors.push('application_type is required');
    if (!client.metadata) errors.push('metadata is required');
    if (!client.source) errors.push('source is required');

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get client statistics by source
   */
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

      stats.byType[client.application_type] =
        (stats.byType[client.application_type] || 0) + 1;
    });

    return stats;
  }
}
