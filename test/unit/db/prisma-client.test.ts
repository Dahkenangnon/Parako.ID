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
      return { kind: 'sqlite-adapter' };
    }),
    prismaClient: vi.fn(function () {
      return sqliteClient;
    }),
    prismaPg: vi.fn(function () {
      return { kind: 'postgresql-adapter' };
    }),
    sqliteClient,
    sqliteDefineExtension: vi.fn(),
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
};

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(value => {
    resolve = value;
  });
  return { promise, resolve };
};

describe.sequential('createPrismaClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.PARAKO_ROOT = '/srv/parako';
    delete process.env.PG_SSL_REJECT_UNAUTHORIZED;
    mocks.existsSync.mockReturnValue(true);
    mocks.createRequire.mockReturnValue(mocks.moduleLoader);
    mocks.moduleLoader.mockReturnValue({
      PrismaClient: mocks.generatedPrismaClient,
      Prisma: { defineExtension: mocks.generatedDefineExtension },
    });
    mocks.sqliteClient.$executeRaw.mockReset().mockResolvedValue(undefined);
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
    mocks.sqliteClient.$executeRaw.mockImplementation(
      () =>
        pending[mocks.sqliteClient.$executeRaw.mock.calls.length - 1]!.promise
    );
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({
      storage: { adapter: 'sqlite', sqlite: { path: './data/test.db' } },
    } as never);

    expect(mocks.sqliteClient.$executeRaw).toHaveBeenCalledTimes(1);
    pending[0]!.resolve(undefined);
    await vi.waitFor(() => {
      expect(mocks.sqliteClient.$executeRaw).toHaveBeenCalledTimes(2);
    });
    pending[1]!.resolve(undefined);
    pending[2]!.resolve(undefined);
    pending[3]!.resolve(undefined);
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
      adapter: { kind: 'sqlite-adapter' },
    });
    await vi.waitFor(() => {
      expect(mocks.sqliteClient.$executeRaw).toHaveBeenCalledTimes(4);
    });
    expect(
      mocks.sqliteClient.$executeRaw.mock.calls.map(([strings]) => strings[0])
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

    await vi.waitFor(() => {
      expect(mocks.sqliteClient.$executeRaw).toHaveBeenCalledTimes(4);
    });
    expect(
      mocks.sqliteClient.$executeRaw.mock.calls.map(([strings]) => strings[0])
    ).toContain('PRAGMA synchronous = FULL');
  });

  it('reports SQLite PRAGMA failures and continues the queue', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sqliteClient.$executeRaw
      .mockRejectedValueOnce(new Error('read only'))
      .mockRejectedValueOnce('not supported')
      .mockResolvedValue(undefined);
    const { createPrismaClient } = await import('../../../src/db/prisma.js');

    createPrismaClient({ storage: { adapter: 'sqlite' } } as never);

    await vi.waitFor(() => {
      expect(mocks.sqliteClient.$executeRaw).toHaveBeenCalledTimes(4);
      expect(error).toHaveBeenCalledTimes(2);
    });
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
