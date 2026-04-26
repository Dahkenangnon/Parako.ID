/**
 * TDD — Master Tenant Bootstrap
 *
 * Verifies that bootstrapMasterTenant():
 * - Creates _platforms tenant when it doesn't exist
 * - Skips creation when _platforms already exists
 * - Handles PM2 race condition (duplicate key error)
 * - Creates bootstrap admin when env vars are set and no admin exists
 * - Skips admin creation when admin already exists
 * - Skips admin creation when env vars are missing
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from 'inversify';
import { TYPES } from '../../../src/di/types.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import type { ITenantRepository } from '../../../src/db/repositories/interfaces/tenant.repository.js';
import type { IUserRepository } from '../../../src/db/repositories/interfaces/user.repository.js';
import type { IPasswordUtils } from '../../../src/di/interfaces/password-utils.interface.js';
import type { BootstrapConfig } from '../../../src/config/schemas/bootstrap-schema.js';
import { bootstrapMasterTenant } from '../../../src/multi-tenancy/master-tenant-bootstrap.js';

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

function createMockTenantRepo(exists = false): ITenantRepository {
  return {
    exists: vi.fn().mockResolvedValue(exists),
    create: vi.fn().mockResolvedValue({
      id: 'id-_platforms',
      slug: '_platforms',
      display_name: 'Platform Administration',
      status: 'active',
    }),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByDomain: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  } as unknown as ITenantRepository;
}

function createMockUserRepo(hasAdmin = false): IUserRepository {
  return {
    findMany: vi.fn().mockResolvedValue({
      results: hasAdmin ? [{ id: 'admin-1', roles: ['platform_admin'] }] : [],
      totalResults: hasAdmin ? 1 : 0,
      page: 1,
      limit: 1,
      totalPages: hasAdmin ? 1 : 0,
    }),
    create: vi.fn().mockResolvedValue({
      id: 'new-admin',
      email: 'admin@example.com',
      roles: ['admin', 'platform_admin'],
    }),
  } as unknown as IUserRepository;
}

function createMockPasswordUtils(): IPasswordUtils {
  return {
    hashPassword: vi.fn().mockResolvedValue('$argon2id$hashed'),
    verifyPassword: vi.fn(),
    rehashIfNeeded: vi.fn(),
  } as unknown as IPasswordUtils;
}

function makeBootstrapConfig(
  overrides: {
    enabled?: boolean;
    email?: string;
    password?: string;
  } = {}
): BootstrapConfig {
  const { enabled = true, email, password } = overrides;
  return {
    deployment: {
      environment: 'development',
      server: { port: 3000 },
    },
    storage: { adapter: 'mongodb', mongodb: { uri: 'mongodb://localhost' } },
    multiTenancy: {
      enabled,
      extraction_priority: ['header', 'subdomain'],
      tenant_header: 'x-tenant-id',
      provider_pool: {
        max_size: 50,
        idle_ttl_ms: 1_800_000,
        cleanup_interval_ms: 60_000,
      },
      bootstrap_admin_email: email,
      bootstrap_admin_password: password,
    },
  } as BootstrapConfig;
}

function createContainer(
  tenantRepo: ITenantRepository,
  userRepo?: IUserRepository,
  passwordUtils?: IPasswordUtils
): Container {
  const container = new Container();
  container.bind(TYPES.TenantRepository).toConstantValue(tenantRepo);
  if (userRepo) {
    container.bind(TYPES.UserRepository).toConstantValue(userRepo);
  }
  if (passwordUtils) {
    container.bind(TYPES.PasswordUtils).toConstantValue(passwordUtils);
  }
  return container;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bootstrapMasterTenant', () => {
  let logger: ILogger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  describe('tenant seeding', () => {
    it('creates _platforms tenant when it does not exist', async () => {
      const tenantRepo = createMockTenantRepo(false);
      const container = createContainer(tenantRepo);
      const config = makeBootstrapConfig();

      await bootstrapMasterTenant(container, logger, config);

      expect(tenantRepo.create).toHaveBeenCalledWith({
        slug: '_platforms',
        display_name: 'Platform Administration',
      });
      expect(logger.info).toHaveBeenCalledWith(
        'master_tenant_created',
        expect.objectContaining({ slug: '_platforms' })
      );
    });

    it('skips creation when _platforms already exists', async () => {
      const tenantRepo = createMockTenantRepo(true);
      const container = createContainer(tenantRepo);
      const config = makeBootstrapConfig();

      await bootstrapMasterTenant(container, logger, config);

      expect(tenantRepo.create).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'master_tenant_already_exists',
        expect.objectContaining({ slug: '_platforms' })
      );
    });

    it('handles PM2 race condition (MongoDB duplicate key error)', async () => {
      const tenantRepo = createMockTenantRepo(false);
      const duplicateError = new Error('E11000 duplicate key error');
      (duplicateError as any).code = 11000;
      (tenantRepo.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        duplicateError
      );
      const container = createContainer(tenantRepo);
      const config = makeBootstrapConfig();

      // Should NOT throw — duplicate key means another worker created it
      await expect(
        bootstrapMasterTenant(container, logger, config)
      ).resolves.not.toThrow();

      expect(logger.debug).toHaveBeenCalledWith(
        'master_tenant_created_by_another_worker',
        expect.objectContaining({ slug: '_platforms' })
      );
    });

    it('handles PM2 race condition (Prisma unique constraint violation)', async () => {
      const tenantRepo = createMockTenantRepo(false);
      const prismaError = new Error('Unique constraint failed');
      (prismaError as any).code = 'P2002';
      (tenantRepo.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        prismaError
      );
      const container = createContainer(tenantRepo);
      const config = makeBootstrapConfig();

      await expect(
        bootstrapMasterTenant(container, logger, config)
      ).resolves.not.toThrow();
    });

    it('rethrows non-duplicate errors', async () => {
      const tenantRepo = createMockTenantRepo(false);
      (tenantRepo.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused')
      );
      const container = createContainer(tenantRepo);
      const config = makeBootstrapConfig();

      await expect(
        bootstrapMasterTenant(container, logger, config)
      ).rejects.toThrow('Connection refused');
    });
  });

  describe('bootstrap admin seeding', () => {
    it('creates admin when env vars set and no admin exists', async () => {
      const tenantRepo = createMockTenantRepo(true);
      const userRepo = createMockUserRepo(false);
      const passwordUtils = createMockPasswordUtils();
      const container = createContainer(tenantRepo, userRepo, passwordUtils);
      const config = makeBootstrapConfig({
        email: 'admin@example.com',
        password: 'securepass123',
      });

      await bootstrapMasterTenant(container, logger, config);

      expect(passwordUtils.hashPassword).toHaveBeenCalledWith('securepass123');
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@example.com',
          password: '$argon2id$hashed',
          roles: ['admin', 'platform_admin'],
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'bootstrap_admin_created',
        expect.objectContaining({
          tenant: '_platforms',
          email: 'admin@example.com',
        })
      );
    });

    it('skips admin creation when admin already exists', async () => {
      const tenantRepo = createMockTenantRepo(true);
      const userRepo = createMockUserRepo(true);
      const passwordUtils = createMockPasswordUtils();
      const container = createContainer(tenantRepo, userRepo, passwordUtils);
      const config = makeBootstrapConfig({
        email: 'admin@example.com',
        password: 'securepass123',
      });

      await bootstrapMasterTenant(container, logger, config);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'bootstrap_admin_already_exists',
        expect.objectContaining({ tenant: '_platforms' })
      );
    });

    it('skips admin creation when env vars are not provided', async () => {
      const tenantRepo = createMockTenantRepo(true);
      const userRepo = createMockUserRepo(false);
      const passwordUtils = createMockPasswordUtils();
      const container = createContainer(tenantRepo, userRepo, passwordUtils);
      const config = makeBootstrapConfig();

      await bootstrapMasterTenant(container, logger, config);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(passwordUtils.hashPassword).not.toHaveBeenCalled();
    });

    it('skips admin creation when only email is provided (no password)', async () => {
      const tenantRepo = createMockTenantRepo(true);
      const userRepo = createMockUserRepo(false);
      const passwordUtils = createMockPasswordUtils();
      const container = createContainer(tenantRepo, userRepo, passwordUtils);
      const config = makeBootstrapConfig({
        email: 'admin@example.com',
      });

      await bootstrapMasterTenant(container, logger, config);

      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it('handles duplicate admin user gracefully (PM2 race)', async () => {
      const tenantRepo = createMockTenantRepo(true);
      const userRepo = createMockUserRepo(false);
      const duplicateError = new Error('E11000 duplicate key error');
      (duplicateError as any).code = 11000;
      (userRepo.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        duplicateError
      );
      const passwordUtils = createMockPasswordUtils();
      const container = createContainer(tenantRepo, userRepo, passwordUtils);
      const config = makeBootstrapConfig({
        email: 'admin@example.com',
        password: 'securepass123',
      });

      await expect(
        bootstrapMasterTenant(container, logger, config)
      ).resolves.not.toThrow();
    });
  });
});
