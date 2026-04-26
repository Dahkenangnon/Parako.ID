/**
 * Scope constants and helpers for the Parako.ID Management API v1.
 *
 * Every Management API access token carries a set of scopes that determine
 * which endpoints the caller may use. Scopes follow the taxonomy
 * `parako:<domain>:<action>` and are classified as read, write, or
 * destructive to drive TTL policies and audit severity.
 */

// Scope constants — grouped by domain

export const SCOPES = {
  CLIENTS_READ: 'parako:clients:read',
  CLIENTS_WRITE: 'parako:clients:write',
  CLIENTS_DELETE: 'parako:clients:delete',

  USERS_READ: 'parako:users:read',
  USERS_WRITE: 'parako:users:write',
  USERS_DELETE: 'parako:users:delete',

  SESSIONS_READ: 'parako:sessions:read',
  SESSIONS_REVOKE: 'parako:sessions:revoke',

  GRANTS_READ: 'parako:grants:read',
  GRANTS_REVOKE: 'parako:grants:revoke',

  // JWKS
  JWKS_READ: 'parako:jwks:read',
  JWKS_ROTATE: 'parako:jwks:rotate',

  AUDIT_READ: 'parako:audit:read',
  AUDIT_WRITE: 'parako:audit:write',

  CONFIG_READ: 'parako:config:read',
  CONFIG_WRITE: 'parako:config:write',

  SOCIAL_READ: 'parako:social:read',
  SOCIAL_WRITE: 'parako:social:write',

  STATS_READ: 'parako:stats:read',

  WEBHOOKS_MANAGE: 'parako:webhooks:manage',

  // Registration Tokens (DCR Initial Access Tokens)
  REGISTRATION_TOKENS_READ: 'parako:registration-tokens:read',
  REGISTRATION_TOKENS_WRITE: 'parako:registration-tokens:write',
  REGISTRATION_TOKENS_DELETE: 'parako:registration-tokens:delete',

  // Platform-only — Tenants
  TENANTS_READ: 'parako:tenants:read',
  TENANTS_WRITE: 'parako:tenants:write',
  TENANTS_DELETE: 'parako:tenants:delete',

  // Platform-only — Cross-tenant
  CROSS_TENANT_READ: 'parako:cross-tenant:read',
  CROSS_TENANT_WRITE: 'parako:cross-tenant:write',

  // Platform-only — Settings
  SETTINGS_READ: 'parako:settings:read',
  SETTINGS_WRITE: 'parako:settings:write',
} as const;

/** Union type of all valid scope string values. */
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/**
 * The resource URI for the Management API v1.
 * Used as the `resource` indicator in RFC 8707 token requests and as the
 * expected `aud` claim in issued JWTs.
 */
export const MANAGEMENT_API_RESOURCE_URI = 'urn:parako:api:v1';

// Scope definitions with human-readable labels and descriptions

export interface ScopeDefinition {
  /** The full scope string, e.g. `parako:clients:read`. */
  value: string;
  /** Short human-readable label for UI display. */
  label: string;
  /** Longer description explaining what the scope grants. */
  description: string;
  /** Domain grouping for UI sections. */
  domain: string;
  /** Risk classification. */
  classification: ScopeClassification;
}

