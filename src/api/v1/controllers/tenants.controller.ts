/**
 * Tenants controller — Management API v1.
 *
 * Tenant lifecycle management: paginated listing, creation, single-tenant
 * retrieval, and per-section configuration overrides. All endpoints are
 * platform-scoped and require elevated authorization (TENANTS_READ,
 * TENANTS_WRITE, CROSS_TENANT_READ, or CROSS_TENANT_WRITE).
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  tenantNotFound,
  conflict,
  sectionNotAllowed,
  internal,
} from '../errors.js';
import { apiSuccess, apiCreated, apiList } from '../response.js';
import { buildCursorResponse, parsePaginationParams } from '../pagination.js';
import {
  createTenantSchema,
  updateConfigSectionSchema,
} from '../validators/tenants.validator.js';

/** Service and logger dependencies required by {@link TenantsController}. */
export interface TenantsControllerDeps {
  platformAdminService: {
    listTenants(filter?: { status?: string }): Promise<any[]>;
    createTenant(data: {
      slug: string;
      display_name: string;
      domain?: string;
    }): Promise<any>;
    getTenantBySlug(slug: string): Promise<any>;
  };
  tenantSettingsOverrideService?: {
    loadOverrides(tenantId: string): Promise<any>;
    saveOverrides(tenantId: string, section: string, data: any): Promise<any>;
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

export class TenantsController {
  private readonly platformAdminService: TenantsControllerDeps['platformAdminService'];
  private readonly tenantSettingsOverrideService: TenantsControllerDeps['tenantSettingsOverrideService'];
  private readonly logger: TenantsControllerDeps['logger'];

  constructor(deps: TenantsControllerDeps) {
    this.platformAdminService = deps.platformAdminService;
    this.tenantSettingsOverrideService = deps.tenantSettingsOverrideService;
    this.logger = deps.logger;
  }

  /**
   * List tenants with cursor-based pagination.
   *
   * Supports optional `status` query parameter to filter tenants.
   * Cursor pagination uses the `slug` field for alphabetical ordering.
   */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const filter: { status?: string } = {};
      if (typeof req.query.status === 'string' && req.query.status.length > 0) {
        filter.status = req.query.status;
      }

      const tenants = await this.platformAdminService.listTenants(
        Object.keys(filter).length > 0 ? filter : undefined
      );

      const page = buildCursorResponse(tenants, limit, 'slug');

      apiList(res, page);
    } catch (error) {
      next(error);
    }
  };

  // POST /tenants

  /**
   * Create a new tenant.
   *
   * Validates the request body against `createTenantSchema`, delegates to
   * the platform admin service, and returns the created tenant with 201.
   * Duplicate slug errors are converted to a 409 Conflict response.
   */
  create = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = createTenantSchema.parse(req.body);

      let tenant: any;
      try {
        tenant = await this.platformAdminService.createTenant(body);
      } catch (err: any) {
        // Detect duplicate slug errors — check for DB-agnostic patterns
        // (MongoDB code 11000, Prisma P2002, or message-based detection).
        const isDuplicate =
          err?.code === 11000 ||
          err?.code === 'P2002' ||
          err?.message?.toLowerCase().includes('duplicate') ||
          err?.message?.toLowerCase().includes('already exists') ||
          err?.message?.toLowerCase().includes('unique constraint');
        if (isDuplicate) {
          throw conflict(`Tenant with slug '${body.slug}' already exists`);
        }
        throw err;
      }

      this.logger.info('Tenant created', { slug: body.slug });

      apiCreated(res, tenant);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve a single tenant by its slug. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenant = await this.platformAdminService.getTenantBySlug(
        req.params.slug
      );

      if (!tenant) {
        throw tenantNotFound(`Tenant '${req.params.slug}' not found`);
      }

      apiSuccess(res, tenant);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve configuration overrides for a tenant.
   *
   * If the `tenantSettingsOverrideService` is not available (e.g. the
   * feature is not enabled), returns an empty configuration object.
   */
  getConfig = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenant = await this.platformAdminService.getTenantBySlug(
        req.params.slug
      );

      if (!tenant) {
        throw tenantNotFound(`Tenant '${req.params.slug}' not found`);
      }

      const tenantId = String(tenant.id ?? tenant._id ?? tenant.slug);

      if (this.tenantSettingsOverrideService) {
        const config =
          await this.tenantSettingsOverrideService.loadOverrides(tenantId);
        apiSuccess(res, config);
      } else {
        apiSuccess(res, {});
      }
    } catch (error) {
      next(error);
    }
  };

  // PUT /tenants/:slug/config/:section

  /**
   * Update a specific configuration section for a tenant.
   *
   * Validates the request body as a generic JSON object, then delegates
   * to the tenant settings override service. Returns the updated
   * configuration.
   */
  updateConfig = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenant = await this.platformAdminService.getTenantBySlug(
        req.params.slug
      );

      if (!tenant) {
        throw tenantNotFound(`Tenant '${req.params.slug}' not found`);
      }

      const { section } = req.params;

      const allowedSections = [
        'application',
        'branding',
        'security',
        'features',
        'oidc',
        'integrations',
        'notifications',
      ];
      if (!allowedSections.includes(section)) {
        throw sectionNotAllowed(
          `Configuration section '${section}' is not a valid override section. Allowed: ${allowedSections.join(', ')}`,
          req.path
        );
      }

      const data = updateConfigSectionSchema.parse(req.body);
      const tenantId = String(tenant.id ?? tenant._id ?? tenant.slug);

      if (!this.tenantSettingsOverrideService) {
        throw internal('Configuration management is not available', req.path);
      }

      const updated = await this.tenantSettingsOverrideService.saveOverrides(
        tenantId,
        section,
        data
      );

      this.logger.info('Tenant config updated', {
        slug: req.params.slug,
        section,
      });

      apiSuccess(res, updated);
    } catch (error) {
      next(error);
    }
  };
}
