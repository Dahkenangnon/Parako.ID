import { type Command } from 'commander';
import { listClients } from './list.js';
import { addClientInteractive } from './add.js';

/**
 * Setup client management commands (intentionally minimal).
 *
 * Only `add` and `list` are exposed via the CLI. For other operations
 * (update, remove, inspect, import, export), use the admin UI or the
 * Management API. See `parako-rp.example.json` for the client shape.
 */
export function setupCommands(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('📋 List all registered clients')
    .action(listClients);

  program
    .command('add')
    .alias('create')
    .alias('new')
    .description('🆕 Add a new OIDC client (interactive)')
    .action(addClientInteractive);
}
