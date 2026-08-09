import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'PARAKO_COMPRESSION_QUALITY',
  'PARAKO_COMPRESSION_THRESHOLD',
  'PARAKO_KEEPALIVE_MS',
  'PARAKO_HEADERS_MS',
  'PARAKO_REQUEST_MS',
] as const;

const originalEnv = new Map(
  ENV_KEYS.map(key => [key, process.env[key]] as const)
);

const loadHardening = async () => {
  vi.resetModules();
  return (await import('../../../src/config/hardening-defaults.js')).HARDENING;
};

describe.sequential('hardening defaults', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it('uses safe runtime defaults and immutable security policy values', async () => {
    const hardening = await loadHardening();

    expect(hardening.compression).toEqual({
      brotliQuality: 4,
      compressHtml: false,
      gzipLevel: 6,
      threshold: 1024,
    });
    expect(hardening.timeouts).toEqual({
      headersMs: 70_000,
      keepAliveMs: 65_000,
      requestMs: 300_000,
      tcpNoDelay: true,
    });
    expect(hardening.static.precompressed).toEqual({
      enabled: true,
      preferBrotli: true,
    });
    expect(hardening.bruteForce).toEqual({
      perIdentifier: { max: 5, windowMs: 3_600_000 },
      perIp: { max: 100, windowMs: 86_400_000 },
    });
  });

  it('accepts bounded integer emergency overrides', async () => {
    process.env.PARAKO_COMPRESSION_QUALITY = '11';
    process.env.PARAKO_COMPRESSION_THRESHOLD = '0';
    process.env.PARAKO_KEEPALIVE_MS = '1000';
    process.env.PARAKO_HEADERS_MS = '2000';
    process.env.PARAKO_REQUEST_MS = '3000';

    const hardening = await loadHardening();

    expect(hardening.compression.brotliQuality).toBe(11);
    expect(hardening.compression.threshold).toBe(0);
    expect(hardening.timeouts).toMatchObject({
      headersMs: 2000,
      keepAliveMs: 1000,
      requestMs: 3000,
    });
  });

  it('falls back when overrides are empty, non-finite, fractional, or out of range', async () => {
    process.env.PARAKO_COMPRESSION_QUALITY = '12';
    process.env.PARAKO_COMPRESSION_THRESHOLD = '-1';
    process.env.PARAKO_KEEPALIVE_MS = ' ';
    process.env.PARAKO_HEADERS_MS = '70000.5';
    process.env.PARAKO_REQUEST_MS = 'Infinity';

    const hardening = await loadHardening();

    expect(hardening.compression.brotliQuality).toBe(4);
    expect(hardening.compression.threshold).toBe(1024);
    expect(hardening.timeouts).toMatchObject({
      headersMs: 70_000,
      keepAliveMs: 65_000,
      requestMs: 300_000,
    });
  });

  it('fails fast when headers timeout does not exceed keep-alive timeout', async () => {
    process.env.PARAKO_KEEPALIVE_MS = '2000';
    process.env.PARAKO_HEADERS_MS = '2000';

    await expect(loadHardening()).rejects.toThrow(
      'HARDENING.timeouts.headersMs must exceed HARDENING.timeouts.keepAliveMs'
    );
  });
});
