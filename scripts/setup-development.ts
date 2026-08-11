import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Command {
  command: string;
  args: string[];
  captureOutput?: boolean;
}

interface CommandResult {
  status: number | null;
  stdout?: string;
}

export type SetupCommandExecutor = (command: Command) => CommandResult;

export interface DevelopmentSetupOptions {
  root?: string;
  nodeVersion?: string;
  execute?: SetupCommandExecutor;
  randomSecret?: () => string;
}

export interface DevelopmentSetupResult {
  created: string[];
  preserved: string[];
}

const REQUIRED_DIRECTORIES = [
  'runtime',
  'runtime/data',
  'runtime/logs',
  'runtime/uploads',
  'runtime/jwks',
] as const;

const DEVELOPMENT_SECRETS = [
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'COOKIE_SECRET_1',
  'COOKIE_SECRET_2',
  'HMAC_SECRET',
  'PAIRWISE_SALT',
] as const;

function majorVersion(version: string): number {
  const major = Number.parseInt(
    version.replace(/^v/, '').split('.')[0] ?? '',
    10
  );
  if (!Number.isInteger(major)) {
    throw new Error(`Unable to parse runtime version: ${version}`);
  }
  return major;
}

export function assertDevelopmentRuntimeVersions(
  nodeVersion: string,
  pnpmVersion: string
): void {
  if (majorVersion(nodeVersion) < 24) {
    throw new Error(`Node.js 24 or newer is required (found ${nodeVersion})`);
  }
  if (majorVersion(pnpmVersion) < 11) {
    throw new Error(`pnpm 11 or newer is required (found ${pnpmVersion})`);
  }
}

function setEnvironmentValue(
  contents: string,
  name: string,
  value: string
): string {
  const line = new RegExp(`^${name}=.*$`, 'm');
  if (!line.test(contents)) {
    throw new Error(`.env.example is missing ${name}`);
  }
  return contents.replace(line, `${name}=${value}`);
}

export function renderDevelopmentEnvironment(
  template: string,
  randomSecret: () => string = () => randomBytes(32).toString('hex')
): string {
  return DEVELOPMENT_SECRETS.reduce(
    (contents, name) => setEnvironmentValue(contents, name, randomSecret()),
    template
  );
}

export function prepareDevelopmentFiles(
  root: string,
  randomSecret?: () => string
): DevelopmentSetupResult {
  const created: string[] = [];
  const preserved: string[] = [];

  for (const directory of REQUIRED_DIRECTORIES) {
    mkdirSync(resolve(root, directory), { recursive: true });
  }

  const environmentPath = resolve(root, 'runtime/.env');
  if (existsSync(environmentPath)) {
    preserved.push('runtime/.env');
  } else {
    const template = readFileSync(resolve(root, '.env.example'), 'utf8');
    writeFileSync(
      environmentPath,
      renderDevelopmentEnvironment(template, randomSecret),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    created.push('runtime/.env');
  }

  const configurationPath = resolve(root, 'runtime/parako.jsonc');
  if (existsSync(configurationPath)) {
    preserved.push('runtime/parako.jsonc');
  } else {
    copyFileSync(
      resolve(root, 'parako.sample.jsonc'),
      configurationPath,
      constants.COPYFILE_EXCL
    );
    created.push('runtime/parako.jsonc');
  }

  return { created, preserved };
}

function executeCommand({
  command,
  args,
  captureOutput,
}: Command): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  return { status: result.status, stdout: result.stdout?.trim() };
}

function requireSuccessfulCommand(
  execute: SetupCommandExecutor,
  command: Command
): CommandResult {
  const result = execute(command);
  if (result.status !== 0) {
    throw new Error(
      `Development setup command failed: ${command.command} ${command.args.join(' ')}`
    );
  }
  return result;
}

export function runDevelopmentSetup({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  nodeVersion = process.versions.node,
  execute = executeCommand,
  randomSecret,
}: DevelopmentSetupOptions = {}): DevelopmentSetupResult {
  const pnpm = requireSuccessfulCommand(execute, {
    command: 'pnpm',
    args: ['--version'],
    captureOutput: true,
  });
  assertDevelopmentRuntimeVersions(nodeVersion, pnpm.stdout ?? '');

  const result = prepareDevelopmentFiles(root, randomSecret);
  requireSuccessfulCommand(execute, {
    command: 'pnpm',
    args: ['exec', 'prisma', 'generate', '--config=prisma.config.ts'],
  });
  requireSuccessfulCommand(execute, {
    command: 'pnpm',
    args: ['exec', 'prisma', 'migrate', 'deploy', '--config=prisma.config.ts'],
  });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = runDevelopmentSetup();
    for (const file of result.created) console.log(`Created ${file}`);
    for (const file of result.preserved) console.log(`Preserved ${file}`);
    console.log('Development setup completed successfully.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
