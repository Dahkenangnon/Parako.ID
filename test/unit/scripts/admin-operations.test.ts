import { readFileSync } from 'node:fs';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => {
  const prisma = {
    $disconnect: vi.fn(),
    user: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const mongo = {
    close: vi.fn(),
    connect: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    toArray: vi.fn(),
  };
  const limit = vi.fn(() => ({ toArray: mongo.toArray }));
  const find = vi.fn(() => ({ limit }));
  const collection = vi.fn(() => ({
    find,
    insertOne: mongo.insertOne,
    updateOne: mongo.updateOne,
  }));
  const db = vi.fn(() => ({ collection }));
  const client = { close: mongo.close, connect: mongo.connect, db };

  return {
    client,
    collection,
    createPrismaClient: vi.fn(() => prisma),
    db,
    find,
    findProjectRoot: vi.fn(() => '/project'),
    limit,
    loadRuntimeEnvironment: vi.fn(),
    mongo,
    mongoClient: vi.fn(function () {
      return client;
    }),
    prisma,
    resolved: {
      adapter: 'sqlite',
      config: 'prisma.config.ts',
      env: { DATABASE_URL: 'file:/data/parako.db' },
    } as {
      adapter: 'sqlite' | 'postgresql' | 'mongodb';
      config?: string;
      env: NodeJS.ProcessEnv;
    },
    resolveAdapterEnvironment: vi.fn(() => dependencies.resolved),
  };
});

vi.mock('../../../src/db/prisma.js', () => ({
  createPrismaClient: dependencies.createPrismaClient,
}));
vi.mock('../../../scripts/manage/database.js', () => ({
  findProjectRoot: dependencies.findProjectRoot,
  loadRuntimeEnvironment: dependencies.loadRuntimeEnvironment,
  resolveAdapterEnvironment: dependencies.resolveAdapterEnvironment,
}));
vi.mock('mongodb', () => ({ MongoClient: dependencies.mongoClient }));
vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => false,
}));

import {
  buildProgram,
  createAdminActivation,
  hashActivationToken,
  selectReissuableAdmin,
} from '../../../scripts/manage/admin.js';

const ORIGINAL_ENV = { ...process.env };

