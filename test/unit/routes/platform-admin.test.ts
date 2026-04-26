import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

/**
 * Tests for Platform Admin Controller (HTML view handlers)
 *
 * Tests the PlatformAdminController which renders HTML views
 * for the _platforms admin portal tenant management UI.
 */

function makeMockPlatformAdminService() {
  return {
    listTenants: vi.fn(async () => [
      {
        _id: 't1',
        slug: 'acme',
        display_name: 'Acme Corp',
        status: 'active',
      },
      {
        _id: 't2',
        slug: 'beta',
        display_name: 'Beta Inc',
        status: 'suspended',
      },
    ]),
    createTenant: vi.fn(
      async (data: { slug: string; display_name: string }) => ({
        _id: 'new-id',
        ...data,
        status: 'active',
      })
    ),
    getTenantBySlug: vi.fn(async (slug: string) =>
      slug === 'acme'
        ? {
            _id: 't1',
            slug: 'acme',
            display_name: 'Acme Corp',
            status: 'active',
          }
        : null
    ),
    listTenantUsers: vi.fn(async () => ({
      results: [{ _id: 'u1', username: 'alice' }],
      page: 1,
      limit: 20,
      totalPages: 1,
      totalResults: 1,
    })),
    updateTenant: vi.fn(async (slug: string, data: Record<string, string>) => ({
      _id: 't1',
      slug,
      display_name: data.display_name || 'Acme Corp',
      domain: data.domain,
      status: 'active',
    })),
    updateTenantStatus: vi.fn(async (slug: string, status: string) => ({
      _id: 't1',
      slug,
      display_name: 'Acme Corp',
      status,
    })),
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/tenants',
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): Response & {
  _rendered: { view: string; data: any } | null;
  _status: number;
  _redirectUrl: string | null;
} {
  const res = {
    _rendered: null as { view: string; data: any } | null,
    _status: 200,
    _redirectUrl: null as string | null,
    status: vi.fn(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    render: vi.fn(function (this: any, view: string, data?: any) {
      this._rendered = { view, data };
      return this;
    }),
    redirect: vi.fn(function (this: any, url: string) {
      this._redirectUrl = url;
      return this;
    }),
    json: vi.fn(),
  };
  return res as unknown as Response & {
    _rendered: { view: string; data: any } | null;
    _status: number;
    _redirectUrl: string | null;
  };
}

describe('PlatformAdminController', () => {
  let service: ReturnType<typeof makeMockPlatformAdminService>;
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    service = makeMockPlatformAdminService();
    logger = makeMockLogger();
  });

  describe('listTenantsPage', () => {
    it('renders the tenant list view with stats', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({ query: {} });
      const res = makeMockRes();

      await controller.listTenantsPage(req, res);

      expect(service.listTenants).toHaveBeenCalledOnce();
      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/index',
        expect.objectContaining({
          title: 'Tenant Management',
          tenants: expect.any(Array),
          stats: expect.objectContaining({
            total: 2,
            active: 1,
            suspended: 1,
          }),
        })
      );
    });

    it('passes status filter when provided', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({ query: { status: 'active' } });
      const res = makeMockRes();

      await controller.listTenantsPage(req, res);

      expect(service.listTenants).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('showTenantPage', () => {
    it('renders tenant detail for existing slug', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({ params: { slug: 'acme' } });
      const res = makeMockRes();

      await controller.showTenantPage(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/show',
        expect.objectContaining({
          tenant: expect.objectContaining({ slug: 'acme' }),
          users: expect.objectContaining({ results: expect.any(Array) }),
        })
      );
    });

    it('renders 404 for nonexistent tenant', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({ params: { slug: 'nonexistent' } });
      const res = makeMockRes();

      await controller.showTenantPage(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: 'Tenant not found' })
      );
    });
  });

  describe('createTenantPage', () => {
    it('renders the create form', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq();
      const res = makeMockRes();

      await controller.createTenantPage(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({ title: 'New Tenant' })
      );
    });
  });

  describe('storeTenant', () => {
    it('creates a tenant and redirects to show page', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        body: { slug: 'newcorp', display_name: 'New Corp' },
      });
      const res = makeMockRes();

      await controller.storeTenant(req, res);

      expect(service.createTenant).toHaveBeenCalledWith({
        slug: 'newcorp',
        display_name: 'New Corp',
      });
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/newcorp');
    });

    it('re-renders form with error when slug is missing', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        body: { display_name: 'No Slug' },
      });
      const res = makeMockRes();

      await controller.storeTenant(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({ error: expect.any(String) })
      );
      expect(service.createTenant).not.toHaveBeenCalled();
    });

    it('re-renders form with error when slug has invalid format', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        body: { slug: 'INVALID SLUG!!!', display_name: 'Test' },
      });
      const res = makeMockRes();

      await controller.storeTenant(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({ error: expect.any(String) })
      );
      expect(service.createTenant).not.toHaveBeenCalled();
    });

    it('re-renders form with error when display_name is missing', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        body: { slug: 'newcorp' },
      });
      const res = makeMockRes();

      await controller.storeTenant(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('re-renders form with error on ConflictError', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const { ConflictError } =
        await import('../../../src/errors/platform.errors.js');

      service.createTenant.mockRejectedValueOnce(
        new ConflictError("Tenant 'acme' already exists")
      );

      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        body: { slug: 'acme', display_name: 'Acme' },
      });
      const res = makeMockRes();

      await controller.storeTenant(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({
          error: "Tenant 'acme' already exists",
        })
      );
    });

    it('re-renders form with error on ReservedSlugError', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const { ReservedSlugError } =
        await import('../../../src/errors/platform.errors.js');

      service.createTenant.mockRejectedValueOnce(
        new ReservedSlugError(
          "Slug 'admin' is reserved for system infrastructure"
        )
      );

      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        body: { slug: 'admin', display_name: 'Admin' },
      });
      const res = makeMockRes();

      await controller.storeTenant(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({
          error: "Slug 'admin' is reserved for system infrastructure",
        })
      );
    });
  });

  describe('editTenantPage', () => {
    it('renders the edit form for existing tenant', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({ params: { slug: 'acme' } });
      const res = makeMockRes();

      await controller.editTenantPage(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/edit',
        expect.objectContaining({
          tenant: expect.objectContaining({ slug: 'acme' }),
        })
      );
    });

    it('renders 404 for nonexistent tenant', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({ params: { slug: 'nonexistent' } });
      const res = makeMockRes();

      await controller.editTenantPage(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('updateTenant', () => {
    it('updates tenant and redirects to show page', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        params: { slug: 'acme' },
        body: { display_name: 'Acme Updated', domain: 'acme.com' },
      });
      const res = makeMockRes();

      await controller.updateTenant(req, res);

      expect(service.updateTenant).toHaveBeenCalledWith('acme', {
        display_name: 'Acme Updated',
        domain: 'acme.com',
      });
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
    });
  });

  describe('updateTenantStatus', () => {
    it('updates status and redirects to show page', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        params: { slug: 'acme' },
        body: { status: 'suspended' },
      });
      const res = makeMockRes();

      await controller.updateTenantStatus(req, res);

      expect(service.updateTenantStatus).toHaveBeenCalledWith(
        'acme',
        'suspended'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
    });

    it('redirects without updating for invalid status', async () => {
      const { PlatformAdminController } =
        await import('../../../src/controllers/admin/platform.controller.js');
      const controller = new PlatformAdminController(
        logger as any,
        service as any
      );

      const req = makeMockReq({
        method: 'POST',
        params: { slug: 'acme' },
        body: { status: 'invalid_status' },
      });
      const res = makeMockRes();

      await controller.updateTenantStatus(req, res);

      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
      expect(service.updateTenantStatus).not.toHaveBeenCalled();
    });
  });
});
