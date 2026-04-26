import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create enable HTTP POST method configuration
 * @param configManager - Configuration manager instance
 * @returns Boolean indicating if HTTP POST methods are enabled
 */
export default function EnableHttpPostMethod(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Enable HTTP POST methods for authorization requests
   *
   * This configuration allows the use of HTTP POST methods for authorization requests.
   * It is set to false by default, meaning HTTP POST methods are disabled.
   *
   * Why You Might Need POST
   * - Large Requests: Hiding long parameter sets (e.g. huge request JWTs) from URL logs.
   * - Form-Based UIs: Some SPAs or server-rendered pages prefer <form method="POST">…</form>.
   * - Security Profiles: Certain FAPI or enterprise profiles demand POST for /authorize.
   *
   * @type {boolean}
   */
  return config.features.oidc.enable_http_post_methods;
}
