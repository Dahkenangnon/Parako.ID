/**
 * Prometheus metrics collection service.
 *
 * Design principles:
 * - All record*() methods are fire-and-forget (never throw)
 * - All record*() methods are no-ops when metrics are disabled
 * - Labels are cardinality-bounded (no unbounded user/client IDs)
 * - Multi-tenant ready: optional `tenant` param on all methods (defaults to 'default')
 */
export interface IMetricsService {
  /** Whether metrics collection is currently enabled */
  isEnabled(): boolean;

  // ── OIDC Token Metrics ──

  /** Record a successful token issuance via grant endpoint */
  recordTokenIssued(grantType: string, tenant?: string): void;

  /** Record an OIDC endpoint error */
  recordTokenError(
    errorType: string,
    grantType?: string,
    tenant?: string
  ): void;

  // ── Authentication Metrics ──

  /** Record a password-based login attempt */
  recordLoginAttempt(
    result: 'success' | 'failure' | 'error',
    method: string,
    tenant?: string
  ): void;

  /** Record a federated/social login outcome */
  recordFederationLogin(
    provider: string,
    result: 'success' | 'failure',
    tenant?: string
  ): void;

  // ── HTTP Metrics ──

  /** Record HTTP request duration (seconds) */
  recordRequestDuration(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
    tenant?: string
  ): void;

  // ── Infrastructure Metrics ──

  /** Record a JWKS rotation lifecycle event */
  recordJwksRotation(
    phase: string,
    status: 'success' | 'failure',
    tenant?: string
  ): void;

  /** Record an OIDC interaction outcome */
  recordOidcInteraction(
    prompt: string,
    result: 'started' | 'ended' | 'error',
    tenant?: string
  ): void;

  // ── Endpoint ──

  /** Return Prometheus text-format metrics output */
  getMetrics(): Promise<string>;

  /** Return the Content-Type header for Prometheus exposition format */
  getContentType(): string;
}
