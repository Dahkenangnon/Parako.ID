import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create conform ID token claims configuration
 * @param configManager - Configuration manager instance
 * @returns Boolean configuration value determining ID Token claims behavior
 */
export default function ConformIdTokenClaims(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Conform ID Token Claims Configuration
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#conformidtokenclaims}
   *
   * This configuration determines whether the ID Token should only contain End-User claims when the requested response_type is id_token.
   *
   * According to Core 1.0 - Requesting Claims using Scope Values:
   * - Claims requested using the scope parameter are only returned from the UserInfo Endpoint unless the response_type is id_token
   * - Despite this configuration, the ID Token always includes claims requested using the scope parameter when:
   *   1. The userinfo endpoint is disabled
   *   2. When issuing an Access Token not applicable for access to the userinfo endpoint
   *
   * When set to false (default):
   * - The ID Token will contain all claims requested by clients through scopes
   * - This is less strict but more convenient for clients
   *
   * When set to true:
   * - The ID Token will only contain claims when response_type includes 'id_token'
   * - This is more strict and follows the specification more closely
   *
   * true: ID Tokens will include all End-User claims (profile, email, etc.) for the scopes the RP requested—so your client can skip the separate UserInfo call.
   *
   * false: ID Tokens stay minimal (iss, sub, aud, exp, iat, at_hash, c_hash, etc.), and UserInfo is the canonical place for profile/email data.
   *
   * Specifically, setting it to true lets mobile/SPAs grab everything they need in one go—your ID Token payload carries the user's name, email, picture, and so on.
   *
   * @type {boolean} Configuration value determining ID Token claims behavior
   */
  return config.features.oidc.conform_id_token_claims;
}
