import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

import {
  MetricsService,
  normalizeRoute,
  sanitizeLabel,
} from '../../../src/observability/metrics/metrics.service.js';

// ── Helpers ──

function createMockConfig(overrides: Record<string, any> = {}) {
  return {
    getConfig: vi.fn().mockReturnValue({
      application: { title: 'Parako.ID' },
      deployment: { environment: 'test' },
      features: {
        metrics: {
          enabled: true,
          path: '/metrics',
          include_default_metrics: false,
          prefix: 'parako_',
          ...overrides,
        },
      },
    }),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createService(configOverrides: Record<string, any> = {}) {
  const config = createMockConfig(configOverrides);
  const logger = createMockLogger();
  return {
    service: new (MetricsService as any)(config, logger) as MetricsService,
    config,
    logger,
  };
}

// ── Tests ──

describe('MetricsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('disabled mode', () => {
    it('all record*() methods are no-ops', () => {
      const { service } = createService({ enabled: false });
      expect(service.isEnabled()).toBe(false);

      // Should not throw
      service.recordTokenIssued('authorization_code');
      service.recordTokenError('grant', 'authorization_code');
      service.recordLoginAttempt('success', 'email');
      service.recordFederationLogin('github', 'success');
      service.recordRequestDuration('GET', '/foo', 200, 0.05);
      service.recordJwksRotation('generate', 'success');
      service.recordOidcInteraction('login', 'started');
    });

    it('getMetrics() returns empty string', async () => {
      const { service } = createService({ enabled: false });
      const metrics = await service.getMetrics();
      expect(metrics).toBe('');
    });
  });

  describe('enabled mode', () => {
    it('isEnabled() returns true', () => {
      const { service } = createService();
      expect(service.isEnabled()).toBe(true);
    });

    it('recordTokenIssued increments counter', async () => {
      const { service } = createService();
      service.recordTokenIssued('authorization_code');
      service.recordTokenIssued('client_credentials');
      service.recordTokenIssued('authorization_code');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_token_issued_total');
      expect(metrics).toContain('grant_type="authorization_code"');
      expect(metrics).toContain('grant_type="client_credentials"');
    });

    it('recordTokenError increments counter with labels', async () => {
      const { service } = createService();
      service.recordTokenError('grant', 'authorization_code');
      service.recordTokenError('introspection');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_token_error_total');
      expect(metrics).toContain('error_type="grant"');
      expect(metrics).toContain('error_type="introspection"');
    });

    it('recordLoginAttempt increments counter', async () => {
      const { service } = createService();
      service.recordLoginAttempt('success', 'email');
      service.recordLoginAttempt('failure', 'phone');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_login_attempt_total');
      expect(metrics).toContain('result="success"');
      expect(metrics).toContain('method="email"');
    });

    it('recordFederationLogin increments counter', async () => {
      const { service } = createService();
      service.recordFederationLogin('github', 'success');
      service.recordFederationLogin('google', 'failure');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_federation_login_total');
      expect(metrics).toContain('provider="github"');
      expect(metrics).toContain('provider="google"');
    });

    it('recordRequestDuration observes histogram', async () => {
      const { service } = createService();
      service.recordRequestDuration('GET', '/api/users', 200, 0.05);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_http_request_duration_seconds');
      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('route="/api/users"');
    });

    it('recordJwksRotation increments counter', async () => {
      const { service } = createService();
      service.recordJwksRotation('generate', 'success');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_jwks_rotation_total');
      expect(metrics).toContain('phase="generate"');
    });

    it('recordOidcInteraction increments counter', async () => {
      const { service } = createService();
      service.recordOidcInteraction('login', 'started');
      service.recordOidcInteraction('consent', 'ended');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_oidc_interaction_total');
      expect(metrics).toContain('prompt="login"');
    });
  });

  describe('error containment', () => {
    it('record methods never throw even when counters are corrupted', () => {
      const { service } = createService();
      // Force counter to null to simulate corruption
      (service as any).tokenIssuedCounter = null;

      expect(() =>
        service.recordTokenIssued('authorization_code')
      ).not.toThrow();
    });
  });

  describe('Prometheus output format', () => {
    it('getMetrics() returns valid Prometheus exposition text', async () => {
      const { service } = createService();
      service.recordTokenIssued('authorization_code');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });

    it('getContentType() returns correct MIME type', () => {
      const { service } = createService();
      const contentType = service.getContentType();
      expect(contentType).toContain('text/plain');
    });

    it('info gauge is present in output without version disclosure', async () => {
      const { service } = createService();
      const metrics = await service.getMetrics();
      expect(metrics).toContain('parako_info');
      expect(metrics).toContain('environment="test"');
      // Security: version info should NOT be exposed in metrics
      expect(metrics).not.toContain('node_version=');
      expect(metrics).not.toContain('version=');
    });
  });

  describe('custom prefix', () => {
    it('uses configured prefix for metric names', async () => {
      const { service } = createService({ prefix: 'myapp_' });
      service.recordTokenIssued('authorization_code');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('myapp_token_issued_total');
      expect(metrics).not.toContain('parako_token_issued_total');
    });
  });

  describe('default metrics', () => {
    it('includes process metrics when enabled', async () => {
      const { service } = createService({ include_default_metrics: true });
      const metrics = await service.getMetrics();
      expect(metrics).toContain('process_cpu');
    });

    it('excludes process metrics when disabled', async () => {
      const { service } = createService({ include_default_metrics: false });
      const metrics = await service.getMetrics();
      expect(metrics).not.toContain('process_cpu');
    });
  });

  describe('multi-tenant labels', () => {
    it('defaults tenant to "default" when not specified', async () => {
      const { service } = createService();
      service.recordTokenIssued('authorization_code');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('tenant="default"');
    });

    it('uses custom tenant when specified', async () => {
      const { service } = createService();
      service.recordTokenIssued('authorization_code', 'acme');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('tenant="acme"');
    });

    it('different tenants produce separate counter series', async () => {
      const { service } = createService();
      service.recordTokenIssued('authorization_code', 'acme');
      service.recordTokenIssued('authorization_code', 'globex');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('tenant="acme"');
      expect(metrics).toContain('tenant="globex"');
    });
  });
});

