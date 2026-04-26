import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Glob patterns for test files
    include: ['test/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist', '**/*.d.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './test-results/coverage',
      include: ['src/**/*.{js,ts}'],
      exclude: [
        'test/**/*.{test,spec}.{js,ts}',
        'src/**/*.d.ts',
        'src/**/index.ts', // Entry points
        'src/types/**',
        'src/**/types.ts',
        'src/**/interfaces.ts',
        'src/**/schemas.ts',
        'src/**/constants.ts',
        'src/**/config.ts',
        'src/**/index.ts',
        'src/**/vite.config.ts',
        'src/**/vitest.config.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },

    // Test timeout
    testTimeout: 10000,
    hookTimeout: 120000,

    // Setup files
    setupFiles: [],

    // Global test configuration
    globals: true,

    // TypeScript configuration
    typecheck: {
      tsconfig: './tsconfig.json',
    },

    // Reporter configuration
    reporters: ['verbose', 'json', 'html'],
    outputFile: {
      json: './test-results/test-results.json',
      html: './test-results/test-results.html',
    },
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
