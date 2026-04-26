import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create registration management configuration
 * @param configManager - Configuration manager instance
 * @returns Registration management configuration object
 */
export default function RegistrationManagement(configManager: IConfigManager) {
  const config = configManager.getConfig();

  return {
    enabled: config.features.oidc.client_registration_management.enabled,
    rotateRegistrationAccessToken:
      config.features.oidc.client_registration_management
        .rotate_registration_access_token,
  };
}
