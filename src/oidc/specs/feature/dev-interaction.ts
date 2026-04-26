import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create dev interactions configuration
 * @param configManager - Configuration manager instance
 * @returns Dev interactions configuration object
 */
export default function DevInteraction(configManager: IConfigManager) {
  return {
    enabled: configManager.getConfig().features.oidc.dev_interactions.enabled,
  };
}
