import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const generatedClient = {
    $executeRaw: vi.fn(),
    $extends: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const sqliteClient = {
    $executeRaw: vi.fn(),
    $extends: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const sqliteDriver = { executeRaw: vi.fn() };
  const sqliteAdapterFactory = {
    adapterName: '@prisma/adapter-better-sqlite3',
    connect: vi.fn(async () => sqliteDriver),
    connectToShadowDb: vi.fn(async () => sqliteDriver),
    provider: 'sqlite',
  };

  return {
    createRequire: vi.fn(),
    createTenantExtension: vi.fn(),
    existsSync: vi.fn(),
    generatedClient,
    generatedDefineExtension: vi.fn(),
    generatedPrismaClient: vi.fn(function () {
      return generatedClient;
    }),
    mkdirSync: vi.fn(),
    moduleLoader: vi.fn(),
    prismaBetterSqlite3: vi.fn(function () {
      return sqliteAdapterFactory;
    }),
    prismaClient: vi.fn(function (_options?: { adapter?: unknown }) {
      return sqliteClient;
    }),
    prismaPg: vi.fn(function () {
      return { kind: 'postgresql-adapter' };
    }),
    sqliteAdapterFactory,
    sqliteClient,
    sqliteDefineExtension: vi.fn(),
    sqliteDriver,
  };
});

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
}));
vi.mock('node:module', () => ({ createRequire: mocks.createRequire }));
vi.mock('@prisma/client', () => ({
  Prisma: { defineExtension: mocks.sqliteDefineExtension },
  PrismaClient: mocks.prismaClient,
}));
vi.mock('@prisma/adapter-better-sqlite3', () => ({
  PrismaBetterSqlite3: mocks.prismaBetterSqlite3,
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: mocks.prismaPg }));
vi.mock('../../../src/db/extensions/tenant.extension.js', () => ({
  createTenantExtension: mocks.createTenantExtension,
}));

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PARAKO_ROOT: process.env.PARAKO_ROOT,
  PG_SSL_REJECT_UNAUTHORIZED: process.env.PG_SSL_REJECT_UNAUTHORIZED,
  PG_SSL_ENABLED: process.env.PG_SSL_ENABLED,
};

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(value => {
    resolve = value;
  });
  return { promise, resolve };
};

const getConfiguredSqliteAdapter = () =>
  mocks.prismaClient.mock.calls.at(-1)?.[0]?.adapter as {
    connect: () => Promise<typeof mocks.sqliteDriver>;
    connectToShadowDb: () => Promise<typeof mocks.sqliteDriver>;
  };

