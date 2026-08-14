export const PLATFORM_TENANT_ID = '_platforms';

export const PLATFORM_ROLES = ['platform_admin', 'platform_viewer'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export function isPlatformRole(role: string): role is PlatformRole {
  return PLATFORM_ROLES.includes(role as PlatformRole);
}

export function isRoleAvailableForTenant(
  role: string,
  configuredRoles: readonly string[],
  tenantId: string | undefined
): boolean {
  return (
    configuredRoles.includes(role) ||
    (tenantId === PLATFORM_TENANT_ID && isPlatformRole(role))
  );
}

/**
 * Values accepted by the storage schema. Tenant-aware service and model
 * validation still limit platform roles to the `_platforms` system tenant.
 */
export function getPersistableRoleValues(
  configuredRoles: readonly string[]
): string[] {
  return [...new Set([...configuredRoles, ...PLATFORM_ROLES])];
}