describe('administrator activation lifecycle', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      DEPLOYMENT_URL: 'https://id.example.com',
      PARAKO_ROOT: '/project',
    };
    delete process.env.DEPLOYMENT_SERVER_PORT;
    dependencies.resolved = {
      adapter: 'sqlite',
      config: 'prisma.config.ts',
      env: { DATABASE_URL: 'file:/data/parako.db' },
    };
    dependencies.prisma.user.findMany.mockResolvedValue([]);
    dependencies.prisma.user.create.mockResolvedValue({});
    dependencies.prisma.user.update.mockResolvedValue({});
    dependencies.prisma.$disconnect.mockResolvedValue(undefined);
    dependencies.mongo.connect.mockResolvedValue(undefined);
    dependencies.mongo.close.mockResolvedValue(undefined);
    dependencies.mongo.toArray.mockResolvedValue([]);
    dependencies.mongo.insertOne.mockResolvedValue({ acknowledged: true });
    dependencies.mongo.updateOne.mockResolvedValue({ acknowledged: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    ['invalid', 60, 'valid administrator email'],
    ['admin@example.com', 4, 'between 5 and 1440 minutes'],
    ['admin@example.com', 1441, 'between 5 and 1440 minutes'],
    ['admin@example.com', 5.5, 'between 5 and 1440 minutes'],
  ])('rejects invalid activation input %#', async (email, expiry, message) => {
    await expect(createAdminActivation(email, expiry)).rejects.toThrow(message);
    expect(dependencies.createPrismaClient).not.toHaveBeenCalled();
  });

  it('refuses the single-tenant activation workflow in multi-tenant mode', async () => {
    process.env.MULTI_TENANCY_ENABLED = 'true';

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow(
      'The administrator activation CLI supports only single-tenant deployments'
    );
    expect(dependencies.resolveAdapterEnvironment).not.toHaveBeenCalled();
    expect(dependencies.createPrismaClient).not.toHaveBeenCalled();
    expect(dependencies.mongoClient).not.toHaveBeenCalled();
  });

  it('rejects malformed multi-tenancy configuration before adapter access', async () => {
    process.env.MULTI_TENANCY_ENABLED = 'truthy';

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow('MULTI_TENANCY_ENABLED must be true or false');
    expect(dependencies.resolveAdapterEnvironment).not.toHaveBeenCalled();
    expect(dependencies.createPrismaClient).not.toHaveBeenCalled();
    expect(dependencies.mongoClient).not.toHaveBeenCalled();
  });

  it('requires an HTTPS deployment URL before writing an activation', async () => {
    process.env.DEPLOYMENT_URL = 'http://id.example.com';

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow('DEPLOYMENT_URL must be configured with HTTPS');
  });

  it('rejects a malformed HTTPS deployment URL before writing an activation', async () => {
    process.env.DEPLOYMENT_URL = 'https://';

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow(
      'DEPLOYMENT_URL must be configured with HTTPS and be a valid URL'
    );
    expect(dependencies.prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects deployment URLs containing credentials before writing an activation', async () => {
    process.env.DEPLOYMENT_URL = 'https://operator:secret@id.example.com';

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow('DEPLOYMENT_URL must not contain credentials');
    expect(dependencies.prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid deployment server port before writing an activation', async () => {
    process.env.DEPLOYMENT_SERVER_PORT = 'not-a-port';

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow(
      'DEPLOYMENT_SERVER_PORT must be an integer between 1 and 65535'
    );
    expect(dependencies.createPrismaClient).not.toHaveBeenCalled();
  });

  it('resolves the release root from the module and rejects a missing deployment URL', async () => {
    delete process.env.PARAKO_ROOT;
    delete process.env.DEPLOYMENT_URL;

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow('DEPLOYMENT_URL must be configured with HTTPS');
    expect(dependencies.findProjectRoot).toHaveBeenCalledWith(
      expect.stringMatching(/scripts\/manage$/)
    );
  });

  it('creates a pending SQLite administrator with a hashed expiring token', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      { id: 'array', roles: ['viewer', 4] },
      { id: 'json', roles: JSON.stringify(['viewer', 4]) },
      { id: 'object', roles: JSON.stringify({ admin: true }) },
      { id: 'invalid', roles: '{' },
      { id: 'null', roles: null },
    ]);

    const activationUrl = await createAdminActivation('Admin@Example.com', 60);

    const token = new URL(activationUrl).searchParams.get('token')!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencies.createPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: { environment: 'production', server: { port: 9007 } },
        storage: {
          adapter: 'sqlite',
          sqlite: { path: '/data/parako.db' },
          postgresql: undefined,
        },
      })
    );
    expect(dependencies.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'admin@example.com',
        roles: JSON.stringify(['admin']),
        reset_password_token: hashActivationToken(token),
        reset_password_expires: new Date('2026-08-03T13:00:00.000Z'),
      }),
    });
    expect(dependencies.prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('uses one validated database configuration snapshot per activation', async () => {
    await createAdminActivation('admin@example.com', 60);

    expect(dependencies.loadRuntimeEnvironment).toHaveBeenCalledOnce();
    expect(dependencies.resolveAdapterEnvironment).toHaveBeenCalledOnce();
  });

  it('reissues the sole pending PostgreSQL administrator activation', async () => {
    process.env.DEPLOYMENT_SERVER_PORT = '9443';
    dependencies.resolved = {
      adapter: 'postgresql',
      config: 'prisma.config.pg.ts',
      env: { DATABASE_URL: 'postgresql://db/parako' },
    };
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'pending-admin',
        email: 'admin@example.com',
        password: null,
        roles: JSON.stringify(['admin']),
      },
    ]);

    const activationUrl = await createAdminActivation('ADMIN@example.com', 30);
    const token = new URL(activationUrl).searchParams.get('token')!;

    expect(dependencies.createPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: { environment: 'production', server: { port: 9443 } },
        storage: {
          adapter: 'postgresql',
          sqlite: undefined,
          postgresql: { url: 'postgresql://db/parako' },
        },
      })
    );
    expect(dependencies.prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'pending-admin' },
      data: {
        reset_password_token: hashActivationToken(token),
        reset_password_expires: new Date('2026-08-03T12:30:00.000Z'),
      },
    });
    expect(dependencies.prisma.user.create).not.toHaveBeenCalled();
    expect(dependencies.prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects Prisma when administrator selection fails', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'active-admin',
        email: 'admin@example.com',
        password: 'hash',
        roles: ['admin'],
      },
    ]);

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow('activated administrator already exists');
    expect(dependencies.prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('creates a pending MongoDB administrator and closes the client', async () => {
    dependencies.resolved = {
      adapter: 'mongodb',
      env: { STORAGE_MONGODB_URI: 'mongodb://db/parako' },
    };
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';

    const activationUrl = await createAdminActivation('Admin@Example.com', 15);
    const token = new URL(activationUrl).searchParams.get('token')!;

    expect(dependencies.mongoClient).toHaveBeenCalledWith(
      'mongodb://db/parako',
      { serverSelectionTimeoutMS: 10_000 }
    );
    expect(dependencies.find).toHaveBeenCalledWith({
      roles: { $in: ['admin', 'superadmin', 'platform_admin'] },
    });
    expect(dependencies.limit).toHaveBeenCalledWith(2);
    expect(dependencies.mongo.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        roles: ['admin'],
        reset_password_token: hashActivationToken(token),
        reset_password_expires: new Date('2026-08-03T12:15:00.000Z'),
      })
    );
    expect(dependencies.mongo.close).toHaveBeenCalledOnce();
  });

  it('reissues a matching pending MongoDB administrator activation', async () => {
    dependencies.resolved = {
      adapter: 'mongodb',
      env: { STORAGE_MONGODB_URI: 'mongodb://db/parako' },
    };
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.mongo.toArray.mockResolvedValue([
      { _id: 'mongo-id', email: 'admin@example.com', password: null },
    ]);

    const activationUrl = await createAdminActivation('admin@example.com', 20);
    const token = new URL(activationUrl).searchParams.get('token')!;

    expect(dependencies.mongo.updateOne).toHaveBeenCalledWith(
      { _id: 'mongo-id' },
      {
        $set: {
          reset_password_token: hashActivationToken(token),
          reset_password_expires: new Date('2026-08-03T12:20:00.000Z'),
          updated_at: new Date('2026-08-03T12:00:00.000Z'),
        },
      }
    );
    expect(dependencies.mongo.insertOne).not.toHaveBeenCalled();
  });

  it('closes MongoDB when activation persistence fails', async () => {
    dependencies.resolved = {
      adapter: 'mongodb',
      env: { STORAGE_MONGODB_URI: 'mongodb://db/parako' },
    };
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.mongo.toArray.mockRejectedValue(new Error('query failed'));

    await expect(
      createAdminActivation('admin@example.com', 60)
    ).rejects.toThrow('query failed');
    expect(dependencies.mongo.close).toHaveBeenCalledOnce();
  });

  it('rejects multiple pending administrators as an ambiguous bootstrap state', () => {
    expect(() =>
      selectReissuableAdmin(
        [
          { email: 'one@example.com', password: null },
          { email: 'two@example.com', password: null },
        ],
        'one@example.com'
      )
    ).toThrow('pending administrator activation');
  });

  it('registers and dispatches the bootstrap command', async () => {
    const program = buildProgram();
    program.exitOverride();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    await program.parseAsync([
      'node',
      'parako-admin',
      'bootstrap',
      '--email',
      'admin@example.com',
      '--expires-minutes',
      '10',
    ]);

    expect(program.name()).toBe('parako-admin');
    expect(program.version()).toBe(packageJson.version);
    expect(consoleLog.mock.calls.flat().join('\n')).toContain(
      'Single-use administrator activation URL:'
    );
    expect(consoleLog.mock.calls.flat().join('\n')).toContain(
      'https://id.example.com/auth/reset-password?token='
    );
  });
});
