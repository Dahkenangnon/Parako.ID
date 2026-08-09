import path from 'node:path';
import inquirer from 'inquirer';
import { log } from '../shared/logger.js';
import rootDir from '../shared/file.js';
import { assertInteractiveTty, executeCommand } from '../shared/utils.js';
import {
  SERVICE_NAME,
  APP_SCRIPT,
  WORKER_SCRIPT,
  NODE_ARGS,
} from './constants.js';
import type { SystemdConfig, UnitFiles } from './types.js';
import { assertServiceName, validateServiceName } from './validation.js';

function validateServiceUser(input: string): true | string {
  if (!input) return 'Service user is required';
  return /^(?:[A-Za-z_][A-Za-z0-9_.@-]*|[0-9]+)$/u.test(input)
    ? true
    : 'Service user contains unsupported characters';
}

function assertServiceUser(input: string): void {
  const result = validateServiceUser(input);
  if (result !== true) {
    throw new Error(result);
  }
}

function containsUnsafeUnitText(input: string): boolean {
  return [...input].some(character => {
    const codePoint = character.codePointAt(0)!;
    return /\s/u.test(character) || codePoint < 32 || codePoint === 127;
  });
}

function validateAbsoluteUnitPath(input: string, label: string): true | string {
  if (!input) return `${label} is required`;
  if (!path.isAbsolute(input)) return `${label} must be an absolute path`;
  if (containsUnsafeUnitText(input)) {
    return `${label} must not contain whitespace or control characters`;
  }
  return true;
}

function assertAbsoluteUnitPath(input: string, label: string): void {
  const result = validateAbsoluteUnitPath(input, label);
  if (result !== true) {
    throw new Error(result);
  }
}

function assertSingleUnitValue(input: string | undefined, label: string): void {
  if (input !== undefined && containsUnsafeUnitText(input)) {
    throw new Error(`${label} must be a single unit value`);
  }
}

function assertSystemdConfig(config: SystemdConfig): void {
  assertServiceName(config.serviceName || SERVICE_NAME);
  assertServiceUser(config.user);
  assertAbsoluteUnitPath(config.workingDirectory, 'Working directory');
  assertAbsoluteUnitPath(config.runtimeDirectory, 'Runtime directory');
  assertAbsoluteUnitPath(config.envFile, 'Environment file path');
  assertAbsoluteUnitPath(config.nodePath, 'Node.js path');
  assertSingleUnitValue(config.memoryApp, 'Main app memory limit');
  assertSingleUnitValue(config.memoryWorker, 'Worker memory limit');
}

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
 * Prompt the user interactively for systemd configuration.
 *
 * The shared `assertInteractiveTty` guard refuses to run when stdin is
 * not a TTY (e.g. piped from CI), preventing the prompt from hanging the
 * caller indefinitely.
 */
export async function promptForConfig(): Promise<SystemdConfig> {
  assertInteractiveTty('systemd generate');

  const defaultUser = process.env.USER || 'parako';
  const defaultNodePath = await detectNodePath();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'serviceName',
      message: 'Service name:',
      default: SERVICE_NAME,
      validate: validateServiceName,
    },
    {
      type: 'input',
      name: 'user',
      message: 'Service user:',
      default: defaultUser,
      validate: validateServiceUser,
    },
    {
      type: 'input',
      name: 'workingDirectory',
      message: 'Working directory:',
      default: rootDir,
      validate: (input: string) =>
        validateAbsoluteUnitPath(input, 'Working directory'),
    },
    {
      type: 'input',
      name: 'envFile',
      message: 'Environment file path:',
      default: `${rootDir}/runtime/.env`,
      validate: (input: string) =>
        validateAbsoluteUnitPath(input, 'Environment file path'),
    },
    {
      type: 'input',
      name: 'runtimeDirectory',
      message: 'Mutable runtime directory:',
      default: `${rootDir}/runtime`,
      validate: (input: string) =>
        validateAbsoluteUnitPath(input, 'Runtime directory'),
    },
    {
      type: 'input',
      name: 'nodePath',
      message: 'Node.js binary path:',
      default: defaultNodePath,
      validate: (input: string) =>
        validateAbsoluteUnitPath(input, 'Node.js path'),
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
  const { user, dir, runtimeDir, envFile, nodePath } = options;

  if (!user || !dir || !runtimeDir || !envFile || !nodePath) {
    return null;
  }

  const serviceName = options.name ?? SERVICE_NAME;
  const config = {
    user,
    workingDirectory: dir,
    runtimeDirectory: runtimeDir,
    envFile,
    nodePath,
    serviceName,
    memoryApp: options.memoryApp,
    memoryWorker: options.memoryWorker,
  };
  assertSystemdConfig(config);
  return config;
}

/**
 * Generate systemd unit file contents from configuration
 */
export function generateUnitFiles(config: SystemdConfig): UnitFiles {
  assertSystemdConfig(config);
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
StartLimitBurst=10
StartLimitIntervalSec=300

[Service]
Type=simple
User=${config.user}
WorkingDirectory=${config.workingDirectory}
EnvironmentFile=${config.envFile}
Environment=NODE_ENV=production
Environment=PARAKO_ROOT=${config.workingDirectory}
ExecStartPre=${config.nodePath} dist/scripts/manage/database.js status
ExecStart=${config.nodePath} ${NODE_ARGS} ${APP_SCRIPT}
Restart=on-failure
RestartSec=3

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
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictRealtime=yes
SystemCallArchitectures=native
UMask=0077
ReadWritePaths=${config.runtimeDirectory}

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
StartLimitBurst=10
StartLimitIntervalSec=300

[Service]
Type=simple
User=${config.user}
WorkingDirectory=${config.workingDirectory}
EnvironmentFile=${config.envFile}
Environment=NODE_ENV=production
Environment=PARAKO_ROOT=${config.workingDirectory}
ExecStart=${config.nodePath} ${NODE_ARGS} ${WORKER_SCRIPT}
Restart=on-failure
RestartSec=5

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
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictRealtime=yes
SystemCallArchitectures=native
UMask=0077
ReadWritePaths=${config.runtimeDirectory}

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
