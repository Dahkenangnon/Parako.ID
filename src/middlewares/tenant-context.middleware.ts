import type { Request, Response, NextFunction } from 'express';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { ITenantContextMiddleware } from '../di/interfaces/tenant-context-middleware.interface.js';
import type { ITenantRepository } from '../db/repositories/interfaces/tenant.repository.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../multi-tenancy/tenant-context.js';

/**
 * Strict slug format for tenant IDs from untrusted sources.
 * Only lowercase alphanumeric, hyphens, underscores. 1-63 chars.
 * Must start with a letter or digit.
 */
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * Express middleware that extracts the tenant identity from the incoming
 * request and wraps all downstream handlers in `tenantContext.run()`.
 *
 * Extraction priority is configurable via `features.multi_tenancy.extraction_priority`.
 * Sources: header → subdomain (order matters).
 * The resolved tenant is always bound to the session (internal behavior, not a configurable strategy).
 *
 * Security:
 * - Validates tenant slug format before any database lookup.
 * - Validates that the extracted tenant slug exists and is active.
 * - In production/staging, rejects requests that cannot be attributed to a
 *   tenant (returns 400). Silently falling back to the default tenant in
 *   production would risk cross-tenant data leakage.
 * - In development, falls back to DEFAULT_TENANT_ID with a warning log.
 */
@injectable()
export class TenantContextMiddleware implements ITenantContextMiddleware {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.TenantRepository)
    private readonly tenantRepo: ITenantRepository,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager
  ) {}

  public handler = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const config = this.configManager.getConfig();
      const mtConfig = config.features.multi_tenancy;

      // Single-tenant mode — wrap in default context, skip extraction entirely
      if (!mtConfig.enabled) {
        this.sessionManager.set(req, 'tenantId', DEFAULT_TENANT_ID);
        await this.configManager.ensureTenantConfig(DEFAULT_TENANT_ID);
        return tenantContext.run(DEFAULT_TENANT_ID, () => next());
      }

      const environment = config.deployment.environment;
      let tenantId = this.extractTenantId(req, mtConfig);

      // ── Subdomain-session consistency validation ──────────────────────
      // When cookies are scoped to the base domain (e.g. .parako.test),
      // a session from acme.parako.test is sent to beta.parako.test too.
      const subdomain = this.extractSubdomain(req);
      const sessionTenant = (req.session as Record<string, unknown>)
        ?.tenantId as string | undefined;

      if (
        subdomain &&
        sessionTenant &&
        subdomain !== sessionTenant &&
        sessionTenant !== DEFAULT_TENANT_ID
      ) {
        this.logger.warn('tenant_session_subdomain_mismatch', {
          sessionTenant,
          subdomain,
          path: req.originalUrl,
          action: 'clearing_auth_using_subdomain',
        });
        this.sessionManager.clearAuthenticationData(req);
        tenantId = subdomain; // subdomain wins
      }

      // _ops: stateless infrastructure gateway — no session, no config cache
      if (tenantId === '_ops') {
        this.logger.debug('system_tenant_request', {
          tenantId,
          path: req.originalUrl,
        });
        return tenantContext.run(tenantId, () => next());
      }

      // _platforms: master tenant — full session + config like regular tenants.
      // Caught before slug validation (which rejects the underscore prefix)
      // and before DB lookup (works even before bootstrap on first startup).
      if (tenantId === '_platforms') {
        this.logger.debug('master_tenant_request', {
          tenantId,
          path: req.originalUrl,
        });
        this.sessionManager.set(req, 'tenantId', tenantId);
        await this.configManager.ensureTenantConfig(tenantId);
        return tenantContext.run(tenantId, () => next());
      }

      // Prevents malformed input from reaching queries, logs, or error messages.
      if (
        tenantId !== DEFAULT_TENANT_ID &&
        !TENANT_SLUG_PATTERN.test(tenantId)
      ) {
        res.status(400).json({ error: 'Invalid tenant identifier format' });
        return;
      }

      // Fallback to DEFAULT_TENANT_ID — security-sensitive in production
      if (tenantId === DEFAULT_TENANT_ID) {
        const isSecureEnv =
          environment === 'production' || environment === 'staging';

        if (isSecureEnv) {
          this.logger.warn('tenant_identification_failed_secure_env', {
            ip: req.ip,
            url: req.originalUrl,
            environment,
            sources: mtConfig.extraction_priority,
          });
          res.status(400).json({
            error:
              'Tenant identification required. No tenant could be resolved from session, headers, or subdomain.',
          });
          return;
        }

        // Development — allow but warn
        this.logger.warn('tenant_fallback_to_default', {
          ip: req.ip,
          url: req.originalUrl,
          environment,
          hint: 'Set x-tenant-id header or configure session.tenantId for multi-tenant testing.',
        });
        this.sessionManager.set(req, 'tenantId', DEFAULT_TENANT_ID);
        await this.configManager.ensureTenantConfig(DEFAULT_TENANT_ID);
        return tenantContext.run(DEFAULT_TENANT_ID, () => next());
      }

      // Error messages intentionally do NOT reflect the raw input to prevent
      // reflected XSS if the JSON response is rendered in a browser context.
      const tenant = await this.tenantRepo.findBySlug(tenantId);
      if (!tenant) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }
      if (tenant.status !== 'active') {
        res.status(403).json({ error: 'Tenant is not active' });
        return;
      }

      // Bind tenant to session (prevents cross-tenant hijacking on subsequent requests)
      this.sessionManager.set(req, 'tenantId', tenantId);
      // Warm the per-tenant config cache (ConfigManager handles auto-seeding internally)
      await this.configManager.ensureTenantConfig(tenantId);

      return tenantContext.run(tenantId, () => next());
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'tenant_context_middleware',
      });
      next(error as Error);
    }
  };

  /**
   * Extract subdomain from hostname, if present.
   * e.g. "acme.parako.test" → "acme", "parako.test" → undefined
   */
  private extractSubdomain(req: Request): string | undefined {
    const parts = req.hostname.split('.');
    return parts.length >= 3 ? parts[0] : undefined;
  }

  /**
   * Walk the configured extraction priority list and return the first
   * tenant slug found, or DEFAULT_TENANT_ID if none matched.
   */
  private extractTenantId(
    req: Request,
    config: {
      extraction_priority: string[];
      tenant_header: string;
    }
  ): string {
    for (const source of config.extraction_priority) {
      switch (source) {
        case 'header': {
          const headerTenant = req.headers[config.tenant_header] as
            | string
            | undefined;
          if (headerTenant) return headerTenant;
          break;
        }
        case 'subdomain': {
          const host = req.hostname;
          const parts = host.split('.');
          // Need at least 3 parts for a subdomain (e.g., acme.parako.id)
          if (parts.length >= 3) return parts[0];
          break;
        }
      }
    }
    return DEFAULT_TENANT_ID;
  }
}
