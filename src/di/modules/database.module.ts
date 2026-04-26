import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { PrismaClient } from '@prisma/client';
import { TYPES } from '../types.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
import DatabaseConnectionManager from '../../db/connection.js';
import { IDatabaseConnectionManager } from '../interfaces/database-connection-manager.interface.js';
import { createPrismaClient } from '../../db/prisma.js';

// ── Repository interfaces ─────────────────────────────────────────────────────
import type { IUserRepository } from '../../db/repositories/interfaces/user.repository.js';
import type { IActivityRepository } from '../../db/repositories/interfaces/activity.repository.js';
import type { ISettingsRepository } from '../../db/repositories/interfaces/settings.repository.js';
import type { ISocialIntegrationRepository } from '../../db/repositories/interfaces/social-integration.repository.js';
import type { ITenantRepository } from '../../db/repositories/interfaces/tenant.repository.js';
import type { ITenantSettingsOverrideRepository } from '../../db/repositories/interfaces/tenant-settings-override.repository.js';

// ── Prisma implementations ────────────────────────────────────────────────────
import { PrismaUserRepository } from '../../db/repositories/prisma/user.repository.js';
import { PrismaActivityRepository } from '../../db/repositories/prisma/activity.repository.js';
import { PrismaSettingsRepository } from '../../db/repositories/prisma/settings.repository.js';
import { PrismaSocialIntegrationRepository } from '../../db/repositories/prisma/social-integration.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/prisma/tenant.repository.js';
import { PrismaTenantSettingsOverrideRepository } from '../../db/repositories/prisma/tenant-settings-override.repository.js';

// ── Mongoose implementations ──────────────────────────────────────────────────
import { MongooseUserRepository } from '../../db/repositories/mongoose/user.repository.js';
import { MongooseActivityRepository } from '../../db/repositories/mongoose/activity.repository.js';
import { MongooseSettingsRepository } from '../../db/repositories/mongoose/settings.repository.js';
import { MongooseSocialIntegrationRepository } from '../../db/repositories/mongoose/social-integration.repository.js';
import { MongooseTenantRepository } from '../../db/repositories/mongoose/tenant.repository.js';
import { MongooseTenantSettingsOverrideRepository } from '../../db/repositories/mongoose/tenant-settings-override.repository.js';

// ── Model types ───────────────────────────────────────────────────────────────
import type { UserModel } from '../../models/user.model.js';
import type { ActivityModel } from '../../models/activity.model.js';
import type { SettingsModel } from '../../models/settings.model.js';
import type { SocialIntegrationModel } from '../../models/social-integration.model.js';
import type { TenantModel } from '../../models/tenant.model.js';
import type { TenantSettingsOverrideModel } from '../../models/tenant-settings-override/model.js';
import type { IConfigProvider } from '../interfaces/config-provider.interface.js';
import type { BootstrapConfig } from '../../config/schemas/bootstrap-schema.js';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Read the storage adapter from the cached bootstrap config. */
function getAdapter(provider: IConfigProvider<BootstrapConfig>): string {
  return provider.getConfigValue<string>('storage.adapter', 'mongodb');
}

