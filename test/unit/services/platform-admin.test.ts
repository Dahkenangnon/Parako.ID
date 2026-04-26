import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function makeMockTenantRepo() {
  const tenants = [
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

  describe('listTenants', () => {
    it('returns all tenants from the repository', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      const result = await service.listTenants();

      expect(tenantRepo.findAll).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
      expect(result[0].slug).toBe('acme');
      expect(result[1].slug).toBe('beta');
    });

    it('supports filtering by status', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await service.listTenants({ status: 'active' });

      expect(tenantRepo.findAll).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('createTenant', () => {
    it('creates a tenant and returns it', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

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
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.createTenant({ slug: '_ops', display_name: 'Ops' })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects reserved slug _platforms', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.createTenant({
          slug: '_platforms',
          display_name: 'Platforms',
        })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects reserved slug _system', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.createTenant({ slug: '_system', display_name: 'System' })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects reserved slug admin', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.createTenant({ slug: 'admin', display_name: 'Admin' })
      ).rejects.toThrow(/reserved/i);
    });

    it('rejects duplicate slug when tenant already exists', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.createTenant({ slug: 'acme', display_name: 'Acme Again' })
      ).rejects.toThrow(/already exists/i);
    });

    it('logs activity on successful creation', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

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
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      const result = await service.getTenantBySlug('acme');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('acme');
    });

    it('returns null when tenant not found', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      const result = await service.getTenantBySlug('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listTenantUsers', () => {
    it('returns paginated users for a tenant', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      const result = await service.listTenantUsers('acme', {
        page: 1,
        limit: 20,
      });

      expect(result.results).toHaveLength(2);
      expect(result.totalResults).toBe(2);
    });

    it('throws when tenant does not exist', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.listTenantUsers('nonexistent', { page: 1, limit: 20 })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('updateTenantStatus', () => {
    it('updates tenant status', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await service.updateTenantStatus('acme', 'suspended');

      const tenant = await tenantRepo.findBySlug('acme');
      expect(tenantRepo.update).toHaveBeenCalledWith(
        tenant!._id,
        expect.objectContaining({ status: 'suspended' })
      );
    });

    it('logs activity on status change', async () => {
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

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
      const { PlatformAdminService } =
        await import('../../../src/services/platform-admin.service.js');
      const service = new PlatformAdminService(
        logger as any,
        tenantRepo as any,
        userService as any,
        configManager as any,
        activityService as any
      );

      await expect(
        service.updateTenantStatus('nonexistent', 'suspended')
      ).rejects.toThrow(/not found/i);
    });
  });
});
