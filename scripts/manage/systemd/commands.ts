import fs from 'node:fs';
import path from 'node:path';
import { type Command } from 'commander';
import { log } from '../shared/logger.js';
import { showSubcommandHelp, getPackageInfo } from '../shared/utils.js';
import { SERVICE_NAME } from './constants.js';
import { resolveConfig, generateUnitFiles } from './generate.js';
import { installServices } from './install.js';
import { uninstallServices } from './uninstall.js';
import { showStatus } from './status.js';
import { restartServices } from './restart.js';
import { showLogs } from './logs.js';

const HELP_PROFILE = {
  name: 'SYSTEMD SERVICE MANAGER',
  icon: '🐧',
  description:
    'Generate, install, restart, and tail systemd unit files for Parako.ID as a PM2 alternative',
  version: getPackageInfo().version,
  quickStart: [
    {
      command: 'pnpm systemd generate',
      description: 'Preview unit files (stdout)',
      time: '< 1 min',
    },
    {
      command: 'sudo pnpm systemd install',
      description: 'Install systemd services',
      time: '< 1 min',
    },
    {
      command: 'pnpm systemd status',
      description: 'Check service status',
      time: '< 1 min',
    },
    {
      command: 'pnpm systemd logs',
      description: 'Follow journalctl for both services',
      time: 'live',
    },
  ],
  examples: [
    {
      command: 'pnpm systemd generate -o /tmp/parako-units',
      description: 'Write unit files to a directory instead of stdout',
    },
    {
      command:
        'pnpm systemd generate --user parako --dir /opt/parako --env-file /opt/parako/.env --node-path /usr/bin/node --memory-app 2G --memory-worker 512M',
      description: 'Non-interactive generation with custom memory caps',
    },
    {
      command: 'sudo pnpm systemd install',
      description: 'Interactive install to /etc/systemd/system/',
    },
    {
      command: 'sudo pnpm systemd install --force',
      description: 'Overwrite existing unit files when content differs',
    },
    {
      command: 'sudo pnpm systemd restart',
      description: 'Restart both main and worker services',
    },
    {
      command: 'pnpm systemd logs --since "1 hour ago"',
      description: 'Tail logs from the last hour for both services',
    },
    {
      command: 'pnpm systemd logs --worker',
      description: 'Tail only the worker service',
    },
    {
      command: 'sudo pnpm systemd uninstall',
      description: 'Stop, disable, and remove services',
    },
  ],
  features: [
    {
      icon: '🔐',
      title: 'Security Hardening',
      description: 'NoNewPrivileges, ProtectSystem=strict, PrivateTmp enabled',
    },
    {
      icon: '📦',
      title: 'PM2 Parity',
      description:
        'Equivalent resource limits, restart policies, and graceful shutdown — configurable via --memory-app / --memory-worker',
    },
    {
      icon: '🔗',
      title: 'Service Dependencies',
      description: 'Worker service is bound to main app with BindsTo directive',
    },
    {
      icon: '📋',
      title: 'Journal Integration',
      description:
        'Logs via journalctl with SyslogIdentifier tagging; tail via `pnpm systemd logs`',
    },
    {
      icon: '🛡️',
      title: 'Safe Installs',
      description:
        'Pre-install validation (user/workdir/env-file) and refuse-on-diff unless --force',
    },
    {
      icon: '⚡',
      title: 'Non-Interactive Mode',
      description: 'Pass all flags for scripted/CI usage',
    },
  ],
  tips: [
    'Use "generate" first to preview unit files before installing',
    'Add `-o <dir>` to `generate` to write files directly instead of piping stdout',
    'The worker service is bound to the main app — stopping the app stops the worker',
    `View logs with: pnpm systemd logs (or journalctl -u ${SERVICE_NAME} -f)`,
    'Customize resource limits with --memory-app / --memory-worker (defaults: 1G / 300M)',
    'For SQLite deployments, the app runs as a single process (no cluster mode)',
  ],
} as const;

