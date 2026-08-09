import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { KoaContextWithOIDC } from 'oidc-provider';
import { errors } from 'oidc-provider';
import type { ClientProperties } from '../../interfaces/interface.js';

interface RegistrationTokenAdapter {
  find(id: string): Promise<Record<string, unknown> | undefined>;
  upsert(
    id: string,
    payload: Record<string, unknown>,
    expiresIn?: number
  ): Promise<void>;
}

interface InitialAccessTokenEntity {
  adapter?: RegistrationTokenAdapter;
  jti?: unknown;
  remainingTTL?: unknown;
}

function invalidUsageState(): InstanceType<typeof errors.InvalidToken> {
  return new errors.InvalidToken(
    'Initial access token usage state cannot be persisted'
  );
}

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
      async 'general-policy'(
        ctx: KoaContextWithOIDC,
        properties: ClientProperties
      ) {
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

        const iat = ctx.oidc.entities?.InitialAccessToken as unknown as
          InitialAccessTokenEntity | undefined;

        if (iat) {
          if (
            typeof iat.jti !== 'string' ||
            !iat.jti ||
            typeof iat.adapter?.find !== 'function' ||
            typeof iat.adapter.upsert !== 'function'
          ) {
            throw invalidUsageState();
          }

          const storedPayload = await iat.adapter.find(iat.jti);
          if (!storedPayload) {
            throw invalidUsageState();
          }

          const rawMetadata = storedPayload.policies_metadata;
          if (
            rawMetadata !== undefined &&
            (typeof rawMetadata !== 'object' ||
              rawMetadata === null ||
              Array.isArray(rawMetadata))
          ) {
            throw invalidUsageState();
          }

          const meta = rawMetadata as
            | {
                max_usage_count?: number;
                current_usage_count?: number;
              }
            | undefined;

          if (meta) {
            const maxUsage = meta.max_usage_count;
            const currentUsage = meta.current_usage_count ?? 0;

            if (
              (maxUsage !== undefined &&
                (!Number.isSafeInteger(maxUsage) || maxUsage < 1)) ||
              !Number.isSafeInteger(currentUsage) ||
              currentUsage < 0
            ) {
              throw invalidUsageState();
            }

            if (maxUsage !== undefined && currentUsage >= maxUsage) {
              throw new errors.InvalidToken(
                'Initial access token usage limit exceeded'
              );
            }

            if (
              typeof iat.remainingTTL !== 'number' ||
              !Number.isFinite(iat.remainingTTL) ||
              iat.remainingTTL <= 0
            ) {
              throw invalidUsageState();
            }

            await iat.adapter.upsert(
              iat.jti,
              {
                ...storedPayload,
                policies_metadata: {
                  ...meta,
                  current_usage_count: currentUsage + 1,
                },
              },
              Math.ceil(iat.remainingTTL)
            );
          }
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