/** All Management API scopes with labels and descriptions for admin UI. */
export const SCOPE_DEFINITIONS: readonly ScopeDefinition[] = [
  // --- Clients ---
  {
    value: SCOPES.CLIENTS_READ,
    label: 'Read Clients',
    description: 'View OIDC client applications and their configuration',
    domain: 'Clients',
    classification: 'read',
  },
  {
    value: SCOPES.CLIENTS_WRITE,
    label: 'Write Clients',
    description: 'Create and update OIDC client applications',
    domain: 'Clients',
    classification: 'write',
  },
  {
    value: SCOPES.CLIENTS_DELETE,
    label: 'Delete Clients',
    description: 'Permanently delete OIDC client applications',
    domain: 'Clients',
    classification: 'destructive',
  },

  // --- Users ---
  {
    value: SCOPES.USERS_READ,
    label: 'Read Users',
    description: 'View user accounts, profiles, and activity logs',
    domain: 'Users',
    classification: 'read',
  },
  {
    value: SCOPES.USERS_WRITE,
    label: 'Write Users',
    description: 'Create, update, lock/unlock users and reset passwords',
    domain: 'Users',
    classification: 'write',
  },
  {
    value: SCOPES.USERS_DELETE,
    label: 'Delete Users',
    description: 'Anonymize or permanently remove user accounts',
    domain: 'Users',
    classification: 'destructive',
  },

  // --- Sessions ---
  {
    value: SCOPES.SESSIONS_READ,
    label: 'Read Sessions',
    description: 'View active OIDC sessions and their details',
    domain: 'Sessions',
    classification: 'read',
  },
  {
    value: SCOPES.SESSIONS_REVOKE,
    label: 'Revoke Sessions',
    description: 'Revoke individual or bulk OIDC sessions',
    domain: 'Sessions',
    classification: 'destructive',
  },

  // --- Grants ---
  {
    value: SCOPES.GRANTS_READ,
    label: 'Read Grants',
    description: 'View authorization grants issued to clients',
    domain: 'Grants',
    classification: 'read',
  },
  {
    value: SCOPES.GRANTS_REVOKE,
    label: 'Revoke Grants',
    description: 'Revoke authorization grants issued to clients',
    domain: 'Grants',
    classification: 'destructive',
  },

  // --- JWKS ---
  {
    value: SCOPES.JWKS_READ,
    label: 'Read JWKS',
    description: 'View JSON Web Key Sets and key lifecycle state',
    domain: 'JWKS',
    classification: 'read',
  },
  {
    value: SCOPES.JWKS_ROTATE,
    label: 'Rotate JWKS',
    description: 'Trigger key rotation, retire expired keys',
    domain: 'JWKS',
    classification: 'destructive',
  },

  // --- Audit ---
  {
    value: SCOPES.AUDIT_READ,
    label: 'Read Audit Log',
    description: 'Query the audit trail and activity log',
    domain: 'Audit',
    classification: 'read',
  },
  {
    value: SCOPES.AUDIT_WRITE,
    label: 'Write Audit Log',
    description: 'Create entries in the audit trail',
    domain: 'Audit',
    classification: 'destructive',
  },

  // --- Statistics ---
  {
    value: SCOPES.STATS_READ,
    label: 'Read Statistics',
    description: 'View aggregate dashboard stats and system health',
    domain: 'Statistics',
    classification: 'read',
  },

  // --- Registration Tokens ---
  {
    value: SCOPES.REGISTRATION_TOKENS_READ,
    label: 'Read Registration Tokens',
    description: 'View issued DCR initial access tokens and their metadata',
    domain: 'Registration Tokens',
    classification: 'read',
  },
  {
    value: SCOPES.REGISTRATION_TOKENS_WRITE,
    label: 'Write Registration Tokens',
    description: 'Create DCR initial access tokens for client registration',
    domain: 'Registration Tokens',
    classification: 'write',
  },
  {
    value: SCOPES.REGISTRATION_TOKENS_DELETE,
    label: 'Delete Registration Tokens',
    description: 'Revoke DCR initial access tokens',
    domain: 'Registration Tokens',
    classification: 'destructive',
  },

  // --- Platform-only: Tenants ---
  {
    value: SCOPES.TENANTS_READ,
    label: 'Read Tenants',
    description: 'View tenant list and details (platform-only)',
    domain: 'Tenants',
    classification: 'read',
  },
  {
    value: SCOPES.TENANTS_WRITE,
    label: 'Write Tenants',
    description: 'Create and update tenants (platform-only)',
    domain: 'Tenants',
    classification: 'write',
  },
  {
    value: SCOPES.TENANTS_DELETE,
    label: 'Delete Tenants',
    description: 'Remove tenants (platform-only)',
    domain: 'Tenants',
    classification: 'destructive',
  },

  // --- Platform-only: Cross-tenant ---
  {
    value: SCOPES.CROSS_TENANT_READ,
    label: 'Cross-Tenant Read',
    description: 'Read configuration across tenant boundaries (platform-only)',
    domain: 'Cross-Tenant',
    classification: 'read',
  },
  {
    value: SCOPES.CROSS_TENANT_WRITE,
    label: 'Cross-Tenant Write',
    description:
      'Modify configuration across tenant boundaries (platform-only)',
    domain: 'Cross-Tenant',
    classification: 'write',
  },

  // --- Platform-only: Settings ---
  {
    value: SCOPES.SETTINGS_READ,
    label: 'Read Settings',
    description: 'View system settings (platform-only)',
    domain: 'Settings',
    classification: 'read',
  },
  {
    value: SCOPES.SETTINGS_WRITE,
    label: 'Write Settings',
    description: 'Modify system settings (platform-only)',
    domain: 'Settings',
    classification: 'write',
  },

  // --- Config ---
  {
    value: SCOPES.CONFIG_READ,
    label: 'Read Configuration',
    description: 'View application configuration',
    domain: 'Configuration',
    classification: 'read',
  },
  {
    value: SCOPES.CONFIG_WRITE,
    label: 'Write Configuration',
    description: 'Modify application configuration',
    domain: 'Configuration',
    classification: 'write',
  },

  // --- Social ---
  {
    value: SCOPES.SOCIAL_READ,
    label: 'Read Social Integrations',
    description: 'View social login provider configurations',
    domain: 'Social',
    classification: 'read',
  },
  {
    value: SCOPES.SOCIAL_WRITE,
    label: 'Write Social Integrations',
    description: 'Configure social login providers',
    domain: 'Social',
    classification: 'write',
  },

  // --- Webhooks ---
  {
    value: SCOPES.WEBHOOKS_MANAGE,
    label: 'Manage Webhooks',
    description: 'Create, update, and delete webhook subscriptions',
    domain: 'Webhooks',
    classification: 'write',
  },
] as const;

