import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

export default defineConfig({
  root: repositoryRoot,
  test: {
    environment: 'node',
    globalSetup: [
      resolve(
        repositoryRoot,
        'test/integration/config/postgresql-global-setup.ts'
      ),
    ],
    include: [
      'test/integration/db/extensions/tenant-postgresql-runtime.test.ts',
      'test/integration/config/config-manager-redis-invalidation.test.ts',
      'test/integration/scripts/admin-cli.postgresql.test.ts',
      'test/integration/scripts/database-cli.postgresql.test.ts',
    ],
    env: { CONFIG_INVALIDATION_STORAGE_ADAPTER: 'postgresql' },
    testTimeout: 10_000,
    hookTimeout: 120_000,
    globals: true,
    reporters: ['verbose'],
    setupFiles: [
      resolve(
        repositoryRoot,
        'test/integration/config/postgresql-test-setup.ts'
      ),
    ],
  },
  resolve: {
    alias: {
      '@': resolve(repositoryRoot, 'src'),
    },
  },
});
