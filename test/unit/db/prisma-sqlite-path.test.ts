import { describe, expect, it } from 'vitest';
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
});
