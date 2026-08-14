/**
 * Platform Admin Service
 *
 * Provides cross-tenant operations for the `_platforms` admin portal.
 * All operations require platform-level roles (enforced by middleware).
 *
 * Operations:
 * - List all tenants with optional status filter
 * - Create new tenants (with reserved slug protection)
 * - Get tenant details by slug
 * - List users for a specific tenant
 * - Update tenant status (activate, suspend, archive)
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type {
  ITenantRepository,
  UpdateTenantDto,
} from '../db/repositories/interfaces/tenant.repository.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IActivityService } from '../di/interfaces/activity-service.interface.js';
import type { ITenant, TenantStatus } from '../types/tenant.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';
import { normalizeTenantDomain } from '../multi-tenancy/tenant-domain.js';
import {
  ConflictError,
  ReservedSlugError,
  NotFoundError,
  ProtectedTenantError,
} from '../errors/platform.errors.js';

export const PLATFORM_MASTER_TENANT_SLUG = '_platforms';

export function isProtectedTenantSlug(slug: string): boolean {
  return slug === PLATFORM_MASTER_TENANT_SLUG;
}

function assertTenantMutable(slug: string): void {
  if (isProtectedTenantSlug(slug)) {
    throw new ProtectedTenantError();
  }
}

/**
 * Slugs reserved for system infrastructure.
 * Cannot be created as regular tenants.
 */
const RESERVED_SLUGS = new Set([
  '_ops',
  '_platforms',
  '_system',
  'admin',
  'api',
]);

function tenantId(tenant: ITenant): string {
  const id = tenant.id ?? tenant._id;
  if (!id) {
    throw new Error(`Tenant '${tenant.slug}' has no repository identity`);
  }
  return id;
}

export interface IPlatformAdminService {
  listTenants(filter?: { status?: TenantStatus }): Promise<ITenant[]>;
  createTenant(data: {
    slug: string;
    display_name: string;
    domain?: string;
  }): Promise<ITenant>;
  getTenantBySlug(slug: string): Promise<ITenant | null>;
  listTenantUsers(
    slug: string,
    pagination: { page: number; limit: number }
  ): Promise<{
    results: unknown[];
    page: number;
    limit: number;
    totalPages: number;
    totalResults: number;
  }>;
  updateTenant(
    slug: string,
    data: Pick<UpdateTenantDto, 'display_name' | 'domain'>
  ): Promise<ITenant>;
  updateTenantStatus(slug: string, status: TenantStatus): Promise<ITenant>;
}

@injectable()
export class PlatformAdminService implements IPlatformAdminService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.TenantRepository)
    private readonly tenantRepo: ITenantRepository,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService
  ) {}

  async listTenants(filter?: { status?: TenantStatus }): Promise<ITenant[]> {
    return this.tenantRepo.findAll(filter);
  }

  async createTenant(data: {
    slug: string;
    display_name: string;
    domain?: string;
  }): Promise<ITenant> {
    if (RESERVED_SLUGS.has(data.slug)) {
      throw new ReservedSlugError(
        `Slug '${data.slug}' is reserved for system infrastructure`
      );
    }

    const exists = await this.tenantRepo.exists(data.slug);
    if (exists) {
      throw new ConflictError(`Tenant '${data.slug}' already exists`);
    }

    const domain = data.domain ? normalizeTenantDomain(data.domain) : undefined;
    if (domain && (await this.tenantRepo.findByDomain(domain))) {
      throw new ConflictError(`Tenant domain '${domain}' already exists`);
    }

    const normalizedData = { ...data, ...(domain ? { domain } : {}) };
    const tenant = await this.tenantRepo.create(normalizedData);

    this.logger.info('platform_tenant_created', {
      slug: data.slug,
      display_name: data.display_name,
    });

    this.activityService.success(
      'platform_tenant_created',
      `Created tenant '${data.slug}' (${data.display_name})`,
      null,
      {
        target: {
          target_type: 'system',
          entity_data: {
            slug: data.slug,
            display_name: data.display_name,
          },
        },
      }
    );

    return tenant;
  }

  async getTenantBySlug(slug: string): Promise<ITenant | null> {
    return this.tenantRepo.findBySlug(slug);
  }

  async listTenantUsers(
    slug: string,
    pagination: { page: number; limit: number }
  ): Promise<{
    results: unknown[];
    page: number;
    limit: number;
    totalPages: number;
    totalResults: number;
  }> {
    const tenant = await this.tenantRepo.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundError(`Tenant '${slug}' not found`);
    }

    // Switch to the target tenant's context so the tenant-scoped
    // Mongoose plugin auto-filters queries by the correct tenant_id.
    return tenantContext.run(slug, () =>
      this.userService.findWithPagination(
        {},
        { page: pagination.page, limit: pagination.limit }
      )
    );
  }

  async updateTenant(
    slug: string,
    data: Pick<UpdateTenantDto, 'display_name' | 'domain'>
  ): Promise<ITenant> {
    assertTenantMutable(slug);
    const tenant = await this.tenantRepo.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundError(`Tenant '${slug}' not found`);
    }

    const normalizedData = { ...data };
    if (typeof data.domain === 'string') {
      normalizedData.domain = normalizeTenantDomain(data.domain);
      const domainOwner = await this.tenantRepo.findByDomain(
        normalizedData.domain
      );
      if (domainOwner && tenantId(domainOwner) !== tenantId(tenant)) {
        throw new ConflictError(
          `Tenant domain '${normalizedData.domain}' already exists`
        );
      }
    }

    const updated = await this.tenantRepo.update(
      tenantId(tenant),
      normalizedData
    );

    this.logger.info('platform_tenant_updated', { slug, ...normalizedData });
    this.activityService.info(
      'platform_tenant_updated',
      `Updated tenant '${slug}'`,
      null,
      {
        target: {
          target_type: 'system',
          entity_data: { slug, ...normalizedData },
        },
      }
    );

    return updated as ITenant;
  }

  async updateTenantStatus(
    slug: string,
    status: TenantStatus
  ): Promise<ITenant> {
    assertTenantMutable(slug);
    const tenant = await this.tenantRepo.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundError(`Tenant '${slug}' not found`);
    }

    const previousStatus = tenant.status;
    const updated = await this.tenantRepo.update(tenantId(tenant), {
      status,
    });

    this.logger.info('platform_tenant_status_changed', {
      slug,
      from: previousStatus,
      to: status,
    });

    this.activityService.warning(
      'platform_tenant_status_changed',
      `Tenant '${slug}' status changed: ${previousStatus} → ${status}`,
      null,
      {
        target: {
          target_type: 'system',
          entity_data: {
            slug,
            previousStatus,
            newStatus: status,
          },
        },
      }
    );

    return updated as ITenant;
  }
}
