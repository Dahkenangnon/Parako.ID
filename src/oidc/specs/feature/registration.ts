import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { KoaContextWithOIDC } from 'oidc-provider';
import { errors } from 'oidc-provider';
import type { ClientProperties } from '../../interfaces/interface.js';

/**
 * Factory function to create registration configuration
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @returns Registration configuration object
 */
export default function Registration(configManager: IConfigManager) {
  const config = configManager.getConfig();

  return {
    // We can register dynamically new clients in addition to the ones defined in the clients.js file
    enabled: config.features.oidc.dynamic_client_registration.enabled,

    // Client must be authorized to register a new client
    // Enables registration_endpoint to check a valid initial access token is provided as a bearer token during the registration call. Supported types are
    // string the string value will be checked as a static initial access token boolean true/false to enable/disable adapter backed initial access tokens
    // Whether static or dynamic initial access tokens are supported is determined by the adapter.
    initialAccessToken:
      config.features.oidc.dynamic_client_registration
        .require_initial_access_token,

    issueRegistrationAccessToken:
      config.features.oidc.dynamic_client_registration
        .issue_registration_access_token,

    policies: {
      'general-policy'(ctx: KoaContextWithOIDC, properties: ClientProperties) {
        // Only require client_name (RFC 7591 doesn't mandate it, but it's
        // essential for admin dashboards and audit logs)
        if (!('client_name' in properties) || !properties.client_name) {
          throw new errors.InvalidClientMetadata(
            'client_name is required for client registration'
          );
        }

        // Block internal-only flag — reserved for platform-provisioned clients
        if ('isInternalClient' in properties) {
          throw new errors.InvalidClientMetadata(
            'isInternalClient is reserved for internal use'
          );
        }

        const iat = ctx.oidc.entities?.InitialAccessToken as
          | (Record<string, unknown> & {
              policies_metadata?: {
                max_usage_count?: number;
                current_usage_count?: number;
              };
              save?: () => Promise<unknown>;
            })
          | undefined;

        if (iat?.policies_metadata) {
          const meta = iat.policies_metadata;
          const maxUsage = meta.max_usage_count;
          const currentUsage = meta.current_usage_count ?? 0;

          if (maxUsage !== undefined && currentUsage >= maxUsage) {
            throw new errors.InvalidToken(
              'Initial access token usage limit exceeded'
            );
          }

          // Increment usage count — persisted via adapter
          meta.current_usage_count = currentUsage + 1;
        }

        // Transfer policies to Registration Access Token
        if (ctx.oidc.entities?.RegistrationAccessToken) {
          ctx.oidc.entities.RegistrationAccessToken.policies = [
            'general-policy',
          ];
        }
      },
    },
  };
}
