import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { ProtectedTenantError } from '../../../src/errors/platform.errors.js';
import { PlatformAdminService } from '../../../src/services/platform-admin.service.js';

/**
 * Tests for PlatformAdminService
 *
 * Cross-tenant operations for the _platforms admin portal:
 * - List all tenants
 * - Create tenant (with reserved slug protection)
 * - Get tenant config via cross-tenant context switching
 * - List users for a specific tenant
 */

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

interface TenantFixture {
  id?: string;
  _id?: string;
  slug: string;
  display_name: string;
  domain?: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function makeMockTenantRepo() {
  const tenants: TenantFixture[] = [
    {
      _id: 't1',
      slug: 'acme',
      display_name: 'Acme Corp',
      status: 'active',
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
    },
    {
      _id: 't2',
      slug: 'beta',
      display_name: 'Beta Inc',
      status: 'suspended',
      created_at: new Date('2025-02-01'),
      updated_at: new Date('2025-02-01'),
    },
  ];

  return {
    findAll: vi.fn(async () => tenants),
    findBySlug: vi.fn(
      async (slug: string) => tenants.find(t => t.slug === slug) ?? null
    ),
    findByDomain: vi.fn(
      async (domain: string) =>
        tenants.find(tenant => tenant.domain === domain) ?? null
    ),
    create: vi.fn(async (data: { slug: string; display_name: string }) => ({
      _id: 'new-id',
      ...data,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })),
    exists: vi.fn(async (slug: string) => tenants.some(t => t.slug === slug)),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => ({
      _id: id,
      ...data,
    })),
  };
}

function makeMockUserService() {
  return {
    findWithPagination: vi.fn(async () => ({
      results: [
        { _id: 'u1', username: 'alice', email: 'alice@acme.com' },
        { _id: 'u2', username: 'bob', email: 'bob@acme.com' },
      ],
      page: 1,
      limit: 20,
      totalPages: 1,
      totalResults: 2,
    })),
    countDocuments: vi.fn(async () => 2),
  };
}

function makeMockConfigManager() {
  return {
    getConfig: vi.fn(() => ({
      deployment: { url: 'https://parako.id' },
      application: { title: 'Parako.ID' },
    })),
    ensureTenantConfig: vi.fn(async () => {}),
  };
}

function makeMockActivityService() {
  return {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    failed: vi.fn(),
  };
}

