import { describe, expect, it } from 'vitest';

import {
  AppLogger,
  MetricsService,
  normalizeRoute,
  rootLogger,
  sanitizeLabel,
} from '../../../src/observability/index.js';

describe('observability public exports', () => {
  it('exposes the logging and metrics APIs from one entry point', () => {
    expect(AppLogger).toBeTypeOf('function');
    expect(MetricsService).toBeTypeOf('function');
    expect(normalizeRoute).toBeTypeOf('function');
    expect(sanitizeLabel).toBeTypeOf('function');
    expect(rootLogger).toBeTypeOf('object');
  });
});
