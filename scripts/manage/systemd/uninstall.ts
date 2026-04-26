import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.js';
import { executeCommand } from '../shared/utils.js';
import { SYSTEMD_DIR, SERVICE_NAME } from './constants.js';

export async function uninstallServices(
  serviceName: string = SERVICE_NAME
): Promise<void> {
  if (process.getuid && process.getuid() !== 0) {
    log.error('Uninstallation requires root privileges. Run with sudo.');
    process.exit(1);
  }

  const workerServiceName = `${serviceName}-worker`;
  const services = [workerServiceName, serviceName];

  for (const service of services) {
    // Stop service
    log.progress(`Stopping ${service}...`);
    await executeCommand('systemctl', ['stop', service]);

    // Disable service
    log.progress(`Disabling ${service}...`);
    await executeCommand('systemctl', ['disable', service]);

    // Remove unit file
    const unitPath = path.join(SYSTEMD_DIR, `${service}.service`);
    if (fs.existsSync(unitPath)) {
      fs.unlinkSync(unitPath);
      log.success(`Removed: ${unitPath}`);
    }
  }

  // Reload daemon
  await executeCommand('systemctl', ['daemon-reload']);
  log.success('Systemd daemon reloaded');
  log.success('Services uninstalled successfully');
}
