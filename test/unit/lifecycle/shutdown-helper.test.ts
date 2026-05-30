/**
 * Unit tests for the shutdown helper.
 *
 * These verify that `safeShutdownStep` swallows failures and routes them
 * through the structured logger so a single bad step never aborts the rest
 * of the graceful shutdown sequence.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  safeShutdownStep,
  SHUTDOWN_TIMEOUT_MS,
  SERVER_CLOSE_TIMEOUT_MS,
} from '../../../src/utils/shutdown.js';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';

function makeLogger(): ILogger {
  return {
    getLogger: () => null as any,
    child: () => null as any,
    flush: async () => {},
    shutdown: async () => {},
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

describe('safeShutdownStep', () => {
  it('resolves when the wrapped fn resolves', async () => {
    const logger = makeLogger();
    const fn = vi.fn().mockResolvedValue(undefined);

    await expect(
      safeShutdownStep('clean-step', fn, logger)
    ).resolves.toBeUndefined();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not throw when the wrapped fn rejects with an Error', async () => {
    const logger = makeLogger();
    const fn = vi
      .fn()
      .mockRejectedValue(new Error('database disconnect failed'));

    await expect(
      safeShutdownStep('database', fn, logger)
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, context] = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(message).toContain('database');
    expect(message).toContain('database disconnect failed');
    expect(context).toEqual({
      step: 'database',
      err: 'database disconnect failed',
    });
  });

  it('does not throw when the wrapped fn rejects with a non-Error value', async () => {
    const logger = makeLogger();
    const fn = vi.fn().mockRejectedValue('string failure');

    await expect(
      safeShutdownStep('weird', fn, logger)
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, context] = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(context).toEqual({ step: 'weird', err: 'string failure' });
  });
});

describe('shutdown constants', () => {
  it('keeps the app shutdown timeout below the PM2 kill_timeout (14s)', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(14_000);
  });

  it('keeps the server-close timeout below the overall shutdown ceiling', () => {
    expect(SERVER_CLOSE_TIMEOUT_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
  });
});