/** Build a BootstrapConfig object from individual getConfigValue calls. */
function buildBootstrapConfig(
  provider: IConfigProvider<BootstrapConfig>,
  adapter: string
): BootstrapConfig {
  return {
    deployment: {
      environment: provider.getConfigValue(
        'deployment.environment',
        'development'
      ),
      server: {
        port: provider.getConfigValue('deployment.server.port', 3000),
      },
    },
    storage: {
      adapter: adapter as BootstrapConfig['storage']['adapter'],
      mongodb:
        adapter === 'mongodb'
          ? { uri: provider.getConfigValue('storage.mongodb.uri', '') }
          : undefined,
      sqlite:
        adapter === 'sqlite'
          ? {
              path: provider.getConfigValue(
                'storage.sqlite.path',
                './data/parako.db'
              ),
            }
          : undefined,
      postgresql:
        adapter === 'postgresql'
          ? { url: provider.getConfigValue('storage.postgresql.url') }
          : undefined,
    },
    multiTenancy: {
      enabled: provider.getConfigValue('multiTenancy.enabled', false),
      extraction_priority: provider.getConfigValue(
        'multiTenancy.extraction_priority',
        ['header', 'subdomain']
      ),
      tenant_header: provider.getConfigValue(
        'multiTenancy.tenant_header',
        'x-tenant-id'
      ),
      provider_pool: provider.getConfigValue('multiTenancy.provider_pool', {
        max_size: 50,
        idle_ttl_ms: 1_800_000,
        cleanup_interval_ms: 60_000,
      }),
    },
  };
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const databaseModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // MongoDB connection manager (always bound — used regardless of adapter)
    options
      .bind<IDatabaseConnectionManager>(TYPES.DatabaseConnectionManager)
      .to(DatabaseConnectionManager)
      .inSingletonScope();

    // ── PrismaClient ──────────────────────────────────────────────────────────
    // Returns null for mongodb (no Prisma needed).
    // Returns a real PrismaClient for sqlite / postgresql.
    // regardless of the configured adapter.
    options
      .bind<PrismaClient | null>(TYPES.PrismaClient)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        const adapter = getAdapter(provider);
        if (adapter === 'mongodb') return null;
        const config = buildBootstrapConfig(provider, adapter);
        return createPrismaClient(config);
      })
      .inSingletonScope();

    // ── UserRepository ────────────────────────────────────────────────────────
    options
      .bind<IUserRepository>(TYPES.UserRepository)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        if (getAdapter(provider) !== 'mongodb') {
          return new PrismaUserRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new MongooseUserRepository(
          context.get<UserModel>(TYPES.UserModel)
        );
      })
      .inSingletonScope();

    // ── ActivityRepository ────────────────────────────────────────────────────
    options
      .bind<IActivityRepository>(TYPES.ActivityRepository)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        if (getAdapter(provider) !== 'mongodb') {
          return new PrismaActivityRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new MongooseActivityRepository(
          context.get<ActivityModel>(TYPES.ActivityModel)
        );
      })
      .inSingletonScope();

    // ── SettingsRepository ────────────────────────────────────────────────────
    options
      .bind<ISettingsRepository>(TYPES.SettingsRepository)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        if (getAdapter(provider) !== 'mongodb') {
          return new PrismaSettingsRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new MongooseSettingsRepository(
          context.get<SettingsModel>(TYPES.SettingsModel)
        );
      })
      .inSingletonScope();

    // ── SocialIntegrationRepository ───────────────────────────────────────────
    options
      .bind<ISocialIntegrationRepository>(TYPES.SocialIntegrationRepository)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        if (getAdapter(provider) !== 'mongodb') {
          return new PrismaSocialIntegrationRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new MongooseSocialIntegrationRepository(
          context.get<SocialIntegrationModel>(TYPES.SocialIntegrationModel)
        );
      })
      .inSingletonScope();

    // ── TenantRepository ───────────────────────────────────────────────────────
    options
      .bind<ITenantRepository>(TYPES.TenantRepository)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        if (getAdapter(provider) !== 'mongodb') {
          return new PrismaTenantRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new MongooseTenantRepository(
          context.get<TenantModel>(TYPES.TenantModel)
        );
      })
      .inSingletonScope();

    // ── TenantSettingsOverrideRepository ──────────────────────────────────────
    options
      .bind<ITenantSettingsOverrideRepository>(
        TYPES.TenantSettingsOverrideRepository
      )
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        if (getAdapter(provider) !== 'mongodb') {
          return new PrismaTenantSettingsOverrideRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new MongooseTenantSettingsOverrideRepository(
          context.get<TenantSettingsOverrideModel>(
            TYPES.TenantSettingsOverrideModel
          )
        );
      })
      .inSingletonScope();
  }
);
