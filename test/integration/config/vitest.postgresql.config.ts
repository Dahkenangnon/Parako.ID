import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

export default defineConfig({
  root: repositoryRoot,
  test: {
    environment: 'node',
    include: [
      'test/integration/db/extensions/tenant-postgresql-runtime.test.ts',
    ],
    testTimeout: 10_000,
    hookTimeout: 120_000,
    globals: true,
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': resolve(repositoryRoot, 'src'),
    },
  },
});
