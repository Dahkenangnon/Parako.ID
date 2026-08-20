import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';

import { resolvePostgresqlTestUrl } from '../../../scripts/testing/postgresql-test-url.js';
import { createPrismaClient } from '../../../src/db/prisma.js';
import type { ISettingsRepository } from '../../../src/db/repositories/interfaces/settings.repository.js';
import type { ITenantSettingsOverrideRepository } from '../../../src/db/repositories/interfaces/tenant-settings-override.repository.js';
import { MongooseSettingsRepository } from '../../../src/db/repositories/mongoose/settings.repository.js';
import { MongooseTenantSettingsOverrideRepository } from '../../../src/db/repositories/mongoose/tenant-settings-override.repository.js';
import { PrismaSettingsRepository } from '../../../src/db/repositories/prisma/settings.repository.js';
import { PrismaTenantSettingsOverrideRepository } from '../../../src/db/repositories/prisma/tenant-settings-override.repository.js';
import { createSettingsModel } from '../../../src/models/settings.model.js';
import { createJwksKeyModel } from '../../../src/models/jwks-key.model.js';
import { createTenantSettingsOverrideModel } from '../../../src/models/tenant-settings-override/model.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { DBKeyStore } from '../../../src/oidc/key-store/db-key-store.js';
import { MongooseJwksKeyRepository } from '../../../src/oidc/key-store/mongoose-jwks-key.repository.js';
import { PrismaJwksKeyRepository } from '../../../src/oidc/key-store/prisma-jwks-key.repository.js';

export type ContractStorageAdapter = 'sqlite' | 'postgresql' | 'mongodb';

export interface SettingsRepositoryHarness {
  adapter: ContractStorageAdapter;
  repository: ISettingsRepository;
  tenantRepository: ITenantSettingsOverrideRepository;
  supportsTenantIsolation: boolean;
  runAsTenant<T>(tenantId: string, operation: () => Promise<T>): Promise<T>;
  tenantRevisionCount(tenantId: string): Promise<number>;
  tenantRevisions(
    tenantId: string
  ): Promise<Array<{ _version: number; is_active: boolean }>>;
  createKeyStore(): DBKeyStore;
  jwksCount(tenantId: string): Promise<number>;
  cleanup(key: string): Promise<void>;
  cleanupTenantSettings(tenantIds: string[]): Promise<void>;
  cleanupJwks(tenantId: string): Promise<void>;
  close(): Promise<void>;
}

function selectedAdapter(): ContractStorageAdapter {
  const adapter =
    process.env.CONTRACT_STORAGE_ADAPTER ??
    process.env.STORAGE_ADAPTER ??
    'sqlite';

  if (
    adapter === 'sqlite' ||
    adapter === 'postgresql' ||
    adapter === 'mongodb'
  ) {
    return adapter;
  }

  throw new Error(`Unsupported contract storage adapter: ${adapter}`);
}

async function createPrismaHarness(
  adapter: Exclude<ContractStorageAdapter, 'mongodb'>
): Promise<SettingsRepositoryHarness> {
  let temporaryDirectory: string | undefined;
  let client: PrismaClient;

  if (adapter === 'sqlite') {
    temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'parako-settings-contract-')
    );
    const databasePath = join(temporaryDirectory, 'contract.db');
    const migrationsDirectory = resolve('prisma/migrations/sqlite');
    const database = new Database(databasePath);

    try {
      const migrations = readdirSync(migrationsDirectory, {
        withFileTypes: true,
      })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
      for (const migration of migrations) {
        database.exec(
          readFileSync(
            join(migrationsDirectory, migration, 'migration.sql'),
            'utf8'
          )
        );
      }
    } finally {
      database.close();
    }

    client = createPrismaClient({
      storage: { adapter: 'sqlite', sqlite: { path: databasePath } },
    } as never);
  } else {
    const url = resolvePostgresqlTestUrl(process.env);

    if (!url) {
      throw new Error(
        'CONTRACT_DATABASE_URL, STORAGE_POSTGRESQL_URL, or PARAKO_E2E_POSTGRESQL_URL is required for PostgreSQL contracts'
      );
    }

    client = createPrismaClient({
      storage: { adapter: 'postgresql', postgresql: { url } },
      multiTenancy: { enabled: true },
    } as never);
  }

  await client.$queryRawUnsafe('SELECT 1');
  const jwksRepository = new PrismaJwksKeyRepository(client);
  const createKeyStore = () =>
    new DBKeyStore(
      { info() {} } as never,
      {
        getConfig: () => ({
          security: {
            secrets: { jwt_secret: 'contract-jwks-secret-at-least-32-chars' },
            key_store: { algorithms: ['ES256'] },
          },
        }),
      } as never,
      jwksRepository
    );

  return {
    adapter,
    repository: new PrismaSettingsRepository(client),
    tenantRepository: new PrismaTenantSettingsOverrideRepository(client),
    supportsTenantIsolation: adapter === 'postgresql',
    runAsTenant(tenantId, operation) {
      return tenantContext.run(tenantId, operation);
    },
    tenantRevisionCount(tenantId) {
      return tenantContext.run(tenantId, async () =>
        client.tenantSettingsOverride.count()
      );
    },
    tenantRevisions(tenantId) {
      return tenantContext.run(tenantId, async () => {
        const revisions = await client.tenantSettingsOverride.findMany({
          select: { int_version: true, is_active: true },
        });
        return revisions.map(revision => ({
          _version: revision.int_version,
          is_active: revision.is_active,
        }));
      });
    },
    createKeyStore,
    jwksCount(tenantId) {
      return jwksRepository.countCurrent(tenantId);
    },
    async cleanup(key) {
      await client.settings.deleteMany({ where: { key } });
    },
    async cleanupTenantSettings(tenantIds) {
      for (const tenantId of tenantIds) {
        await tenantContext.run(tenantId, async () =>
          client.tenantSettingsOverride.deleteMany()
        );
      }
    },
    async cleanupJwks(tenantId) {
      await client.jwksKey.deleteMany({ where: { tenant_id: tenantId } });
    },
    async close() {
      await client.$disconnect();
      if (temporaryDirectory) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
  };
}

