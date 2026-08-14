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

import type { ITenantSettingsOverrideService } from '../../../di/interfaces/tenant-settings-override-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { ITenantSettingsOverride } from '../../../types/tenant-settings-override.js';
import { ConflictError as PlatformConflictError } from '../../../errors/platform.errors.js';
import {
  TenantStatusValues,
  type TenantStatus,
} from '../../../types/tenant.js';
import {
  tenantNotFound,
  conflict,
  sectionNotAllowed,
  internal,
} from '../errors.js';
import { apiSuccess, apiCreated, apiList } from '../response.js';
import {
  buildCursorQuery,
  buildCursorResponse,
  parsePaginationParams,
} from '../pagination.js';
import type {
  CreateTenantInput,
  UpdateConfigSectionInput,
} from '../validators/tenants.validator.js';

const UNIQUE_CONSTRAINT_CODES = new Set<unknown>([
  11000,
  'P2002',
  '23505',
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
]);

function isTenantConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return UNIQUE_CONSTRAINT_CODES.has(code);
}

/** Service and logger dependencies required by {@link TenantsController}. */
export interface TenantsControllerDeps {
  platformAdminService: {
    listTenants(filter?: { status?: TenantStatus }): Promise<any[]>;
    createTenant(data: {
      slug: string;
      display_name: string;
      domain?: string;
    }): Promise<any>;
    getTenantBySlug(slug: string): Promise<any>;
  };
  tenantSettingsOverrideService?: Pick<
    ITenantSettingsOverrideService,
    'loadOverrides' | 'saveOverrides'
  >;
  configManager: Pick<IConfigManager, 'getPlatformConfig'>;
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

export class TenantsController {
  private readonly platformAdminService: TenantsControllerDeps['platformAdminService'];
  private readonly tenantSettingsOverrideService: TenantsControllerDeps['tenantSettingsOverrideService'];
  private readonly configManager: TenantsControllerDeps['configManager'];
  private readonly logger: TenantsControllerDeps['logger'];

  constructor(deps: TenantsControllerDeps) {
    this.platformAdminService = deps.platformAdminService;
    this.tenantSettingsOverrideService = deps.tenantSettingsOverrideService;
    this.configManager = deps.configManager;
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
      const { limit, cursor, includeCount } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const filter: { status?: TenantStatus } = {};
      if (
        typeof req.query.status === 'string' &&
        (TenantStatusValues as string[]).includes(req.query.status)
      ) {
        filter.status = req.query.status as TenantStatus;
      }

      let tenants = await this.platformAdminService.listTenants(
        Object.keys(filter).length > 0 ? filter : undefined
      );
      tenants = [...tenants].sort((left, right) =>
        String(left.slug).localeCompare(String(right.slug))
      );
      const totalCount = includeCount ? tenants.length : undefined;

      if (cursor) {
        const cursorQuery = buildCursorQuery(cursor, 'slug');
        const slugRange = cursorQuery.slug as { $gt: string };
        tenants = tenants.filter(
          tenant => String(tenant.slug).localeCompare(slugRange.$gt) > 0
        );
      }

      const page = buildCursorResponse(
        tenants.slice(0, limit + 1),
        limit,
        'slug',
        totalCount
      );

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
   * Duplicate slug and domain errors are converted to a 409 Conflict response.
   */
  create = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as CreateTenantInput;

      let tenant: any;
      try {
        tenant = await this.platformAdminService.createTenant(body);
      } catch (err: unknown) {
        if (err instanceof PlatformConflictError) {
          throw conflict(err.message);
        }
        if (isTenantConflict(err)) {
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

      const data = req.body as UpdateConfigSectionInput;
      const tenantId = String(tenant.id ?? tenant._id ?? tenant.slug);

      if (!this.tenantSettingsOverrideService) {
        throw internal('Configuration management is not available', req.path);
      }

      const updated = await this.tenantSettingsOverrideService.saveOverrides(
        tenantId,
        { [section]: data } as Partial<ITenantSettingsOverride>,
        req.apiAuth?.client_id ?? 'management-api',
        `Updated ${section} configuration via Management API`,
        this.configManager.getPlatformConfig() as unknown as Record<string, any>
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
