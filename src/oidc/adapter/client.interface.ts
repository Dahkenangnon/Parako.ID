/** Canonical client metadata shared by static registries and managed adapters. */

export type ApplicationType = 'web' | 'native' | 'spa';

/**
 * Client preset — friendly name set at creation, immutable afterward.
 * Maps to spec-compliant application_type + grant/auth defaults.
 */
export type ClientPreset =
  'web' | 'spa' | 'native' | 'm2m' | 'device' | 'api_management';

/**
 * Convert Parako's legacy `spa` application label into provider metadata.
 * OIDC only defines `web` and `native`; the separate preset preserves the
 * user-facing SPA classification without passing an invalid value downstream.
 */
export function normalizeClientApplicationType<
  T extends { application_type?: ApplicationType; preset?: ClientPreset },
>(data: T): T {
  if (data.application_type !== 'spa') return data;

  return {
    ...data,
    application_type: 'web',
    preset: data.preset ?? 'spa',
  } as T;
}

export type TokenEndpointAuthMethod =
  | 'none'
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'client_secret_jwt'
  | 'private_key_jwt';

/**
 * Whether the client's token endpoint authentication method uses a shared
 * secret. An omitted method resolves to Parako's client_secret_basic default.
 */
export function clientAuthMethodUsesSecret(
  method?: TokenEndpointAuthMethod
): boolean {
  return method === undefined || method.startsWith('client_secret_');
}

/**
 * Grant and response types supported by Parako's oidc-provider configuration.
 *
 * Keep these lists aligned with the provider features enabled in
 * `src/oidc/specs/feature.ts`. Access-token implicit response types are not
 * enabled by oidc-provider and must not be offered or persisted.
 */
export const SUPPORTED_GRANT_TYPES = [
  'authorization_code',
  'implicit',
  'refresh_token',
  'client_credentials',
  'urn:ietf:params:oauth:grant-type:device_code',
] as const;

export const SUPPORTED_RESPONSE_TYPES = [
  'code',
  'id_token',
  'code id_token',
  'none',
] as const;

export interface OidcClientData {
  client_id: string;
  client_name: string;
  application_type: ApplicationType;

  client_secret?: string;
  token_endpoint_auth_method?: TokenEndpointAuthMethod;
  token_endpoint_auth_signing_alg?: string;

  // Client keys used by asymmetric authentication and encrypted responses.
  // node-oidc-provider accepts exactly one of an inline public JWKS or a JWKS URI.
  jwks_uri?: string;
  jwks?: {
    keys: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };

  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  client_uri?: string;
  logo_uri?: string;
  policy_uri?: string;
  tos_uri?: string;

  grant_types?: string[];
  response_types?: string[];
  scope?: string;

  require_pkce?: boolean;
  id_token_signed_response_alg?: string;
  subject_type?: string;
  default_max_age?: number;

  // Resource indicators (RFC 8707)
  allowedResources?: string[];
  resourcesScopes?: string;

  // Preset (immutable after creation)
  preset?: ClientPreset;

  description?: string;
  active?: boolean;
  tags?: string[];
  contacts?: string[];
  isInternalClient?: boolean;

  created_at?: string;
  updated_at?: string;
}

export interface ClientFilters {
  application_type?: ApplicationType;
  active?: boolean;
  tags?: string[];
  search?: string;
}

export interface ClientValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ClientStatistics {
  total: number;
  active: number;
  inactive: number;
  byType: Record<ApplicationType, number>;
}

export interface RegenerateSecretResult {
  client: OidcClientData;
  newSecret: string;
}

export const CLIENT_DEFAULTS: Partial<OidcClientData> = {
  application_type: 'web',
  token_endpoint_auth_method: 'client_secret_basic',
  grant_types: ['authorization_code'],
  response_types: ['code'],
  active: true,
  require_pkce: false,
  tags: [],
  contacts: [],
  isInternalClient: false,
};

/**
 * Auth0-style quick-start presets per application type.
 * Per OIDC spec, `application_type` only accepts "web" or "native".
 * Presets map friendly names (spa, m2m, device) to spec-compliant values.
 */
