import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findProjectRoot,
  resolveAdapterEnvironment,
} from '../../../scripts/manage/database.js';

const ORIGINAL_ENV = { ...process.env };

describe('database lifecycle CLI', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('finds the repository root from a nested path', () => {
    expect(findProjectRoot(path.join(process.cwd(), 'scripts', 'manage'))).toBe(
      process.cwd()
    );
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

  it('uses STORAGE_POSTGRESQL_URL for PostgreSQL migrations', () => {
    process.env.STORAGE_ADAPTER = 'postgresql';
    process.env.STORAGE_POSTGRESQL_URL = 'postgresql://parako:secret@db/parako';

    const resolved = resolveAdapterEnvironment(process.cwd());

    expect(resolved.config).toBe('prisma.config.pg.ts');
    expect(resolved.env.DATABASE_URL).toBe(
      'postgresql://parako:secret@db/parako'
    );
  });

  it('fails closed when a required remote database URL is missing', () => {
    process.env.STORAGE_ADAPTER = 'mongodb';
    delete process.env.STORAGE_MONGODB_URI;

    expect(() => resolveAdapterEnvironment(process.cwd())).toThrow(
      'STORAGE_MONGODB_URI is required'
    );
  });
});
