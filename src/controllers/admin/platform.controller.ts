/**
 * Platform Admin Controller
 *
 * HTML view handlers for the `_platforms` admin portal.
 * JSON API is handled by src/api/v1/controllers/tenants.controller.ts.
 */

import { injectable, inject } from 'inversify';
import type { Request, Response } from 'express';
import { TYPES } from '../../di/types.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import {
  isProtectedTenantSlug,
  type IPlatformAdminService,
} from '../../services/platform-admin.service.js';
import { TenantStatusValues, type TenantStatus } from '../../types/tenant.js';
import {
  ConflictError,
  ReservedSlugError,
  NotFoundError,
  ProtectedTenantError,
} from '../../errors/platform.errors.js';
import { parsePositiveInt } from '../../validators/listing-query.js';
import { InvalidTenantDomainError } from '../../multi-tenancy/tenant-domain.js';

/** Slug format: lowercase alphanumeric, hyphens, underscores, 1-63 chars. */
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Maximum page size for paginated queries. */
const MAX_PAGE_LIMIT = 100;

function renderProtectedTenantError(res: Response): void {
  res.status(403).render('error/403', {
    title: 'Access Denied',
    errorDetails: 'The platform master tenant cannot be modified',
  });
}

@injectable()
export class PlatformAdminController {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.PlatformAdminService)
    private readonly platformService: IPlatformAdminService
  ) {}

  /* ------------------------------------------------------------------ */
  /*  LIST                                                               */
  /* ------------------------------------------------------------------ */

  public listTenantsPage = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const rawStatus = req.query.status;
      const status: TenantStatus | undefined =
        typeof rawStatus === 'string' &&
        (TenantStatusValues as string[]).includes(rawStatus)
          ? (rawStatus as TenantStatus)
          : undefined;
      const filter = status ? { status } : undefined;
      const tenantsPromise = this.platformService.listTenants(filter);
      const allTenantsPromise = filter
        ? this.platformService.listTenants(undefined)
        : tenantsPromise;
      const [tenants, allTenants] = await Promise.all([
        tenantsPromise,
        allTenantsPromise,
      ]);

      const stats = {
        total: allTenants.length,
        active: allTenants.filter(t => t.status === 'active').length,
        suspended: allTenants.filter(t => t.status === 'suspended').length,
        archived: allTenants.filter(t => t.status === 'archived').length,
      };

      res.render('admin/tenants/index', {
        title: 'Tenant Management',
        tenants,
        stats,
        filters: { status: status || '' },
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'platform_list_tenants_page',
      });
      res.status(500).render('error', { message: 'Failed to load tenants' });
    }
  };

  /* ------------------------------------------------------------------ */
  /*  SHOW                                                               */
  /* ------------------------------------------------------------------ */

  public showTenantPage = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { slug } = req.params;
      const tenant = await this.platformService.getTenantBySlug(slug);

      if (!tenant) {
        res.status(404).render('error', { message: 'Tenant not found' });
        return;
      }

      const page = parsePositiveInt(req.query.page, {
        default: 1,
        min: 1,
        max: 10_000,
      });
      const limit = parsePositiveInt(req.query.limit, {
        default: 20,
        min: 1,
        max: MAX_PAGE_LIMIT,
      });

      const users = await this.platformService.listTenantUsers(slug, {
        page,
        limit,
      });

      res.render('admin/tenants/show', {
        title: `Tenant: ${tenant.display_name}`,
        tenant,
        users,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'platform_show_tenant_page',
      });
      res.status(500).render('error', { message: 'Failed to load tenant' });
    }
  };

  /* ------------------------------------------------------------------ */
  /*  CREATE (form + action)                                             */
  /* ------------------------------------------------------------------ */

  public createTenantPage = async (
    _req: Request,
    res: Response
  ): Promise<void> => {
    res.render('admin/tenants/create', {
      title: 'New Tenant',
    });
  };

  public storeTenant = async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug, display_name, domain } = req.body;

      if (!slug || typeof slug !== 'string') {
        res.render('admin/tenants/create', {
          title: 'New Tenant',
          error: 'Slug is required',
          formData: req.body,
        });
        return;
      }

      if (!display_name || typeof display_name !== 'string') {
        res.render('admin/tenants/create', {
          title: 'New Tenant',
          error: 'Display name is required',
          formData: req.body,
        });
        return;
      }

      const normalizedDisplayName = display_name.trim();
      if (!normalizedDisplayName) {
        res.render('admin/tenants/create', {
          title: 'New Tenant',
          error: 'Display name is required',
          formData: req.body,
        });
        return;
      }

      const normalizedSlug = slug.trim().toLowerCase();
      if (!TENANT_SLUG_PATTERN.test(normalizedSlug)) {
        res.render('admin/tenants/create', {
          title: 'New Tenant',
          error:
            'Invalid slug format. Must be 1-63 lowercase alphanumeric characters, hyphens, or underscores.',
          formData: req.body,
        });
        return;
      }

      const data: { slug: string; display_name: string; domain?: string } = {
        slug: normalizedSlug,
        display_name: normalizedDisplayName,
      };
      if (domain && typeof domain === 'string' && domain.trim()) {
        data.domain = domain.trim();
      }

      const tenant = await this.platformService.createTenant(data);
      res.redirect(`/admin/tenants/${tenant.slug}`);
    } catch (error) {
      if (
        error instanceof ConflictError ||
        error instanceof ReservedSlugError ||
        error instanceof InvalidTenantDomainError
      ) {
        res.render('admin/tenants/create', {
          title: 'New Tenant',
          error: (error as Error).message,
          formData: req.body,
        });
        return;
      }

      this.logger.error(error as Error, {
        context: 'platform_store_tenant',
      });
      res.render('admin/tenants/create', {
        title: 'New Tenant',
        error: 'Failed to create tenant',
        formData: req.body,
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /*  EDIT (form + action)                                               */
  /* ------------------------------------------------------------------ */

  public editTenantPage = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { slug } = req.params;
      if (isProtectedTenantSlug(slug)) {
        renderProtectedTenantError(res);
        return;
      }
      const tenant = await this.platformService.getTenantBySlug(slug);

      if (!tenant) {
        res.status(404).render('error', { message: 'Tenant not found' });
        return;
      }

      res.render('admin/tenants/edit', {
        title: `Edit Tenant: ${tenant.display_name}`,
        tenant,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'platform_edit_tenant_page',
      });
      res.status(500).render('error', { message: 'Failed to load tenant' });
    }
  };

  public updateTenant = async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug } = req.params;
      const { display_name, domain } = req.body;

      const data: { display_name?: string; domain?: string | null } = {};
      if (typeof display_name === 'string') {
        const normalizedDisplayName = display_name.trim();
        if (normalizedDisplayName) {
          data.display_name = normalizedDisplayName;
        }
      }
      if (typeof domain === 'string') {
        data.domain = domain.trim() || null;
      }

      await this.platformService.updateTenant(slug, data);
      res.redirect(`/admin/tenants/${slug}`);
    } catch (error) {
      if (error instanceof ProtectedTenantError) {
        renderProtectedTenantError(res);
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).render('error', { message: 'Tenant not found' });
        return;
      }

      const isInputError =
        error instanceof ConflictError ||
        error instanceof InvalidTenantDomainError;
      if (!isInputError) {
        this.logger.error(error as Error, {
          context: 'platform_update_tenant',
        });
      }

      let tenant;
      try {
        tenant = await this.platformService.getTenantBySlug(req.params.slug);
      } catch (reloadError) {
        this.logger.error(reloadError as Error, {
          context: 'platform_update_tenant_reload_failed',
        });
        res.status(500).render('error', {
          message: 'Failed to load tenant',
        });
        return;
      }

      res.render('admin/tenants/edit', {
        title: `Edit Tenant: ${req.params.slug}`,
        tenant,
        error: isInputError
          ? (error as Error).message
          : 'Failed to update tenant',
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /*  STATUS CHANGE                                                      */
  /* ------------------------------------------------------------------ */

  public updateTenantStatus = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { slug } = req.params;
      const { status } = req.body;

      if (!status || !TenantStatusValues.includes(status as TenantStatus)) {
        res.redirect(`/admin/tenants/${slug}`);
        return;
      }

      await this.platformService.updateTenantStatus(
        slug,
        status as TenantStatus
      );

      res.redirect(`/admin/tenants/${slug}`);
    } catch (error) {
      if (error instanceof ProtectedTenantError) {
        renderProtectedTenantError(res);
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).render('error', { message: 'Tenant not found' });
        return;
      }

      this.logger.error(error as Error, {
        context: 'platform_update_tenant_status',
      });
      res.redirect(`/admin/tenants/${req.params.slug}`);
    }
  };
}
