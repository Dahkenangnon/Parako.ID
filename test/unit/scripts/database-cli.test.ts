import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findProjectRoot,
  loadRuntimeEnvironment,
  resolveAdapterEnvironment,
} from '../../../scripts/manage/database.js';

const ORIGINAL_ENV = { ...process.env };

describe('database lifecycle CLI', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('finds the repository root from a nested path', () => {
    expect(findProjectRoot(path.join(process.cwd(), 'scripts', 'manage'))).toBe(
      process.cwd()
    );
  });

  it('fails clearly when no release root can be found', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(() => findProjectRoot('/missing/release')).toThrow(
      'Could not locate a Parako.ID release root'
    );
  });

  it('loads an explicit runtime environment file only when it exists', () => {
    const loadEnvFile = vi
      .spyOn(process, 'loadEnvFile')
      .mockImplementation(() => {});
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    process.env.PARAKO_ENV_FILE = '/secure/parako.env';

    loadRuntimeEnvironment('/project');
    expect(exists).toHaveBeenCalledWith('/secure/parako.env');
    expect(loadEnvFile).toHaveBeenCalledWith('/secure/parako.env');

    exists.mockReturnValueOnce(false);
    loadRuntimeEnvironment('/project');
    expect(loadEnvFile).toHaveBeenCalledOnce();
  });

  it('maps the SQLite bootstrap path to an absolute Prisma URL', () => {
    process.env.STORAGE_ADAPTER = 'sqlite';
    process.env.STORAGE_SQLITE_PATH = './runtime/data/example.db';
    delete process.env.DATABASE_URL;

    const resolved = resolveAdapterEnvironment(process.cwd());

    expect(resolved.config).toBe('prisma.config.ts');
    expect(resolved.env.DATABASE_URL).toBe(
      `file:${path.join(process.cwd(), 'runtime', 'data', 'example.db')}`
    );
  });

  it('supports SQLite defaults, absolute paths, and explicit database URLs', () => {
    delete process.env.STORAGE_ADAPTER;
    delete process.env.STORAGE_SQLITE_PATH;
    delete process.env.DATABASE_URL;
    expect(resolveAdapterEnvironment('/project').env.DATABASE_URL).toBe(
      'file:/project/runtime/data/parako.db'
    );

    process.env.STORAGE_SQLITE_PATH = '/data/parako.db';
    expect(resolveAdapterEnvironment('/project').env.DATABASE_URL).toBe(
      'file:/data/parako.db'
    );

    process.env.DATABASE_URL = 'file:/override.db';
    expect(resolveAdapterEnvironment('/project').env.DATABASE_URL).toBe(
      'file:/override.db'
    );
  });

  it('uses STORAGE_POSTGRESQL_URL for PostgreSQL migrations', () => {
    process.env.STORAGE_ADAPTER = 'postgresql';
    process.env.STORAGE_POSTGRESQL_URL = 'postgresql://parako:secret@db/parako';

    const resolved = resolveAdapterEnvironment(process.cwd());

    expect(resolved.config).toBe('prisma.config.pg.ts');
    expect(resolved.env.DATABASE_URL).toBe(
      'postgresql://parako:secret@db/parako'
    );
  });

  it('accepts the standard database URL for PostgreSQL and requires one', () => {
    process.env.STORAGE_ADAPTER = 'postgresql';
    delete process.env.STORAGE_POSTGRESQL_URL;
    process.env.DATABASE_URL = 'postgresql://db/parako';
    expect(resolveAdapterEnvironment('/project').env.DATABASE_URL).toBe(
      'postgresql://db/parako'
    );

    delete process.env.DATABASE_URL;
    expect(() => resolveAdapterEnvironment('/project')).toThrow(
      'STORAGE_POSTGRESQL_URL is required'
    );

    process.env.STORAGE_POSTGRESQL_URL = 'https://db.example.com/parako';
    expect(() => resolveAdapterEnvironment('/project')).toThrow(
      'PostgreSQL URL must use postgres:// or postgresql://'
    );

    process.env.STORAGE_POSTGRESQL_URL = 'postgresql://';
    expect(() => resolveAdapterEnvironment('/project')).toThrow(
      'STORAGE_POSTGRESQL_URL must be a valid URL'
    );
  });

  it('fails closed when a required remote database URL is missing', () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    delete process.env.STORAGE_MONGODB_URI;

    expect(() => resolveAdapterEnvironment(process.cwd())).toThrow(
      'STORAGE_MONGODB_URI is required'
    );
  });

  it('rejects a non-MongoDB URI scheme', () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'https://db.example.com/parako';

    expect(() => resolveAdapterEnvironment('/project')).toThrow(
      'MongoDB URI must use mongodb:// or mongodb+srv://'
    );
  });

  it('rejects a MongoDB URI without a database host', () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI = 'mongodb://';

    expect(() => resolveAdapterEnvironment('/project')).toThrow(
      'STORAGE_MONGODB_URI must be a valid URI'
    );
  });

  it('accepts a MongoDB replica-set URI with multiple hosts', () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI =
      'mongodb://db-1:27017,db-2:27017/parako?replicaSet=rs0';

    expect(resolveAdapterEnvironment('/project').env.STORAGE_MONGODB_URI).toBe(
      process.env.STORAGE_MONGODB_URI
    );
  });

  it('returns MongoDB configuration and rejects unsupported adapters', () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    process.env.STORAGE_MONGODB_URI =
      'mongodb+srv://cluster.example.com/parako';
    const resolved = resolveAdapterEnvironment('/project');
    expect(resolved).toMatchObject({
      adapter: 'mongodb',
      env: {
        STORAGE_MONGODB_URI: 'mongodb+srv://cluster.example.com/parako',
      },
    });
    expect(resolved).not.toHaveProperty('config');

    process.env.STORAGE_ADAPTER = 'mysql';
    expect(() => resolveAdapterEnvironment('/project')).toThrow(
      'Unsupported STORAGE_ADAPTER "mysql"'
    );
  });
});
