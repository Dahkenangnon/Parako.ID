import { describe, expect, it, vi } from 'vitest';
import type { ILogger } from '../../../src/di/interfaces/logger.interface.js';
import {
  isShuttingDown,
  markShuttingDown,
  safeShutdownStep,
  SERVER_CLOSE_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
} from '../../../src/utils/shutdown.js';

function createLogger(): ILogger {
  return { error: vi.fn() } as unknown as ILogger;
}

describe('shutdown utilities', () => {
  it('uses a server drain timeout below the process shutdown ceiling', () => {
    expect(SERVER_CLOSE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(SERVER_CLOSE_TIMEOUT_MS);
  });

  it('irreversibly marks the current process as shutting down', () => {
    expect(isShuttingDown()).toBe(false);

    markShuttingDown();

    expect(isShuttingDown()).toBe(true);
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
  });

  it('awaits a successful shutdown step without logging an error', async () => {
    const logger = createLogger();
    const step = vi.fn().mockResolvedValue(undefined);

    await expect(
      safeShutdownStep('database', step, logger)
    ).resolves.toBeUndefined();
    expect(step).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('connection stuck'), 'connection stuck'],
    ['connection stuck', 'connection stuck'],
  ])(
    'isolates shutdown step failure %p and logs its normalized message',
    async (failure, message) => {
      const logger = createLogger();

      await expect(
        safeShutdownStep(
          'database',
          async () => {
            throw failure;
          },
          logger
        )
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Shutdown step "database" failed: connection stuck',
        { step: 'database', err: message }
      );
    }
  );
});
