import { log } from '../shared/logger.js';
import { executeCommand } from '../shared/utils.js';
import { SERVICE_NAME } from './constants.js';

export async function showStatus(
  serviceName: string = SERVICE_NAME
): Promise<void> {
  const workerServiceName = `${serviceName}-worker`;
  const services = [serviceName, workerServiceName];

  for (const service of services) {
    log.title(service);
    const result = await executeCommand('systemctl', ['status', service]);
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr && !result.success) {
      log.warning(`Service ${service} may not be installed or running`);
      console.log(result.stderr);
    }
  }
}
