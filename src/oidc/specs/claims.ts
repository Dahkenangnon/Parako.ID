import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create claims configuration
 * @param configManager - Configuration manager instance
 * @returns Claims configuration object
 */
export default function Claims(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * The claims configuration parameter can be used to define which claims fall under what scope as well as to expose additional claims that are available to clients via the claims authorization parameter.
   * Describes the claims that the OpenID Provider MAY be able to supply values for.
   * It is used to achieve two different things related to claims:
   * 1. Define which claims fall under what scope
   * 2. Expose additional claims available to clients via the claims authorization parameter
   *
   * This configuration defines the available claims and their scopes for the OpenID Connect provider.
   * Claims are pieces of information about the end-user that can be requested by clients.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#claims}
   *
   * @type {Object}
   */
  return config.features.oidc.claims;
}
