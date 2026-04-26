import { Client, KoaContextWithOIDC } from 'oidc-provider';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create introspection configuration
 * @param configManager - Configuration manager instance
 * @returns Introspection configuration object
 */
export default function Introspection(configManager: IConfigManager) {
  const config = configManager.getConfig();

  return {
    enabled: config.features.oidc.token_introspection.enabled,

    allowedPolicy(
      ctx: KoaContextWithOIDC,
      client: Client | undefined,
      token: { clientId?: string } | undefined
    ) {
      if (
        client?.introspectionEndpointAuthMethod === 'none' &&
        token?.clientId !== ctx?.oidc?.client?.clientId
      ) {
        return false;
      }
      return true;
    },
  };
}
