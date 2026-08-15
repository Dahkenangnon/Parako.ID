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
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

function mockBootstrapProvider(adapter: string) {
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

function buildContainer(adapter: string, bundle: AdapterBundle) {
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
  it('rejects an unsupported runtime storage adapter', () => {
    const container = buildContainer('mysql', prismaBundle);

    expect(() => container.get(TYPES.PrismaClient)).toThrow(
      'Unsupported storage adapter: mysql'
    );
  });

  it('rejects a Prisma client for MongoDB configuration', () => {
    const container = buildContainer('mongodb', prismaBundle);

    expect(() => container.get(TYPES.PrismaClient)).toThrow(
      'AdapterBundle kind "prisma" does not match storage adapter "mongodb"'
    );
  });

  it('rejects a Prisma user repository for MongoDB configuration', () => {
    const container = buildContainer('mongodb', prismaBundle);

    expect(() => container.get(TYPES.UserRepository)).toThrow(
      'A Prisma user repository requires sqlite or postgresql storage'
    );
  });

  it('rejects a Mongoose runtime bundle for SQLite configuration', () => {
    const container = buildContainer('sqlite', mongooseBundle);

    expect(() => container.get(TYPES.PrismaClient)).toThrow(
      'AdapterBundle kind "mongoose" does not provide a Prisma client'
    );
  });

  it('creates the PostgreSQL client with the complete bootstrap configuration', () => {
    const client = {} as never;
    const createClient = vi.fn(() => client);
    const container = buildContainer('postgresql', {
      ...prismaBundle,
      createClient,
    });

    expect(container.get(TYPES.PrismaClient)).toBe(client);
    expect(createClient).toHaveBeenCalledWith({
      deployment: {
        environment: 'development',
        server: { port: 3000 },
      },
      storage: {
        adapter: 'postgresql',
        mongodb: undefined,
        sqlite: undefined,
        postgresql: { url: 'postgresql://localhost/test' },
      },
      integrations: {
        file_storage: { provider: 'local' },
      },
      multiTenancy: {
        enabled: false,
        extraction_priority: ['header', 'subdomain'],
        tenant_header: 'x-tenant-id',
        provider_pool: {
          max_size: 50,
          idle_ttl_ms: 1_800_000,
          cleanup_interval_ms: 60_000,
        },
      },
    });
  });

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

    it('binds the Prisma tenant repositories', () => {
      expect(c.get(TYPES.TenantRepository)).toBeInstanceOf(
        PrismaTenantRepository
      );
      expect(c.get(TYPES.TenantSettingsOverrideRepository)).toBeInstanceOf(
        PrismaTenantSettingsOverrideRepository
      );
    });
  });

  describe('adapter = mongodb', () => {
    let c: Container;
    beforeAll(() => {
      c = buildContainer('mongodb', mongooseBundle);
    });

    it('does not create a Prisma client', () => {
      expect(c.get(TYPES.PrismaClient)).toBeNull();
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

    it('binds the Mongoose tenant repositories', () => {
      expect(c.get(TYPES.TenantRepository)).toBeInstanceOf(
        MongooseTenantRepository
      );
      expect(c.get(TYPES.TenantSettingsOverrideRepository)).toBeInstanceOf(
        MongooseTenantSettingsOverrideRepository
      );
    });
  });
});