async function createMongoHarness(): Promise<SettingsRepositoryHarness> {
  const configuredUri =
    process.env.CONTRACT_MONGODB_URI ??
    process.env.STORAGE_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/parako_contract';
  const databaseName = `parako_contract_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const uri = new URL(configuredUri);
  uri.pathname = `/${databaseName}`;

  const isolatedMongoose = new mongoose.Mongoose();
  await isolatedMongoose.connect(uri.toString());

  const model = createSettingsModel(isolatedMongoose);
  const tenantModel = createTenantSettingsOverrideModel(isolatedMongoose);
  const jwksModel = createJwksKeyModel(isolatedMongoose);
  await model.syncIndexes();
  await tenantModel.syncIndexes();
  await jwksModel.syncIndexes();
  const jwksRepository = new MongooseJwksKeyRepository(jwksModel);
  const createKeyStore = () =>
    new DBKeyStore(
      { info() {} } as never,
      {
        getConfig: () => ({
          security: {
            secrets: { jwt_secret: 'contract-jwks-secret-at-least-32-chars' },
            key_store: { algorithms: ['ES256'] },
          },
        }),
      } as never,
      jwksRepository
    );

  return {
    adapter: 'mongodb',
    repository: new MongooseSettingsRepository(model),
    tenantRepository: new MongooseTenantSettingsOverrideRepository(tenantModel),
    supportsTenantIsolation: true,
    runAsTenant(tenantId, operation) {
      return tenantContext.run(tenantId, operation);
    },
    tenantRevisionCount(tenantId) {
      return tenantContext.run(tenantId, async () =>
        tenantModel.countDocuments({}).exec()
      );
    },
    tenantRevisions(tenantId) {
      return tenantContext.run(tenantId, async () => {
        const revisions = await tenantModel.find({}).lean().exec();
        return revisions.map(revision => ({
          _version: revision._version,
          is_active: revision.is_active,
        }));
      });
    },
    createKeyStore,
    jwksCount(tenantId) {
      return jwksRepository.countCurrent(tenantId);
    },
    async cleanup(key) {
      await model.deleteMany({ key }).exec();
    },
    async cleanupTenantSettings(tenantIds) {
      for (const tenantId of tenantIds) {
        await tenantContext.run(tenantId, async () =>
          tenantModel.deleteMany({}).exec()
        );
      }
    },
    async cleanupJwks(tenantId) {
      await jwksModel.deleteMany({ tenant_id: tenantId }).exec();
    },
    async close() {
      if (isolatedMongoose.connection.name !== databaseName) {
        throw new Error(
          'Refusing to drop an unexpected MongoDB contract database'
        );
      }

      await isolatedMongoose.connection.dropDatabase();
      await isolatedMongoose.disconnect();
    },
  };
}

export async function createSettingsRepositoryHarness(
  requestedAdapter?: ContractStorageAdapter
): Promise<SettingsRepositoryHarness> {
  const adapter = requestedAdapter ?? selectedAdapter();
  return adapter === 'mongodb'
    ? createMongoHarness()
    : createPrismaHarness(adapter);
}
