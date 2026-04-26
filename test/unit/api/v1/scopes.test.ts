import { describe, it, expect } from 'vitest';
import {
  SCOPES,
  PLATFORM_ONLY_SCOPES,
  SCOPE_TTL_MAP,
  classifyScope,
  hasScope,
  hasAnyScope,
  isPlatformOnlyScope,
} from '../../../../src/api/v1/scopes.js';

describe('api/v1/scopes', () => {
  // -----------------------------------------------------------------------
  // SCOPES constant
  // -----------------------------------------------------------------------
  describe('SCOPES', () => {
    it('should contain all standard client scopes', () => {
      expect(SCOPES.CLIENTS_READ).toBe('parako:clients:read');
      expect(SCOPES.CLIENTS_WRITE).toBe('parako:clients:write');
      expect(SCOPES.CLIENTS_DELETE).toBe('parako:clients:delete');
    });

    it('should contain all standard user scopes', () => {
      expect(SCOPES.USERS_READ).toBe('parako:users:read');
      expect(SCOPES.USERS_WRITE).toBe('parako:users:write');
      expect(SCOPES.USERS_DELETE).toBe('parako:users:delete');
    });

    it('should contain session scopes', () => {
      expect(SCOPES.SESSIONS_READ).toBe('parako:sessions:read');
      expect(SCOPES.SESSIONS_REVOKE).toBe('parako:sessions:revoke');
    });

    it('should contain grant scopes', () => {
      expect(SCOPES.GRANTS_READ).toBe('parako:grants:read');
      expect(SCOPES.GRANTS_REVOKE).toBe('parako:grants:revoke');
    });

    it('should contain JWKS scopes', () => {
      expect(SCOPES.JWKS_READ).toBe('parako:jwks:read');
      expect(SCOPES.JWKS_ROTATE).toBe('parako:jwks:rotate');
    });

    it('should contain audit scopes', () => {
      expect(SCOPES.AUDIT_READ).toBe('parako:audit:read');
      expect(SCOPES.AUDIT_WRITE).toBe('parako:audit:write');
    });

    it('should contain config scopes', () => {
      expect(SCOPES.CONFIG_READ).toBe('parako:config:read');
      expect(SCOPES.CONFIG_WRITE).toBe('parako:config:write');
    });

    it('should contain social scopes', () => {
      expect(SCOPES.SOCIAL_READ).toBe('parako:social:read');
      expect(SCOPES.SOCIAL_WRITE).toBe('parako:social:write');
    });

    it('should contain stats and webhooks scopes', () => {
      expect(SCOPES.STATS_READ).toBe('parako:stats:read');
      expect(SCOPES.WEBHOOKS_MANAGE).toBe('parako:webhooks:manage');
    });

    it('should contain platform-only tenant scopes', () => {
      expect(SCOPES.TENANTS_READ).toBe('parako:tenants:read');
      expect(SCOPES.TENANTS_WRITE).toBe('parako:tenants:write');
      expect(SCOPES.TENANTS_DELETE).toBe('parako:tenants:delete');
    });

    it('should contain platform-only cross-tenant scopes', () => {
      expect(SCOPES.CROSS_TENANT_READ).toBe('parako:cross-tenant:read');
      expect(SCOPES.CROSS_TENANT_WRITE).toBe('parako:cross-tenant:write');
    });

    it('should contain platform-only settings scopes', () => {
      expect(SCOPES.SETTINGS_READ).toBe('parako:settings:read');
      expect(SCOPES.SETTINGS_WRITE).toBe('parako:settings:write');
    });

    it('should have exactly 30 scope entries', () => {
      const keys = Object.keys(SCOPES);
      expect(keys).toHaveLength(30);
    });
  });

  // -----------------------------------------------------------------------
  // hasScope
  // -----------------------------------------------------------------------
  describe('hasScope', () => {
    it('should return true when the required scope is present', () => {
      const granted = 'parako:clients:read parako:users:read parako:stats:read';
      expect(hasScope(granted, 'parako:clients:read')).toBe(true);
      expect(hasScope(granted, 'parako:users:read')).toBe(true);
      expect(hasScope(granted, 'parako:stats:read')).toBe(true);
    });

    it('should return false when the required scope is absent', () => {
      const granted = 'parako:clients:read parako:users:read';
      expect(hasScope(granted, 'parako:clients:write')).toBe(false);
      expect(hasScope(granted, 'parako:tenants:read')).toBe(false);
    });

    it('should not match partial scope names', () => {
      const granted = 'parako:clients:read';
      expect(hasScope(granted, 'parako:clients:rea')).toBe(false);
      expect(hasScope(granted, 'parako:clients')).toBe(false);
    });

    it('should handle a single scope string', () => {
      expect(hasScope('parako:stats:read', 'parako:stats:read')).toBe(true);
      expect(hasScope('parako:stats:read', 'parako:users:read')).toBe(false);
    });

    it('should handle empty granted scopes', () => {
      expect(hasScope('', 'parako:clients:read')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // hasAnyScope
  // -----------------------------------------------------------------------
  describe('hasAnyScope', () => {
    const granted = 'parako:clients:read parako:users:write parako:stats:read';

    it('should return true when at least one required scope matches', () => {
      expect(
        hasAnyScope(granted, 'parako:clients:read', 'parako:tenants:read')
      ).toBe(true);
      expect(
        hasAnyScope(granted, 'parako:tenants:read', 'parako:stats:read')
      ).toBe(true);
    });

    it('should return false when none of the required scopes match', () => {
      expect(
        hasAnyScope(granted, 'parako:tenants:read', 'parako:config:write')
      ).toBe(false);
    });

    it('should return true when checking a single matching scope', () => {
      expect(hasAnyScope(granted, 'parako:users:write')).toBe(true);
    });

    it('should return false when checking a single non-matching scope', () => {
      expect(hasAnyScope(granted, 'parako:users:delete')).toBe(false);
    });

    it('should handle empty granted scopes', () => {
      expect(hasAnyScope('', 'parako:clients:read')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // classifyScope
  // -----------------------------------------------------------------------
  describe('classifyScope', () => {
    it('should classify :read scopes as read', () => {
      expect(classifyScope('parako:clients:read')).toBe('read');
      expect(classifyScope('parako:users:read')).toBe('read');
      expect(classifyScope('parako:sessions:read')).toBe('read');
      expect(classifyScope('parako:grants:read')).toBe('read');
      expect(classifyScope('parako:jwks:read')).toBe('read');
      expect(classifyScope('parako:audit:read')).toBe('read');
      expect(classifyScope('parako:config:read')).toBe('read');
      expect(classifyScope('parako:social:read')).toBe('read');
      expect(classifyScope('parako:stats:read')).toBe('read');
      expect(classifyScope('parako:tenants:read')).toBe('read');
      expect(classifyScope('parako:cross-tenant:read')).toBe('read');
      expect(classifyScope('parako:settings:read')).toBe('read');
    });

    it('should classify :write scopes as write', () => {
      expect(classifyScope('parako:clients:write')).toBe('write');
      expect(classifyScope('parako:users:write')).toBe('write');
      expect(classifyScope('parako:config:write')).toBe('write');
      expect(classifyScope('parako:social:write')).toBe('write');
      expect(classifyScope('parako:tenants:write')).toBe('write');
      expect(classifyScope('parako:cross-tenant:write')).toBe('write');
      expect(classifyScope('parako:settings:write')).toBe('write');
    });

    it('should classify :manage scopes as write', () => {
      expect(classifyScope('parako:webhooks:manage')).toBe('write');
    });

    it('should classify :delete scopes as destructive', () => {
      expect(classifyScope('parako:clients:delete')).toBe('destructive');
      expect(classifyScope('parako:users:delete')).toBe('destructive');
      expect(classifyScope('parako:tenants:delete')).toBe('destructive');
    });

    it('should classify :revoke scopes as destructive', () => {
      expect(classifyScope('parako:sessions:revoke')).toBe('destructive');
      expect(classifyScope('parako:grants:revoke')).toBe('destructive');
    });

    it('should classify :rotate scopes as destructive', () => {
      expect(classifyScope('parako:jwks:rotate')).toBe('destructive');
    });

    it('should classify audit:write as destructive (special case)', () => {
      expect(classifyScope('parako:audit:write')).toBe('destructive');
    });

    it('should default unknown suffixes to write', () => {
      expect(classifyScope('parako:custom:unknown')).toBe('write');
    });
  });

  // -----------------------------------------------------------------------
  // SCOPE_TTL_MAP
  // -----------------------------------------------------------------------
  describe('SCOPE_TTL_MAP', () => {
    it('should map read to 3600 seconds (1 hour)', () => {
      expect(SCOPE_TTL_MAP.read).toBe(3600);
    });

    it('should map write to 1800 seconds (30 minutes)', () => {
      expect(SCOPE_TTL_MAP.write).toBe(1800);
    });

    it('should map destructive to 900 seconds (15 minutes)', () => {
      expect(SCOPE_TTL_MAP.destructive).toBe(900);
    });

    it('should have exactly three tiers', () => {
      expect(Object.keys(SCOPE_TTL_MAP)).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // isPlatformOnlyScope
  // -----------------------------------------------------------------------
  describe('isPlatformOnlyScope', () => {
    it('should return true for all platform-only scopes', () => {
      expect(isPlatformOnlyScope('parako:tenants:read')).toBe(true);
      expect(isPlatformOnlyScope('parako:tenants:write')).toBe(true);
      expect(isPlatformOnlyScope('parako:tenants:delete')).toBe(true);
      expect(isPlatformOnlyScope('parako:cross-tenant:read')).toBe(true);
      expect(isPlatformOnlyScope('parako:cross-tenant:write')).toBe(true);
      expect(isPlatformOnlyScope('parako:settings:read')).toBe(true);
      expect(isPlatformOnlyScope('parako:settings:write')).toBe(true);
    });

    it('should return false for standard scopes', () => {
      expect(isPlatformOnlyScope('parako:clients:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:users:write')).toBe(false);
      expect(isPlatformOnlyScope('parako:sessions:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:grants:revoke')).toBe(false);
      expect(isPlatformOnlyScope('parako:jwks:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:audit:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:config:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:social:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:stats:read')).toBe(false);
      expect(isPlatformOnlyScope('parako:webhooks:manage')).toBe(false);
    });

    it('should return false for unknown scopes', () => {
      expect(isPlatformOnlyScope('parako:custom:read')).toBe(false);
      expect(isPlatformOnlyScope('openid')).toBe(false);
      expect(isPlatformOnlyScope('')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // PLATFORM_ONLY_SCOPES set
  // -----------------------------------------------------------------------
  describe('PLATFORM_ONLY_SCOPES', () => {
    it('should contain exactly 7 platform-only scopes', () => {
      expect(PLATFORM_ONLY_SCOPES.size).toBe(7);
    });

    it('should be a ReadonlySet (not mutated at runtime)', () => {
      // Verify it is a Set instance
      expect(PLATFORM_ONLY_SCOPES).toBeInstanceOf(Set);
    });
  });
});