/**
 * All Management API scope values as a space-separated string.
 * Used when registering the built-in resource server.
 */
export const ALL_MANAGEMENT_API_SCOPES: string =
  Object.values(SCOPES).join(' ');

// Platform-only scopes

/** Scopes that may only be granted to platform-level (super-admin) clients. */
export const PLATFORM_ONLY_SCOPES: ReadonlySet<string> = new Set<string>([
  SCOPES.TENANTS_READ,
  SCOPES.TENANTS_WRITE,
  SCOPES.TENANTS_DELETE,
  SCOPES.CROSS_TENANT_READ,
  SCOPES.CROSS_TENANT_WRITE,
  SCOPES.SETTINGS_READ,
  SCOPES.SETTINGS_WRITE,
]);

/** The three risk tiers that drive TTL and audit severity. */
export type ScopeClassification = 'read' | 'write' | 'destructive';

/**
 * Classify a scope string by its trailing action segment.
 *
 * - `read`        — `:read`
 * - `write`       — `:write` or `:manage`
 * - `destructive` — `:delete`, `:revoke`, `:rotate`, or `audit:write`
 *
 * Unknown suffixes default to `'write'`.
 */
export function classifyScope(scope: string): ScopeClassification {
  if (
    scope.endsWith(':delete') ||
    scope.endsWith(':revoke') ||
    scope.endsWith(':rotate')
  ) {
    return 'destructive';
  }
  // audit:write is a special case — writing audit logs is a privileged action
  if (scope === SCOPES.AUDIT_WRITE) {
    return 'destructive';
  }
  if (scope.endsWith(':read')) {
    return 'read';
  }
  // :write, :manage, and anything unexpected
  return 'write';
}

// TTL map (seconds)

/**
 * Recommended maximum token TTL per classification tier.
 *
 * - read:        3 600 s  (1 hour)
 * - write:       1 800 s  (30 minutes)
 * - destructive:   900 s  (15 minutes)
 */
export const SCOPE_TTL_MAP: Readonly<Record<ScopeClassification, number>> = {
  read: 3600,
  write: 1800,
  destructive: 900,
};

/**
 * Check whether a space-separated granted-scopes string contains the
 * required scope.
 *
 * @param grantedScopes  Space-separated scope string (e.g. from a token).
 * @param required       Single scope to check for.
 * @returns `true` when `required` is present in `grantedScopes`.
 */
export function hasScope(grantedScopes: string, required: string): boolean {
  const scopes = grantedScopes.split(' ');
  return scopes.includes(required);
}

/**
 * Check whether a space-separated granted-scopes string contains **any** of
 * the required scopes.
 *
 * @param grantedScopes  Space-separated scope string.
 * @param required       One or more scopes — returns `true` if at least one matches.
 */
export function hasAnyScope(
  grantedScopes: string,
  ...required: string[]
): boolean {
  const scopes = grantedScopes.split(' ');
  return required.some(r => scopes.includes(r));
}

/**
 * Returns `true` when the given scope is restricted to platform-level clients.
 */
export function isPlatformOnlyScope(scope: string): boolean {
  return PLATFORM_ONLY_SCOPES.has(scope);
}
