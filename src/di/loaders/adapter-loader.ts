/**
 * Bootstrap-time loader for storage-adapter runtimes.
 *
 * Only the adapter family selected by `STORAGE_ADAPTER` is dynamic-imported,
 * so a SQLite or PostgreSQL deployment does not pay the heap cost of the
 * Mongoose family, and a MongoDB deployment does not pay the heap cost of
 * the Prisma client. The loader returns a discriminated bundle that the DI
 * factories consume synchronously through a constant binding.
 */

import type { PrismaClient } from '@prisma/client';
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
import type { BootstrapConfig } from '../../config/schemas/bootstrap-schema.js';

export type StorageAdapter = 'sqlite' | 'postgresql' | 'mongodb';

export interface PrismaAdapterBundle {
  readonly kind: 'prisma';
  readonly createClient: (config: BootstrapConfig) => PrismaClient;
  readonly UserRepository: new (client: PrismaClient) => IUserRepository;
  readonly ActivityRepository: new (
    client: PrismaClient
  ) => IActivityRepository;
  readonly SettingsRepository: new (
    client: PrismaClient
  ) => ISettingsRepository;
  readonly SocialIntegrationRepository: new (
    client: PrismaClient
  ) => ISocialIntegrationRepository;
  readonly TenantRepository: new (client: PrismaClient) => ITenantRepository;
  readonly TenantSettingsOverrideRepository: new (
    client: PrismaClient
  ) => ITenantSettingsOverrideRepository;
}

export interface MongooseAdapterBundle {
  readonly kind: 'mongoose';
  readonly UserRepository: new (model: UserModel) => IUserRepository;
  readonly ActivityRepository: new (
    model: ActivityModel
  ) => IActivityRepository;
  readonly SettingsRepository: new (
    model: SettingsModel
  ) => ISettingsRepository;
  readonly SocialIntegrationRepository: new (
    model: SocialIntegrationModel
  ) => ISocialIntegrationRepository;
  readonly TenantRepository: new (model: TenantModel) => ITenantRepository;
  readonly TenantSettingsOverrideRepository: new (
    model: TenantSettingsOverrideModel
  ) => ITenantSettingsOverrideRepository;
}

export type AdapterBundle = PrismaAdapterBundle | MongooseAdapterBundle;

export async function loadAdapterBundle(
  adapter: StorageAdapter
): Promise<AdapterBundle> {
  if (adapter === 'mongodb') {
    const [
      { MongooseUserRepository },
      { MongooseActivityRepository },
      { MongooseSettingsRepository },
      { MongooseSocialIntegrationRepository },
      { MongooseTenantRepository },
      { MongooseTenantSettingsOverrideRepository },
    ] = await Promise.all([
      import('../../db/repositories/mongoose/user.repository.js'),
      import('../../db/repositories/mongoose/activity.repository.js'),
      import('../../db/repositories/mongoose/settings.repository.js'),
      import('../../db/repositories/mongoose/social-integration.repository.js'),
      import('../../db/repositories/mongoose/tenant.repository.js'),
      import('../../db/repositories/mongoose/tenant-settings-override.repository.js'),
    ]);

    return {
      kind: 'mongoose',
      UserRepository: MongooseUserRepository,
      ActivityRepository: MongooseActivityRepository,
      SettingsRepository: MongooseSettingsRepository,
      SocialIntegrationRepository: MongooseSocialIntegrationRepository,
      TenantRepository: MongooseTenantRepository,
      TenantSettingsOverrideRepository:
        MongooseTenantSettingsOverrideRepository,
    };
  }

  const [
    { createPrismaClient },
    { PrismaUserRepository },
    { PrismaActivityRepository },
    { PrismaSettingsRepository },
    { PrismaSocialIntegrationRepository },
    { PrismaTenantRepository },
    { PrismaTenantSettingsOverrideRepository },
  ] = await Promise.all([
    import('../../db/prisma.js'),
    import('../../db/repositories/prisma/user.repository.js'),
    import('../../db/repositories/prisma/activity.repository.js'),
    import('../../db/repositories/prisma/settings.repository.js'),
    import('../../db/repositories/prisma/social-integration.repository.js'),
    import('../../db/repositories/prisma/tenant.repository.js'),
    import('../../db/repositories/prisma/tenant-settings-override.repository.js'),
  ]);

  return {
    kind: 'prisma',
    createClient: createPrismaClient,
    UserRepository: PrismaUserRepository,
    ActivityRepository: PrismaActivityRepository,
    SettingsRepository: PrismaSettingsRepository,
    SocialIntegrationRepository: PrismaSocialIntegrationRepository,
    TenantRepository: PrismaTenantRepository,
    TenantSettingsOverrideRepository: PrismaTenantSettingsOverrideRepository,
  };
}
