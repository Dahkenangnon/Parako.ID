import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create JWT introspection configuration
 * @param configManager - Configuration manager instance
 * @returns JWT introspection configuration object
 */
export default function JWTIntrospection(configManager: IConfigManager) {
  return {
    enabled: configManager.getConfig().features.oidc.jwt_introspection.enabled,
  };
}
