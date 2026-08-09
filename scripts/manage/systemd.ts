#!/usr/bin/env node

import { Command } from 'commander';
import { isMainModule } from './shared/entrypoint.js';
import { getPackageInfo } from './shared/utils.js';
import { setupCommands } from './systemd/commands.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('systemd')
    .description('🐧 Parako.ID Systemd Service Manager')
    .version(getPackageInfo().version);

  setupCommands(program);
  return program;
}

export async function runSystemdCli(argv = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

/** Execute the systemd CLI at the process boundary. */
export async function runSystemdEntrypoint(argv = process.argv): Promise<void> {
  try {
    await runSystemdCli(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Systemd command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  void runSystemdEntrypoint();
}
