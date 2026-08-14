import process from 'node:process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => {
  const connect = vi.fn();
  const close = vi.fn();
  const command = vi.fn();
  const createIndex = vi.fn();
  const ledgerToArray = vi.fn();
  const migrationsToArray = vi.fn();
  const sort = vi.fn(() => ({ toArray: migrationsToArray }));
  const find = vi.fn(() => ({ sort }));
  const collection = vi.fn(() => ({ createIndex, find }));
  const listCollections = vi.fn(() => ({ toArray: ledgerToArray }));
  const db = vi.fn(() => ({ command, collection, listCollections }));
  const client = { connect, close, db };

  return {
    client,
    close,
    collection,
    command,
    connect,
    createIndex,
    db,
    existsSync: vi.fn(),
    find,
    ledgerToArray,
    migrationsToArray,
    mongoClient: vi.fn(function () {
      return client;
    }),
    sort,
    spawnSync: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  spawnSync: dependencies.spawnSync,
}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: { ...actual, existsSync: dependencies.existsSync },
  };
});
vi.mock('mongodb', () => ({ MongoClient: dependencies.mongoClient }));
vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => false,
}));

import {
  baselineExistingDatabase,
  buildProgram,
  databaseStatus,
  migrateDatabase,
  redactDatabaseOutput,
} from '../../../scripts/manage/database.js';

const ORIGINAL_ENV = { ...process.env };