describe('sanitizeLabel', () => {
  const ALLOWLIST = new Set(['alpha', 'beta', 'gamma']);

  it('returns value when in allowlist', () => {
    expect(sanitizeLabel('alpha', ALLOWLIST)).toBe('alpha');
    expect(sanitizeLabel('beta', ALLOWLIST)).toBe('beta');
  });

  it('returns "other" for unknown values', () => {
    expect(sanitizeLabel('delta', ALLOWLIST)).toBe('other');
    expect(sanitizeLabel('', ALLOWLIST)).toBe('other');
  });

  it('is case-sensitive', () => {
    expect(sanitizeLabel('Alpha', ALLOWLIST)).toBe('other');
    expect(sanitizeLabel('ALPHA', ALLOWLIST)).toBe('other');
  });
});

describe('label sanitization in metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collapses unknown grant_type to "other"', async () => {
    const { service } = createService();
    service.recordTokenIssued('malicious_grant_type_injection');

    const metrics = await service.getMetrics();
    expect(metrics).toContain('grant_type="other"');
    expect(metrics).not.toContain('malicious_grant_type_injection');
  });

  it('preserves known grant_type values', async () => {
    const { service } = createService();
    service.recordTokenIssued('authorization_code');
    service.recordTokenIssued('client_credentials');

    const metrics = await service.getMetrics();
    expect(metrics).toContain('grant_type="authorization_code"');
    expect(metrics).toContain('grant_type="client_credentials"');
  });

  it('collapses unknown error_type to "other"', async () => {
    const { service } = createService();
    service.recordTokenError('unknown_error_type');

    const metrics = await service.getMetrics();
    expect(metrics).toContain('error_type="other"');
    expect(metrics).not.toContain('unknown_error_type');
  });

  it('collapses unknown login method to "other"', async () => {
    const { service } = createService();
    service.recordLoginAttempt('success', 'injected_method');

    const metrics = await service.getMetrics();
    expect(metrics).toContain('method="other"');
    expect(metrics).not.toContain('injected_method');
  });

  it('collapses unknown social provider to "other"', async () => {
    const { service } = createService();
    service.recordFederationLogin('evil_provider', 'success');

    const metrics = await service.getMetrics();
    expect(metrics).toContain('provider="other"');
    expect(metrics).not.toContain('evil_provider');
  });

  it('normalizes social provider to lowercase before checking', async () => {
    const { service } = createService();
    service.recordFederationLogin('GitHub', 'success');

    const metrics = await service.getMetrics();
    expect(metrics).toContain('provider="github"');
  });

  it('collapses unknown HTTP method to "other"', async () => {
    const { service } = createService();
    service.recordRequestDuration('PROPFIND', '/api/test', 200, 0.05);

    const metrics = await service.getMetrics();
    expect(metrics).toContain('method="other"');
    expect(metrics).not.toContain('PROPFIND');
  });
});

describe('normalizeRoute', () => {
  it('replaces UUID v4 with :id', () => {
    expect(normalizeRoute('/users/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/users/:id'
    );
  });

  it('replaces MongoDB ObjectID with :id', () => {
    expect(normalizeRoute('/users/507f1f77bcf86cd799439011')).toBe(
      '/users/:id'
    );
  });

  it('replaces numeric IDs with :id', () => {
    expect(normalizeRoute('/users/12345')).toBe('/users/:id');
  });

  it('replaces OIDC interaction UIDs', () => {
    expect(normalizeRoute('/interaction/abc123def456ghi789')).toBe(
      '/interaction/:uid'
    );
  });

  it('preserves static route paths', () => {
    expect(normalizeRoute('/api/v1/users')).toBe('/api/v1/users');
  });

  it('handles multiple dynamic segments', () => {
    const result = normalizeRoute('/users/12345/posts/67890');
    expect(result).toBe('/users/:id/posts/:id');
  });
});
