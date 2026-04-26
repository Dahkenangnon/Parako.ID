import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.js';
import { executeCommand } from '../shared/utils.js';
import { SYSTEMD_DIR, SERVICE_NAME } from './constants.js';
import type { SystemdConfig, UnitFiles } from './types.js';

export interface InstallOptions {
  /** Overwrite existing unit files even if they differ. Default: false */
  force?: boolean;
}

/**
 * Pre-install validation. Verifies the configured user, working directory,
 * and env file are present. Throws (via process.exit) on hard failures and
 * warns on soft failures (e.g., missing env file is recoverable on first boot).
 */
async function preflight(config: SystemdConfig): Promise<void> {
  // user must exist
  const userCheck = await executeCommand('id', ['-u', config.user]);
  if (!userCheck.success) {
    log.error(
      `Service user "${config.user}" does not exist. Create it first (e.g., \`sudo useradd --system --no-create-home --shell /usr/sbin/nologin ${config.user}\`).`
    );
    process.exit(1);
  }

  // workingDirectory must exist
  if (!fs.existsSync(config.workingDirectory)) {
    log.error(
      `Working directory "${config.workingDirectory}" does not exist. Create or correct the path before installing.`
    );
    process.exit(1);
  }
  if (!fs.statSync(config.workingDirectory).isDirectory()) {
    log.error(`"${config.workingDirectory}" is not a directory.`);
    process.exit(1);
  }

  // envFile is allowed to be missing on first boot but warn the operator
  if (!fs.existsSync(config.envFile)) {
    log.warning(
      `Environment file "${config.envFile}" does not exist. The service will fail to start until it is created.`
    );
  }
}

/**
 * Render a small unified diff for two unit-file contents. Best-effort, no
 * external diff tools required — just enough to show the operator what would
 * change before they confirm `--force`.
 */
function renderDiff(
  existing: string,
  incoming: string,
  filename: string
): string {
  const oldLines = existing.split('\n');
  const newLines = incoming.split('\n');
  const lines: string[] = [
    `--- ${filename} (current)`,
    `+++ ${filename} (incoming)`,
  ];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) continue;
    if (o !== undefined) lines.push(`- ${o}`);
    if (n !== undefined) lines.push(`+ ${n}`);
  }
  return lines.join('\n');
}

/**
 * Write a unit file, refusing to overwrite differing existing content unless
 * `force` is set. Identical content is a no-op (idempotent).
 */
function writeUnitFile(
  filePath: string,
  contents: string,
  force: boolean
): { wrote: boolean; skipped: boolean } {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing === contents) {
      log.info(`Unchanged: ${filePath}`);
      return { wrote: false, skipped: true };
    }
    if (!force) {
      log.error(
        `Refusing to overwrite ${filePath} — content differs. Pass --force to apply, or remove the file first.`
      );
      console.log('');
      console.log(renderDiff(existing, contents, path.basename(filePath)));
      console.log('');
      process.exit(1);
    }
    log.warning(`Overwriting ${filePath} (--force).`);
  }

  fs.writeFileSync(filePath, contents, 'utf-8');
  log.success(`Written: ${filePath}`);
  return { wrote: true, skipped: false };
}

export async function installServices(
  unitFiles: UnitFiles,
  serviceName: string = SERVICE_NAME,
  config: SystemdConfig,
  options: InstallOptions = {}
): Promise<void> {
  // Check if running as root
  if (process.getuid && process.getuid() !== 0) {
    log.error('Installation requires root privileges. Run with sudo.');
    process.exit(1);
  }

  // Pre-install validation
  await preflight(config);

  const workerServiceName = `${serviceName}-worker`;
  const appPath = path.join(SYSTEMD_DIR, `${serviceName}.service`);
  const workerPath = path.join(SYSTEMD_DIR, `${workerServiceName}.service`);

  // Write unit files (idempotent; refuse on diff unless --force)
  const force = options.force === true;
  const appResult = writeUnitFile(appPath, unitFiles.app, force);
  const workerResult = writeUnitFile(workerPath, unitFiles.worker, force);

  // Reload systemd daemon only if anything actually changed
  if (appResult.wrote || workerResult.wrote) {
    const reload = await executeCommand('systemctl', ['daemon-reload']);
    if (!reload.success) {
      log.error(`Failed to reload systemd: ${reload.stderr}`);
      process.exit(1);
    }
    log.success('Systemd daemon reloaded');
  } else {
    log.info('Nothing changed — skipping daemon-reload.');
  }

  // Print next steps
  console.log('');
  log.info('Services installed. To start:');
  console.log(`  sudo systemctl enable --now ${serviceName}`);
  console.log(`  sudo systemctl enable --now ${workerServiceName}`);
  console.log('');
  log.info('To check status:');
  console.log(`  yarn systemd status`);
  console.log('');
  log.info('To restart:');
  console.log(`  sudo yarn systemd restart`);
  console.log('');
  log.info('To view logs:');
  console.log(`  yarn systemd logs`);
}
