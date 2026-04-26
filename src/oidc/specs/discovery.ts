import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create discovery configuration
 * @param configManager - Configuration manager instance
 * @returns Discovery configuration object
 */
export default function Discovery(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * OpenID Provider Discovery Configuration
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#discovery}
   *
   * This configuration object allows you to extend the OpenID Provider Discovery document
   * with additional properties. The discovery document is available at the well-known
   * endpoint /.well-known/openid-configuration.
   *
   * Any properties added to this object will be merged with the default discovery
   * document properties. This is useful for adding custom endpoints, features, or
   * metadata to your OpenID Provider.
   *
   * Example properties that can be added:
   * - custom_endpoint: URL for a custom endpoint
   * - custom_feature: Boolean indicating support for a custom feature
   * - custom_metadata: Additional metadata about the provider
   *
   * @type {Object} Discovery configuration object
   */
  return {
    ...config.oidc.discovery,
    ui_locales_supported: config.application.locales.available,
  };
}
