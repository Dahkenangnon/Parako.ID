/**
 * TDD — PlatformAdminController
 *
 * Covers tenant list/show/create/edit/status HTML behavior, input boundaries,
 * pagination, typed domain errors, and dependency failures.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { PlatformAdminController } from '../../../../src/controllers/admin/platform.controller.js';
import {
  ConflictError,
  NotFoundError,
  ReservedSlugError,
} from '../../../../src/errors/platform.errors.js';

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'tenant-1',
    slug: 'acme',
    display_name: 'Acme Corporation',
    domain: 'acme.example.com',
    status: 'active',
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as any;
}

function makeMocks() {
  return {
    logger: { error: vi.fn() },
    platformService: {
      listTenants: vi.fn().mockResolvedValue([]),
      createTenant: vi.fn().mockResolvedValue(tenant()),
      getTenantBySlug: vi.fn().mockResolvedValue(tenant()),
      listTenantUsers: vi.fn().mockResolvedValue({
        results: [],
        page: 1,
        limit: 20,
        totalPages: 0,
        totalResults: 0,
      }),
      updateTenant: vi.fn().mockResolvedValue(tenant()),
      updateTenantStatus: vi.fn().mockResolvedValue(tenant()),
    },
  };
}

function makeController(mocks = makeMocks()) {
  return {
    controller: new PlatformAdminController(
      mocks.logger as any,
      mocks.platformService as any
    ),
    ...mocks,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res = {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
  } as any;
  res.status.mockReturnValue(res);
  return res;
}

describe('PlatformAdminController', () => {
  describe('listTenantsPage()', () => {
    it('filters valid statuses and renders status aggregates', async () => {
      const mocks = makeMocks();
      const allTenants = [
        tenant(),
        tenant({ slug: 'active-2' }),
        tenant({ slug: 'suspended', status: 'suspended' }),
        tenant({ slug: 'archived', status: 'archived' }),
      ];
      mocks.platformService.listTenants.mockImplementation(async filter =>
        filter
          ? allTenants.filter(candidate => candidate.status === filter.status)
          : allTenants
      );
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.listTenantsPage(
        makeReq({ query: { status: 'active' } }),
        res
      );

      expect(mocks.platformService.listTenants).toHaveBeenNthCalledWith(1, {
        status: 'active',
      });
      expect(mocks.platformService.listTenants).toHaveBeenNthCalledWith(
        2,
        undefined
      );
      expect(res.render).toHaveBeenCalledWith('admin/tenants/index', {
        title: 'Tenant Management',
        tenants: [
          expect.objectContaining({ slug: 'acme' }),
          expect.objectContaining({ slug: 'active-2' }),
        ],
        stats: { total: 4, active: 2, suspended: 1, archived: 1 },
        filters: { status: 'active' },
      });
    });

    it.each([undefined, 'unknown', ['active']])(
      'ignores unsupported status query %j',
      async status => {
        const { controller, platformService } = makeController();
        const res = makeRes();

        await controller.listTenantsPage(makeReq({ query: { status } }), res);

        expect(platformService.listTenants).toHaveBeenCalledWith(undefined);
        expect(res.render).toHaveBeenCalledWith(
          'admin/tenants/index',
          expect.objectContaining({ filters: { status: '' } })
        );
      }
    );

    it('renders a safe error page when listing fails', async () => {
      const failure = new Error('storage unavailable');
      const mocks = makeMocks();
      mocks.platformService.listTenants.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.listTenantsPage(makeReq(), res);

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'platform_list_tenants_page',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Failed to load tenants',
      });
    });
  });

  describe('showTenantPage()', () => {
    it('renders a tenant and bounded user pagination', async () => {
      const { controller, platformService } = makeController();
      const res = makeRes();

      await controller.showTenantPage(
        makeReq({
          params: { slug: 'acme' },
          query: { page: '2', limit: '1000' },
        }),
        res
      );

      expect(platformService.listTenantUsers).toHaveBeenCalledWith('acme', {
        page: 2,
        limit: 100,
      });
      expect(res.render).toHaveBeenCalledWith('admin/tenants/show', {
        title: 'Tenant: Acme Corporation',
        tenant: expect.objectContaining({ slug: 'acme' }),
        users: expect.objectContaining({ results: [] }),
      });
    });

    it('renders 404 without querying users when the tenant is absent', async () => {
      const mocks = makeMocks();
      mocks.platformService.getTenantBySlug.mockResolvedValue(null);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.showTenantPage(
        makeReq({ params: { slug: 'missing' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Tenant not found',
      });
      expect(mocks.platformService.listTenantUsers).not.toHaveBeenCalled();
    });

    it('renders 500 when loading the tenant fails', async () => {
      const failure = new Error('read failed');
      const mocks = makeMocks();
      mocks.platformService.getTenantBySlug.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.showTenantPage(
        makeReq({ params: { slug: 'acme' } }),
        res
      );

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'platform_show_tenant_page',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Failed to load tenant',
      });
    });
  });

  it('renders the create form', async () => {
    const { controller } = makeController();
    const res = makeRes();

    await controller.createTenantPage(makeReq(), res);

    expect(res.render).toHaveBeenCalledWith('admin/tenants/create', {
      title: 'New Tenant',
    });
  });

  describe('storeTenant()', () => {
    it.each([
      [{ display_name: 'Acme' }, 'Slug is required'],
      [{ slug: 42, display_name: 'Acme' }, 'Slug is required'],
      [{ slug: 'acme' }, 'Display name is required'],
      [{ slug: 'acme', display_name: 42 }, 'Display name is required'],
      [{ slug: '---', display_name: 'Acme' }, 'Invalid slug format.'],
      [{ slug: 'acme', display_name: '   ' }, 'Display name is required'],
    ])('rejects invalid create input %#', async (body, errorPrefix) => {
      const { controller, platformService } = makeController();
      const res = makeRes();

      await controller.storeTenant(makeReq({ body }), res);

      expect(platformService.createTenant).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith(
        'admin/tenants/create',
        expect.objectContaining({
          title: 'New Tenant',
          error: expect.stringContaining(errorPrefix),
          formData: body,
        })
      );
    });

    it.each([
      [undefined, undefined],
      ['   ', undefined],
      [42, undefined],
      [' tenant.example.com ', 'tenant.example.com'],
    ])('normalizes a valid tenant with domain %j', async (domain, expected) => {
      const { controller, platformService } = makeController();
      const res = makeRes();
      const body = {
        slug: ' Acme_Tenant ',
        display_name: ' Acme Corporation ',
        domain,
      };

      await controller.storeTenant(makeReq({ body }), res);

      expect(platformService.createTenant).toHaveBeenCalledWith({
        slug: 'acme_tenant',
        display_name: 'Acme Corporation',
        ...(expected ? { domain: expected } : {}),
      });
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
    });

    it.each([
      new ConflictError('Tenant already exists'),
      new ReservedSlugError('Slug is reserved'),
    ])('renders domain conflict errors without logging', async failure => {
      const mocks = makeMocks();
      mocks.platformService.createTenant.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();
      const body = { slug: 'acme', display_name: 'Acme' };

      await controller.storeTenant(makeReq({ body }), res);

      expect(res.render).toHaveBeenCalledWith('admin/tenants/create', {
        title: 'New Tenant',
        error: failure.message,
        formData: body,
      });
      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('logs and renders a generic create failure', async () => {
      const failure = new Error('write failed');
      const mocks = makeMocks();
      mocks.platformService.createTenant.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();
      const body = { slug: 'acme', display_name: 'Acme' };

      await controller.storeTenant(makeReq({ body }), res);

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'platform_store_tenant',
      });
      expect(res.render).toHaveBeenCalledWith('admin/tenants/create', {
        title: 'New Tenant',
        error: 'Failed to create tenant',
        formData: body,
      });
    });
  });

  describe('editTenantPage()', () => {
    it('renders the tenant edit form', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.editTenantPage(
        makeReq({ params: { slug: 'acme' } }),
        res
      );

      expect(res.render).toHaveBeenCalledWith('admin/tenants/edit', {
        title: 'Edit Tenant: Acme Corporation',
        tenant: expect.objectContaining({ slug: 'acme' }),
      });
    });

    it('renders 404 when the tenant is absent', async () => {
      const mocks = makeMocks();
      mocks.platformService.getTenantBySlug.mockResolvedValue(null);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.editTenantPage(
        makeReq({ params: { slug: 'missing' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Tenant not found',
      });
    });

    it('renders 500 when loading the edit form fails', async () => {
      const failure = new Error('read failed');
      const mocks = makeMocks();
      mocks.platformService.getTenantBySlug.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.editTenantPage(
        makeReq({ params: { slug: 'acme' } }),
        res
      );

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'platform_edit_tenant_page',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Failed to load tenant',
      });
    });
  });

  describe('updateTenant()', () => {
    it('does not erase the display name when the submitted value is whitespace', async () => {
      const { controller, platformService } = makeController();
      const res = makeRes();

      await controller.updateTenant(
        makeReq({
          params: { slug: 'acme' },
          body: {
            display_name: '   ',
            domain: ' tenant.example.com ',
          },
        }),
        res
      );

      expect(platformService.updateTenant).toHaveBeenCalledWith('acme', {
        domain: 'tenant.example.com',
      });
    });

    it.each([
      [
        { display_name: ' Updated ', domain: ' new.example.com ' },
        { display_name: 'Updated', domain: 'new.example.com' },
      ],
      [{ display_name: '', domain: '' }, { domain: null }],
      [{ display_name: 42, domain: 42 }, {}],
    ])('normalizes update data %#', async (body, expected) => {
      const { controller, platformService } = makeController();
      const res = makeRes();

      await controller.updateTenant(
        makeReq({ params: { slug: 'acme' }, body }),
        res
      );

      expect(platformService.updateTenant).toHaveBeenCalledWith(
        'acme',
        expected
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
    });

    it('renders 404 for a missing tenant', async () => {
      const mocks = makeMocks();
      mocks.platformService.updateTenant.mockRejectedValue(
        new NotFoundError('missing')
      );
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.updateTenant(
        makeReq({ params: { slug: 'missing' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Tenant not found',
      });
    });

    it('re-renders the tenant after a generic update failure', async () => {
      const failure = new Error('write failed');
      const mocks = makeMocks();
      mocks.platformService.updateTenant.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.updateTenant(makeReq({ params: { slug: 'acme' } }), res);

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'platform_update_tenant',
      });
      expect(res.render).toHaveBeenCalledWith('admin/tenants/edit', {
        title: 'Edit Tenant: acme',
        tenant: expect.objectContaining({ slug: 'acme' }),
        error: 'Failed to update tenant',
      });
    });

    it('renders a stable error when rebuilding the failed form also fails', async () => {
      const updateFailure = new Error('write failed');
      const reloadFailure = new Error('read failed');
      const mocks = makeMocks();
      mocks.platformService.updateTenant.mockRejectedValue(updateFailure);
      mocks.platformService.getTenantBySlug.mockRejectedValue(reloadFailure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await expect(
        controller.updateTenant(makeReq({ params: { slug: 'acme' } }), res)
      ).resolves.toBeUndefined();

      expect(mocks.logger.error).toHaveBeenCalledWith(reloadFailure, {
        context: 'platform_update_tenant_reload_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Failed to load tenant',
      });
    });
  });

  describe('updateTenantStatus()', () => {
    it.each([undefined, 'unknown', ['active']])(
      'redirects without mutation for invalid status %j',
      async status => {
        const { controller, platformService } = makeController();
        const res = makeRes();

        await controller.updateTenantStatus(
          makeReq({ params: { slug: 'acme' }, body: { status } }),
          res
        );

        expect(platformService.updateTenantStatus).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
      }
    );

    it('updates a valid tenant status', async () => {
      const { controller, platformService } = makeController();
      const res = makeRes();

      await controller.updateTenantStatus(
        makeReq({
          params: { slug: 'acme' },
          body: { status: 'suspended' },
        }),
        res
      );

      expect(platformService.updateTenantStatus).toHaveBeenCalledWith(
        'acme',
        'suspended'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
    });

    it('renders 404 for a missing tenant', async () => {
      const mocks = makeMocks();
      mocks.platformService.updateTenantStatus.mockRejectedValue(
        new NotFoundError('missing')
      );
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.updateTenantStatus(
        makeReq({ params: { slug: 'missing' }, body: { status: 'active' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render).toHaveBeenCalledWith('error', {
        message: 'Tenant not found',
      });
    });

    it('logs generic failures and returns to the tenant page', async () => {
      const failure = new Error('status write failed');
      const mocks = makeMocks();
      mocks.platformService.updateTenantStatus.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.updateTenantStatus(
        makeReq({ params: { slug: 'acme' }, body: { status: 'archived' } }),
        res
      );

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'platform_update_tenant_status',
      });
      expect(res.redirect).toHaveBeenCalledWith('/admin/tenants/acme');
    });
  });
});
