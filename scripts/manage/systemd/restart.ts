import { log } from '../shared/logger.js';
import { executeCommand } from '../shared/utils.js';

/**
 * Restart the Parako.ID systemd services (main app + worker).
 *
 * Worker is bound to the main app via `BindsTo`, so restarting the main
 * service typically restarts the worker too. We restart both explicitly
 * to keep the operation deterministic and to avoid relying on transitive
 * systemd behavior.
 */
export async function restartServices(serviceName: string): Promise<void> {
  if (process.getuid && process.getuid() !== 0) {
    log.error('Restart requires root privileges. Run with sudo.');
    process.exit(1);
  }

  const workerServiceName = `${serviceName}-worker`;

  log.info(`Restarting ${serviceName}...`);
  const appResult = await executeCommand('systemctl', ['restart', serviceName]);
  if (!appResult.success) {
    log.error(`Failed to restart ${serviceName}: ${appResult.stderr}`);
    process.exit(1);
  }
  log.success(`${serviceName} restarted`);

  log.info(`Restarting ${workerServiceName}...`);
  const workerResult = await executeCommand('systemctl', [
    'restart',
    workerServiceName,
  ]);
  if (!workerResult.success) {
    log.error(`Failed to restart ${workerServiceName}: ${workerResult.stderr}`);
    process.exit(1);
  }
  log.success(`${workerServiceName} restarted`);
}
