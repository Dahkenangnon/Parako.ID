import { describe, it, expect } from 'vitest';
import { AppConfigSchema } from '../../../src/config/schemas/schema.js';
import {
  DEFAULT_FULL_CONFIG,
  getDefaultFullConfig,
} from '../../../src/config/constants.js';

describe('security.key_store schema', () => {
  it('should have key_store in security section with defaults', () => {
    // Parse a minimal security object — key_store should get defaults
    const result = AppConfigSchema.safeParse(DEFAULT_FULL_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const keyStore = result.data.security.key_store;
    expect(keyStore).toBeDefined();
    expect(keyStore.type).toBe('database');
    expect(keyStore.rotation_interval_days).toBe(90);
    expect(keyStore.overlap_window_seconds).toBe(7200);
    expect(keyStore.algorithms).toEqual(['RS256', 'ES256', 'EdDSA']);
    expect(keyStore.promotion_delay_ms).toBe(0);
  });

  it('should accept type "file"', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { type: 'file' };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.security.key_store.type).toBe('file');
  });

  it('should reject invalid type', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { type: 'invalid' };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept custom rotation_interval_days', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { rotation_interval_days: 30 };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.security.key_store.rotation_interval_days).toBe(30);
  });

  it('should reject non-positive rotation_interval_days', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { rotation_interval_days: 0 };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept subset of algorithms', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { algorithms: ['RS256'] };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.security.key_store.algorithms).toEqual(['RS256']);
  });

  it('should reject unknown algorithms', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { algorithms: ['RS512'] };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept custom promotion_delay_ms', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { promotion_delay_ms: 5000 };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.security.key_store.promotion_delay_ms).toBe(5000);
  });

  it('should reject negative promotion_delay_ms', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { promotion_delay_ms: -1 };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject promotion_delay_ms exceeding 24 hours', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = {
      promotion_delay_ms: 86_400_001,
    };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept promotion_delay_ms at 24 hour boundary', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = {
      promotion_delay_ms: 86_400_000,
    };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.security.key_store.promotion_delay_ms).toBe(86_400_000);
  });

  it('should default promotion_delay_ms to 0', () => {
    const config = structuredClone(getDefaultFullConfig());
    (config as any).security.key_store = { type: 'database' };

    const result = AppConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.security.key_store.promotion_delay_ms).toBe(0);
  });
});
