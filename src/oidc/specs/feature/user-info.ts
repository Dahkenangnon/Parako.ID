import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create user info configuration
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @returns User info configuration object
 */
export default function UserInfo(configManager: IConfigManager) {
  const config = configManager.getConfig();

  return {
    enabled: config.features.oidc.userinfo_endpoint.enabled,
  };
}
