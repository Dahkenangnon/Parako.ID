import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const eslintExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

export interface StagedCheckCommand {
  command: string;
  args: string[];
}

export function parseStagedFiles(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

export function createStagedCheckPlan(
  stagedFiles: readonly string[]
): StagedCheckCommand[] {
  const commands: StagedCheckCommand[] = [
    {
      command: 'git',
      args: ['diff', '--cached', '--check'],
    },
  ];

  const eslintFiles = stagedFiles.filter(file =>
    eslintExtensions.has(extname(file))
  );
  if (eslintFiles.length > 0) {
    commands.push({
      command: 'pnpm',
      args: ['exec', 'eslint', '--max-warnings', '0', '--', ...eslintFiles],
    });
  }

  if (stagedFiles.length > 0) {
    commands.push({
      command: 'pnpm',
      args: [
        'exec',
        'prettier',
        '--check',
        '--ignore-unknown',
        '--',
        ...stagedFiles,
      ],
    });
  }

  return commands;
}

function run(command: StagedCheckCommand, captureOutput = false): string {
  const result = spawnSync(command.command, command.args, {
    encoding: 'utf8',
    stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return captureOutput ? (result.stdout ?? '') : '';
}

export function checkStagedFiles(): void {
  const stagedOutput = run(
    {
      command: 'git',
      args: ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    },
    true
  );

  for (const command of createStagedCheckPlan(parseStagedFiles(stagedOutput))) {
    run(command);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  checkStagedFiles();
}
