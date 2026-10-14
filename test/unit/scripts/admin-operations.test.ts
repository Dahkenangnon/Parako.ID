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
      updateMany: vi.fn(),
    },
  };
  const mongo = {
    close: vi.fn(),
    connect: vi.fn(),
    insertOne: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
    toArray: vi.fn(),
  };
  const limit = vi.fn(() => ({ toArray: mongo.toArray }));
  const find = vi.fn(() => ({ limit }));
  const collection = vi.fn(() => ({
    find,
    findOne: mongo.findOne,
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
    operatorAudit: vi.fn(),
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
vi.mock('../../../scripts/manage/shared/operator-audit.js', () => ({
  writeOperatorAudit: dependencies.operatorAudit,
}));

import {
  buildProgram,
  createAdminActivation,
  hashActivationToken,
  replacePendingAdmin,
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
    dependencies.prisma.user.updateMany.mockResolvedValue({ count: 1 });
    dependencies.prisma.$disconnect.mockResolvedValue(undefined);
    dependencies.mongo.connect.mockResolvedValue(undefined);
    dependencies.mongo.close.mockResolvedValue(undefined);
    dependencies.mongo.toArray.mockResolvedValue([]);
    dependencies.mongo.insertOne.mockResolvedValue({ acknowledged: true });
    dependencies.mongo.findOne.mockResolvedValue(null);
    dependencies.mongo.updateOne.mockResolvedValue({ acknowledged: true });
    dependencies.operatorAudit.mockResolvedValue(undefined);
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

  it('replaces the sole pending SQLite administrator and invalidates its old token', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'pending-admin',
        email: 'wrong@example.com',
        password: null,
        roles: JSON.stringify(['admin']),
      },
    ]);

    const activationUrl = await replacePendingAdmin(
      'Correct@Example.com',
      'Correcting an address entered during deployment',
      30
    );
    const token = new URL(activationUrl).searchParams.get('token')!;

    expect(dependencies.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'pending-admin', password: null },
      data: expect.objectContaining({
        email: 'correct@example.com',
        reset_password_token: hashActivationToken(token),
        reset_password_expires: new Date('2026-08-03T12:30:00.000Z'),
      }),
    });
    expect(dependencies.operatorAudit).toHaveBeenNthCalledWith(
      1,
      '/project',
      expect.objectContaining({
        action: 'bootstrap_admin.replace_pending',
        status: 'attempt',
        reason: 'Correcting an address entered during deployment',
      })
    );
    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({ status: 'success' })
    );
  });

  it('does not replace an administrator activated after selection', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'pending-admin',
        email: 'wrong@example.com',
        password: null,
        roles: JSON.stringify(['admin']),
      },
    ]);
    dependencies.prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      replacePendingAdmin(
        'correct@example.com',
        'Activation raced with operator correction',
        60
      )
    ).rejects.toThrow('changed during replacement');

    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('requires exactly one pending administrator before replacement', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([]);

    await expect(
      replacePendingAdmin(
        'correct@example.com',
        'Correcting a missing pending administrator',
        60
      )
    ).rejects.toThrow('requires exactly one unactivated administrator');
    expect(dependencies.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a replacement email already assigned to another Prisma user', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'pending-admin',
        email: 'wrong@example.com',
        password: null,
        roles: JSON.stringify(['admin']),
      },
      {
        id: 'existing-user',
        email: 'correct@example.com',
        password: 'hash',
        roles: JSON.stringify(['user']),
      },
    ]);

    await expect(
      replacePendingAdmin(
        'correct@example.com',
        'Correcting a duplicate deployment address',
        60
      )
    ).rejects.toThrow('replacement email is already assigned');
    expect(dependencies.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('replaces a pending PostgreSQL administrator without an existing email', async () => {
    dependencies.resolved = {
      adapter: 'postgresql',
      config: 'prisma.config.pg.ts',
      env: { DATABASE_URL: 'postgresql://db/parako' },
    };
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'pending-admin',
        email: null,
        password: null,
        roles: JSON.stringify(['admin']),
      },
    ]);

    await replacePendingAdmin(
      'correct@example.com',
      'Correcting the pending PostgreSQL administrator',
      60
    );

    expect(dependencies.createPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        storage: {
          adapter: 'postgresql',
          postgresql: { url: 'postgresql://db/parako' },
          sqlite: undefined,
        },
      })
    );
    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({
        status: 'success',
        target: expect.objectContaining({ previousEmail: '' }),
      })
    );
  });

  it('refuses pending-administrator replacement after activation', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'active-admin',
        email: 'active@example.com',
        password: 'password-hash',
        roles: JSON.stringify(['admin']),
      },
    ]);

    await expect(
      replacePendingAdmin(
        'new@example.com',
        'Attempted correction after activation',
        60
      )
    ).rejects.toThrow('activated administrator already exists');
    expect(dependencies.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('replaces the sole pending MongoDB administrator', async () => {
    dependencies.resolved = {
      adapter: 'mongodb',
      env: { STORAGE_MONGODB_URI: 'mongodb://db/parako' },
    };
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.mongo.toArray.mockResolvedValue([
      { _id: 'mongo-id', email: null, password: null },
    ]);
    dependencies.mongo.updateOne.mockResolvedValue({ matchedCount: 1 });

    const activationUrl = await replacePendingAdmin(
      'new@example.com',
      'Correcting the pending MongoDB administrator',
      20
    );
    const token = new URL(activationUrl).searchParams.get('token')!;

    expect(dependencies.mongo.findOne).toHaveBeenCalledWith({
      email: 'new@example.com',
      _id: { $ne: 'mongo-id' },
    });
    expect(dependencies.mongo.updateOne).toHaveBeenCalledWith(
      { _id: 'mongo-id', password: null },
      {
        $set: expect.objectContaining({
          email: 'new@example.com',
          reset_password_token: hashActivationToken(token),
        }),
      }
    );
    expect(dependencies.operatorAudit).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({
        status: 'success',
        target: expect.objectContaining({ previousEmail: '' }),
      })
    );
  });

  it('rejects a replacement email already assigned to another MongoDB user', async () => {
    dependencies.resolved = {
      adapter: 'mongodb',
      env: { STORAGE_MONGODB_URI: 'mongodb://db/parako' },
    };
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.mongo.toArray.mockResolvedValue([
      { _id: 'mongo-id', email: 'wrong@example.com', password: null },
    ]);
    dependencies.mongo.findOne.mockResolvedValue({ _id: 'existing-user' });

    await expect(
      replacePendingAdmin(
        'new@example.com',
        'Correcting a duplicate MongoDB administrator address',
        60
      )
    ).rejects.toThrow('replacement email is already assigned');
    expect(dependencies.mongo.updateOne).not.toHaveBeenCalled();
  });

  it('does not replace a MongoDB administrator activated after selection', async () => {
    dependencies.resolved = {
      adapter: 'mongodb',
      env: { STORAGE_MONGODB_URI: 'mongodb://db/parako' },
    };
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.mongo.toArray.mockResolvedValue([
      { _id: 'mongo-id', email: 'wrong@example.com', password: null },
    ]);
    dependencies.mongo.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(
      replacePendingAdmin(
        'new@example.com',
        'Activation raced with MongoDB operator correction',
        60
      )
    ).rejects.toThrow('changed during replacement');
  });

  it('requires a meaningful audit reason for pending-administrator replacement', async () => {
    await expect(
      replacePendingAdmin('new@example.com', 'short', 60)
    ).rejects.toThrow('reason must be between 10 and 500 characters');
    expect(dependencies.createPrismaClient).not.toHaveBeenCalled();
    expect(dependencies.operatorAudit).not.toHaveBeenCalled();
  });

  it('rejects an excessively long pending-administrator audit reason', async () => {
    await expect(
      replacePendingAdmin('new@example.com', 'x'.repeat(501), 60)
    ).rejects.toThrow('reason must be between 10 and 500 characters');
    expect(dependencies.operatorAudit).not.toHaveBeenCalled();
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

  it('registers and dispatches the pending-administrator replacement command', async () => {
    dependencies.prisma.user.findMany.mockResolvedValue([
      {
        id: 'pending-admin',
        email: 'wrong@example.com',
        password: null,
        roles: JSON.stringify(['admin']),
      },
    ]);
    const program = buildProgram();
    program.exitOverride();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'parako-admin',
      'replace-pending',
      '--email',
      'correct@example.com',
      '--reason',
      'Correcting the deployment administrator address',
      '--expires-minutes',
      '20',
    ]);

    const output = consoleLog.mock.calls.flat().join('\n');
    expect(output).toContain('Replacement administrator activation URL:');
    expect(output).toContain(
      'https://id.example.com/auth/reset-password?token='
    );
    expect(output).toContain('The previous activation URL is invalid.');
  });
});