describe('PlatformAdminService', () => {
  let logger: ReturnType<typeof makeMockLogger>;
  let tenantRepo: ReturnType<typeof makeMockTenantRepo>;
  let userService: ReturnType<typeof makeMockUserService>;
  let configManager: ReturnType<typeof makeMockConfigManager>;
  let activityService: ReturnType<typeof makeMockActivityService>;

  beforeEach(() => {
    logger = makeMockLogger();
    tenantRepo = makeMockTenantRepo();
    userService = makeMockUserService();
    configManager = makeMockConfigManager();
    activityService = makeMockActivityService();
  });

  function makeService(): PlatformAdminService {
    return new PlatformAdminService(
      logger as any,
      tenantRepo as any,
      userService as any,
      configManager as any,
      activityService as any
    );
  }

  describe('listTenants', () => {
    it('returns all tenants from the repository', async () => {
      const service = makeService();

      const result = await service.listTenants();

      expect(tenantRepo.findAll).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
      expect(result[0].slug).toBe('acme');
      expect(result[1].slug).toBe('beta');
    });

    it('supports filtering by status', async () => {
      const service = makeService();

      await service.listTenants({ status: 'active' });

      expect(tenantRepo.findAll).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('createTenant', () => {
    it('creates a tenant and returns it', async () => {
      const service = makeService();

      const result = await service.createTenant({
        slug: 'newcorp',
        display_name: 'New Corp',
      });

      expect(tenantRepo.create).toHaveBeenCalledWith({
        slug: 'newcorp',
        display_name: 'New Corp',
      });
      expect(result.slug).toBe('newcorp');
    });

    it('rejects reserved slug _ops', async () => {
      const service = makeService();

      await expect(
        service.createTenant({ slug: '_ops', display_name: 'Ops' })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects reserved slug _platforms', async () => {
      const service = makeService();

      await expect(
        service.createTenant({
          slug: '_platforms',
          display_name: 'Platforms',
        })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects reserved slug _system', async () => {
      const service = makeService();

      await expect(
        service.createTenant({ slug: '_system', display_name: 'System' })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects reserved slug admin', async () => {
      const service = makeService();

      await expect(
        service.createTenant({ slug: 'admin', display_name: 'Admin' })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects duplicate slug when tenant already exists', async () => {
      const service = makeService();

      await expect(
        service.createTenant({ slug: 'acme', display_name: 'Acme Again' })
      ).rejects.toThrow(/already exists/i);
    });

    it('stores a canonical custom domain', async () => {
      const service = makeService();

      await service.createTenant({
        slug: 'newcorp',
        display_name: 'New Corp',
        domain: ' Login.NewCorp.Example. ',
      });

      expect(tenantRepo.findByDomain).toHaveBeenCalledWith(
        'login.newcorp.example'
      );
      expect(tenantRepo.create).toHaveBeenCalledWith({
        slug: 'newcorp',
        display_name: 'New Corp',
        domain: 'login.newcorp.example',
      });
    });

    it('rejects a custom domain already owned by another tenant', async () => {
      const service = makeService();
      tenantRepo.findByDomain.mockResolvedValueOnce({
        _id: 'domain-owner',
        slug: 'domain-owner',
        display_name: 'Domain Owner',
        domain: 'login.example.test',
        status: 'active',
        created_at: new Date('2025-03-01'),
        updated_at: new Date('2025-03-01'),
      });

      await expect(
        service.createTenant({
          slug: 'newcorp',
          display_name: 'New Corp',
          domain: 'LOGIN.EXAMPLE.TEST',
        })
      ).rejects.toThrow(/domain.*already/i);
      expect(tenantRepo.create).not.toHaveBeenCalled();
    });

    it('logs activity on successful creation', async () => {
      const service = makeService();

      await service.createTenant({
        slug: 'newcorp',
        display_name: 'New Corp',
      });

      expect(activityService.success).toHaveBeenCalledWith(
        'platform_tenant_created',
        expect.any(String),
        null,
        expect.objectContaining({
          target: expect.objectContaining({
            target_type: 'system',
          }),
        })
      );
    });
  });

  describe('getTenantBySlug', () => {
    it('returns tenant when found', async () => {
      const service = makeService();

      const result = await service.getTenantBySlug('acme');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('acme');
    });

    it('returns null when tenant not found', async () => {
      const service = makeService();

      const result = await service.getTenantBySlug('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listTenantUsers', () => {
    it('returns paginated users for a tenant', async () => {
      const service = makeService();
      userService.findWithPagination.mockImplementation(async () => {
        expect(tenantContext.getTenantId()).toBe('acme');
        return {
          results: [
            { _id: 'u1', username: 'alice', email: 'alice@acme.com' },
            { _id: 'u2', username: 'bob', email: 'bob@acme.com' },
          ],
          page: 1,
          limit: 20,
          totalPages: 1,
          totalResults: 2,
        };
      });

      const result = await service.listTenantUsers('acme', {
        page: 1,
        limit: 20,
      });

      expect(result.results).toHaveLength(2);
      expect(result.totalResults).toBe(2);
      expect(userService.findWithPagination).toHaveBeenCalledWith(
        {},
        { page: 1, limit: 20 }
      );
    });

    it('throws when tenant does not exist', async () => {
      const service = makeService();

      await expect(
        service.listTenantUsers('nonexistent', { page: 1, limit: 20 })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('updateTenant', () => {
    it('rejects mutation of the protected platform master tenant', async () => {
      const service = makeService();

      await expect(
        service.updateTenant('_platforms', { display_name: 'Compromised' })
      ).rejects.toBeInstanceOf(ProtectedTenantError);
      expect(tenantRepo.update).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(activityService.info).not.toHaveBeenCalled();
    });

    it('uses the adapter-neutral id returned by Prisma repositories', async () => {
      const service = makeService();
      tenantRepo.findBySlug.mockResolvedValueOnce({
        id: 'prisma-t1',
        slug: 'acme',
        display_name: 'Acme Corp',
        status: 'active',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
      });

      await service.updateTenant('acme', { display_name: 'Acme Updated' });

      expect(tenantRepo.update).toHaveBeenCalledWith('prisma-t1', {
        display_name: 'Acme Updated',
      });
    });

    it('updates mutable tenant details and records the complete audit context', async () => {
      const service = makeService();
      const update = {
        display_name: 'Acme International',
        domain: 'login.acme.test',
      };

      const result = await service.updateTenant('acme', update);

      expect(tenantRepo.update).toHaveBeenCalledWith('t1', update);
      expect(result).toEqual({ _id: 't1', ...update });
      expect(logger.info).toHaveBeenCalledWith('platform_tenant_updated', {
        slug: 'acme',
        ...update,
      });
      expect(activityService.info).toHaveBeenCalledWith(
        'platform_tenant_updated',
        "Updated tenant 'acme'",
        null,
        {
          target: {
            target_type: 'system',
            entity_data: { slug: 'acme', ...update },
          },
        }
      );
    });

    it('canonicalizes a changed domain and rejects ownership by another tenant', async () => {
      const service = makeService();

      await service.updateTenant('acme', {
        domain: ' Login.Acme.Example. ',
      });
      expect(tenantRepo.findByDomain).toHaveBeenCalledWith(
        'login.acme.example'
      );
      expect(tenantRepo.update).toHaveBeenCalledWith('t1', {
        domain: 'login.acme.example',
      });

      tenantRepo.update.mockClear();
      tenantRepo.findByDomain.mockResolvedValueOnce({
        _id: 'other-id',
        slug: 'other',
        display_name: 'Other Tenant',
        domain: 'login.other.example',
        status: 'active',
        created_at: new Date('2025-03-01'),
        updated_at: new Date('2025-03-01'),
      });
      await expect(
        service.updateTenant('acme', { domain: 'login.other.example' })
      ).rejects.toThrow(/domain.*already/i);
      expect(tenantRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a missing tenant without writing or logging success', async () => {
      const service = makeService();

      await expect(
        service.updateTenant('missing', { display_name: 'Missing' })
      ).rejects.toThrow("Tenant 'missing' not found");
      expect(tenantRepo.update).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(activityService.info).not.toHaveBeenCalled();
    });
  });

  describe('updateTenantStatus', () => {
    it('rejects status changes for the protected platform master tenant', async () => {
      const service = makeService();

      await expect(
        service.updateTenantStatus('_platforms', 'suspended')
      ).rejects.toBeInstanceOf(ProtectedTenantError);
      expect(tenantRepo.update).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(activityService.warning).not.toHaveBeenCalled();
    });

    it('uses the adapter-neutral id returned by Prisma repositories', async () => {
      const service = makeService();
      tenantRepo.findBySlug.mockResolvedValueOnce({
        id: 'prisma-t1',
        slug: 'acme',
        display_name: 'Acme Corp',
        status: 'active',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
      });

      await service.updateTenantStatus('acme', 'suspended');

      expect(tenantRepo.update).toHaveBeenCalledWith('prisma-t1', {
        status: 'suspended',
      });
    });

    it('updates tenant status', async () => {
      const service = makeService();

      await service.updateTenantStatus('acme', 'suspended');

      const tenant = await tenantRepo.findBySlug('acme');
      expect(tenantRepo.update).toHaveBeenCalledWith(
        tenant!._id,
        expect.objectContaining({ status: 'suspended' })
      );
    });

    it('logs activity on status change', async () => {
      const service = makeService();

      await service.updateTenantStatus('acme', 'suspended');

      expect(activityService.warning).toHaveBeenCalledWith(
        'platform_tenant_status_changed',
        expect.any(String),
        null,
        expect.objectContaining({
          target: expect.objectContaining({
            target_type: 'system',
          }),
        })
      );
    });

    it('throws when tenant not found', async () => {
      const service = makeService();

      await expect(
        service.updateTenantStatus('nonexistent', 'suspended')
      ).rejects.toThrow(/not found/i);
    });
  });
});
