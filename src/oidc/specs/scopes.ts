import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create scopes configuration
 * @param configManager - Configuration manager instance
 * @returns Scopes configuration array
 */
export default function Scopes(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Scopes Configuration
   *
   * This configuration defines the scopes that are supported by the OIDC Provider.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#scopes}
   *
   * @type {string[]} Array of supported scopes
   */
  return config.features.oidc.scopes;
}
