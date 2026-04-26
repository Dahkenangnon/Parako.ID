import * as client from 'prom-client';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../di/types.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IMetricsService } from '../../di/interfaces/metrics-service.interface.js';

const DEFAULT_TENANT = 'default';

/** Standard HTTP duration buckets (seconds) aligned with Prometheus best practices */
const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// ── Label allowlists (cardinality safety) ──
// Unknown values are collapsed to 'other' to prevent cardinality explosion
// from user-controlled or malicious inputs.

const KNOWN_GRANT_TYPES = new Set([
  'authorization_code',
  'client_credentials',
  'refresh_token',
  'urn:ietf:params:oauth:grant-type:device_code',
  'unknown',
]);

const KNOWN_ERROR_TYPES = new Set([
  'authorization',
  'backchannel',
  'end_session',
  'grant',
  'registration_create',
  'registration_delete',
  'registration_read',
  'registration_update',
  'pushed_authorization_request',
  'jwks',
  'discovery',
  'introspection',
  'revocation',
  'userinfo',
  'server_error',
  'unknown',
]);

const KNOWN_LOGIN_METHODS = new Set([
  'email',
  'phone',
  'custom_identifier',
  'unknown',
]);

const KNOWN_SOCIAL_PROVIDERS = new Set([
  'github',
  'google',
  'facebook',
  'linkedin',
  'microsoft',
  'unknown',
]);

const KNOWN_HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/** Sanitize a label value against an allowlist. Unknown values become 'other'. */
export function sanitizeLabel(value: string, allowlist: Set<string>): string {
  return allowlist.has(value) ? value : 'other';
}

/**
 * Normalize route paths to prevent label cardinality explosion.
 * Replaces dynamic segments (UUIDs, ObjectIDs, numeric IDs) with placeholders.
 */
export function normalizeRoute(route: string): string {
  return (
    route
      // UUID v4: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ':id'
      )
      // MongoDB ObjectID: 24 hex chars
      .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
      // Numeric IDs in path segments
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      // OIDC interaction UIDs (typically 20+ char alphanumeric)
      .replace(/\/interaction\/[a-zA-Z0-9_-]{10,}/, '/interaction/:uid')
  );
}

@injectable()
export class MetricsService implements IMetricsService {
  private readonly registry: client.Registry;
  private readonly enabled: boolean;
  private readonly prefix: string;

  private readonly tokenIssuedCounter?: client.Counter;
  private readonly tokenErrorCounter?: client.Counter;
  private readonly loginAttemptCounter?: client.Counter;
  private readonly federationLoginCounter?: client.Counter;
  private readonly jwksRotationCounter?: client.Counter;
  private readonly oidcInteractionCounter?: client.Counter;

  private readonly httpDurationHistogram?: client.Histogram;