export const APP_TYPE_PRESETS = {
  web: {
    label: 'Regular Web Application',
    description: 'Server-side app (Node.js, PHP, Ruby) with secure backend',
    application_type: 'web' as const,
    token_endpoint_auth_method: 'client_secret_basic' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    require_pkce: false,
    scope: 'openid profile email',
  },
  spa: {
    label: 'Single Page Application',
    description:
      'Client-side JavaScript app (React, Vue, Angular) — public client, PKCE required',
    application_type: 'web' as const,
    token_endpoint_auth_method: 'none' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    require_pkce: true,
    scope: 'openid profile email',
  },
  native: {
    label: 'Native / Mobile Application',
    description: 'iOS, Android, or desktop app — public client, PKCE required',
    application_type: 'native' as const,
    token_endpoint_auth_method: 'none' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    require_pkce: true,
    scope: 'openid profile email',
  },
  m2m: {
    label: 'Machine-to-Machine (M2M)',
    description:
      'Backend service or daemon — client credentials for your own resource servers',
    application_type: 'web' as const,
    token_endpoint_auth_method: 'client_secret_basic' as const,
    grant_types: ['client_credentials'],
    response_types: [] as string[],
    require_pkce: false,
    scope: '',
  },
  device: {
    label: 'Device Flow (Smart TV, CLI, IoT)',
    description:
      'Device with limited input — user authorizes on a separate screen',
    application_type: 'native' as const,
    token_endpoint_auth_method: 'client_secret_post' as const,
    grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
    response_types: [] as string[],
    require_pkce: false,
    scope: 'openid profile email offline_access',
  },
  api_management: {
    label: 'Management API',
    description:
      'Access the built-in Management API — select scopes below after creation',
    application_type: 'web' as const,
    token_endpoint_auth_method: 'client_secret_basic' as const,
    grant_types: ['client_credentials'],
    response_types: [] as string[],
    require_pkce: false,
    scope: '',
    allowedResources: ['urn:parako:api:v1'],
  },
} as const;

export const SIGNING_ALGORITHMS = [
  { value: '', label: 'Provider Default (RS256)' },
  { value: 'RS256', label: 'RS256' },
  { value: 'RS384', label: 'RS384' },
  { value: 'RS512', label: 'RS512' },
  { value: 'ES256', label: 'ES256' },
  { value: 'ES384', label: 'ES384' },
  { value: 'ES512', label: 'ES512' },
  { value: 'PS256', label: 'PS256' },
  { value: 'PS384', label: 'PS384' },
  { value: 'PS512', label: 'PS512' },
] as const;

export const SUBJECT_TYPES = [
  { value: 'public', label: 'Public', description: 'Same sub for all clients' },
  {
    value: 'pairwise',
    label: 'Pairwise',
    description: 'Different sub per client',
  },
] as const;

export const GRANT_TYPES = [
  {
    value: 'authorization_code',
    label: 'Authorization Code',
    description: 'Standard OAuth 2.0 authorization code flow',
    recommended: true,
  },
  {
    value: 'refresh_token',
    label: 'Refresh Token',
    description: 'Allow obtaining new access tokens using refresh tokens',
    recommended: true,
  },
  {
    value: 'client_credentials',
    label: 'Client Credentials',
    description: 'Machine-to-machine authentication without user interaction',
    recommended: false,
  },
  {
    value: 'implicit',
    label: 'Implicit (Legacy)',
    description: 'Legacy flow, not recommended for new applications',
    recommended: false,
  },
  {
    value: 'urn:ietf:params:oauth:grant-type:device_code',
    label: 'Device Code',
    description: 'For devices with limited input capabilities',
    recommended: false,
  },
] as const;

export const RESPONSE_TYPES = [
  {
    value: 'code',
    label: 'Code',
    description: 'Authorization code response',
    recommended: true,
  },
  {
    value: 'id_token',
    label: 'ID Token',
    description: 'OpenID Connect ID token',
    recommended: false,
  },
  {
    value: 'code id_token',
    label: 'Code + ID Token',
    description: 'Hybrid flow with code and ID token',
    recommended: false,
  },
  {
    value: 'none',
    label: 'None',
    description: 'Authorization response without credentials',
    recommended: false,
  },
] as const;

export const AUTH_METHODS = [
  {
    value: 'client_secret_basic',
    label: 'Client Secret Basic',
    description: 'HTTP Basic Authentication with client credentials',
    recommended: true,
  },
  {
    value: 'client_secret_post',
    label: 'Client Secret POST',
    description: 'Client credentials in request body',
    recommended: false,
  },
  {
    value: 'none',
    label: 'None (Public Client)',
    description: 'No client authentication (for SPAs and native apps)',
    recommended: false,
  },
  {
    value: 'private_key_jwt',
    label: 'Private Key JWT',
    description: 'Client authentication using signed JWT',
    recommended: false,
  },
] as const;
