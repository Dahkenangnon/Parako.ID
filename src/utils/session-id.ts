import {
  DEFAULT_TENANT_ID,
  SYSTEM_TENANTS,
} from '../multi-tenancy/tenant-context.js';

const SESSION_ID_SEPARATOR = '.';
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function isSessionTenantId(value: string): boolean {
  return (
    value === DEFAULT_TENANT_ID ||
    SYSTEM_TENANTS.has(value) ||
    TENANT_SLUG_PATTERN.test(value)
  );
}

/**
 * Prefix an opaque Express session identifier with its tenant.
 *
 * express-session signs the complete identifier before placing it in a cookie,
 * so the prefix cannot be changed without invalidating the cookie signature.
 * The prefix lets tenant-scoped stores establish database context before the
 * session payload itself is available.
 */
export function createTenantSessionId(
  tenantId: string,
  randomComponent: string
): string {
  if (!isSessionTenantId(tenantId)) {
    throw new Error('Invalid tenant identifier for session ID');
  }
  if (randomComponent.length === 0) {
    throw new Error('Session ID random component must not be empty');
  }
  return `${tenantId}${SESSION_ID_SEPARATOR}${randomComponent}`;
}

/**
 * Resolve the tenant encoded in a signed session identifier.
 *
 * Unprefixed identifiers predate tenant-aware IDs and are deliberately limited
 * to the default tenant. This fails closed for legacy non-default sessions,
 * requiring a one-time sign-in after upgrading.
 */
export function tenantIdFromSessionId(sessionId: string): string {
  const separatorIndex = sessionId.indexOf(SESSION_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    return DEFAULT_TENANT_ID;
  }

  const tenantId = sessionId.slice(0, separatorIndex);
  return isSessionTenantId(tenantId) ? tenantId : DEFAULT_TENANT_ID;
}
