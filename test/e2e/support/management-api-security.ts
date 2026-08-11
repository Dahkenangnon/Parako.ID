export type ManagementApiHttpMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type SecuredManagementApiOperation = readonly [
  label: string,
  method: ManagementApiHttpMethod,
  path: string,
  requiredScope: string,
];

/**
 * Complete non-tenant Management API surface. Keeping this manifest shared
 * makes scope-policy tests portable across storage and tenancy adapters.
 */
export const MANAGEMENT_API_SECURED_OPERATIONS: readonly SecuredManagementApiOperation[] =
  [
    ['list clients', 'GET', '/clients', 'parako:clients:read'],
    ['create client', 'POST', '/clients', 'parako:clients:write'],
    ['get client', 'GET', '/clients/missing-e2e-client', 'parako:clients:read'],
    [
      'replace client',
      'PUT',
      '/clients/missing-e2e-client',
      'parako:clients:write',
    ],
    [
      'patch client',
      'PATCH',
      '/clients/missing-e2e-client',
      'parako:clients:write',
    ],
    [
      'delete client',
      'DELETE',
      '/clients/missing-e2e-client',
      'parako:clients:delete',
    ],
    [
      'activate client',
      'POST',
      '/clients/missing-e2e-client/activate',
      'parako:clients:write',
    ],
    [
      'deactivate client',
      'POST',
      '/clients/missing-e2e-client/deactivate',
      'parako:clients:write',
    ],
    [
      'rotate client secret',
      'POST',
      '/clients/missing-e2e-client/secret',
      'parako:clients:write',
    ],
    [
      'get client stats',
      'GET',
      '/clients/missing-e2e-client/stats',
      'parako:clients:read',
    ],
    ['list users', 'GET', '/users', 'parako:users:read'],
    ['create user', 'POST', '/users', 'parako:users:write'],
    ['get user', 'GET', '/users/missing-e2e-user', 'parako:users:read'],
    ['replace user', 'PUT', '/users/missing-e2e-user', 'parako:users:write'],
    ['patch user', 'PATCH', '/users/missing-e2e-user', 'parako:users:write'],
    ['delete user', 'DELETE', '/users/missing-e2e-user', 'parako:users:delete'],
    ['lock user', 'POST', '/users/missing-e2e-user/lock', 'parako:users:write'],
    [
      'unlock user',
      'DELETE',
      '/users/missing-e2e-user/lock',
      'parako:users:write',
    ],
    [
      'reset user password',
      'POST',
      '/users/missing-e2e-user/password-reset',
      'parako:users:write',
    ],
    [
      'reset user MFA',
      'POST',
      '/users/missing-e2e-user/mfa/reset',
      'parako:users:write',
    ],
    [
      'list user activities',
      'GET',
      '/users/missing-e2e-user/activities',
      'parako:users:read',
    ],
    [
      'list user sessions',
      'GET',
      '/users/missing-e2e-user/sessions',
      'parako:sessions:read',
    ],
    ['list sessions', 'GET', '/sessions', 'parako:sessions:read'],
    [
      'get session',
      'GET',
      '/sessions/missing-e2e-session',
      'parako:sessions:read',
    ],
    [
      'revoke session',
      'DELETE',
      '/sessions/missing-e2e-session',
      'parako:sessions:revoke',
    ],
    ['bulk revoke sessions', 'DELETE', '/sessions', 'parako:sessions:revoke'],
    ['list JWKS', 'GET', '/jwks', 'parako:jwks:read'],
    ['rotate JWKS', 'POST', '/jwks/rotate', 'parako:jwks:rotate'],
    [
      'retire expired JWKS',
      'POST',
      '/jwks/retire-expired',
      'parako:jwks:rotate',
    ],
    ['get JWK', 'GET', '/jwks/missing-e2e-key', 'parako:jwks:read'],
    ['retire JWK', 'DELETE', '/jwks/missing-e2e-key', 'parako:jwks:rotate'],
    ['list audit types', 'GET', '/audit/types', 'parako:audit:read'],
    ['get audit stats', 'GET', '/audit/stats', 'parako:stats:read'],
    ['list audit records', 'GET', '/audit', 'parako:audit:read'],
    [
      'get audit record',
      'GET',
      '/audit/missing-e2e-audit',
      'parako:audit:read',
    ],
    ['get operational stats', 'GET', '/stats', 'parako:stats:read'],
    ['get operational health', 'GET', '/stats/health', 'parako:stats:read'],
    [
      'list registration tokens',
      'GET',
      '/registration-tokens',
      'parako:registration-tokens:read',
    ],
    [
      'create registration token',
      'POST',
      '/registration-tokens',
      'parako:registration-tokens:write',
    ],
    [
      'get registration token',
      'GET',
      '/registration-tokens/missing-e2e-token',
      'parako:registration-tokens:read',
    ],
    [
      'revoke registration token',
      'DELETE',
      '/registration-tokens/missing-e2e-token',
      'parako:registration-tokens:delete',
    ],
  ];
