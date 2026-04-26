import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create ACR values configuration
 * @param configManager - Configuration manager instance
 * @returns Array of ACR values
 */
export default function AcrValues(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * ACR Values
   *
   * Authentication Context Class Reference Values is a list of values that
   * describe the authentication context of the user.
   *
   * @see {@link https://openid.net/specs/openid-connect-core-1_0.html#acrvalues}
   *
   *
   * @see {@link https://openid.net/specs/openid-connect-core-1_0.html}
   * Why acr_values?
   * The RP uses the acr_values parameter in its authorization request to ask the OP for particular authentication
   * contexts (e.g. multi-factor, phishing-resistant).
   */
  const configured: string[] = config.features.oidc.acr_values.supported;

  // Always include baseline values
  const defaults = ['urn:pwd', 'urn:mfa:otp'];

  return Array.from(new Set([...defaults, ...configured]));
}
