/**
 * TDD — databaseModule repository bindings
 *
 * Verifies that TYPES.UserRepository (and the other repo symbols) resolve to
 * the correct implementation class depending on storage.adapter.
 *
 * Adapter = 'sqlite' | 'postgresql'  →  Prisma implementations
 * Adapter = 'mongodb'                →  Mongoose implementations
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { Container } from 'inversify';
import { databaseModule } from '../../../src/di/modules/database.module.js';
import { TYPES } from '../../../src/di/types.js';

// ── Prisma repos ─────────────────────────────────────────────────────────────
import { PrismaUserRepository } from '../../../src/db/repositories/prisma/user.repository.js';
import { PrismaActivityRepository } from '../../../src/db/repositories/prisma/activity.repository.js';
import { PrismaSettingsRepository } from '../../../src/db/repositories/prisma/settings.repository.js';
import { PrismaSocialIntegrationRepository } from '../../../src/db/repositories/prisma/social-integration.repository.js';

// ── Mongoose repos ────────────────────────────────────────────────────────────
import { MongooseUserRepository } from '../../../src/db/repositories/mongoose/user.repository.js';
import { MongooseActivityRepository } from '../../../src/db/repositories/mongoose/activity.repository.js';
import { MongooseSettingsRepository } from '../../../src/db/repositories/mongoose/settings.repository.js';
import { MongooseSocialIntegrationRepository } from '../../../src/db/repositories/mongoose/social-integration.repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function buildContainer(adapter: 'mongodb' | 'sqlite' | 'postgresql') {
  const c = new Container({ defaultScope: 'Transient' });

  // Minimal mocks BootstrapConfigProvider needs
  c.bind(TYPES.BootstrapConfigProvider).toConstantValue(
    mockBootstrapProvider(adapter)
  );

  // Mock Mongoose model constants — needed when adapter=mongodb
  c.bind(TYPES.UserModel).toConstantValue({} as any);
  c.bind(TYPES.ActivityModel).toConstantValue({} as any);
  c.bind(TYPES.SettingsModel).toConstantValue({} as any);
  c.bind(TYPES.SocialIntegrationModel).toConstantValue({} as any);

  c.load(databaseModule);
  return c;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('databaseModule — repository bindings', () => {
  describe('adapter = sqlite', () => {
    let c: Container;
    beforeAll(() => {
      c = buildContainer('sqlite');
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
      c = buildContainer('mongodb');
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
