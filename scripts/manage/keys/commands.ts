/**
 * CLI commands setup for keys module
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { generateKeys, generateKeysInteractive } from './index.js';

const program = new Command();

program.name('keys').description('🔑 Manage OIDC JWKS keys').version('1.0.0');

program
  .command('generate')
  .alias('gen')
  .description(
    'Generate JWKS keys (RS256, ES256, EdDSA). For first-boot bootstrap; rotation/listing are handled by the DB-backed key store.'
  )
  .action(async () => {
    try {
      await generateKeys(true);
    } catch (error: any) {
      console.error(
        chalk.red(`\n❌ Failed to generate keys: ${error.message}\n`)
      );
      process.exit(1);
    }
  });

process.on('uncaughtException', error => {
  console.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  console.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Default action - run interactive mode if no command provided
if (process.argv.length === 2) {
  generateKeysInteractive().catch(error => {
    console.error(
      chalk.red(`\n❌ Failed to generate keys: ${error.message}\n`)
    );
    process.exit(1);
  });
} else {
  try {
    program.parse();
  } catch (error: any) {
    if (error.code === 'commander.unknownCommand') {
      console.error(chalk.red(`\nUnknown command: ${error.message}`));
      console.log(chalk.dim('Run with --help to see available commands\n'));
    } else if (error.code === 'commander.missingArgument') {
      console.error(chalk.red(`\nMissing argument: ${error.message}`));
      console.log(chalk.dim('Run with --help to see command usage\n'));
    } else {
      console.error(chalk.red(`\nCLI error: ${error.message}\n`));
    }
    process.exit(1);
  }
}
