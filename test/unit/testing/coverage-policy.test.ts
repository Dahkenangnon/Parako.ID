import { describe, expect, it } from 'vitest';

import vitestConfig from '../../../vitest.config.js';

const GLOBAL_THRESHOLD_KEYS = new Set([
  'autoUpdate',
  'branches',
  'functions',
  'lines',
  'perFile',
  'statements',
]);

function coverageConfiguration() {
  const coverage = vitestConfig.test?.coverage;
  if (!coverage) throw new Error('Vitest coverage is not configured');
  return coverage;
}

describe('coverage policy', () => {
  it('exposes enforceable global floors using the Vitest 4 threshold shape', () => {
    expect(coverageConfiguration().thresholds).toMatchObject({
      branches: 16.01,
      functions: 21.19,
      lines: 18.22,
      statements: 18.07,
    });
    expect(coverageConfiguration().thresholds).not.toHaveProperty('global');
  });

  it('measures application sources and production scripts', () => {
    expect(coverageConfiguration().include).toEqual([
      'src/**/*.{js,ts}',
      'scripts/**/*.{js,mjs,ts}',
    ]);
  });

  it('excludes only TypeScript declarations from production coverage', () => {
    expect(coverageConfiguration().exclude).toEqual(['src/**/*.d.ts']);
  });

  it('emits every coverage artifact required by CI', () => {
    expect(coverageConfiguration().reporter).toEqual(
      expect.arrayContaining(['text', 'json-summary', 'lcov', 'html'])
    );
  });

  it('keeps every file-specific ratchet at absolute coverage', () => {
    const entries = Object.entries(
      coverageConfiguration().thresholds ?? {}
    ).filter(([key]) => !GLOBAL_THRESHOLD_KEYS.has(key));

    expect(entries.length).toBeGreaterThan(0);
    for (const [filePattern, threshold] of entries) {
      expect(filePattern).toMatch(/^(scripts|src)\//);
      expect(threshold, filePattern).toEqual({ 100: true });
    }
  });
});
