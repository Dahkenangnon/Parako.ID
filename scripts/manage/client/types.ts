import type { OidcClient } from './local-types.js';

// Client type templates with enhanced configuration
export const CLIENT_TYPES = {
  web: {
    name: 'Regular Web Application',
    description: 'Server-side app (Node.js, PHP, Ruby) with secure backend',
    icon: '🌐',
    defaults: {
      application_type: 'web' as const,
      token_endpoint_auth_method: 'client_secret_basic' as const,
      grant_types: ['authorization_code', 'refresh_token'] as const,
      response_types: ['code'] as const,
      scope: 'openid profile email',
      logo_uri: undefined,
      client_uri: undefined,
      tags: undefined,
      post_logout_redirect_uris: [],
      tos_uri: undefined,
      policy_uri: undefined,

      require_pkce: false,
      isInternalClient: false,
    },
  },
  spa: {
    name: 'Single Page Application',
    description:
      'Client-side JavaScript app (React, Vue, Angular) — public client, PKCE required',
    icon: '⚡',
    defaults: {
      application_type: 'web' as const,
      token_endpoint_auth_method: 'none' as const,
      grant_types: ['authorization_code', 'refresh_token'] as const,
      response_types: ['code'] as const,
      scope: 'openid profile email',
      require_pkce: true,
      isInternalClient: false,
    },
  },
  native: {
    name: 'Native / Mobile Application',
    description: 'iOS, Android, or desktop app — public client, PKCE required',
    icon: '📱',
    defaults: {
      application_type: 'native' as const,
      token_endpoint_auth_method: 'none' as const,
      grant_types: ['authorization_code', 'refresh_token'] as const,
      response_types: ['code'] as const,
      scope: 'openid profile email',
      require_pkce: true,
      isInternalClient: false,
    },
  },
  device: {
    name: 'Device Flow (Smart TV, CLI, IoT)',
    description:
      'Device with limited input — user authorizes on a separate screen',
    icon: '📺',
    defaults: {
      application_type: 'native' as const,
      token_endpoint_auth_method: 'client_secret_post' as const,
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'] as const,
      response_types: [] as string[],
      scope: 'openid profile email offline_access',
      redirect_uris: [] as string[],
      require_pkce: false,
      isInternalClient: false,
      // Device flow specific settings
      device_authorization_endpoint: '/oidc/v1/device/auth',
      user_code_challenge_method: 'S256',
      device_code_lifetime: 600, // 10 minutes
      user_code_lifetime: 600, // 10 minutes
      verification_uri_complete: true,
    },
  },
  m2m: {
    name: 'Machine-to-Machine (M2M)',
    description:
      'Backend service or daemon — client credentials for your own resource servers',
    icon: '🤖',
    defaults: {
      application_type: 'web' as const,
      token_endpoint_auth_method: 'client_secret_basic' as const,
      grant_types: ['client_credentials'] as const,
      redirect_uris: [] as string[],
      response_types: [] as string[],
      scope: '',
      require_pkce: false,
      isInternalClient: false,
    },
  },
  api_management: {
    name: 'Management API',
    description: 'Access the built-in Management API',
    icon: '🔧',
    defaults: {
      application_type: 'web' as const,
      token_endpoint_auth_method: 'client_secret_basic' as const,
      grant_types: ['client_credentials'] as const,
      redirect_uris: [] as string[],
      response_types: [] as string[],
      scope: '',
      require_pkce: false,
      isInternalClient: false,
      allowedResources: ['urn:parako:api:v1'],
    },
  },
} as const;

export type ClientType = keyof typeof CLIENT_TYPES;
export type { OidcClient };