describe('database lifecycle operations', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      PARAKO_ROOT: '/project',
      STORAGE_ADAPTER: 'sqlite',
      STORAGE_SQLITE_PATH: '/data/parako.db',
    };
    delete process.env.PARAKO_ENV_FILE;
    delete process.env.DATABASE_URL;
    dependencies.existsSync.mockImplementation(input => {
      const value = String(input);
      return (
        value.endsWith('/package.json') ||
        value.endsWith('/prisma') ||
        value.endsWith('/node_modules/prisma/build/index.js')
      );
    });
    dependencies.spawnSync.mockReturnValue({ status: 0 });
    dependencies.connect.mockResolvedValue(undefined);
    dependencies.close.mockResolvedValue(undefined);
    dependencies.command.mockResolvedValue({ ok: 1 });
    dependencies.createIndex.mockResolvedValue('id_1');
    dependencies.ledgerToArray.mockResolvedValue([]);
    dependencies.migrationsToArray.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('deploys pending SQLite migrations with the release-local Prisma CLI', async () => {
    await migrateDatabase();

    expect(dependencies.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [
        '/project/node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        '/project/prisma.config.ts',
      ],
      expect.objectContaining({
        cwd: '/project',
        encoding: 'utf8',
        env: expect.objectContaining({ DATABASE_URL: 'file:/data/parako.db' }),
      })
    );
  });

  it('forwards useful Prisma output without database paths or passwords', async () => {
    dependencies.spawnSync.mockReturnValue({
      status: 0,
      stdout:
        'Datasource at file:/data/parako.db\nDatabase path: /data/parako.db\n',
      stderr: 'Migration warning\n',
    });
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await migrateDatabase();

    expect(stdout).toHaveBeenCalledWith(
      'Datasource at [database-url]\nDatabase path: [database-path]\n'
    );
    expect(stderr).toHaveBeenCalledWith('Migration warning\n');
  });

  it('redacts database URLs and standalone encoded credentials safely', () => {
    const databaseUrl =
      'postgresql://operator:public%2Dtest%2Dpassword@db.example/parako';

    expect(
      redactDatabaseOutput(
        `${databaseUrl} public%2Dtest%2Dpassword public-test-password`,
        { DATABASE_URL: databaseUrl }
      )
    ).toBe('[database-url] [database-password] [database-password]');
    expect(redactDatabaseOutput('plain output', {})).toBe('plain output');
    expect(redactDatabaseOutput(Buffer.from('buffer output'), {})).toBe(
      'buffer output'
    );
    expect(redactDatabaseOutput(undefined, {})).toBe('');
    expect(
      redactDatabaseOutput('invalid-url remains useful', {
        DATABASE_URL: 'invalid-url',
      })
    ).toBe('[database-url] remains useful');
    expect(
      redactDatabaseOutput('public%ZZ', {
        DATABASE_URL: 'postgresql://operator:public%ZZ@db.example/parako',
      })
    ).toBe('[database-password]');
  });

  it('resolves the release root from the module location when not configured', async () => {
    delete process.env.PARAKO_ROOT;

    await migrateDatabase();

    expect(dependencies.spawnSync.mock.calls[0]?.[2]).toMatchObject({
      cwd: expect.stringMatching(/scripts\/manage$/),
    });
  });

  it('fails before spawning when the release-local Prisma CLI is missing', async () => {
    dependencies.existsSync.mockImplementation(input => {
      const value = String(input);
      return value.endsWith('/package.json') || value.endsWith('/prisma');
    });

    await expect(migrateDatabase()).rejects.toThrow(
      'Prisma CLI is missing from this release'
    );
    expect(dependencies.spawnSync).not.toHaveBeenCalled();
  });

  it('propagates process launch errors from Prisma', async () => {
    const failure = new Error('spawn failed');
    dependencies.spawnSync.mockReturnValue({ error: failure, status: null });

    await expect(databaseStatus()).rejects.toBe(failure);
  });

  it.each([
    [2, '2'],
    [null, 'unknown'],
  ])('rejects Prisma exit status %s', async (status, expected) => {
    dependencies.spawnSync.mockReturnValue({ status });

    await expect(databaseStatus()).rejects.toThrow(
      `Prisma exited with status ${expected}`
    );
  });

  it('initializes the MongoDB migration ledger and always closes the client', async () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await migrateDatabase();

    expect(dependencies.mongoClient).toHaveBeenCalledWith(
      'mongodb://db/parako',
      { serverSelectionTimeoutMS: 10_000 }
    );
    expect(dependencies.connect).toHaveBeenCalledOnce();
    expect(dependencies.command).toHaveBeenCalledWith({ ping: 1 });
    expect(dependencies.collection).toHaveBeenCalledWith('_parako_migrations');
    expect(dependencies.createIndex).toHaveBeenCalledWith(
      { id: 1 },
      { unique: true }
    );
    expect(dependencies.close).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith(
      'MongoDB migration ledger is ready; no migrations are pending.'
    );
  });

  it('closes MongoDB when a migration-ledger operation fails', async () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.command.mockRejectedValue(new Error('ping failed'));

    await expect(migrateDatabase()).rejects.toThrow('ping failed');
    expect(dependencies.close).toHaveBeenCalledOnce();
  });

  it('reports a reachable MongoDB database without a migration ledger', async () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await databaseStatus();

    expect(consoleLog).toHaveBeenCalledWith(
      'MongoDB is reachable; migration ledger is not initialized.'
    );
    expect(dependencies.find).not.toHaveBeenCalled();
  });

  it('reports every recorded MongoDB application migration', async () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';
    dependencies.ledgerToArray.mockResolvedValue([
      { name: '_parako_migrations' },
    ]);
    dependencies.migrationsToArray.mockResolvedValue([
      { id: '001', appliedAt: '2026-01-01' },
      { id: '002' },
    ]);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await databaseStatus();

    expect(dependencies.find).toHaveBeenCalledWith(
      {},
      { projection: { _id: 0, id: 1, appliedAt: 1 } }
    );
    expect(dependencies.sort).toHaveBeenCalledWith({ id: 1 });
    expect(consoleLog.mock.calls.flat().join('\n')).toContain(
      '2 application migration(s) recorded'
    );
    expect(consoleLog.mock.calls.flat().join('\n')).toContain(
      '001  2026-01-01'
    );
    expect(consoleLog.mock.calls.flat().join('\n')).toContain('002');
  });

  it('requires explicit confirmation before recording a Prisma baseline', async () => {
    await expect(baselineExistingDatabase(false)).rejects.toThrow(
      '--confirm-existing-schema'
    );
    expect(dependencies.spawnSync).not.toHaveBeenCalled();
  });

  it('rejects the Prisma baseline command for MongoDB', async () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'mongodb://db/parako';

    await expect(baselineExistingDatabase(true)).rejects.toThrow(
      'MongoDB does not use the Prisma baseline command'
    );
  });

  it('records the baseline migration for a relational database', async () => {
    process.env.STORAGE_ADAPTER = 'postgresql';
    process.env.STORAGE_POSTGRESQL_URL = 'postgresql://db/parako';

    await baselineExistingDatabase(true);

    expect(dependencies.spawnSync.mock.calls[0]?.[1]).toEqual([
      '/project/node_modules/prisma/build/index.js',
      'migrate',
      'resolve',
      '--applied',
      '20260714000000_baseline',
      '--config',
      '/project/prisma.config.pg.ts',
    ]);
  });

  it('registers status, migrate, and baseline commands', () => {
    const program = buildProgram();
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    expect(program.name()).toBe('parako-database');
    expect(program.version()).toBe(packageJson.version);
    expect(program.commands.map(command => command.name())).toEqual([
      'status',
      'migrate',
      'baseline',
    ]);
    expect(program.commands[2]?.options[0]?.long).toBe(
      '--confirm-existing-schema'
    );
  });

  it('dispatches a confirmed baseline command through Commander', async () => {
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'parako-database',
      'baseline',
      '--confirm-existing-schema',
    ]);

    expect(dependencies.spawnSync.mock.calls[0]?.[1]).toContain(
      '20260714000000_baseline'
    );
  });
});
