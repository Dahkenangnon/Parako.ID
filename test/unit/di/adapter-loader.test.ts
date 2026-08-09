import { describe, expect, it } from 'vitest';

import {
  loadAdapterBundle,
  type StorageAdapter,
} from '../../../src/di/loaders/adapter-loader.js';

describe('loadAdapterBundle', () => {
  it('rejects an unsupported runtime storage adapter', async () => {
    await expect(loadAdapterBundle('mysql' as StorageAdapter)).rejects.toThrow(
      'Unsupported storage adapter: mysql'
    );
  });

  it('loads the Prisma repository runtime for SQLite', async () => {
    const bundle = await loadAdapterBundle('sqlite');

    expect(bundle).toMatchObject({
      kind: 'prisma',
      createClient: expect.any(Function),
      UserRepository: expect.any(Function),
      ActivityRepository: expect.any(Function),
      SettingsRepository: expect.any(Function),
      SocialIntegrationRepository: expect.any(Function),
      TenantRepository: expect.any(Function),
      TenantSettingsOverrideRepository: expect.any(Function),
    });
  });

  it('loads the Prisma repository runtime for PostgreSQL', async () => {
    const bundle = await loadAdapterBundle('postgresql');

    expect(bundle).toMatchObject({
      kind: 'prisma',
      createClient: expect.any(Function),
      UserRepository: expect.any(Function),
      ActivityRepository: expect.any(Function),
      SettingsRepository: expect.any(Function),
      SocialIntegrationRepository: expect.any(Function),
      TenantRepository: expect.any(Function),
      TenantSettingsOverrideRepository: expect.any(Function),
    });
  });

  it('loads the Mongoose repository runtime for MongoDB', async () => {
    const bundle = await loadAdapterBundle('mongodb');

    expect(bundle).toMatchObject({
      kind: 'mongoose',
      UserRepository: expect.any(Function),
      ActivityRepository: expect.any(Function),
      SettingsRepository: expect.any(Function),
      SocialIntegrationRepository: expect.any(Function),
      TenantRepository: expect.any(Function),
      TenantSettingsOverrideRepository: expect.any(Function),
    });
    expect('createClient' in bundle).toBe(false);
  });
});
