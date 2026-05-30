import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { PrismaClient } from '@prisma/client';
import { TYPES } from '../types.js';

import DatabaseConnectionManager from '../../db/connection.js';
import { IDatabaseConnectionManager } from '../interfaces/database-connection-manager.interface.js';

import type { IUserRepository } from '../../db/repositories/interfaces/user.repository.js';
import type { IActivityRepository } from '../../db/repositories/interfaces/activity.repository.js';
import type { ISettingsRepository } from '../../db/repositories/interfaces/settings.repository.js';
import type { ISocialIntegrationRepository } from '../../db/repositories/interfaces/social-integration.repository.js';
import type { ITenantRepository } from '../../db/repositories/interfaces/tenant.repository.js';
import type { ITenantSettingsOverrideRepository } from '../../db/repositories/interfaces/tenant-settings-override.repository.js';

import type { UserModel } from '../../models/user.model.js';
import type { ActivityModel } from '../../models/activity.model.js';
import type { SettingsModel } from '../../models/settings.model.js';
import type { SocialIntegrationModel } from '../../models/social-integration.model.js';
import type { TenantModel } from '../../models/tenant.model.js';
import type { TenantSettingsOverrideModel } from '../../models/tenant-settings-override/model.js';
import type { IConfigProvider } from '../interfaces/config-provider.interface.js';
import type { BootstrapConfig } from '../../config/schemas/bootstrap-schema.js';
import type { AdapterBundle } from '../loaders/adapter-loader.js';

function getAdapter(provider: IConfigProvider<BootstrapConfig>): string {
  return provider.getConfigValue<string>('storage.adapter', 'mongodb');
}

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

export const databaseModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    options
      .bind<IDatabaseConnectionManager>(TYPES.DatabaseConnectionManager)
      .to(DatabaseConnectionManager)
      .inSingletonScope();

    options
      .bind<PrismaClient | null>(TYPES.PrismaClient)
      .toDynamicValue(context => {
        const provider = context.get<IConfigProvider<BootstrapConfig>>(
          TYPES.BootstrapConfigProvider
        );
        const adapter = getAdapter(provider);
        if (adapter === 'mongodb') return null;

        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind !== 'prisma') {
          throw new Error(
            `AdapterBundle kind "${bundle.kind}" does not provide a Prisma client`
          );
        }
        const config = buildBootstrapConfig(provider, adapter);
        return bundle.createClient(config);
      })
      .inSingletonScope();

    options
      .bind<IUserRepository>(TYPES.UserRepository)
      .toDynamicValue(context => {
        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind === 'prisma') {
          return new bundle.UserRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new bundle.UserRepository(
          context.get<UserModel>(TYPES.UserModel)
        );
      })
      .inSingletonScope();

    options
      .bind<IActivityRepository>(TYPES.ActivityRepository)
      .toDynamicValue(context => {
        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind === 'prisma') {
          return new bundle.ActivityRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new bundle.ActivityRepository(
          context.get<ActivityModel>(TYPES.ActivityModel)
        );
      })
      .inSingletonScope();

    options
      .bind<ISettingsRepository>(TYPES.SettingsRepository)
      .toDynamicValue(context => {
        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind === 'prisma') {
          return new bundle.SettingsRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new bundle.SettingsRepository(
          context.get<SettingsModel>(TYPES.SettingsModel)
        );
      })
      .inSingletonScope();

    options
      .bind<ISocialIntegrationRepository>(TYPES.SocialIntegrationRepository)
      .toDynamicValue(context => {
        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind === 'prisma') {
          return new bundle.SocialIntegrationRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new bundle.SocialIntegrationRepository(
          context.get<SocialIntegrationModel>(TYPES.SocialIntegrationModel)
        );
      })
      .inSingletonScope();

    options
      .bind<ITenantRepository>(TYPES.TenantRepository)
      .toDynamicValue(context => {
        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind === 'prisma') {
          return new bundle.TenantRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new bundle.TenantRepository(
          context.get<TenantModel>(TYPES.TenantModel)
        );
      })
      .inSingletonScope();

    options
      .bind<ITenantSettingsOverrideRepository>(
        TYPES.TenantSettingsOverrideRepository
      )
      .toDynamicValue(context => {
        const bundle = context.get<AdapterBundle>(TYPES.AdapterBundle);
        if (bundle.kind === 'prisma') {
          return new bundle.TenantSettingsOverrideRepository(
            context.get<PrismaClient>(TYPES.PrismaClient)
          );
        }
        return new bundle.TenantSettingsOverrideRepository(
          context.get<TenantSettingsOverrideModel>(
            TYPES.TenantSettingsOverrideModel
          )
        );
      })
      .inSingletonScope();
  }
);
