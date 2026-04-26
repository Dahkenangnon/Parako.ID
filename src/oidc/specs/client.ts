import type { IOIDCClientMerger } from '../../di/interfaces/oidc-client-merger.interface.js';
import { OidcClient } from '../../utils/client-registry-config.js';

/**
 * Factory function to create client configuration
 * @param clientMerger - OIDC Client Merger service instance
 * @returns Array of merged static and dynamic clients
 */
export default function Client(clientMerger: IOIDCClientMerger) {
  /**
   * Client Configuration for OIDC Provider
   *
   * This file defines the static client configurations for the OIDC Provider.
   * Static clients are those that don't expire, never reload, and are always available.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#clients}
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#faq}
   *
   * Client Metadata Properties:
   * - client_id: Unique identifier for the client (required)
   * - client_secret: Client's secret used for authentication (required for confidential clients)
   * - redirect_uris: Array of valid redirect URIs for the client
   * - response_types: Array of OAuth 2.0 response types the client can use
   * - grant_types: Array of OAuth 2.0 grant types the client can use
   * - application_type: Type of application (web, native, spa)
   * - token_endpoint_auth_method: Method used to authenticate at the token endpoint
   * - scope: Space-separated list of scopes the client can request
   *
   * Additional Custom Properties:
   * - allowedResources: Array of resource server URLs this client can access
   * - resourcesScopes: Space-separated list of scopes for resource access
   * - isInternalClient: Boolean indicating if this is an internal system client
   *
   * @type {Array<Object>} Array of client configuration objects
   */
  const staticClients: Partial<OidcClient>[] = [
    // You can hardcoded clients here which is not recommended.
    // Instead, you can use the CLI (`yarn client:add`) to add clients to the parako-rp.jsonc file.
    // This is the preferred way to add clients to the OIDC Provider.
    // Note: This is only for sample purposes.
    // {
    //   client_id: 'never-used-client',
    //   client_secret: 'never-used-client-secret',
    //   client_name: 'never-used-client',
    //   application_type: 'web',
    //   token_endpoint_auth_method: 'client_secret_basic',
    //   grant_types: ['authorization_code'],
    //   response_types: ['code'],
    //   redirect_uris: ['https://parako.id/auth/callback'],
    //   post_logout_redirect_uris: ['https://parako.id/auth/callback'],
    //   scope: 'openid',
    //   isInternalClient: true,
    // },
  ];

  /**
   * Export merged static and dynamic clients
   *
   * Note: These dynamic clients are not the same as d ynamic in the sense of the RFC 6749
   * dynamic clients. These are clients that are defined in the parako-rp.jsonc file and are
   * loaded from the file.
   *
   * This combines the static clients defined above with any dynamic clients
   * loaded from the parako-rp.jsonc file. Dynamic clients are filtered by
   * environment and only active clients are included.
   */
  return clientMerger.mergeClients(staticClients as any[]) as any[];
}
