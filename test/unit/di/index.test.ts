import { afterAll, describe, expect, it, vi } from 'vitest';

const inheritedRedisEnvironment = vi.hoisted(() => {
  const keys = [
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'REDIS_DATABASE',
  ] as const;
  const values = new Map(keys.map(key => [key, process.env[key]]));

  for (const key of keys) delete process.env[key];

  return { keys, values };
});

const bootstrap = vi.hoisted(() => ({
  values: {
    DEPLOYMENT_ENVIRONMENT: 'development',
    DEPLOYMENT_SERVER_PORT: '9007',
    STORAGE_ADAPTER: 'sqlite',
    STORAGE_SQLITE_PATH: ':memory:',
  } as Record<string, string>,
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => path === 'runtime/.env',
  };
});

vi.mock('dotenv', () => ({
  default: {
    config: ({ path }: { path: string }) => ({
      parsed: path === 'runtime/.env' ? { ...bootstrap.values } : {},
    }),
  },
}));

import {
  buildContainer,
  containerReady,
  validateContainer,
} from '../../../src/di/index.js';
import type { AdapterBundle } from '../../../src/di/loaders/adapter-loader.js';
import type { OptionalDepsHandles } from '../../../src/di/loaders/optional-deps.js';
import type { IOpsRedisClient } from '../../../src/services/ops-social-callback.service.js';
import { TYPES } from '../../../src/di/types.js';

describe.sequential('DI container composition', () => {
  afterAll(() => {
    for (const key of inheritedRedisEnvironment.keys) {
      const value = inheritedRedisEnvironment.values.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('builds independent valid SQLite containers with Prisma and local file storage', async () => {
    const initialContainer = await containerReady;
    const secondContainer = await buildContainer();

    expect(secondContainer).not.toBe(initialContainer);
    expect(initialContainer.get<AdapterBundle>(TYPES.AdapterBundle).kind).toBe(
      'prisma'
    );
    expect(
      initialContainer.get<OptionalDepsHandles>(TYPES.OptionalDepsHandles)
        .storageProviderName
    ).toBe('local');
    expect(validateContainer(initialContainer)).toMatchObject({
      valid: true,
      missingCount: 0,
      missingSymbols: [],
    });
    expect(initialContainer.isBound(TYPES.Application)).toBe(true);
  });

  it('builds a valid MongoDB container with the Mongoose adapter family', async () => {
    bootstrap.values = {
      DEPLOYMENT_ENVIRONMENT: 'development',
      DEPLOYMENT_SERVER_PORT: '9007',
      STORAGE_ADAPTER: 'mongodb',
      STORAGE_MONGODB_URI: 'mongodb://127.0.0.1:27017/parako-test',
    };

    const container = await buildContainer();

    expect(container.get<AdapterBundle>(TYPES.AdapterBundle).kind).toBe(
      'mongoose'
    );
    expect(container.get(TYPES.PrismaClient)).toBeNull();
    expect(validateContainer(container)).toMatchObject({
      valid: true,
      missingCount: 0,
      missingSymbols: [],
    });
  });

  it('builds a valid PostgreSQL container with the Prisma adapter family', async () => {
    bootstrap.values = {
      DEPLOYMENT_ENVIRONMENT: 'development',
      DEPLOYMENT_SERVER_PORT: '9007',
      STORAGE_ADAPTER: 'postgresql',
      STORAGE_POSTGRESQL_URL: 'postgresql://parako:secret@127.0.0.1/parako',
    };

    const container = await buildContainer();

    expect(container.get<AdapterBundle>(TYPES.AdapterBundle).kind).toBe(
      'prisma'
    );
    expect(validateContainer(container)).toMatchObject({
      valid: true,
      missingCount: 0,
      missingSymbols: [],
    });
  });

  it('selects the S3 storage implementation from bootstrap configuration', async () => {
    bootstrap.values = {
      DEPLOYMENT_ENVIRONMENT: 'development',
      DEPLOYMENT_SERVER_PORT: '9007',
      STORAGE_ADAPTER: 'sqlite',
      STORAGE_SQLITE_PATH: ':memory:',
      FILE_STORAGE_PROVIDER: 's3',
    };

    const container = await buildContainer();

    expect(
      container.get<OptionalDepsHandles>(TYPES.OptionalDepsHandles)
        .storageProviderName
    ).toBe('s3');
  });

  it('binds the optional operations Redis client only when Redis is explicitly configured', async () => {
    bootstrap.values = {
      DEPLOYMENT_ENVIRONMENT: 'development',
      DEPLOYMENT_SERVER_PORT: '9007',
      STORAGE_ADAPTER: 'sqlite',
      STORAGE_SQLITE_PATH: ':memory:',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      REDIS_DATABASE: '15',
    };

    const redisContainer = await buildContainer();

    expect(redisContainer.isBound(TYPES.OpsRedisClient)).toBe(true);
    redisContainer.get<IOpsRedisClient>(TYPES.OpsRedisClient).disconnect?.();

    bootstrap.values = {
      DEPLOYMENT_ENVIRONMENT: 'development',
      DEPLOYMENT_SERVER_PORT: '9007',
      STORAGE_ADAPTER: 'sqlite',
      STORAGE_SQLITE_PATH: ':memory:',
    };

    const localOnlyContainer = await buildContainer();

    expect(localOnlyContainer.isBound(TYPES.OpsRedisClient)).toBe(false);
  });
});
