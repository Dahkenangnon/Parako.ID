import { describe, expect, it } from 'vitest';

import { resolvePostgresqlTestUrl } from '../../../scripts/testing/postgresql-test-url.js';

describe('resolvePostgresqlTestUrl', () => {
  it('prefers purpose-specific URLs before the full-matrix and generic fallbacks', () => {
    expect(
      resolvePostgresqlTestUrl({
        CONTRACT_DATABASE_URL: 'postgresql://contract.example.test/parako',
        STORAGE_POSTGRESQL_URL: 'postgresql://storage.example.test/parako',
        PARAKO_E2E_POSTGRESQL_URL: 'postgresql://matrix.example.test/parako',
        DATABASE_URL: 'postgresql://generic.example.test/parako',
      })
    ).toBe('postgresql://contract.example.test/parako');

    expect(
      resolvePostgresqlTestUrl({
        STORAGE_POSTGRESQL_URL: 'postgresql://storage.example.test/parako',
        PARAKO_E2E_POSTGRESQL_URL: 'postgresql://matrix.example.test/parako',
        DATABASE_URL: 'postgresql://generic.example.test/parako',
      })
    ).toBe('postgresql://storage.example.test/parako');
  });

  it('accepts the full verification matrix URL before the generic fallback', () => {
    expect(
      resolvePostgresqlTestUrl({
        PARAKO_E2E_POSTGRESQL_URL: 'postgresql://matrix.example.test/parako',
        DATABASE_URL: 'postgresql://generic.example.test/parako',
      })
    ).toBe('postgresql://matrix.example.test/parako');
  });

  it('ignores blank values and returns undefined when no URL is configured', () => {
    expect(
      resolvePostgresqlTestUrl({
        CONTRACT_DATABASE_URL: ' ',
        STORAGE_POSTGRESQL_URL: '',
        PARAKO_E2E_POSTGRESQL_URL: '\t',
        DATABASE_URL: 'postgresql://generic.example.test/parako',
      })
    ).toBe('postgresql://generic.example.test/parako');
    expect(resolvePostgresqlTestUrl({})).toBeUndefined();
  });
});
