#!/usr/bin/env node

// When the admin API is available, this script should become a thin
// zero-dep HTTP client using fetch() (Node 18+ built-in), eliminating
// the chalk/commander/inquirer production dependencies.

import { Command } from 'commander';
import { getPackageInfo, showSubcommandHelp } from './shared/utils.js';
import { setupCommands, addClientInteractive } from './client/index.js';

const program = new Command();

program
  .name('client')
  .description(
    '🔧 Parako.ID OIDC Client Management CLI (Works in all environments)'
  )
  .version(getPackageInfo().version);

setupCommands(program);

// Enhanced help using common help system
program.on('--help', () => {
  showSubcommandHelp({
    name: 'OIDC CLIENT MANAGEMENT',
    icon: '🔧',
    description:
      'Manage OIDC clients in both development and production. Use this CLI tool OR the admin panel at /admin/clients for a secure web UI.',
    version: getPackageInfo().version,
    quickStart: [
      {
        command: 'pnpm client add',
        description: 'Create your first OIDC client',
        time: '1-2 min',
      },
      {
        command: 'pnpm client list',
        description: 'View all registered clients',
        time: '< 1 min',
      },
      {
        command: 'pnpm client show',
        description: 'Show client details (interactive)',
        time: '< 1 min',
      },
    ],
    examples: [
      {
        command: 'pnpm client add',
        description: 'Add a new client interactively',
      },
      { command: 'pnpm client list', description: 'List all clients' },
      {
        command: 'pnpm client show',
        description: 'Show client details (interactive)',
      },
      {
        command: 'pnpm client show <ID>',
        description: 'Show specific client by ID',
      },
      {
        command: 'pnpm client update',
        description: 'Update client settings',
      },
      {
        command: 'pnpm client remove',
        description: 'Remove a client (interactive)',
      },
      {
        command: 'pnpm client remove <ID>',
        description: 'Remove specific client by ID',
      },
      {
        command: 'pnpm client export',
        description: 'Export clients to JSON',
      },
      {
        command: 'pnpm client import',
        description: 'Import clients from JSON',
      },
      {
        command: 'pnpm client init',
        description: 'Initialize client registry',
      },
    ],
    features: [
      {
        icon: '✅',
        title: 'Works Everywhere',
        description: 'Use in dev, staging, or production',
      },
      {
        icon: '🌐',
        title: 'Web Application',
        description: 'Server-side apps with secrets',
      },
      {
        icon: '⚡',
        title: 'Single Page App',
        description: 'Client-side apps (no secrets)',
      },
      {
        icon: '📱',
        title: 'Native Application',
        description: 'Mobile/desktop apps',
      },
      {
        icon: '📺',
        title: 'Device Flow Client',
        description: 'IoT devices, smart TVs (RFC 8628)',
      },
      { icon: '🔧', title: 'API/Resource Server', description: 'Backend APIs' },
    ],
    tips: [
      'Alternative: Use the admin panel at /admin/clients for web UI',
      'This CLI works in all environments (dev, staging, production)',
      'Changes are saved to database OR parako-rp.jsonc file',
      'Use interactive mode for guided client creation',
      'Export clients before making bulk changes',
      'Client secrets are auto-generated for secure clients',
    ],
    fileInfo: {
      configFile: 'parako-rp.jsonc',
    },
  });
});

// Error handling for the CLI
program.exitOverride();

process.on('uncaughtException', error => {
  console.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`Unhandled rejection at ${promise}: ${reason}`);
  process.exit(1);
});

// Default action (backwards compatibility)
if (process.argv.length === 2) {
  // No arguments provided, run interactive client creation
  addClientInteractive().catch(error => {
    console.error(
      `Failed to start interactive client creation: ${error.message}`
    );
    process.exit(1);
  });
} else {
  try {
    program.parse();
  } catch (error: any) {
    if (error.code === 'commander.unknownCommand') {
      console.error(`Unknown command: ${error.message}`);
      console.info('Run with --help to see available commands');
    } else if (error.code === 'commander.missingArgument') {
      console.error(`Missing argument: ${error.message}`);
      console.info('Run with --help to see command usage');
    } else {
      console.error(`CLI error: ${error.message}`);
    }
    process.exit(1);
  }
}
