import chalk from 'chalk';
import inquirer from 'inquirer';
import { CLIENT_TYPES } from './types.js';
import { addClient, findClientById } from './local-client-manager.js';
import { log } from '../shared/utils.js';
import { displayClient } from './display.js';
import type { OidcClient } from './local-types.js';

/**
 * Add a new client interactively
 */
export async function addClientInteractive(): Promise<void> {
  try {
    log.title('🆕 Add New OIDC Client');
    log.subtitle("Let's create a new client for your application");
    console.log(
      chalk.dim(
        '💡 Alternative: Use the admin panel at /admin/clients for a web UI\n'
      )
    );

    const typeChoices = Object.entries(CLIENT_TYPES).map(([key, type]) => ({
      name: `${type.icon} ${type.name}`,
      value: key,
      description: type.description,
    }));

    const { clientType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'clientType',
        message: 'What type of client are you creating?',
        choices: typeChoices,
        pageSize: 10,
      },
    ] as any);

    const selectedType = CLIENT_TYPES[clientType as keyof typeof CLIENT_TYPES];
    log.info(`Selected: ${selectedType.name}`);

    const basicInfo = await inquirer.prompt([
      {
        type: 'input',
        name: 'client_id',
        message: 'Client ID (leave empty to auto-generate):',
        validate: async (input: string) => {
          if (!input) return true; // Allow empty for auto-generation
          if (findClientById(input)) {
            return `Client with ID '${input}' already exists!`;
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'client_name',
        message: 'Client name:',
        validate: (input: string) =>
          input.trim().length > 0 || 'Client name is required',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
      },
    ] as any);

    // @ts-expect-error - OidcClient is not defined
    const clientData: Partial<OidcClient> = {
      ...selectedType.defaults,
      ...basicInfo,
      client_name: basicInfo.client_name.trim(),
      description: basicInfo.description?.trim() || undefined,
      grant_types: [...selectedType.defaults.grant_types],
      preset: clientType as OidcClient['preset'],
    };

    if (
      clientType !== 'api_management' &&
      clientType !== 'm2m' &&
      clientType !== 'device'
    ) {
      const { needsRedirectUris } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'needsRedirectUris',
          message: 'Add redirect URIs?',
          default: true,
        },
      ] as any);

      if (needsRedirectUris) {
        const redirectUris: string[] = [];
        let addingUris = true;

        while (addingUris) {
          const { uri } = await inquirer.prompt([
            {
              type: 'input',
              name: 'uri',
              message: `Redirect URI ${redirectUris.length + 1} (press Enter to finish):`,
              validate: (input: string) => {
                if (!input) return true; // Empty to finish
                try {
                  new URL(input);
                  return true;
                } catch {
                  return 'Please enter a valid URL';
                }
              },
            },
          ] as any);

          if (!uri) {
            addingUris = false;
          } else {
            redirectUris.push(uri);
            log.success(`Added: ${uri}`);
          }
        }

        clientData.redirect_uris = redirectUris;

        // Post-logout redirect URIs
        if (redirectUris.length > 0) {
          const { needsLogoutUris } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'needsLogoutUris',
              message: 'Add post-logout redirect URIs?',
              default: false,
            },
          ] as any);

          if (needsLogoutUris) {
            const logoutUris: string[] = [];
            let addingLogoutUris = true;

            while (addingLogoutUris) {
              const { uri } = await inquirer.prompt([
                {
                  type: 'input',
                  name: 'uri',
                  message: `Post-logout URI ${logoutUris.length + 1} (press Enter to finish):`,
                  validate: (input: string) => {
                    if (!input) return true;
                    try {
                      new URL(input);
                      return true;
                    } catch {
                      return 'Please enter a valid URL';
                    }
                  },
                },
              ] as any);

              if (!uri) {
                addingLogoutUris = false;
              } else {
                logoutUris.push(uri);
                log.success(`Added: ${uri}`);
              }
            }

            clientData.post_logout_redirect_uris = logoutUris;
          }
        }
      }
    }

    const additionalConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'additionalScopes',
        message:
          'Additional scopes (space-separated, will be added to defaults):',
        default: '',
      },
      {
        type: 'input',
        name: 'client_uri',
        message: 'Client URI (optional):',
        validate: (input: string) => {
          if (!input) return true;
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'input',
        name: 'logo_uri',
        message: 'Logo URI (optional):',
        validate: (input: string) => {
          if (!input) return true;
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'input',
        name: 'tags',
        message: 'Tags (comma-separated, optional):',
      },
    ] as any);

    // Device flow specific configuration
    if (clientType === 'device') {
      const deviceConfig = await inquirer.prompt([
        {
          type: 'input',
          name: 'device_authorization_endpoint',
          message:
            'Device authorization endpoint (default: /oidc/v1/device/auth):',
          default: '/oidc/v1/device/auth',
        },
        {
          type: 'number',
          name: 'device_code_lifetime',
          message: 'Device code lifetime in seconds (default: 600):',
          default: 600,
          validate: (input: number) => {
            if (input < 60)
              return 'Device code lifetime must be at least 60 seconds';
            if (input > 3600)
              return 'Device code lifetime must not exceed 3600 seconds';
            return true;
          },
        },
        {
          type: 'number',
          name: 'user_code_lifetime',
          message: 'User code lifetime in seconds (default: 600):',
          default: 600,
          validate: (input: number) => {
            if (input < 60)
              return 'User code lifetime must be at least 60 seconds';
            if (input > 3600)
              return 'User code lifetime must not exceed 3600 seconds';
            return true;
          },
        },
        {
          type: 'confirm',
          name: 'verification_uri_complete',
          message:
            'Enable verification_uri_complete (recommended for better UX)?',
          default: true,
        },
      ] as any);

      Object.assign(clientData, {
        device_authorization_endpoint:
          deviceConfig.device_authorization_endpoint,
        device_code_lifetime: deviceConfig.device_code_lifetime,
        user_code_lifetime: deviceConfig.user_code_lifetime,
        verification_uri_complete: deviceConfig.verification_uri_complete,
      });

      log.info('📺 Device flow client configured with RFC 8628 compliance');
    }

    const defaultScopes = selectedType.defaults.scope
      ? selectedType.defaults.scope.split(' ').filter(s => s.trim())
      : [];
    const additionalScopes = additionalConfig.additionalScopes
      ? additionalConfig.additionalScopes.split(' ').filter(s => s.trim())
      : [];
    const allScopes = [...new Set([...defaultScopes, ...additionalScopes])]; // Remove duplicates using Set
    const finalScope = allScopes.join(' ');

    Object.assign(clientData, {
      scope: finalScope,
      client_uri: additionalConfig.client_uri || undefined,
      logo_uri: additionalConfig.logo_uri || undefined,
      tags: additionalConfig.tags
        ? additionalConfig.tags
            .split(',')
            .map((tag: string) => tag.trim())
            .filter((tag: string) => tag)
        : undefined,
    });

    console.log(chalk.bold('\n📄 Client Configuration Summary:'));
    console.log(`  Type: ${selectedType.icon} ${selectedType.name}`);
    console.log(`  Name: ${clientData.client_name}`);
    console.log(`  Grant Types: ${clientData.grant_types?.join(', ')}`);
    console.log(`  Scopes: ${clientData.scope}`);
    if (clientData.redirect_uris) {
      console.log(`  Redirect URIs: ${clientData.redirect_uris.length} URI(s)`);
    }

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Create this client?',
        default: true,
      },
    ] as any);

    if (!confirmed) {
      log.info('Operation cancelled.');
      return;
    }

    const newClient = addClient(clientData);

    log.success('✨ Client created successfully!');
    displayClient(newClient, true);

    if (newClient.client_secret) {
      log.warning(
        '⚠️  IMPORTANT: Save the client secret securely. It will not be shown again in plain text.'
      );
    }
  } catch (error) {
    log.error(`Failed to add client: ${(error as Error).message}`);
  }
}
