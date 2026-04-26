/**
 * TDD — Tenant Context Middleware
 *
 * Verifies that the middleware:
 * - Extracts tenant from header or subdomain in priority order
 * - Falls back to DEFAULT_TENANT_ID when nothing matches (non-production)
 * - Rejects with 400 in production when no tenant can be identified
 * - Passes through with DEFAULT_TENANT_ID when multi_tenancy.enabled = false
 * - Wraps downstream in tenantContext.run()
 * - Validates tenant exists via repository — returns 404 for unknown
 * - Validates tenant status — returns 403 for suspended/archived
 * - Skips validation for DEFAULT_TENANT_ID
 * - Binds tenantId to session via SessionManager
 * - Calls ensureTenantConfig() to warm per-tenant config cache
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../src/multi-tenancy/tenant-context.js';
import { TenantContextMiddleware } from '../../../src/middlewares/tenant-context.middleware.js';
import type { IConfigManager } from '../../../src/di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../../src/di/interfaces/session-manager.interface.js';
import type { ITenantRepository } from '../../../src/db/repositories/interfaces/tenant.repository.js';
import type { ITenant } from '../../../src/types/tenant.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

function createMockSessionManager(): ISessionManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    clearAuthenticationData: vi.fn(),
    regenerate: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockReturnValue(true),
    getTTL: vi.fn().mockReturnValue(3600),
    initialize: vi.fn(),
    getMiddleware: vi.fn(),
    activityTracker: vi.fn(),
  } as unknown as ISessionManager;
}

function createMockConfigManager(
  overrides: Partial<{
    enabled: boolean;
    extraction_priority: string[];
    tenant_header: string;
    environment: string;
  }> = {}
): IConfigManager {
  const {
    enabled = true,
    extraction_priority = ['header', 'subdomain'],
    tenant_header = 'x-tenant-id',
    environment = 'development',
  } = overrides;

  return {
    getConfig: vi.fn().mockReturnValue({
      deployment: {
        environment,
      },
      features: {
        multi_tenancy: {
          enabled,
          extraction_priority,
          tenant_header,
        },
      },
    }),
    ensureTenantConfig: vi.fn().mockResolvedValue(undefined),
  } as unknown as IConfigManager;
}

function createMockTenantRepo(
  tenants: Map<string, ITenant> = new Map()
): ITenantRepository {
  return {
    findBySlug: vi
      .fn()
      .mockImplementation((slug: string) =>
        Promise.resolve(tenants.get(slug) ?? null)
      ),
    findByDomain: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    exists: vi
      .fn()
      .mockImplementation((slug: string) => Promise.resolve(tenants.has(slug))),
  } as unknown as ITenantRepository;
}

function makeTenant(
  slug: string,
  status: 'active' | 'suspended' | 'archived' = 'active'
): ITenant {
  return {
    id: `id-${slug}`,
    slug,
    display_name: `${slug} Corp`,
    status,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  } as ITenant;
}

function createMockReq(
  overrides: Partial<{
    session: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    hostname: string;
    query: Record<string, string>;
    ip: string;
    originalUrl: string;
  }> = {}
): Request {
  return {
    session: overrides.session ?? {},
    headers: overrides.headers ?? {},
    hostname: overrides.hostname ?? 'localhost',
    query: overrides.query ?? {},
    ip: overrides.ip ?? '127.0.0.1',
    originalUrl: overrides.originalUrl ?? '/',
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantContextMiddleware', () => {
  let logger: ILogger;
  let tenantRepo: ITenantRepository;
  let sessionManager: ISessionManager;

  beforeEach(() => {
    logger = createMockLogger();
    sessionManager = createMockSessionManager();
  });

  describe('when multi_tenancy.enabled = false', () => {
    it('wraps downstream in DEFAULT_TENANT_ID context and calls next()', async () => {
      const configManager = createMockConfigManager({ enabled: false });
      tenantRepo = createMockTenantRepo();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'acme' },
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(capturedTenantId).toBe(DEFAULT_TENANT_ID);
      // Should NOT call repository when disabled
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });
  });

  describe('tenant extraction (priority order)', () => {
    const tenants = new Map([
      ['acme', makeTenant('acme')],
      ['globex', makeTenant('globex')],
      ['sub-tenant', makeTenant('sub-tenant')],
    ]);

    beforeEach(() => {
      tenantRepo = createMockTenantRepo(tenants);
    });

    it('extracts tenant from header (first priority)', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: { 'x-tenant-id': 'globex' },
        hostname: 'sub-tenant.parako.id',
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(capturedTenantId).toBe('globex');
    });

    it('extracts tenant from subdomain (second priority)', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'sub-tenant.parako.id',
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(capturedTenantId).toBe('sub-tenant');
    });

    it('respects custom header name', async () => {
      const configManager = createMockConfigManager({
        tenant_header: 'x-org-id',
      });
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-org-id': 'acme' },
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(capturedTenantId).toBe('acme');
    });
  });

  describe('production fallback safety', () => {
    it('rejects with 400 in production when no tenant is identified', async () => {
      const configManager = createMockConfigManager({
        environment: 'production',
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'localhost',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Tenant identification required'),
        })
      );
      expect(next).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('rejects with 400 in staging when no tenant is identified', async () => {
      const configManager = createMockConfigManager({
        environment: 'staging',
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'localhost',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows DEFAULT_TENANT_ID fallback in development with a warning', async () => {
      const configManager = createMockConfigManager({
        environment: 'development',
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'localhost',
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(capturedTenantId).toBe(DEFAULT_TENANT_ID);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('slug format validation', () => {
    beforeEach(() => {
      tenantRepo = createMockTenantRepo(new Map());
    });

    it('rejects XSS payload in tenant slug with 400', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '<script>alert(1)</script>' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid tenant identifier format',
      });
      expect(next).not.toHaveBeenCalled();
      // Must NOT reach the database
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('rejects path traversal attempt with 400', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '../../../etc/passwd' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('rejects uppercase slugs with 400', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'ACME' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('rejects slugs longer than 63 characters with 400', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const longSlug = `a${'b'.repeat(63)}`; // 64 chars
      const req = createMockReq({
        headers: { 'x-tenant-id': longSlug },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('rejects slugs starting with hyphen', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '-invalid' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('rejects SQL injection attempts with 400', async () => {
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': "'; DROP TABLE tenants;--" },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('accepts valid slugs (lowercase alphanumeric with hyphens/underscores)', async () => {
      const tenants = new Map([['acme-corp', makeTenant('acme-corp')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'acme-corp' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(tenantRepo.findBySlug).toHaveBeenCalledWith('acme-corp');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('tenant validation', () => {
    it('returns 404 for unknown tenant slug', async () => {
      const configManager = createMockConfigManager();
      tenantRepo = createMockTenantRepo(new Map()); // empty — no tenants
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'unknown-tenant' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not found'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 for suspended tenant', async () => {
      const tenants = new Map([
        ['suspended-co', makeTenant('suspended-co', 'suspended')],
      ]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'suspended-co' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not active'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 for archived tenant', async () => {
      const tenants = new Map([
        ['archived-co', makeTenant('archived-co', 'archived')],
      ]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'archived-co' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('skips validation for DEFAULT_TENANT_ID in development', async () => {
      const configManager = createMockConfigManager({
        environment: 'development',
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      // No extraction sources → falls back to DEFAULT_TENANT_ID
      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'localhost',
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(capturedTenantId).toBe(DEFAULT_TENANT_ID);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });
  });

  describe('context wrapping', () => {
    it('wraps entire downstream in tenantContext.run()', async () => {
      const tenants = new Map([['acme', makeTenant('acme')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'acme' },
      });
      const res = createMockRes();

      const outsideTenantId = tenantContext.getTenantId();
      let insideTenantId: string | undefined;

      const next: NextFunction = vi.fn(() => {
        insideTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      expect(outsideTenantId).toBe(DEFAULT_TENANT_ID);
      expect(insideTenantId).toBe('acme');
    });

    it('does not ignore www subdomain', async () => {
      const configManager = createMockConfigManager({
        extraction_priority: ['subdomain'],
      });
      tenantRepo = createMockTenantRepo(new Map([['www', makeTenant('www')]]));
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        hostname: 'www.parako.id',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      // www is a valid subdomain extraction — it goes through validation
      expect(tenantRepo.findBySlug).toHaveBeenCalledWith('www');
    });

    it('does not extract subdomain from bare domain (no subdomain)', async () => {
      const configManager = createMockConfigManager({
        extraction_priority: ['subdomain'],
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        hostname: 'parako.id',
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      // parako.id has only 2 parts — no subdomain extracted.
      // In development, falls back to DEFAULT_TENANT_ID with warning.
      expect(capturedTenantId).toBe(DEFAULT_TENANT_ID);
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });
  });

  describe('session tenant binding', () => {
    it('sets tenantId on session after successful multi-tenant extraction', async () => {
      const tenants = new Map([['acme', makeTenant('acme')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'acme' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(sessionManager.set).toHaveBeenCalledWith(req, 'tenantId', 'acme');
    });

    it('sets tenantId to DEFAULT_TENANT_ID in single-tenant mode', async () => {
      const configManager = createMockConfigManager({ enabled: false });
      tenantRepo = createMockTenantRepo();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'tenantId',
        DEFAULT_TENANT_ID
      );
    });

    it('sets tenantId to DEFAULT_TENANT_ID in dev fallback', async () => {
      const configManager = createMockConfigManager({
        environment: 'development',
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'localhost',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'tenantId',
        DEFAULT_TENANT_ID
      );
    });
  });

  describe('subdomain-session mismatch validation', () => {
    it('clears auth and uses subdomain when session tenant differs from subdomain', async () => {
      const tenants = new Map([
        ['acme', makeTenant('acme')],
        ['beta', makeTenant('beta')],
      ]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: { tenantId: 'acme' },
        hostname: 'beta.parako.test',
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next: NextFunction = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantId();
      });

      await middleware.handler(req, res, next);

      // Subdomain wins — should be 'beta', not 'acme'
      expect(capturedTenantId).toBe('beta');
      // Auth state should have been cleared
      expect(sessionManager.clearAuthenticationData).toHaveBeenCalledWith(req);
      // Warning should have been logged
      expect(logger.warn).toHaveBeenCalledWith(
        'tenant_session_subdomain_mismatch',
        expect.objectContaining({
          sessionTenant: 'acme',
          subdomain: 'beta',
        })
      );
    });

    it('does not clear auth when session matches subdomain', async () => {
      const tenants = new Map([['acme', makeTenant('acme')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: { tenantId: 'acme' },
        hostname: 'acme.parako.test',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(sessionManager.clearAuthenticationData).not.toHaveBeenCalled();
    });

    it('does not clear auth when session is DEFAULT_TENANT_ID', async () => {
      const tenants = new Map([['beta', makeTenant('beta')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: { tenantId: DEFAULT_TENANT_ID },
        hostname: 'beta.parako.test',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      // DEFAULT_TENANT_ID is a fresh session — no mismatch to clear
      expect(sessionManager.clearAuthenticationData).not.toHaveBeenCalled();
    });

    it('does not clear auth when no subdomain is present', async () => {
      const tenants = new Map([['acme', makeTenant('acme')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: { tenantId: 'acme' },
        hostname: 'localhost',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(sessionManager.clearAuthenticationData).not.toHaveBeenCalled();
    });
  });

  describe('config warm-up', () => {
    it('calls ensureTenantConfig() with resolved tenantId', async () => {
      const tenants = new Map([['acme', makeTenant('acme')]]);
      tenantRepo = createMockTenantRepo(tenants);
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'acme' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(configManager.ensureTenantConfig).toHaveBeenCalledWith('acme');
    });

    it('calls ensureTenantConfig(DEFAULT_TENANT_ID) in single-tenant mode', async () => {
      const configManager = createMockConfigManager({ enabled: false });
      tenantRepo = createMockTenantRepo();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq();
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(configManager.ensureTenantConfig).toHaveBeenCalledWith(
        DEFAULT_TENANT_ID
      );
    });

    it('calls ensureTenantConfig(DEFAULT_TENANT_ID) in dev fallback', async () => {
      const configManager = createMockConfigManager({
        environment: 'development',
      });
      tenantRepo = createMockTenantRepo(new Map());
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        session: {},
        headers: {},
        hostname: 'localhost',
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(configManager.ensureTenantConfig).toHaveBeenCalledWith(
        DEFAULT_TENANT_ID
      );
    });
  });

  describe('error handling', () => {
    it('calls next(error) when repository throws', async () => {
      tenantRepo = createMockTenantRepo(new Map());
      (tenantRepo.findBySlug as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection failed')
      );
      const configManager = createMockConfigManager();
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': 'acme' },
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      await middleware.handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('system tenant bypass (_ops, _platforms)', () => {
    it('skips session binding and config warming for _ops tenant', async () => {
      const tenants = new Map<string, ITenant>();
      const logger = createMockLogger();
      const sessionManager = createMockSessionManager();
      const configManager = createMockConfigManager();
      const tenantRepo = createMockTenantRepo(tenants);
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '_ops' },
      });
      const res = createMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      // Should NOT have called session set or config warm
      expect(sessionManager.set).not.toHaveBeenCalled();
      expect(configManager.ensureTenantConfig).not.toHaveBeenCalled();
      // Should NOT have looked up _ops in tenant repo
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
      // Should still call next (wrapped in tenant context)
      expect(next).toHaveBeenCalled();
    });

    it('applies session binding and config warming for _platforms master tenant', async () => {
      const tenants = new Map<string, ITenant>();
      const logger = createMockLogger();
      const sessionManager = createMockSessionManager();
      const configManager = createMockConfigManager();
      const tenantRepo = createMockTenantRepo(tenants);
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '_platforms' },
      });
      const res = createMockRes();
      const next = vi.fn();

      await middleware.handler(req, res, next);

      // _platforms is a master tenant — gets full session + config treatment
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'tenantId',
        '_platforms'
      );
      expect(configManager.ensureTenantConfig).toHaveBeenCalledWith(
        '_platforms'
      );
      // Should NOT look up _platforms in tenant repo (works before bootstrap)
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('wraps _platforms in tenantContext.run with correct tenant_id', async () => {
      const tenants = new Map<string, ITenant>();
      const logger = createMockLogger();
      const sessionManager = createMockSessionManager();
      const configManager = createMockConfigManager();
      const tenantRepo = createMockTenantRepo(tenants);
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '_platforms' },
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantIdSafe();
      });

      await middleware.handler(req, res, next);

      expect(capturedTenantId).toBe('_platforms');
    });

    it('wraps _ops in tenantContext.run with correct tenant_id', async () => {
      const tenants = new Map<string, ITenant>();
      const logger = createMockLogger();
      const sessionManager = createMockSessionManager();
      const configManager = createMockConfigManager();
      const tenantRepo = createMockTenantRepo(tenants);
      const middleware = new TenantContextMiddleware(
        logger,
        configManager,
        tenantRepo,
        sessionManager
      );

      const req = createMockReq({
        headers: { 'x-tenant-id': '_ops' },
      });
      const res = createMockRes();

      let capturedTenantId: string | undefined;
      const next = vi.fn(() => {
        capturedTenantId = tenantContext.getTenantIdSafe();
      });

      await middleware.handler(req, res, next);

      expect(capturedTenantId).toBe('_ops');
    });
  });
});
