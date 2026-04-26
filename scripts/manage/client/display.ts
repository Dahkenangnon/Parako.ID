import chalk from 'chalk';
import { CLIENT_TYPES } from './types.js';
import type { OidcClient } from './local-types.js';
import { log } from '../shared/utils.js';

/**
 * Display client information in a beautiful format
 */
export function displayClient(
  client: OidcClient,
  showSecret: boolean = false
): void {
  const typeConfig =
    CLIENT_TYPES[(client as any).preset as keyof typeof CLIENT_TYPES] ??
    CLIENT_TYPES[client.application_type as keyof typeof CLIENT_TYPES];
  const icon = typeConfig?.icon || '📄';

  console.log(chalk.bold(`\n${icon} Client Details\n`));
  console.log(chalk.cyan('Basic Information:'));
  console.log(`  ID: ${chalk.yellow(client.client_id)}`);
  console.log(`  Name: ${client.client_name || chalk.dim('Not set')}`);
  console.log(
    `  Type: ${chalk.blue(client.application_type)} ${typeConfig ? `(${typeConfig.name})` : ''}`
  );
  if ((client as any).preset) {
    console.log(`  Preset: ${chalk.magenta((client as any).preset)}`);
  }
  console.log(
    `  Status: ${client.active ? chalk.green('Active ✓') : chalk.red('Inactive ✗')}`
  );

  console.log(chalk.cyan('\nAuthentication:'));
  console.log(`  Grant Types: ${client.grant_types.join(', ')}`);
  console.log(`  Response Types: ${client.response_types.join(', ')}`);
  console.log(`  Auth Method: ${client.token_endpoint_auth_method}`);
  console.log(
    `  PKCE Required: ${client.require_pkce ? chalk.green('Yes') : chalk.red('No')}`
  );

  if (client.scope) {
    console.log(chalk.cyan('\nScopes:'));
    console.log(`  ${client.scope}`);
  }

  if (client.redirect_uris && client.redirect_uris.length > 0) {
    console.log(chalk.cyan('\nRedirect URIs:'));
    client.redirect_uris.forEach(uri => console.log(`  • ${uri}`));
  }

  if (
    client.post_logout_redirect_uris &&
    client.post_logout_redirect_uris.length > 0
  ) {
    console.log(chalk.cyan('\nPost-logout Redirect URIs:'));
    client.post_logout_redirect_uris.forEach(uri => console.log(`  • ${uri}`));
  }

  if (client.description) {
    console.log(chalk.cyan('\nDescription:'));
    console.log(`  ${client.description}`);
  }

  if (client.tags && client.tags.length > 0) {
    console.log(chalk.cyan('\nTags:'));
    console.log(`  ${client.tags.join(', ')}`);
  }

  // Device flow specific information
  if (
    client.grant_types.includes('urn:ietf:params:oauth:grant-type:device_code')
  ) {
    console.log(chalk.cyan('\nDevice Flow Settings:'));
    console.log(
      `  Authorization Endpoint: ${client.device_authorization_endpoint || '/oidc/v1/device/auth'}`
    );
    console.log(
      `  Device Code Lifetime: ${client.device_code_lifetime || 600}s`
    );
    console.log(`  User Code Lifetime: ${client.user_code_lifetime || 600}s`);
    console.log(
      `  Verification URI Complete: ${client.verification_uri_complete ? chalk.green('Enabled') : chalk.red('Disabled')}`
    );
    console.log(
      chalk.dim('  📺 This client supports RFC 8628 Device Authorization Grant')
    );
  }

  if (client.client_secret && showSecret) {
    console.log(chalk.cyan('\nClient Secret:'));
    console.log(`  ${chalk.yellow(client.client_secret)}`);
    log.warning('Keep this secret secure and never share it publicly!');
  }

  console.log(chalk.cyan('\nTimestamps:'));
  console.log(
    `  Created: ${client.created_at ? new Date(client.created_at).toLocaleString() : 'N/A'}`
  );
  console.log(
    `  Updated: ${client.updated_at ? new Date(client.updated_at).toLocaleString() : 'N/A'}`
  );
}
