/**
 * Local types for client management
 * Extracted from client-registry-config.ts to avoid external dependencies
 */

/**
 * OIDC Client configuration type
 * Based on OpenID Connect Core 1.0 specification and OAuth 2.0 Dynamic Client Registration
 */
export interface OidcClient {
  client_id: string;
  client_secret?: string;

  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;

  // Application type and authentication
  application_type: 'web' | 'native' | 'spa';
  token_endpoint_auth_method:
    | 'client_secret_basic'
    | 'client_secret_post'
    | 'client_secret_jwt'
    | 'private_key_jwt'
    | 'none';

  grant_types: string[];
  response_types: string[];

  // URIs
  redirect_uris: string[];
  post_logout_redirect_uris: string[];

  scope: string;
  audience?: string;

  // Token format and TTL
  accessTokenFormat?: 'jwt' | 'opaque';
  id_token_signed_response_alg?: string;
  userinfo_signed_response_alg?: string;

  // PKCE
  require_pkce?: boolean;

  // Custom fields for internal use
  allowedResources?: string[];
  resourcesScopes?: string;
  isInternalClient?: boolean;

  contacts?: string[];
  jwks_uri?: string;
  jwks?: any;

  // Creation and modification timestamps
  created_at?: number;
  updated_at?: number;

  // Client description and tags for management
  description?: string;
  tags?: string[];

  active?: boolean;

  // Client preset (immutable after creation)
  preset?: 'web' | 'spa' | 'native' | 'm2m' | 'device' | 'api_management';

  // Device flow specific properties (RFC 8628)
  device_authorization_endpoint?: string;
  device_code_lifetime?: number;
  user_code_lifetime?: number;
  verification_uri_complete?: boolean;
  user_code_challenge_method?: string;
}

/**
 * Client registry configuration type
 */
export interface ClientRegistryConfig {
  version: string;
  created_at: number;
  updated_at: number;
  clients: OidcClient[];
}
