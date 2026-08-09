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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';
import {
  applyComputedDefaults,
  generateSecureSecret,
  getHostnameFromUrl,
  isComputedField,
} from '../../../src/config/computed-fields.js';

describe('computed field utilities', () => {
  it('generates hex-encoded cryptographic secrets at default and custom lengths', () => {
    expect(generateSecureSecret()).toMatch(/^[a-f0-9]{128}$/);
    expect(generateSecureSecret(3)).toMatch(/^[a-f0-9]{6}$/);
  });

  it('extracts URL hostnames and safely falls back for invalid URLs', () => {
    expect(getHostnameFromUrl('https://auth.example.com:8443/path')).toBe(
      'auth.example.com'
    );
    expect(getHostnameFromUrl('not a URL')).toBe('localhost');
  });

  it('classifies generated, derived, and operator-provided fields', () => {
    expect(isComputedField('security.secrets.jwt_secret')).toEqual({
      isComputed: true,
      type: 'auto-generated',
    });
    expect(isComputedField('oidc.issuer')).toEqual({
      isComputed: true,
      type: 'derived',
    });
    expect(isComputedField('deployment.url')).toEqual({
      isComputed: false,
      type: 'user-provided',
    });
  });
});

function makeBaseConfig(
  overrides: Record<string, unknown> = {}
): Record<string, any> {
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

    it('normalizes a trailing deployment slash for an HTTP tenant issuer', () => {
      const config = makeBaseConfig({
        deployment: { url: 'http://parako.id/' },
      });

      const result = tenantContext.run('acme', () =>
        applyComputedDefaults(config)
      );

      expect(result.oidc.issuer).toBe('http://acme.parako.id/oidc/v1');
      expect(result.oidc.discovery.op_policy_uri).toBe(
        'http://acme.parako.id/privacy'
      );
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

  it('regenerates missing array/null secrets but preserves and warns on corruption', () => {
    const config = makeBaseConfig();
    config.security.secrets = {
      cookie_secrets: [],
      hmac_secret: null,
      jwt_secret: '',
    } as any;
    config.oidc.secrets = { pairwise_salt: 'existing-salt' } as any;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = applyComputedDefaults(config);

    expect(result.security.secrets.jwt_secret).toBe('');
    expect(result.security.secrets.cookie_secrets).toHaveLength(2);
    expect(result.security.secrets.cookie_secrets[0]).toMatch(
      /^[a-f0-9]{128}$/
    );
    expect(result.security.secrets.hmac_secret).toMatch(/^[a-f0-9]{128}$/);
    expect(result.oidc.secrets.pairwise_salt).toBe('existing-salt');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'Empty string for secret "security.secrets.jwt_secret"'
      )
    );

    warning.mockRestore();
  });

  it('applies safe naming defaults without inventing URLs when deployment URL is absent', () => {
    const config = {
      oidc: { secrets: { pairwise_salt: 'pairwise' } },
      security: {
        authentication: {
          multi_factor: { totp: {}, webauthn: {} },
        },
        secrets: {
          cookie_secrets: ['cookie'],
          hmac_secret: 'hmac',
          jwt_secret: 'jwt',
        },
      },
    };

    const result = applyComputedDefaults(config);

    expect(result.oidc).not.toHaveProperty('issuer');
    expect(result).not.toHaveProperty('integrations');
    expect(result.security.authentication.multi_factor.totp.issuer_name).toBe(
      'Parako.ID'
    );
    expect(result.security.authentication.multi_factor.webauthn.rp_name).toBe(
      'Parako.ID'
    );
    expect(
      result.security.authentication.multi_factor.webauthn
    ).not.toHaveProperty('rp_id');
  });

  it('preserves operator-provided URLs and MFA relying-party values', () => {
    const config = makeBaseConfig();
    config.oidc.discovery = {
      op_policy_uri: 'https://legal.example/privacy',
      op_tos_uri: 'https://legal.example/terms',
      service_documentation: 'https://docs.example',
    } as any;
    config.integrations.urls = {
      contact: 'https://support.example',
      privacy_policy: 'https://legal.example/privacy',
      terms_of_service: 'https://legal.example/terms',
      website: 'https://www.example',
    } as any;
    config.security.authentication.multi_factor = {
      totp: { issuer_name: 'Custom issuer' },
      webauthn: { rp_id: 'login.example', rp_name: 'Custom RP' },
    } as any;

    const result = applyComputedDefaults(config);

    expect(result.oidc.discovery).toEqual(config.oidc.discovery);
    expect(result.integrations.urls).toEqual(config.integrations.urls);
    expect(result.security.authentication.multi_factor).toEqual(
      config.security.authentication.multi_factor
    );
  });

  it('replaces legacy MFA placeholders with current branding and hostname', () => {
    const config = makeBaseConfig({
      branding: { companyName: 'Example Corp' },
    });
    config.security.authentication.multi_factor = {
      totp: { issuer_name: 'OIDC Provider' },
      webauthn: { rp_id: 'localhost', rp_name: 'OIDC Provider' },
    } as any;

    const result = applyComputedDefaults(config);

    expect(result.security.authentication.multi_factor).toEqual({
      totp: { issuer_name: 'Example Corp' },
      webauthn: { rp_id: 'parako.id', rp_name: 'Example Corp' },
    });
  });
});
