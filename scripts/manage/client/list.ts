import chalk from 'chalk';
import { CLIENT_TYPES } from './types.js';
import { loadClientRegistryConfig } from './local-client-manager.js';
import { createBox, createTable, log } from '../shared/utils.js';

/**
 * List all clients with beautiful formatting
 */
export async function listClients(): Promise<void> {
  try {
    console.log(
      chalk.dim(
        '💡 Alternative: View clients in the admin panel at /admin/clients\n'
      )
    );

    const config = loadClientRegistryConfig();

    if (config.clients.length === 0) {
      console.log('');
      const emptyContent = [
        '',
        chalk.dim('👻 No OIDC Clients Found'),
        '',
        chalk.dim('Get started by adding your first client:'),
        chalk.cyan('pnpm client add'),
        '',
      ];
      console.log(createBox(emptyContent, 50));
      return;
    }

    log.title(`Registered Clients (${config.clients.length} total)`);

    const tableHeaders = ['Client ID', 'Name', 'Type', 'Status'];
    const tableRows = config.clients.map(client => {
      const typeConfig =
        CLIENT_TYPES[(client as any).preset as keyof typeof CLIENT_TYPES] ??
        CLIENT_TYPES[client.application_type as keyof typeof CLIENT_TYPES];
      const icon = typeConfig?.icon || '📄';
      const status = client.active
        ? chalk.green('Active')
        : chalk.red('Inactive');

      // Shortened client ID and name
      const shortClientId =
        client.client_id.length > 20
          ? `${client.client_id.substring(0, 17)}...`
          : client.client_id;

      const shortName = client.client_name
        ? client.client_name.length > 15
          ? `${client.client_name.substring(0, 12)}...`
          : client.client_name
        : chalk.dim('Unnamed');

      return [
        `${icon} ${chalk.bold(shortClientId)}`,
        shortName,
        chalk.cyan(client.application_type),
        status,
      ];
    });

    console.log(
      createTable(tableHeaders, tableRows, { width: 100, maxColumnWidth: 20 })
    );

    const stats = {
      active: config.clients.filter(c => c.active).length,
      inactive: config.clients.filter(c => !c.active).length,
    };

    console.log(`\n${chalk.bold.blue('📊 Summary')}`);
    console.log(chalk.dim('━'.repeat(30)));

    const summaryRows = [
      ['Total Clients', config.clients.length.toString()],
      ['Active', chalk.green(stats.active.toString())],
      ['Inactive', chalk.red(stats.inactive.toString())],
    ];

    const summaryTable = createTable(['Property', 'Count'], summaryRows, {
      width: 40,
    });

    console.log(summaryTable);
  } catch (error) {
    log.error(`Failed to list clients: ${(error as Error).message}`);
  }
}
