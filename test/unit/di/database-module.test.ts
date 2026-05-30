/**
 * databaseModule repository bindings.
 *
 * Verifies that TYPES.UserRepository (and the other repo symbols) resolve to
 * the implementation class supplied by the active AdapterBundle.
 *
 *   bundle.kind === 'prisma'   →  Prisma implementations
 *   bundle.kind === 'mongoose' →  Mongoose implementations
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { Container } from 'inversify';
import { databaseModule } from '../../../src/di/modules/database.module.js';
import { TYPES } from '../../../src/di/types.js';

import { PrismaUserRepository } from '../../../src/db/repositories/prisma/user.repository.js';
import { PrismaActivityRepository } from '../../../src/db/repositories/prisma/activity.repository.js';
import { PrismaSettingsRepository } from '../../../src/db/repositories/prisma/settings.repository.js';
import { PrismaSocialIntegrationRepository } from '../../../src/db/repositories/prisma/social-integration.repository.js';
import { PrismaTenantRepository } from '../../../src/db/repositories/prisma/tenant.repository.js';
import { PrismaTenantSettingsOverrideRepository } from '../../../src/db/repositories/prisma/tenant-settings-override.repository.js';

import { MongooseUserRepository } from '../../../src/db/repositories/mongoose/user.repository.js';
import { MongooseActivityRepository } from '../../../src/db/repositories/mongoose/activity.repository.js';
import { MongooseSettingsRepository } from '../../../src/db/repositories/mongoose/settings.repository.js';
import { MongooseSocialIntegrationRepository } from '../../../src/db/repositories/mongoose/social-integration.repository.js';
import { MongooseTenantRepository } from '../../../src/db/repositories/mongoose/tenant.repository.js';
import { MongooseTenantSettingsOverrideRepository } from '../../../src/db/repositories/mongoose/tenant-settings-override.repository.js';

import type { AdapterBundle } from '../../../src/di/loaders/adapter-loader.js';

function mockBootstrapProvider(adapter: 'mongodb' | 'sqlite' | 'postgresql') {
  const values: Record<string, unknown> = {
    'storage.adapter': adapter,
    'storage.sqlite.path': ':memory:',
    'storage.postgresql.url': 'postgresql://localhost/test',
    'deployment.environment': 'development',
    'deployment.server.port': 3000,
    'storage.mongodb.uri': 'mongodb://localhost/test',
  };
  return {
    getConfigValue: (path: string, defaultValue?: unknown) =>
      path in values ? values[path] : defaultValue,
    isCached: () => true,
    getProviderName: () => 'bootstrap',
  };
}

const prismaBundle: AdapterBundle = {
  kind: 'prisma',
  createClient: () => ({}) as never,
  UserRepository: PrismaUserRepository,
  ActivityRepository: PrismaActivityRepository,
  SettingsRepository: PrismaSettingsRepository,
  SocialIntegrationRepository: PrismaSocialIntegrationRepository,
  TenantRepository: PrismaTenantRepository,
  TenantSettingsOverrideRepository: PrismaTenantSettingsOverrideRepository,
};

const mongooseBundle: AdapterBundle = {
  kind: 'mongoose',
  UserRepository: MongooseUserRepository,
  ActivityRepository: MongooseActivityRepository,
  SettingsRepository: MongooseSettingsRepository,
  SocialIntegrationRepository: MongooseSocialIntegrationRepository,
  TenantRepository: MongooseTenantRepository,
  TenantSettingsOverrideRepository: MongooseTenantSettingsOverrideRepository,
};

function buildContainer(
  adapter: 'mongodb' | 'sqlite' | 'postgresql',
  bundle: AdapterBundle
) {
  const c = new Container({ defaultScope: 'Transient' });

  c.bind(TYPES.BootstrapConfigProvider).toConstantValue(
    mockBootstrapProvider(adapter)
  );
  c.bind(TYPES.AdapterBundle).toConstantValue(bundle);

  c.bind(TYPES.UserModel).toConstantValue({} as never);
  c.bind(TYPES.ActivityModel).toConstantValue({} as never);
  c.bind(TYPES.SettingsModel).toConstantValue({} as never);
  c.bind(TYPES.SocialIntegrationModel).toConstantValue({} as never);
  c.bind(TYPES.TenantModel).toConstantValue({} as never);
  c.bind(TYPES.TenantSettingsOverrideModel).toConstantValue({} as never);

  c.load(databaseModule);
  return c;
}

describe('databaseModule — repository bindings', () => {
  describe('adapter = sqlite', () => {
    let c: Container;
    beforeAll(() => {
      c = buildContainer('sqlite', prismaBundle);
    });

    it('UserRepository → PrismaUserRepository', () => {
      expect(c.get(TYPES.UserRepository)).toBeInstanceOf(PrismaUserRepository);
    });

    it('ActivityRepository → PrismaActivityRepository', () => {
      expect(c.get(TYPES.ActivityRepository)).toBeInstanceOf(
        PrismaActivityRepository
      );
    });

    it('SettingsRepository → PrismaSettingsRepository', () => {
      expect(c.get(TYPES.SettingsRepository)).toBeInstanceOf(
        PrismaSettingsRepository
      );
    });

    it('SocialIntegrationRepository → PrismaSocialIntegrationRepository', () => {
      expect(c.get(TYPES.SocialIntegrationRepository)).toBeInstanceOf(
        PrismaSocialIntegrationRepository
      );
    });
  });

  describe('adapter = mongodb', () => {
    let c: Container;
    beforeAll(() => {
      c = buildContainer('mongodb', mongooseBundle);
    });

    it('UserRepository → MongooseUserRepository', () => {
      expect(c.get(TYPES.UserRepository)).toBeInstanceOf(
        MongooseUserRepository
      );
    });

    it('ActivityRepository → MongooseActivityRepository', () => {
      expect(c.get(TYPES.ActivityRepository)).toBeInstanceOf(
        MongooseActivityRepository
      );
    });

    it('SettingsRepository → MongooseSettingsRepository', () => {
      expect(c.get(TYPES.SettingsRepository)).toBeInstanceOf(
        MongooseSettingsRepository
      );
    });

    it('SocialIntegrationRepository → MongooseSocialIntegrationRepository', () => {
      expect(c.get(TYPES.SocialIntegrationRepository)).toBeInstanceOf(
        MongooseSocialIntegrationRepository
      );
    });
  });
});