export function setupCommands(program: Command): void {
  // Default action (no subcommand) — show help
  program.action(() => {
    showSubcommandHelp(HELP_PROFILE);
  });

  // generate — print unit files to stdout (or write to -o <dir>)
  program
    .command('generate')
    .description(
      '📝 Generate systemd unit files (stdout by default; pass -o <dir> to write files)'
    )
    .option('-u, --user <user>', 'Service user')
    .option('-d, --dir <directory>', 'Working directory')
    .option('-e, --env-file <path>', 'Environment file path')
    .option('-n, --node-path <path>', 'Node.js binary path')
    .option('--name <name>', 'Service name (default: parako-id)')
    .option(
      '--memory-app <size>',
      'MemoryMax for main app service (default: 1G)'
    )
    .option(
      '--memory-worker <size>',
      'MemoryMax for worker service (default: 300M)'
    )
    .option(
      '-o, --output <dir>',
      'Write unit files to <dir>/<service>.service instead of stdout'
    )
    .option('--force', 'Overwrite existing files in <dir> when used with -o')
    .action(async options => {
      const config = await resolveConfig(options);
      const unitFiles = generateUnitFiles(config);
      const serviceName = config.serviceName || SERVICE_NAME;
      const workerServiceName = `${serviceName}-worker`;

      if (options.output) {
        const outDir = path.resolve(options.output);
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
          log.info(`Created output directory: ${outDir}`);
        }
        const appPath = path.join(outDir, `${serviceName}.service`);
        const workerPath = path.join(outDir, `${workerServiceName}.service`);
        for (const [target, contents] of [
          [appPath, unitFiles.app],
          [workerPath, unitFiles.worker],
        ] as const) {
          if (fs.existsSync(target) && !options.force) {
            log.error(
              `Refusing to overwrite ${target} — pass --force to overwrite.`
            );
            process.exit(1);
          }
          fs.writeFileSync(target, contents, 'utf-8');
          log.success(`Wrote ${target}`);
        }
        log.info(
          `To install: sudo cp ${outDir}/*.service /etc/systemd/system/ && sudo systemctl daemon-reload`
        );
        return;
      }

      log.title(`${serviceName}.service`);
      console.log(unitFiles.app);

      log.title(`${workerServiceName}.service`);
      console.log(unitFiles.worker);

      log.success('Unit files generated successfully');
      log.info(
        'To install, run: sudo pnpm systemd install (with the same flags)'
      );
    });

  // install — generate + write to /etc/systemd/system/ + daemon-reload
  program
    .command('install')
    .description('📦 Install systemd services (requires root)')
    .option('-u, --user <user>', 'Service user')
    .option('-d, --dir <directory>', 'Working directory')
    .option('-e, --env-file <path>', 'Environment file path')
    .option('-n, --node-path <path>', 'Node.js binary path')
    .option('--name <name>', 'Service name (default: parako-id)')
    .option(
      '--memory-app <size>',
      'MemoryMax for main app service (default: 1G)'
    )
    .option(
      '--memory-worker <size>',
      'MemoryMax for worker service (default: 300M)'
    )
    .option('--force', 'Overwrite existing unit files even if content differs')
    .action(async options => {
      log.title('Installing Parako.ID Systemd Services');

      const config = await resolveConfig(options);
      const unitFiles = generateUnitFiles(config);

      await installServices(unitFiles, config.serviceName, config, {
        force: options.force === true,
      });
    });

  // uninstall — stop, disable, remove
  program
    .command('uninstall')
    .description('🗑️  Uninstall systemd services (requires root)')
    .option('--name <name>', 'Service name (default: parako-id)')
    .action(async options => {
      log.title('Uninstalling Parako.ID Systemd Services');

      const serviceName = options.name || SERVICE_NAME;
      await uninstallServices(serviceName);
    });

  // status — show systemctl status
  program
    .command('status')
    .description('📊 Show service status')
    .option('--name <name>', 'Service name (default: parako-id)')
    .action(async options => {
      const serviceName = options.name || SERVICE_NAME;
      await showStatus(serviceName);
    });

  // restart — restart both services
  program
    .command('restart')
    .description('🔄 Restart main app + worker services (requires root)')
    .option('--name <name>', 'Service name (default: parako-id)')
    .action(async options => {
      const serviceName = options.name || SERVICE_NAME;
      await restartServices(serviceName);
    });

  // logs — tail journalctl
  program
    .command('logs')
    .description('📜 Tail logs via journalctl (Ctrl-C to stop)')
    .option('--name <name>', 'Service name (default: parako-id)')
    .option('--worker', 'Tail only the worker service')
    .option(
      '--since <time>',
      'Show entries since this systemd-recognized time (e.g. "1 hour ago")'
    )
    .option('--no-follow', 'Do not follow new entries (default: follow)')
    .action(async options => {
      const serviceName = options.name || SERVICE_NAME;
      await showLogs(serviceName, {
        worker: options.worker === true,
        since: options.since,
        follow: options.follow !== false,
      });
    });

  // Enhanced help
  program.on('--help', () => {
    showSubcommandHelp(HELP_PROFILE);
  });
}
