import { spawn } from 'node:child_process';

export interface LogsOptions {
  /** Follow the journal in real-time (`-f`). Default: true */
  follow?: boolean;
  /** Restrict output to entries since this systemd-recognized date (e.g., "1 hour ago", "2025-01-01"). */
  since?: string;
  /** Show only the worker service. Default: both main + worker. */
  worker?: boolean;
}

/**
 * Stream logs from the Parako.ID systemd services via journalctl.
 *
 * Spawns journalctl directly (not via executeCommand) because we want to
 * stream output live and forward signals (Ctrl-C) to the child cleanly.
 */
export async function showLogs(
  serviceName: string,
  options: LogsOptions = {}
): Promise<void> {
  const workerServiceName = `${serviceName}-worker`;
  const follow = options.follow !== false;

  const args: string[] = [];

  if (options.worker) {
    args.push('-u', workerServiceName);
  } else {
    args.push('-u', serviceName, '-u', workerServiceName);
  }

  if (follow) {
    args.push('-f');
  }

  if (options.since) {
    args.push('--since', options.since);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('journalctl', args, { stdio: 'inherit' });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`journalctl exited with code ${code}`));
      }
    });

    // Forward SIGINT/SIGTERM to the child so Ctrl-C cleanly stops follow mode
    const forward = (sig: NodeJS.Signals) => {
      child.kill(sig);
    };
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
  });
}
