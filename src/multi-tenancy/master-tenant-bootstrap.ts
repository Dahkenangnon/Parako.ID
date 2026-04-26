import type { Container } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { ITenantRepository } from '../db/repositories/interfaces/tenant.repository.js';
import type { IUserRepository } from '../db/repositories/interfaces/user.repository.js';
import type { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';
import type { BootstrapConfig } from '../config/schemas/bootstrap-schema.js';
import type { CreateUserDto } from '../db/repositories/interfaces/user.repository.js';
import { tenantContext } from './tenant-context.js';

const MASTER_TENANT_SLUG = '_platforms';

/**
 * Bootstraps the `_platforms` master tenant on first startup.
 *
 * Two responsibilities:
 * 1. Seed the `_platforms` tenant record if it doesn't exist.
 * 2. Seed a bootstrap admin user if env vars are provided and no admin exists.
 *
 * Idempotent — safe to call on every startup and across PM2 cluster instances.
 */
export async function bootstrapMasterTenant(
  container: Container,
  logger: ILogger,
  bootstrapConfig: BootstrapConfig
): Promise<void> {
  const tenantRepo = container.get<ITenantRepository>(TYPES.TenantRepository);

  // ── 1. Seed _platforms tenant record ──────────────────────────────────────
  await seedMasterTenantRecord(tenantRepo, logger);

  // ── 2. Seed bootstrap admin user (if env vars provided) ──────────────────
  const mtConfig = bootstrapConfig.multiTenancy;
  const email = mtConfig?.bootstrap_admin_email;
  const password = mtConfig?.bootstrap_admin_password;

  if (email && password) {
    const userRepo = container.get<IUserRepository>(TYPES.UserRepository);
    const passwordUtils = container.get<IPasswordUtils>(TYPES.PasswordUtils);
    await seedBootstrapAdmin(userRepo, passwordUtils, logger, email, password);
  }
}

/**
 * Creates the `_platforms` tenant record if it doesn't already exist.
 * Handles PM2 race conditions by catching MongoDB duplicate key errors.
 */
async function seedMasterTenantRecord(
  tenantRepo: ITenantRepository,
  logger: ILogger
): Promise<void> {
  const exists = await tenantRepo.exists(MASTER_TENANT_SLUG);
  if (exists) {
    logger.debug('master_tenant_already_exists', {
      slug: MASTER_TENANT_SLUG,
    });
    return;
  }

  try {
    await tenantRepo.create({
      slug: MASTER_TENANT_SLUG,
      display_name: 'Platform Administration',
    });
    logger.info('master_tenant_created', {
      slug: MASTER_TENANT_SLUG,
      display_name: 'Platform Administration',
    });
  } catch (error: unknown) {
    // PM2 cluster race condition: another worker created it first.
    // MongoDB unique index violation = code 11000.
    if (isDuplicateKeyError(error)) {
      logger.debug('master_tenant_created_by_another_worker', {
        slug: MASTER_TENANT_SLUG,
      });
      return;
    }
    throw error;
  }
}

/**
 * Creates a bootstrap admin user within the `_platforms` tenant context.
 * Only creates if no user with `platform_admin` role exists in `_platforms`.
 */
async function seedBootstrapAdmin(
  userRepo: IUserRepository,
  passwordUtils: IPasswordUtils,
  logger: ILogger,
  email: string,
  password: string
): Promise<void> {
  await tenantContext.run(MASTER_TENANT_SLUG, async () => {
    // Check if any platform admin already exists
    const existingAdmins = await userRepo.findMany(
      { roles: ['platform_admin'] },
      { page: 1, limit: 1 }
    );

    if (existingAdmins.totalResults > 0) {
      logger.warn('bootstrap_admin_already_exists', {
        tenant: MASTER_TENANT_SLUG,
        message:
          'Platform admin already exists but bootstrap credentials are still in environment. ' +
          'Remove PARAKO_BOOTSTRAP_ADMIN_EMAIL and PARAKO_BOOTSTRAP_ADMIN_PASSWORD from your environment.',
      });
      return;
    }

    const hashedPassword = await passwordUtils.hashPassword(password);

    try {
      const bootstrapUser: CreateUserDto = {
        email,
        username: 'platform-admin',
        password: hashedPassword,
        password_hash_algo: 'argon2id',
        roles: ['admin', 'platform_admin'],
        account_enabled: true,
        email_verified: true,
        phone_number_verified: false,
        register_with: 'email',
        gender: 'M',
        blocked_from: [],
        account_is_anonymized: false,
      };
      await userRepo.create(bootstrapUser);

      logger.warn('bootstrap_admin_created', {
        tenant: MASTER_TENANT_SLUG,
        email,
        message:
          'Bootstrap admin created for _platforms. ' +
          'Create a permanent admin account and remove bootstrap credentials from environment.',
      });
    } catch (error: unknown) {
      // Another PM2 worker may have created the admin concurrently
      if (isDuplicateKeyError(error)) {
        logger.debug('bootstrap_admin_created_by_another_worker', {
          tenant: MASTER_TENANT_SLUG,
        });
        return;
      }
      throw error;
    }
  });
}

/**
 * Detects MongoDB duplicate key error (code 11000) or Prisma unique constraint
 * violation (P2002). Covers both database backends.
 */
function isDuplicateKeyError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    // MongoDB: error.code === 11000
    if ('code' in error && (error as any).code === 11000) return true;
    // Prisma: error.code === 'P2002'
    if ('code' in error && (error as any).code === 'P2002') return true;
  }
  return false;
}
