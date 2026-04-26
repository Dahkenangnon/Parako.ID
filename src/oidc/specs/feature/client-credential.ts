import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create client credentials configuration
 * @param configManager - Configuration manager instance
 * @returns Client credentials configuration object
 */
export default function ClientCredential(configManager: IConfigManager) {
  return {
    enabled: configManager.getConfig().features.oidc.client_credentials.enabled,
  };
}
