import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadTestingEnvironment } from '../../../scripts/testing/environment.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('testing environment', () => {
  it('loads local settings while preserving explicit command overrides', () => {
    const root = mkdtempSync(join(tmpdir(), 'parako-testing-environment-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'runtime'));
    writeFileSync(
      join(root, 'runtime/.env'),
      [
        'PARAKO_E2E_POSTGRESQL_URL=postgresql://local.test/parako',
        'REDIS_HOST=runtime-redis',
        'REDIS_PORT=6379',
        '',
      ].join('\n')
    );
    writeFileSync(
      join(root, 'runtime/.env.local'),
      'REDIS_PORT=6380\nREDIS_DATABASE=15\n'
    );

    expect(
      loadTestingEnvironment(root, {
        REDIS_HOST: 'explicit-redis',
        CI: 'true',
      })
    ).toMatchObject({
      PARAKO_E2E_POSTGRESQL_URL: 'postgresql://local.test/parako',
      REDIS_HOST: 'explicit-redis',
      REDIS_PORT: '6380',
      REDIS_DATABASE: '15',
      CI: 'true',
    });
  });
});
