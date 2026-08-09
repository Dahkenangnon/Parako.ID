import { describe, expect, it, vi } from 'vitest';
import { resolveSqliteDatabasePath } from '../../../src/db/prisma.js';

describe('resolveSqliteDatabasePath', () => {
  it('resolves relative runtime paths from PARAKO_ROOT', () => {
    expect(
      resolveSqliteDatabasePath('./runtime/data/parako.db', '/srv/parako')
    ).toBe('/srv/parako/runtime/data/parako.db');
  });

  it('accepts Prisma file URLs without duplicating the prefix', () => {
    expect(
      resolveSqliteDatabasePath('file:./runtime/data/parako.db', '/srv/parako')
    ).toBe('/srv/parako/runtime/data/parako.db');
  });

  it('preserves absolute paths', () => {
    expect(
      resolveSqliteDatabasePath('/var/lib/parako/parako.db', '/srv/parako')
    ).toBe('/var/lib/parako/parako.db');
  });

  it('falls back to the current working directory without PARAKO_ROOT', () => {
    const previousRoot = process.env.PARAKO_ROOT;
    delete process.env.PARAKO_ROOT;
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/workspace/parako');

    try {
      expect(resolveSqliteDatabasePath('./data/parako.db')).toBe(
        '/workspace/parako/data/parako.db'
      );
      expect(cwd).toHaveBeenCalledOnce();
    } finally {
      cwd.mockRestore();
      if (previousRoot === undefined) delete process.env.PARAKO_ROOT;
      else process.env.PARAKO_ROOT = previousRoot;
    }
  });
});
