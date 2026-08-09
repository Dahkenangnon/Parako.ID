import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create cookie configuration
 * @param configManager - Configuration manager instance
 * @returns Cookie configuration object
 */
export default function Cookies(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Cookie Configuration for OIDC Provider
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#cookies}
   *
   * Options for the cookie module used to keep track of various User-Agent states.
   * The options maxAge and expires are ignored. Use ttl.Session and ttl.Interaction
   * to configure the ttl and in turn the cookie expiration values for Session and
   * Interaction models.
   *
   * Cookie Options:
   * - keys: Array of strings used to sign cookies (required)
   * - names: Object containing cookie names for different states
   * - long: Object containing long-lived cookie options
   * - short: Object containing short-lived cookie options
   * - iat: Object containing issued at time cookie options
   *
   * @type {Object} Cookie configuration object
   */
  const cookies: {
    keys: string[];
    long?: { sameSite: 'none' };
  } = {
    keys: config.security.secrets.cookie_secrets,
  };

  // oidc-provider v9 only registers POST handlers for the authorization and
  // end-session endpoints when its long-lived cookies use SameSite=None.
  // Keep the safer provider default for every other configuration profile.
  if (config.features.oidc.enable_http_post_methods) {
    cookies.long = { sameSite: 'none' };
  }

  return cookies;
}