describe.sequential('createPrismaClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.PARAKO_ROOT = '/srv/parako';
    delete process.env.PG_SSL_REJECT_UNAUTHORIZED;
    delete process.env.PG_SSL_ENABLED;
    mocks.existsSync.mockReturnValue(true);
    mocks.createRequire.mockReturnValue(mocks.moduleLoader);
    mocks.moduleLoader.mockReturnValue({
      PrismaClient: mocks.generatedPrismaClient,
      Prisma: { defineExtension: mocks.generatedDefineExtension },
    });
    mocks.sqliteDriver.executeRaw.mockReset().mockResolvedValue(0);
    mocks.sqliteAdapterFactory.connect
      .mockReset()
      .mockResolvedValue(mocks.sqliteDriver);
    mocks.sqliteAdapterFactory.connectToShadowDb
      .mockReset()
      .mockResolvedValue(mocks.sqliteDriver);
    mocks.prismaBetterSqlite3.mockReset().mockImplementation(function () {
      return mocks.sqliteAdapterFactory;
    });
    mocks.generatedClient.$extends.mockReset();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('starts SQLite PRAGMAs sequentially', async () => {
    const pending = [deferred(), deferred(), deferred(), deferred()];
    mocks.sqliteDriver.executeRaw.mockImplementation(
      () =>
        pending[mocks.sqliteDriver.executeRaw.mock.calls.length - 1]!.promise
    );
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: { adapter: 'sqlite', sqlite: { path: './data/test.db' } },
    } as never);
    const connecting = getConfiguredSqliteAdapter().connect();

    await vi.waitFor(() => {
      expect(mocks.sqliteDriver.executeRaw).toHaveBeenCalledTimes(1);
    });
    pending[0]!.resolve(undefined);
    await vi.waitFor(() => {
      expect(mocks.sqliteDriver.executeRaw).toHaveBeenCalledTimes(2);
    });
    pending[1]!.resolve(undefined);
    await vi.waitFor(() => {
      expect(mocks.sqliteDriver.executeRaw).toHaveBeenCalledTimes(3);
    });
    pending[2]!.resolve(undefined);
    await vi.waitFor(() => {
      expect(mocks.sqliteDriver.executeRaw).toHaveBeenCalledTimes(4);
    });
    pending[3]!.resolve(undefined);
    await expect(connecting).resolves.toBe(mocks.sqliteDriver);
  });

  it('configures SQLite before returning the connected adapter to Prisma', async () => {
    const driver = { executeRaw: vi.fn().mockResolvedValue(0) };
    const adapterFactory = {
      adapterName: '@prisma/adapter-better-sqlite3',
      connect: vi.fn().mockResolvedValue(driver),
      connectToShadowDb: vi.fn().mockResolvedValue(driver),
      provider: 'sqlite',
    };
    mocks.prismaBetterSqlite3.mockImplementationOnce(function () {
      return adapterFactory;
    });
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({ storage: { adapter: 'sqlite' } } as never);
    const configuredFactory = mocks.prismaClient.mock.calls.at(-1)?.[0]
      ?.adapter as typeof adapterFactory;
    const connectedDriver = await configuredFactory.connect();

    expect(connectedDriver).toBe(driver);
    expect(driver.executeRaw.mock.calls.map(([query]) => query.sql)).toEqual([
      'PRAGMA journal_mode = WAL',
      'PRAGMA foreign_keys = ON',
      'PRAGMA synchronous = NORMAL',
      'PRAGMA cache_size = -8000',
    ]);
  });

  it('constructs SQLite with the default rooted path and development PRAGMAs', async () => {
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    const client = createPrismaClient({
      storage: { adapter: 'sqlite' },
    } as never);

    expect(client).toBe(mocks.sqliteClient);
    expect(mocks.mkdirSync).toHaveBeenCalledWith('/srv/parako/runtime/data', {
      recursive: true,
    });
    expect(mocks.prismaBetterSqlite3).toHaveBeenCalledWith({
      url: 'file:/srv/parako/runtime/data/parako.db',
    });
    expect(mocks.prismaClient).toHaveBeenCalledWith({
      adapter: expect.objectContaining({
        adapterName: '@prisma/adapter-better-sqlite3',
        connect: expect.any(Function),
        connectToShadowDb: expect.any(Function),
        provider: 'sqlite',
      }),
    });
    await getConfiguredSqliteAdapter().connect();
    expect(
      mocks.sqliteDriver.executeRaw.mock.calls.map(([query]) => query.sql)
    ).toEqual([
      'PRAGMA journal_mode = WAL',
      'PRAGMA foreign_keys = ON',
      'PRAGMA synchronous = NORMAL',
      'PRAGMA cache_size = -8000',
    ]);
  });

  it('uses the durable SQLite synchronous mode in production', async () => {
    process.env.NODE_ENV = 'production';
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: { adapter: 'sqlite', sqlite: { path: 'file:./data/live.db' } },
    } as never);

    await getConfiguredSqliteAdapter().connect();
    expect(
      mocks.sqliteDriver.executeRaw.mock.calls.map(([query]) => query.sql)
    ).toContain('PRAGMA synchronous = FULL');
  });

  it('configures SQLite shadow connections through the same lifecycle', async () => {
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({ storage: { adapter: 'sqlite' } } as never);
    const driver = await getConfiguredSqliteAdapter().connectToShadowDb();

    expect(mocks.sqliteAdapterFactory.connectToShadowDb).toHaveBeenCalledOnce();
    expect(driver).toBe(mocks.sqliteDriver);
    expect(mocks.sqliteDriver.executeRaw).toHaveBeenCalledTimes(4);
  });

  it('reports SQLite PRAGMA failures and continues the queue', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sqliteDriver.executeRaw
      .mockRejectedValueOnce(new Error('read only'))
      .mockRejectedValueOnce('not supported')
      .mockResolvedValue(0);
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({ storage: { adapter: 'sqlite' } } as never);
    await getConfiguredSqliteAdapter().connect();

    expect(mocks.sqliteDriver.executeRaw).toHaveBeenCalledTimes(4);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenNthCalledWith(
      1,
      '[SQLite] Failed to set PRAGMA journal_mode=WAL: read only'
    );
    expect(error).toHaveBeenNthCalledWith(
      2,
      '[SQLite] Failed to set PRAGMA foreign_keys=ON: not supported'
    );
  });

  it('constructs a development PostgreSQL pool without TLS', async () => {
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    const client = createPrismaClient({
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
    } as never);

    expect(client).toBe(mocks.generatedClient);
    expect(mocks.prismaPg).toHaveBeenCalledWith({
      connectionString: 'postgresql://db/parako',
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: false,
    });
    expect(mocks.moduleLoader).toHaveBeenCalledWith(
      '/srv/parako/prisma/generated/postgresql/index.js'
    );
    expect(mocks.generatedPrismaClient).toHaveBeenCalledWith({
      adapter: { kind: 'postgresql-adapter' },
    });
    expect(mocks.createTenantExtension).not.toHaveBeenCalled();
  });

  it('discovers PostgreSQL artifacts from cwd without PARAKO_ROOT', async () => {
    delete process.env.PARAKO_ROOT;
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/workspace/parako');
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
    } as never);

    expect(cwd).toHaveBeenCalledOnce();
    expect(mocks.moduleLoader).toHaveBeenCalledWith(
      '/workspace/parako/prisma/generated/postgresql/index.js'
    );
  });

  it('enables strict PostgreSQL TLS by default in production', async () => {
    process.env.NODE_ENV = 'production';
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
    } as never);

    expect(mocks.prismaPg).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } })
    );
  });

  it('allows an explicit PostgreSQL certificate opt-out in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PG_SSL_REJECT_UNAUTHORIZED = 'false';
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
    } as never);

    expect(mocks.prismaPg).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } })
    );
  });

  it('allows PostgreSQL TLS to be disabled explicitly in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PG_SSL_ENABLED = 'false';
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
    } as never);

    expect(mocks.prismaPg).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: false })
    );
  });

  it('extends PostgreSQL clients when multi-tenancy is enabled', async () => {
    const extension = { name: 'tenant-extension' };
    const extendedClient = { name: 'extended-client' };
    mocks.createTenantExtension.mockReturnValue(extension);
    mocks.generatedClient.$extends.mockReturnValue(extendedClient);
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    const client = createPrismaClient({
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
      multiTenancy: { enabled: true },
    } as never);

    expect(mocks.createTenantExtension).toHaveBeenCalledWith(
      'postgresql',
      mocks.generatedClient,
      mocks.generatedDefineExtension
    );
    expect(mocks.generatedClient.$extends).toHaveBeenCalledWith(extension);
    expect(client).toBe(extendedClient);
  });

  it('loads the generated PostgreSQL module only once per process', async () => {
    const { createPrismaClient } = await import('../../../src/db/prisma.js');
    const config = {
      storage: {
        adapter: 'postgresql',
        postgresql: { url: 'postgresql://db/parako' },
      },
    } as never;

    createPrismaClient(config);
    createPrismaClient(config);

    expect(mocks.createRequire).toHaveBeenCalledOnce();
    expect(mocks.moduleLoader).toHaveBeenCalledOnce();
    expect(mocks.generatedPrismaClient).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported storage adapters', async () => {
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    expect(() =>
      createPrismaClient({ storage: { adapter: 'mongodb' } } as never)
    ).toThrow('Unknown Prisma adapter: mongodb');
  });
});
