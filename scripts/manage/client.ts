#!/usr/bin/env node

// When the admin API is available, this script should become a thin
// zero-dep HTTP client using fetch() (Node 18+ built-in), eliminating
// the chalk/commander/inquirer production dependencies.

import { Command } from 'commander';
import { setupCommands, addClientInteractive } from './client/index.js';
import { isMainModule } from './shared/entrypoint.js';
import { getPackageInfo, showSubcommandHelp } from './shared/utils.js';

interface CliError {
  code?: string;
  message?: string;
}

function getErrorDetails(error: unknown): CliError {
  if (error && typeof error === 'object') return error as CliError;
  return { message: String(error) };
}

/** Build the client-management program without executing it. */
export function buildClientProgram(): Command {
  const program = new Command();
  const version = getPackageInfo().version;

  program
    .name('client')
    .description(
      '🔧 Parako.ID OIDC Client Management CLI (Works in all environments)'
    )
    .version(version)
    .exitOverride();

  setupCommands(program);

  program.on('--help', () => {
    showSubcommandHelp({
      name: 'OIDC CLIENT MANAGEMENT',
      icon: '🔧',
      description:
        'Manage OIDC clients in both development and production. Use this CLI tool OR the admin panel at /admin/clients for a secure web UI.',
      version,
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
      ],
      examples: [
        {
          command: 'pnpm client add',
          description: 'Add a new client interactively',
        },
        { command: 'pnpm client list', description: 'List all clients' },
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
        {
          icon: '🔧',
          title: 'API/Resource Server',
          description: 'Backend APIs',
        },
      ],
      tips: [
        'Alternative: Use the admin panel at /admin/clients for web UI',
        'This CLI works in all environments (dev, staging, production)',
        'Changes are saved to database OR parako-rp.jsonc file',
        'Use interactive mode for guided client creation',
        'Client secrets are auto-generated for secure clients',
      ],
      fileInfo: {
        configFile: 'runtime/parako-rp.jsonc',
      },
    });
  });

  return program;
}

/** Execute the client-management CLI for an explicit argument vector. */
export async function runClientCli(argv = process.argv): Promise<void> {
  try {
    if (argv.length === 2) {
      await addClientInteractive();
      return;
    }

    await buildClientProgram().parseAsync(argv);
  } catch (error: unknown) {
    const details = getErrorDetails(error);
    const message = details.message ?? 'Unknown error';

    if (
      details.code === 'commander.helpDisplayed' ||
      details.code === 'commander.help' ||
      details.code === 'commander.version'
    ) {
      return;
    }

    if (details.code === 'commander.unknownCommand') {
      console.error(`Unknown command: ${message}`);
      console.info('Run with --help to see available commands');
    } else if (details.code === 'commander.missingArgument') {
      console.error(`Missing argument: ${message}`);
      console.info('Run with --help to see command usage');
    } else {
      console.error(`CLI error: ${message}`);
    }

    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  void runClientCli();
}
