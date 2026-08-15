import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const systemdEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'systemd.js'
);

const SYSTEMD_PROCESS_TIMEOUT_MS = 30_000;
const SYSTEMD_TEST_TIMEOUT_MS = 45_000;

// Every assertion exercises the compiled CLI in a child process. Keep this
// allowance scoped to the file so the rest of the integration suite stays strict.
vi.setConfig({ testTimeout: SYSTEMD_TEST_TIMEOUT_MS });

function runSystemd(arguments_: string[], environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [systemdEntrypoint, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
      ...environment,
    },
    timeout: SYSTEMD_PROCESS_TIMEOUT_MS,
  });
}

function systemdConfigArguments(additionalArguments: string[] = []): string[] {
  return [
    '--user',
    'parako',
    '--dir',
    '/opt/parako-id/current',
    '--runtime-dir',
    '/opt/parako-id/runtime',
    '--environment-file',
    '/opt/parako-id/runtime/.env',
    '--node-path',
    '/opt/parako-id/current/node/bin/node',
    '--name',
    'parako-phase2',
    '--memory-app',
    '2G',
    '--memory-worker',
    '512M',
    ...additionalArguments,
  ];
}

function generationArguments(
  outputDirectory: string,
  additionalArguments: string[] = []
): string[] {
  return [
    'generate',
    ...systemdConfigArguments(),
    '--output',
    outputDirectory,
    ...additionalArguments,
  ];
}

