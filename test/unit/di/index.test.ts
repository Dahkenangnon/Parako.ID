import { describe, expect, it, vi } from 'vitest';

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
import { TYPES } from '../../../src/di/types.js';

describe.sequential('DI container composition', () => {
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
});
