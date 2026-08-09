/**
 * CLI commands setup for keys module
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { generateKeys, generateKeysInteractive } from './index.js';

interface CliError {
  code?: string;
  message?: string;
}

function getErrorDetails(error: unknown): CliError {
  if (error && typeof error === 'object') return error as CliError;
  return { message: String(error) };
}

export function buildKeysProgram(): Command {
  const program = new Command();
  program.name('keys').description('🔑 Manage OIDC JWKS keys').version('1.0.0');

  program
    .command('generate')
    .alias('gen')
    .description(
      'Generate JWKS keys (RS256, ES256, EdDSA). For first-boot bootstrap; rotation/listing are handled by the DB-backed key store.'
    )
    .action(() => generateKeys(true));

  return program;
}

export async function runKeysCli(argv = process.argv): Promise<void> {
  try {
    if (argv.length === 2) {
      await generateKeysInteractive();
      return;
    }

    await buildKeysProgram().parseAsync(argv);
  } catch (error: unknown) {
    const details = getErrorDetails(error);
    const message = details.message ?? 'Unknown error';

    if (details.code === 'commander.unknownCommand') {
      console.error(chalk.red(`\nUnknown command: ${message}`));
      console.log(chalk.dim('Run with --help to see available commands\n'));
    } else if (details.code === 'commander.missingArgument') {
      console.error(chalk.red(`\nMissing argument: ${message}`));
      console.log(chalk.dim('Run with --help to see command usage\n'));
    } else {
      console.error(chalk.red(`\n❌ Failed to generate keys: ${message}\n`));
    }

    process.exitCode = 1;
  }
}