function writeFakeCommand(filePath: string, command: string): void {
  writeFileSync(
    filePath,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(
  process.env.PARAKO_FAKE_COMMAND_LOG,
  JSON.stringify({ command: '${command}', args }) + '\\n'
);
const requestedFailure = process.env.PARAKO_FAKE_COMMAND_FAIL;
if (requestedFailure && args.join(' ') === requestedFailure) {
  process.stderr.write(process.env.PARAKO_FAKE_COMMAND_ERROR || 'delegated command failed');
  process.exit(Number(process.env.PARAKO_FAKE_COMMAND_CODE || '7'));
}
process.stdout.write('fake ${command} ' + args.join(' ') + '\\n');
`,
    { encoding: 'utf8', mode: 0o700 }
  );
  chmodSync(filePath, 0o700);
}

describe.sequential('compiled systemd CLI', () => {
  let commandLog: string;
  let fakeBin: string;
  let fakeNonRootModule: string;
  let fakeRootModule: string;
  let temporaryRoot: string;

  beforeAll(() => {
    if (!existsSync(systemdEntrypoint)) {
      throw new Error(
        'The compiled systemd CLI is missing. Run pnpm build before this integration suite.'
      );
    }
    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-systemd-cli-'));
    fakeBin = join(temporaryRoot, 'bin');
    fakeNonRootModule = join(temporaryRoot, 'fake-non-root.mjs');
    fakeRootModule = join(temporaryRoot, 'fake-root.mjs');
    commandLog = join(temporaryRoot, 'commands.jsonl');
    mkdirSync(fakeBin, { recursive: true });
    // Exercise the real privileged CLI path while delegating only to disposable
    // fake OS commands; no host systemd state is accessed or modified.
    writeFileSync(
      fakeRootModule,
      "Object.defineProperty(process, 'getuid', { value: () => 0 });\n",
      'utf8'
    );
    writeFileSync(
      fakeNonRootModule,
      "Object.defineProperty(process, 'getuid', { value: () => 1000 });\n",
      'utf8'
    );
    writeFakeCommand(join(fakeBin, 'systemctl'), 'systemctl');
    writeFakeCommand(join(fakeBin, 'journalctl'), 'journalctl');
  });

  beforeEach(() => {
    writeFileSync(commandLog, '', 'utf8');
  });

  afterAll(() => {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  function fakeCommandEnvironment(
    overrides: NodeJS.ProcessEnv = {}
  ): NodeJS.ProcessEnv {
    return {
      PARAKO_FAKE_COMMAND_LOG: commandLog,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      ...overrides,
    };
  }

  function fakeNonRootEnvironment(
    overrides: NodeJS.ProcessEnv = {}
  ): NodeJS.ProcessEnv {
    return fakeCommandEnvironment({
      NODE_OPTIONS: `--import=${fakeNonRootModule}`,
      ...overrides,
    });
  }

  function fakeRootEnvironment(
    overrides: NodeJS.ProcessEnv = {}
  ): NodeJS.ProcessEnv {
    return fakeCommandEnvironment({
      NODE_OPTIONS: `--import=${fakeRootModule}`,
      ...overrides,
    });
  }

  function readCommandLog(): Array<{ args: string[]; command: string }> {
    const content = readFileSync(commandLog, 'utf8').trim();
    return content
      ? content.split('\n').map(
          line =>
            JSON.parse(line) as {
              args: string[];
              command: string;
            }
        )
      : [];
  }

  it('generates both hardened unit files from complete flags', () => {
    const outputDirectory = join(temporaryRoot, 'generated');
    const result = runSystemd(generationArguments(outputDirectory));

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');

    const appUnit = readFileSync(
      join(outputDirectory, 'parako-phase2.service'),
      'utf8'
    );
    const workerUnit = readFileSync(
      join(outputDirectory, 'parako-phase2-worker.service'),
      'utf8'
    );
    expect(appUnit).toContain('User=parako');
    expect(appUnit).toContain('MemoryMax=2G');
    expect(appUnit).toContain('ProtectSystem=strict');
    expect(appUnit).toContain('ReadWritePaths=/opt/parako-id/runtime');
    expect(workerUnit).toContain('BindsTo=parako-phase2.service');
    expect(workerUnit).toContain('MemoryMax=512M');
  });

  it('detects every output conflict before writing either unit file', () => {
    const outputDirectory = join(temporaryRoot, 'conflict');
    const appPath = join(outputDirectory, 'parako-phase2.service');
    const workerPath = join(outputDirectory, 'parako-phase2-worker.service');
    const workerContent = 'preserve-worker-unit\n';
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(workerPath, workerContent, {
      encoding: 'utf8',
      flag: 'wx',
    });

    const result = runSystemd(generationArguments(outputDirectory));

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to overwrite');
    expect(existsSync(appPath)).toBe(false);
    expect(readFileSync(workerPath, 'utf8')).toBe(workerContent);
  });

  it('replaces both existing unit files only when force is explicit', () => {
    const outputDirectory = join(temporaryRoot, 'forced');
    const appPath = join(outputDirectory, 'parako-phase2.service');
    const workerPath = join(outputDirectory, 'parako-phase2-worker.service');
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(appPath, 'stale-app\n', 'utf8');
    writeFileSync(workerPath, 'stale-worker\n', 'utf8');

    const result = runSystemd(
      generationArguments(outputDirectory, ['--force'])
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(appPath, 'utf8')).toContain('User=parako');
    expect(readFileSync(appPath, 'utf8')).not.toContain('stale-app');
    expect(readFileSync(workerPath, 'utf8')).toContain(
      'BindsTo=parako-phase2.service'
    );
    expect(readFileSync(workerPath, 'utf8')).not.toContain('stale-worker');
  });

  it('fails fast without output when required generation flags are incomplete', () => {
    const outputDirectory = join(temporaryRoot, 'incomplete');
    const result = runSystemd(['generate', '--output', outputDirectory]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Refusing to start interactive prompt for "systemd generate"'
    );
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('delegates status for the app and worker with an exact safe service name', () => {
    const result = runSystemd(
      ['status', '--name', 'parako-phase2'],
      fakeCommandEnvironment()
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(readCommandLog()).toEqual([
      { command: 'systemctl', args: ['status', 'parako-phase2'] },
      { command: 'systemctl', args: ['status', 'parako-phase2-worker'] },
    ]);
  });

  it('returns a nonzero status when a delegated service status fails', () => {
    const result = runSystemd(
      ['status', '--name', 'parako-phase2'],
      fakeCommandEnvironment({
        PARAKO_FAKE_COMMAND_FAIL: 'status parako-phase2',
        PARAKO_FAKE_COMMAND_ERROR: 'unit unavailable',
      })
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unit unavailable');
    expect(readCommandLog()).toEqual([
      { command: 'systemctl', args: ['status', 'parako-phase2'] },
      { command: 'systemctl', args: ['status', 'parako-phase2-worker'] },
    ]);
  });

  it('rejects an unsafe service name before delegating to systemctl', () => {
    const result = runSystemd(
      ['status', '--name', '../outside'],
      fakeCommandEnvironment()
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Service name must start with a letter/digit'
    );
    expect(readCommandLog()).toEqual([]);
  });

  it('rejects install before OS delegation when the process is not root', () => {
    const result = runSystemd(
      ['install', ...systemdConfigArguments()],
      fakeNonRootEnvironment()
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Installation requires root privileges');
    expect(readCommandLog()).toEqual([]);
  });

  it('rejects uninstall before OS delegation when the process is not root', () => {
    const result = runSystemd(
      ['uninstall', '--name', 'parako-phase2'],
      fakeNonRootEnvironment()
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Uninstallation requires root privileges');
    expect(readCommandLog()).toEqual([]);
  });

  it('restarts the app before the worker through the public privileged command', () => {
    const result = runSystemd(
      ['restart', '--name', 'parako-phase2'],
      fakeRootEnvironment()
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(readCommandLog()).toEqual([
      { command: 'systemctl', args: ['restart', 'parako-phase2'] },
      { command: 'systemctl', args: ['restart', 'parako-phase2-worker'] },
    ]);
  });

  it('returns nonzero when the delegated worker restart fails', () => {
    const result = runSystemd(
      ['restart', '--name', 'parako-phase2'],
      fakeRootEnvironment({
        PARAKO_FAKE_COMMAND_FAIL: 'restart parako-phase2-worker',
        PARAKO_FAKE_COMMAND_ERROR: 'worker restart unavailable',
      })
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('worker restart unavailable');
    expect(readCommandLog()).toEqual([
      { command: 'systemctl', args: ['restart', 'parako-phase2'] },
      { command: 'systemctl', args: ['restart', 'parako-phase2-worker'] },
    ]);
  });

  it('streams worker-only historical logs through exact journalctl arguments', () => {
    const result = runSystemd(
      [
        'logs',
        '--name',
        'parako-phase2',
        '--worker',
        '--since',
        '1 hour ago',
        '--no-follow',
      ],
      fakeCommandEnvironment()
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(readCommandLog()).toEqual([
      {
        command: 'journalctl',
        args: ['-u', 'parako-phase2-worker', '--since', '1 hour ago'],
      },
    ]);
  });

  it('returns nonzero when journalctl fails', () => {
    const journalArguments = [
      '-u',
      'parako-phase2-worker',
      '--since',
      '1 hour ago',
    ];
    const result = runSystemd(
      [
        'logs',
        '--name',
        'parako-phase2',
        '--worker',
        '--since',
        '1 hour ago',
        '--no-follow',
      ],
      fakeCommandEnvironment({
        PARAKO_FAKE_COMMAND_FAIL: journalArguments.join(' '),
        PARAKO_FAKE_COMMAND_ERROR: 'journal unavailable',
      })
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('journal unavailable');
    expect(result.stderr).toContain('journalctl exited with code 7');
    expect(readCommandLog()).toEqual([
      { command: 'journalctl', args: journalArguments },
    ]);
  });
});
