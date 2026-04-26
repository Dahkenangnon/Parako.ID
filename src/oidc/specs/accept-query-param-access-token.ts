import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create accept query param access token configuration
 * @param configManager - Configuration manager instance
 * @returns Boolean indicating if query param access tokens are accepted
 */
export default function AcceptQueryParamAccessToken(
  configManager: IConfigManager
) {
  const config = configManager.getConfig();

  /**
   * Configuration for accepting access tokens in query parameters.
   *
   * This setting controls whether the OIDC Provider allows or prohibits the use of query strings
   * to carry access tokens. When enabled (true), clients can pass access tokens as query parameters
   * in the format `?access_token=<token>`. When disabled (false), this mechanism is prohibited.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#acceptqueryparamaccesstokens}
   *
   * Security Considerations:
   * - Enabling this feature may expose access tokens in server logs, browser history, and referrer headers
   * - It's recommended to disable this feature in production environments
   * - If enabled, consider implementing additional security measures like short token lifetimes
   *
   * @type {boolean}
   * @default false
   */
  return config.features.oidc.accept_query_param_access_tokens;
}
