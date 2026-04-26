import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create allow omitting single registered redirect URI configuration
 * @param configManager - Configuration manager instance
 * @returns Boolean indicating if single registered redirect URI can be omitted
 */
export default function AllowOmittingSingleRegisteredRedirectUri(
  configManager: IConfigManager
) {
  const config = configManager.getConfig();

  /**
   * Allow omitting single registered redirect URI.
   *
   * For example, if the RP has only one registered redirect URI, it can omit the `redirect_uri` parameter from the authorization request.
   *
   * @see {@link https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest}
   *
   * "When there's one and only one redirect_uri registered for the client, it may be omitted from the Authorization Request since the provider would know unambiguously where to send the response."
   */
  return config.features.oidc.allowOmittingSingleRegisteredRedirectUri;
}