  private readonly infoGauge?: client.Gauge;

  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.Logger) private readonly logger: ILogger
  ) {
    const config = this.configManager.getConfig();
    const metricsConfig = config.features.metrics;
    this.enabled = metricsConfig.enabled;
    this.prefix = metricsConfig.prefix;

    // Private registry — never pollutes global default
    this.registry = new client.Registry();

    if (!this.enabled) {
      return;
    }

    if (metricsConfig.include_default_metrics) {
      client.collectDefaultMetrics({
        register: this.registry,
        prefix: this.prefix,
      });
    }

    // ── Counters ──

    this.tokenIssuedCounter = new client.Counter({
      name: `${this.prefix}token_issued_total`,
      help: 'Total tokens issued via OIDC grant endpoints',
      labelNames: ['grant_type', 'tenant'] as const,
      registers: [this.registry],
    });

    this.tokenErrorCounter = new client.Counter({
      name: `${this.prefix}token_error_total`,
      help: 'Total OIDC endpoint errors by type',
      labelNames: ['error_type', 'grant_type', 'tenant'] as const,
      registers: [this.registry],
    });

    this.loginAttemptCounter = new client.Counter({
      name: `${this.prefix}login_attempt_total`,
      help: 'Total password login attempts',
      labelNames: ['result', 'method', 'tenant'] as const,
      registers: [this.registry],
    });

    this.federationLoginCounter = new client.Counter({
      name: `${this.prefix}federation_login_total`,
      help: 'Total social/federated login outcomes',
      labelNames: ['provider', 'result', 'tenant'] as const,
      registers: [this.registry],
    });

    this.jwksRotationCounter = new client.Counter({
      name: `${this.prefix}jwks_rotation_total`,
      help: 'Total JWKS key rotation lifecycle events',
      labelNames: ['phase', 'status', 'tenant'] as const,
      registers: [this.registry],
    });

    this.oidcInteractionCounter = new client.Counter({
      name: `${this.prefix}oidc_interaction_total`,
      help: 'Total OIDC interaction flow outcomes',
      labelNames: ['prompt', 'result', 'tenant'] as const,
      registers: [this.registry],
    });

    // ── Histograms ──

    this.httpDurationHistogram = new client.Histogram({
      name: `${this.prefix}http_request_duration_seconds`,
      help: 'HTTP request latency distribution in seconds',
      labelNames: ['method', 'route', 'status_code', 'tenant'] as const,
      buckets: HTTP_DURATION_BUCKETS,
      registers: [this.registry],
    });

    // ── Gauges ──

    this.infoGauge = new client.Gauge({
      name: `${this.prefix}info`,
      help: 'Server info (always 1)',
      labelNames: ['environment'] as const,
      registers: [this.registry],
    });

    this.infoGauge.set(
      {
        environment: config.deployment.environment,
      },
      1
    );

    this.logger.info('Prometheus metrics initialized', {
      prefix: this.prefix,
      path: metricsConfig.path,
      defaultMetrics: metricsConfig.include_default_metrics,
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── OIDC Token Metrics ──

  recordTokenIssued(grantType: string, tenant?: string): void {
    if (!this.enabled) return;
    try {
      this.tokenIssuedCounter!.inc({
        grant_type: sanitizeLabel(grantType, KNOWN_GRANT_TYPES),
        tenant: tenant ?? DEFAULT_TENANT,
      });
    } catch (err) {
      this.logger.debug('metrics: failed to record token issued', {
        error: (err as Error).message,
      });
    }
  }

  recordTokenError(
    errorType: string,
    grantType?: string,
    tenant?: string
  ): void {
    if (!this.enabled) return;
    try {
      this.tokenErrorCounter!.inc({
        error_type: sanitizeLabel(errorType, KNOWN_ERROR_TYPES),
        grant_type: sanitizeLabel(grantType ?? 'unknown', KNOWN_GRANT_TYPES),
        tenant: tenant ?? DEFAULT_TENANT,
      });
    } catch (err) {
      this.logger.debug('metrics: failed to record token error', {
        error: (err as Error).message,
      });
    }
  }

  // ── Authentication Metrics ──

  recordLoginAttempt(
    result: 'success' | 'failure' | 'error',
    method: string,
    tenant?: string
  ): void {
    if (!this.enabled) return;
    try {
      this.loginAttemptCounter!.inc({
        result,
        method: sanitizeLabel(method, KNOWN_LOGIN_METHODS),
        tenant: tenant ?? DEFAULT_TENANT,
      });
    } catch (err) {
      this.logger.debug('metrics: failed to record login attempt', {
        error: (err as Error).message,
      });
    }
  }

  recordFederationLogin(
    provider: string,
    result: 'success' | 'failure',
    tenant?: string
  ): void {
    if (!this.enabled) return;
    try {
      this.federationLoginCounter!.inc({
        provider: sanitizeLabel(provider.toLowerCase(), KNOWN_SOCIAL_PROVIDERS),
        result,
        tenant: tenant ?? DEFAULT_TENANT,
      });
    } catch (err) {
      this.logger.debug('metrics: failed to record federation login', {
        error: (err as Error).message,
      });
    }
  }

  // ── HTTP Metrics ──

  recordRequestDuration(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
    tenant?: string
  ): void {
    if (!this.enabled) return;
    try {
      this.httpDurationHistogram!.observe(
        {
          method: sanitizeLabel(method, KNOWN_HTTP_METHODS),
          route: normalizeRoute(route),
          status_code: statusCode,
          tenant: tenant ?? DEFAULT_TENANT,
        },
        durationSeconds
      );
    } catch (err) {
      this.logger.debug('metrics: failed to record request duration', {
        error: (err as Error).message,
      });
    }
  }

  // ── Infrastructure Metrics ──

  recordJwksRotation(
    phase: string,
    status: 'success' | 'failure',
    tenant?: string
  ): void {
    if (!this.enabled) return;
    try {
      this.jwksRotationCounter!.inc({
        phase,
        status,
        tenant: tenant ?? DEFAULT_TENANT,
      });
    } catch (err) {
      this.logger.debug('metrics: failed to record JWKS rotation', {
        error: (err as Error).message,
      });
    }
  }

  recordOidcInteraction(
    prompt: string,
    result: 'started' | 'ended' | 'error',
    tenant?: string
  ): void {
    if (!this.enabled) return;
    try {
      this.oidcInteractionCounter!.inc({
        prompt,
        result,
        tenant: tenant ?? DEFAULT_TENANT,
      });
    } catch (err) {
      this.logger.debug('metrics: failed to record OIDC interaction', {
        error: (err as Error).message,
      });
    }
  }

  // ── Endpoint ──

  async getMetrics(): Promise<string> {
    if (!this.enabled) return '';
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
