import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create backchannel logout configuration
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @returns Backchannel logout configuration object
 */
export default function BackchannelLogout(configManager: IConfigManager) {
  return {
    enabled: configManager.getConfig().features.oidc.backchannel_logout.enabled,
  };
}
