import { log } from '../shared/logger.js';
import { executeCommand } from '../shared/utils.js';
import { assertServiceName } from './validation.js';

/**
 * Restart the Parako.ID systemd services (main app + worker).
 *
 * Worker is bound to the main app via `BindsTo`, so restarting the main
 * service typically restarts the worker too. We restart both explicitly
 * to keep the operation deterministic and to avoid relying on transitive
 * systemd behavior.
 */
export async function restartServices(serviceName: string): Promise<void> {
  assertServiceName(serviceName);
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('Restart requires root privileges. Run with sudo.');
  }

  const workerServiceName = `${serviceName}-worker`;

  log.info(`Restarting ${serviceName}...`);
  const appResult = await executeCommand('systemctl', ['restart', serviceName]);
  if (!appResult.success) {
    throw new Error(
      `Failed to restart ${serviceName}: ${appResult.stderr || `exit code ${appResult.code}`}`
    );
  }
  log.success(`${serviceName} restarted`);

  log.info(`Restarting ${workerServiceName}...`);
  const workerResult = await executeCommand('systemctl', [
    'restart',
    workerServiceName,
  ]);
  if (!workerResult.success) {
    throw new Error(
      `Failed to restart ${workerServiceName}: ${workerResult.stderr || `exit code ${workerResult.code}`}`
    );
  }
  log.success(`${workerServiceName} restarted`);
}
