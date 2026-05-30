import type { ILogger } from '../di/interfaces/logger.interface.js';

/**
 * Aligned shutdown ceiling for both the web process and the worker. Must remain
 * below the PM2 `kill_timeout` (see ecosystem.config.cjs) so the in-app forced
 * exit triggers before PM2 sends SIGKILL.
 */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Maximum time the HTTP server may take to drain in-flight connections. */
export const SERVER_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Process-wide flag observed by the readiness probe. Flipped to true at the
 * start of the shutdown sequence so load balancers and orchestrators stop
 * routing new traffic before in-flight requests finish draining.
 */
let shuttingDown = false;

export const markShuttingDown = (): void => {
  shuttingDown = true;
};

export const isShuttingDown = (): boolean => shuttingDown;

/**
 * Run a single shutdown step. Never throws — failures are reported through the
 * structured logger so the rest of the shutdown sequence can continue. The very
 * last shutdown step (after `logger.shutdown()`) is the only place where a
 * `console.error` fallback remains legitimate, since the logger is no longer
 * available there.
 */
export async function safeShutdownStep(
  name: string,
  fn: () => Promise<void>,
  logger: ILogger
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Shutdown step "${name}" failed: ${message}`, {
      step: name,
      err: message,
    });
  }
}
