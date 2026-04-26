import inquirer from 'inquirer';
import { log } from '../shared/logger.js';
import rootDir from '../shared/file.js';
import { executeCommand } from '../shared/utils.js';
import {
  SERVICE_NAME,
  APP_SCRIPT,
  WORKER_SCRIPT,
  NODE_ARGS,
} from './constants.js';
import type { SystemdConfig, UnitFiles } from './types.js';

/**
 * Auto-detect the Node.js binary path
 */
async function detectNodePath(): Promise<string> {
  const result = await executeCommand('which', ['node']);
  if (result.success && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return '/usr/bin/node';
}

/**
 * Prompt the user interactively for systemd configuration
 */
export async function promptForConfig(): Promise<SystemdConfig> {
  const defaultUser = process.env.USER || 'parako';
  const defaultNodePath = await detectNodePath();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'serviceName',
      message: 'Service name:',
      default: SERVICE_NAME,
      validate: (input: string) => {
        if (!input) return 'Service name is required';
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(input)) {
          return 'Service name must start with a letter/digit and contain only lowercase letters, digits, dots, hyphens, or underscores';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'user',
      message: 'Service user:',
      default: defaultUser,
      validate: (input: string) => {
        if (!input) return 'User is required';
        return true;
      },
    },
    {
      type: 'input',
      name: 'workingDirectory',
      message: 'Working directory:',
      default: rootDir,
      validate: (input: string) => {
        if (!input) return 'Working directory is required';
        if (!input.startsWith('/')) return 'Must be an absolute path';
        return true;
      },
    },
    {
      type: 'input',
      name: 'envFile',
      message: 'Environment file path:',
      default: `${rootDir}/.env`,
      validate: (input: string) => {
        if (!input) return 'Environment file path is required';
        if (!input.startsWith('/')) return 'Must be an absolute path';
        return true;
      },
    },
    {
      type: 'input',
      name: 'nodePath',
      message: 'Node.js binary path:',
      default: defaultNodePath,
      validate: (input: string) => {
        if (!input) return 'Node.js path is required';
        if (!input.startsWith('/')) return 'Must be an absolute path';
        return true;
      },
    },
  ]);

  return answers as SystemdConfig;
}

/**
 * Extract config from CLI flags for non-interactive use.
 * Returns null if not all required flags are provided.
 */
export function getConfigFromFlags(
  options: Record<string, string>
): SystemdConfig | null {
  const { user, dir, envFile, nodePath } = options;

  if (!user || !dir || !envFile || !nodePath) {
    return null;
  }

  return {
    user,
    workingDirectory: dir,
    envFile,
    nodePath,
    serviceName: options.name || SERVICE_NAME,
    memoryApp: options.memoryApp,
    memoryWorker: options.memoryWorker,
  };
}

/**
 * Generate systemd unit file contents from configuration
 */
export function generateUnitFiles(config: SystemdConfig): UnitFiles {
  const serviceName = config.serviceName || SERVICE_NAME;
  const workerServiceName = `${serviceName}-worker`;
  const memoryApp = config.memoryApp || '1G';
  const memoryWorker = config.memoryWorker || '300M';

  const appUnit = `[Unit]
Description=Parako.ID - OIDC/OAuth2 Identity Provider
Documentation=https://docs.parako.id
After=network.target
# Auto-detected dependencies — uncomment if services are on this host
# After=mongod.service redis-server.service postgresql.service

[Service]
Type=simple
User=${config.user}
WorkingDirectory=${config.workingDirectory}
EnvironmentFile=${config.envFile}
Environment=NODE_ENV=production
ExecStart=${config.nodePath} ${NODE_ARGS} ${APP_SCRIPT}
Restart=on-failure
RestartSec=3
StartLimitBurst=10
StartLimitIntervalSec=300

# Graceful shutdown
TimeoutStopSec=10
KillMode=mixed
KillSignal=SIGTERM

# Resource limits
MemoryMax=${memoryApp}
TasksMax=4096

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
PrivateTmp=yes
ReadWritePaths=${config.workingDirectory}

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${serviceName}

[Install]
WantedBy=multi-user.target
`;

  const workerUnit = `[Unit]
Description=Parako.ID Worker - Background Jobs
Documentation=https://docs.parako.id
After=${serviceName}.service
BindsTo=${serviceName}.service

[Service]
Type=simple
User=${config.user}
WorkingDirectory=${config.workingDirectory}
EnvironmentFile=${config.envFile}
Environment=NODE_ENV=production
ExecStart=${config.nodePath} ${NODE_ARGS} ${WORKER_SCRIPT}
Restart=on-failure
RestartSec=5
StartLimitBurst=10
StartLimitIntervalSec=300

# Graceful shutdown
TimeoutStopSec=10
KillMode=mixed
KillSignal=SIGTERM

# Resource limits
MemoryMax=${memoryWorker}
TasksMax=1024

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
PrivateTmp=yes
ReadWritePaths=${config.workingDirectory}

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${workerServiceName}

[Install]
WantedBy=multi-user.target
`;

  return { app: appUnit, worker: workerUnit };
}

/**
 * Resolve config from flags or interactive prompts
 */
export async function resolveConfig(
  options: Record<string, string>
): Promise<SystemdConfig> {
  const flagConfig = getConfigFromFlags(options);

  if (flagConfig) {
    log.info('Using configuration from flags');
    return flagConfig;
  }

  return promptForConfig();
}
