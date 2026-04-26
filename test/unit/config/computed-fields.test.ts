/**
 * Tests for computed-fields.ts — Phase 1: Subdomain-based OIDC issuer derivation
 *
 * Verifies that applyComputedDefaults() produces correct OIDC issuer URLs:
 * - Default (no tenant): issuer = deployment.url + oidc.path
 * - Tenant context: issuer = https://{tenantId}.{hostname}{oidcPath}
 * - Custom domain tenant: issuer = https://{customDomain}{oidcPath}
 * - Explicit issuer_url: used verbatim (not overridden by derivation)
 * - Discovery URLs (op_policy_uri, etc.) use tenant base URL
 * - WebAuthn rp_id uses custom domain hostname when available
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';
import { applyComputedDefaults } from '../../../src/config/computed-fields.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    deployment: {
      url: 'https://parako.id',
      ...((overrides.deployment as Record<string, unknown>) ?? {}),
    },
    oidc: {
      path: '/oidc/v1',
      ...((overrides.oidc as Record<string, unknown>) ?? {}),
    },
    branding: {
      companyName: 'Parako.ID',
      ...((overrides.branding as Record<string, unknown>) ?? {}),
    },
    security: {
      secrets: {},
      authentication: {
        multi_factor: {
          totp: {},
          webauthn: {},
        },
      },
      ...((overrides.security as Record<string, unknown>) ?? {}),
    },
    features: {
      developer: { api: {} },
      ...((overrides.features as Record<string, unknown>) ?? {}),
    },
    integrations: {
      urls: {},
      ...((overrides.integrations as Record<string, unknown>) ?? {}),
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('applyComputedDefaults — OIDC issuer derivation', () => {
  beforeEach(() => {
    tenantContext.disableStrictMode();
  });

  afterEach(() => {
    tenantContext.disableStrictMode();
  });

  describe('outside tenant context (default/global)', () => {
    it('derives issuer from deployment.url + oidc.path', () => {
      const config = makeBaseConfig();
      const result = applyComputedDefaults(config);

      expect(result.oidc.issuer).toBe('https://parako.id/oidc/v1');
    });

    it('derives discovery URLs from deployment.url', () => {
      const config = makeBaseConfig();
      const result = applyComputedDefaults(config);

      expect(result.oidc.discovery.op_policy_uri).toBe(
        'https://parako.id/privacy'
      );
      expect(result.oidc.discovery.op_tos_uri).toBe('https://parako.id/terms');
      expect(result.oidc.discovery.service_documentation).toBe(
        'https://parako.id/docs'
      );
    });
  });

  describe('inside tenant context (non-default tenant)', () => {
    it('derives subdomain-based issuer: https://{tenantId}.{hostname}{oidcPath}', () => {
      const config = makeBaseConfig();

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.issuer).toBe('https://acme.parako.id/oidc/v1');
    });

    it('derives discovery URLs from tenant subdomain base URL', () => {
      const config = makeBaseConfig();

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.discovery.op_policy_uri).toBe(
        'https://acme.parako.id/privacy'
      );
      expect(result.oidc.discovery.op_tos_uri).toBe(
        'https://acme.parako.id/terms'
      );
      expect(result.oidc.discovery.service_documentation).toBe(
        'https://acme.parako.id/docs'
      );
    });

    it('uses custom domain when tenant_domain is present in config', () => {
      const config = makeBaseConfig();
      // Simulate a tenant config that has a custom domain set
      (config as any).tenant_domain = 'auth.acme.com';

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.issuer).toBe('https://auth.acme.com/oidc/v1');
    });

    it('derives discovery URLs from custom domain when present', () => {
      const config = makeBaseConfig();
      (config as any).tenant_domain = 'auth.acme.com';

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.discovery.op_policy_uri).toBe(
        'https://auth.acme.com/privacy'
      );
      expect(result.oidc.discovery.op_tos_uri).toBe(
        'https://auth.acme.com/terms'
      );
      expect(result.oidc.discovery.service_documentation).toBe(
        'https://auth.acme.com/docs'
      );
    });

    it('preserves tenant-set discovery URLs instead of overwriting', () => {
      const config = makeBaseConfig();
      // Simulate tenant explicitly setting discovery URLs
      (config as any).oidc.discovery = {
        op_policy_uri: 'https://acme.com/custom-privacy',
        op_tos_uri: 'https://acme.com/custom-tos',
        service_documentation: 'https://docs.acme.com',
      };

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      // Should preserve tenant-set values, not overwrite with derived
      expect(result.oidc.discovery.op_policy_uri).toBe(
        'https://acme.com/custom-privacy'
      );
      expect(result.oidc.discovery.op_tos_uri).toBe(
        'https://acme.com/custom-tos'
      );
      expect(result.oidc.discovery.service_documentation).toBe(
        'https://docs.acme.com'
      );
    });

    it('does NOT override issuer when oidc.issuer_url is explicitly set', () => {
      const config = makeBaseConfig({
        oidc: {
          path: '/oidc/v1',
          issuer_url: 'https://custom.issuer.example.com/oidc',
        },
      });

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.issuer).toBe('https://custom.issuer.example.com/oidc');
    });

    it('derives webauthn.rp_id from custom domain hostname', () => {
      const config = makeBaseConfig();
      (config as any).tenant_domain = 'auth.acme.com';

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.security.authentication.multi_factor.webauthn.rp_id).toBe(
        'auth.acme.com'
      );
    });

    it('derives webauthn.rp_id from subdomain when no custom domain', () => {
      const config = makeBaseConfig();

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      // For subdomain-based tenants, rp_id should be the base domain (parako.id)
      // because WebAuthn rp_id must be an ancestor of the origin
      expect(result.security.authentication.multi_factor.webauthn.rp_id).toBe(
        'parako.id'
      );
    });

    it('default tenant context behaves like global (no subdomain)', () => {
      const config = makeBaseConfig();

      const result = tenantContext.run(DEFAULT_TENANT_ID, () =>
        applyComputedDefaults(config)
      );

      // Default tenant should produce the same issuer as no context
      expect(result.oidc.issuer).toBe('https://parako.id/oidc/v1');
    });

    it('handles deployment URL with port', () => {
      const config = makeBaseConfig({
        deployment: { url: 'https://parako.id:8443' },
      });

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.issuer).toBe('https://acme.parako.id:8443/oidc/v1');
    });

    it('handles deployment URL with path prefix', () => {
      const config = makeBaseConfig({
        deployment: { url: 'https://parako.id' },
        oidc: { path: '/auth/oidc' },
      });

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.issuer).toBe('https://acme.parako.id/auth/oidc');
    });
  });
});

describe('applyComputedDefaults — auto-generated secrets (unchanged behavior)', () => {
  it('generates jwt_secret when missing', () => {
    const config = makeBaseConfig();
    const result = applyComputedDefaults(config);

    expect(result.security.secrets.jwt_secret).toBeDefined();
    expect(typeof result.security.secrets.jwt_secret).toBe('string');
    expect(result.security.secrets.jwt_secret.length).toBeGreaterThan(0);
  });

  it('preserves existing jwt_secret', () => {
    const config = makeBaseConfig();
    config.security.secrets = { jwt_secret: 'existing-secret' } as any;
    const result = applyComputedDefaults(config);

    expect(result.security.secrets.jwt_secret).toBe('existing-secret');
  });
});
