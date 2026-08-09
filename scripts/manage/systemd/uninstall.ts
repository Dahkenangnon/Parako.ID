import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.js';
import { executeCommand } from '../shared/utils.js';
import { SYSTEMD_DIR, SERVICE_NAME } from './constants.js';
import { assertServiceName } from './validation.js';

export async function uninstallServices(
  serviceName: string = SERVICE_NAME
): Promise<void> {
  assertServiceName(serviceName);
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('Uninstallation requires root privileges. Run with sudo.');
  }

  const workerServiceName = `${serviceName}-worker`;
  const services = [workerServiceName, serviceName];

  for (const service of services) {
    // Stop service
    log.progress(`Stopping ${service}...`);
    const stopResult = await executeCommand('systemctl', ['stop', service]);
    if (!stopResult.success) {
      throw new Error(
        `Failed to stop ${service}: ${stopResult.stderr || `exit code ${stopResult.code}`}`
      );
    }

    // Disable service
    log.progress(`Disabling ${service}...`);
    const disableResult = await executeCommand('systemctl', [
      'disable',
      service,
    ]);
    if (!disableResult.success) {
      throw new Error(
        `Failed to disable ${service}: ${disableResult.stderr || `exit code ${disableResult.code}`}`
      );
    }

    // Remove unit file
    const unitPath = path.join(SYSTEMD_DIR, `${service}.service`);
    if (fs.existsSync(unitPath)) {
      fs.unlinkSync(unitPath);
      log.success(`Removed: ${unitPath}`);
    }
  }

  // Reload daemon
  const reloadResult = await executeCommand('systemctl', ['daemon-reload']);
  if (!reloadResult.success) {
    throw new Error(
      `Failed to reload systemd: ${reloadResult.stderr || `exit code ${reloadResult.code}`}`
    );
  }
  log.success('Systemd daemon reloaded');
  log.success('Services uninstalled successfully');
}
