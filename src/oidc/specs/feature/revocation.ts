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
  };
}
