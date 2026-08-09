import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { TenantsController } from '../../../../../src/api/v1/controllers/tenants.controller.js';
import type { TenantsControllerDeps } from '../../../../../src/api/v1/controllers/tenants.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';
import { ConflictError as PlatformConflictError } from '../../../../../src/errors/platform.errors.js';
import type { ITenantSettingsOverride } from '../../../../../src/types/tenant-settings-override.js';

// Helpers

function createMockDeps(
  overrides?: Partial<TenantsControllerDeps>
): TenantsControllerDeps {
  return {
    platformAdminService: {
      listTenants: vi.fn().mockResolvedValue([]),
      createTenant: vi.fn().mockResolvedValue({}),
      getTenantBySlug: vi.fn().mockResolvedValue(null),
    },
    tenantSettingsOverrideService: {
      loadOverrides: vi.fn().mockResolvedValue({}),
      saveOverrides: vi.fn().mockResolvedValue({}),
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    ...overrides,
  };
}

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    path: '/api/v1/tenants',
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// Sample data

const sampleTenant = {
  _id: '507f1f77bcf86cd799439011',
  slug: 'acme-corp',
  display_name: 'Acme Corporation',
  domain: 'acme.example.com',
  status: 'active',
};

const sampleTenant2 = {
  _id: '507f1f77bcf86cd799439012',
  slug: 'globex-inc',
  display_name: 'Globex Inc.',
  domain: 'globex.example.com',
  status: 'active',
};

function savedTenantOverride(
  overrides: Partial<ITenantSettingsOverride> = {}
): ITenantSettingsOverride {
  return {
    tenant_id: sampleTenant._id,
    key: 'parako_config',
    version: '1.0.0',
    _version: 1,
    is_active: true,
    ...overrides,
  };
}

// Tests

describe('api/v1/controllers/TenantsController', () => {
  let deps: TenantsControllerDeps;
  let controller: TenantsController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new TenantsController(deps);
  });

  // list
  describe('list()', () => {
    it('should return a paginated list of tenants', async () => {
      const tenants = [{ ...sampleTenant }, { ...sampleTenant2 }];
      vi.mocked(deps.platformAdminService.listTenants).mockResolvedValue(
        tenants
      );

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.platformAdminService.listTenants).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
      expect(jsonCall.pagination).toBeDefined();
      expect(jsonCall.pagination.has_more).toBe(false);
    });

    it('should filter by status when query param is provided', async () => {
      vi.mocked(deps.platformAdminService.listTenants).mockResolvedValue([]);

      const req = createMockRequest({ query: { status: 'active' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.platformAdminService.listTenants).toHaveBeenCalledWith({
        status: 'active',
      });
    });

    it('should pass undefined filter when no status is provided', async () => {
      vi.mocked(deps.platformAdminService.listTenants).mockResolvedValue([]);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.platformAdminService.listTenants).toHaveBeenCalledWith(
        undefined
      );
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('DB connection lost');
      vi.mocked(deps.platformAdminService.listTenants).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // create
  describe('create()', () => {
    it('should validate and create a tenant, returning 201', async () => {
      const created = { ...sampleTenant };
      vi.mocked(deps.platformAdminService.createTenant).mockResolvedValue(
        created
      );

      const req = createMockRequest({
        body: {
          slug: 'acme-corp',
          display_name: 'Acme Corporation',
          domain: 'acme.example.com',
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(deps.platformAdminService.createTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'acme-corp',
          display_name: 'Acme Corporation',
          domain: 'acme.example.com',
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.slug).toBe('acme-corp');
    });

    it('should log tenant creation', async () => {
      const created = { ...sampleTenant };
      vi.mocked(deps.platformAdminService.createTenant).mockResolvedValue(
        created
      );

      const req = createMockRequest({
        body: { slug: 'acme-corp', display_name: 'Acme Corporation' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Tenant created',
        expect.objectContaining({ slug: 'acme-corp' })
      );
    });

    it.each([
      ['MongoDB', 11000],
      ['Prisma', 'P2002'],
      ['PostgreSQL', '23505'],
      ['SQLite UNIQUE', 'SQLITE_CONSTRAINT_UNIQUE'],
      ['SQLite PRIMARY KEY', 'SQLITE_CONSTRAINT_PRIMARYKEY'],
    ])(
      'converts %s uniqueness code to 409 conflict',
      async (_adapter, code) => {
        vi.mocked(deps.platformAdminService.createTenant).mockRejectedValue(
          Object.assign(new Error('persistence conflict'), { code })
        );

        const req = createMockRequest({
          body: { slug: 'acme-corp', display_name: 'Acme Corporation' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await controller.create(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(ApiError));
        const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
        expect(error.status).toBe(409);
        expect(error.detail).toContain('acme-corp');
      }
    );

    it('converts the platform domain conflict to 409', async () => {
      vi.mocked(deps.platformAdminService.createTenant).mockRejectedValue(
        new PlatformConflictError('Tenant already exists')
      );

      const req = createMockRequest({
        body: { slug: 'acme-corp', display_name: 'Acme Corporation' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(409);
    });

    it('does not misclassify an unrelated message containing duplicate', async () => {
      const failure = new Error('duplicate audit delivery failed');
      vi.mocked(deps.platformAdminService.createTenant).mockRejectedValue(
        failure
      );

      const next = createMockNext();
      await controller.create(
        createMockRequest({
          body: { slug: 'acme-corp', display_name: 'Acme Corporation' },
        }),
        createMockResponse(),
        next
      );

      expect(next).toHaveBeenCalledWith(failure);
    });

    it('should propagate unexpected service errors via next()', async () => {
      const error = new Error('Unexpected internal error');
      vi.mocked(deps.platformAdminService.createTenant).mockRejectedValue(
        error
      );

      const req = createMockRequest({
        body: { slug: 'acme-corp', display_name: 'Acme Corporation' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // get
  describe('get()', () => {
    it('should return a tenant by slug', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        ...sampleTenant,
      });

      const req = createMockRequest({ params: { slug: 'acme-corp' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(deps.platformAdminService.getTenantBySlug).toHaveBeenCalledWith(
        'acme-corp'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.slug).toBe('acme-corp');
      expect(jsonCall.data.display_name).toBe('Acme Corporation');
    });

    it('should call next with 404 tenant-not-found when tenant does not exist', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue(
        null
      );

      const req = createMockRequest({ params: { slug: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.type).toBe('urn:parako:error:tenant-not-found');
      expect(error.detail).toContain('nonexistent');
    });
  });

  // getConfig
  describe('getConfig()', () => {
    it('should return configuration overrides for a tenant', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        ...sampleTenant,
      });

      const overrides = {
        branding: { logo: 'https://example.com/logo.png' },
      };
      vi.mocked(
        deps.tenantSettingsOverrideService!.loadOverrides
      ).mockResolvedValue(overrides);

      const req = createMockRequest({ params: { slug: 'acme-corp' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.getConfig(req, res, next);

      expect(
        deps.tenantSettingsOverrideService!.loadOverrides
      ).toHaveBeenCalledWith(sampleTenant._id);
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual(overrides);
    });

    it('should return empty config when override service is not available', async () => {
      const depsWithoutOverrides = createMockDeps({
        tenantSettingsOverrideService: undefined,
      });
      const ctrl = new TenantsController(depsWithoutOverrides);

      vi.mocked(
        depsWithoutOverrides.platformAdminService.getTenantBySlug
      ).mockResolvedValue({
        ...sampleTenant,
      });

      const req = createMockRequest({ params: { slug: 'acme-corp' } });
      const res = createMockResponse();
      const next = createMockNext();

      await ctrl.getConfig(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual({});
    });

    it('should call next with 404 when tenant is not found', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue(
        null
      );

      const req = createMockRequest({ params: { slug: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.getConfig(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.type).toBe('urn:parako:error:tenant-not-found');
    });

    it('should use tenant.id when _id is not present', async () => {
      const tenantWithId = {
        id: 'uuid-123',
        slug: 'acme-corp',
        display_name: 'Acme',
      };
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue(
        tenantWithId
      );

      const req = createMockRequest({ params: { slug: 'acme-corp' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.getConfig(req, res, next);

      expect(
        deps.tenantSettingsOverrideService!.loadOverrides
      ).toHaveBeenCalledWith('uuid-123');
    });

    it('should fall back to the tenant slug when no database ID is exposed', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        slug: 'acme-corp',
        display_name: 'Acme',
      });

      const req = createMockRequest({ params: { slug: 'acme-corp' } });

      await controller.getConfig(req, createMockResponse(), createMockNext());

      expect(
        deps.tenantSettingsOverrideService!.loadOverrides
      ).toHaveBeenCalledWith('acme-corp');
    });
  });

  // updateConfig
  describe('updateConfig()', () => {
    it('should validate and save configuration for a section', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        ...sampleTenant,
      });

      const updatedConfig = savedTenantOverride({
        branding: { companyName: 'Acme' },
      });
      vi.mocked(
        deps.tenantSettingsOverrideService!.saveOverrides
      ).mockResolvedValue(updatedConfig);

      const req = createMockRequest({
        params: { slug: 'acme-corp', section: 'branding' },
        body: { companyName: 'Acme' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.updateConfig(req, res, next);

      expect(
        deps.tenantSettingsOverrideService!.saveOverrides
      ).toHaveBeenCalledWith(sampleTenant._id, {
        branding: { companyName: 'Acme' },
      });
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual(updatedConfig);
    });

    it('should log config update with slug and section', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        ...sampleTenant,
      });
      vi.mocked(
        deps.tenantSettingsOverrideService!.saveOverrides
      ).mockResolvedValue(savedTenantOverride());

      const req = createMockRequest({
        params: { slug: 'acme-corp', section: 'branding' },
        body: { theme: 'dark' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.updateConfig(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Tenant config updated',
        expect.objectContaining({ slug: 'acme-corp', section: 'branding' })
      );
    });

    it('should reject an unknown section before saving overrides', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        ...sampleTenant,
      });
      const next = createMockNext();

      await controller.updateConfig(
        createMockRequest({
          params: { slug: 'acme-corp', section: 'database' },
          body: { url: 'sqlite:///tmp/other.db' },
        }),
        createMockResponse(),
        next
      );

      expect(
        deps.tenantSettingsOverrideService!.saveOverrides
      ).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(400);
      expect(error.type).toBe('urn:parako:error:section-not-allowed');
    });

    it('should fall back to the tenant slug when saving without a database ID', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        slug: 'acme-corp',
        display_name: 'Acme',
      });

      await controller.updateConfig(
        createMockRequest({
          params: { slug: 'acme-corp', section: 'branding' },
          body: { theme: 'dark' },
        }),
        createMockResponse(),
        createMockNext()
      );

      expect(
        deps.tenantSettingsOverrideService!.saveOverrides
      ).toHaveBeenCalledWith('acme-corp', {
        branding: { theme: 'dark' },
      });
    });

    it('should call next with 404 when tenant is not found', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue(
        null
      );

      const req = createMockRequest({
        params: { slug: 'nonexistent', section: 'branding' },
        body: { theme: 'dark' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.updateConfig(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.type).toBe('urn:parako:error:tenant-not-found');
    });

    it('should call next with 500 when override service is not available', async () => {
      const depsWithoutOverrides = createMockDeps({
        tenantSettingsOverrideService: undefined,
      });
      const ctrl = new TenantsController(depsWithoutOverrides);

      vi.mocked(
        depsWithoutOverrides.platformAdminService.getTenantBySlug
      ).mockResolvedValue({
        ...sampleTenant,
      });

      const req = createMockRequest({
        params: { slug: 'acme-corp', section: 'branding' },
        body: { theme: 'dark' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await ctrl.updateConfig(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(500);
      expect(error.type).toBe('urn:parako:error:internal');
      expect(error.detail).toContain('not available');
    });

    it('should call next(error) when saveOverrides fails', async () => {
      vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue({
        ...sampleTenant,
      });

      const error = new Error('Database write failed');
      vi.mocked(
        deps.tenantSettingsOverrideService!.saveOverrides
      ).mockRejectedValue(error);

      const req = createMockRequest({
        params: { slug: 'acme-corp', section: 'branding' },
        body: { theme: 'dark' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.updateConfig(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // DB abstraction
  describe('DB abstraction', () => {
    describe('getConfig — tenant ID resolution', () => {
      it('should prefer tenant.id over tenant._id', async () => {
        const tenant = { id: 'prisma-id', _id: 'mongo-id', slug: 'test' };
        vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue(
          tenant
        );
        const req = createMockRequest({ params: { slug: 'test' } });
        const res = createMockResponse();
        await controller.getConfig(req, res, createMockNext());
        if (deps.tenantSettingsOverrideService) {
          expect(
            deps.tenantSettingsOverrideService.loadOverrides
          ).toHaveBeenCalledWith('prisma-id');
        }
      });

      it('should fall back to tenant._id when id is absent (MongoDB)', async () => {
        const tenant = { _id: 'mongo-id', slug: 'test' };
        vi.mocked(deps.platformAdminService.getTenantBySlug).mockResolvedValue(
          tenant
        );
        const req = createMockRequest({ params: { slug: 'test' } });
        const res = createMockResponse();
        await controller.getConfig(req, res, createMockNext());
        if (deps.tenantSettingsOverrideService) {
          expect(
            deps.tenantSettingsOverrideService.loadOverrides
          ).toHaveBeenCalledWith('mongo-id');
        }
      });
    });
  });
});
