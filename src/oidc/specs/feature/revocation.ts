import { errors } from 'oidc-provider';
import type { Client, KoaContextWithOIDC } from 'oidc-provider';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create revocation configuration
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @returns Revocation configuration object
 */
export default function Revocation(configManager: IConfigManager) {
  const config = configManager.getConfig();

  return {
    enabled: config.features.oidc.token_revocation.enabled,

    allowedPolicy(
      _ctx: KoaContextWithOIDC,
      client: Client,
      token: { clientId?: string }
    ) {
      if (token.clientId !== client.clientId) {
        if (client.clientAuthMethod === 'none') {
          return false;
        }

        throw new errors.InvalidRequest(
          'client is not authorized to revoke the presented token'
        );
      }

      return true;
    },
  };
}
