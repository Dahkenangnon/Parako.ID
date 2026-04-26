import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create enabled JWA configuration
 * @param configManager - Configuration manager instance
 * @returns JWA configuration object
 */
export default function EnabledJWA(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Dynamic JWA (JSON Web Algorithms) configuration
   * Aligned with node-oidc-provider supported enabledJWA properties
   *
   * @see {@link https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#enabledjwa}
   */
  return {
    // attestSigningAlgValues: getConfigValue('features.oidc.jwa.attest_signing_alg_values', ['ES256', 'Ed25519', 'EdDSA']),

    // Authorization Response (JARM) algorithms
    authorizationEncryptionAlgValues:
      config.oidc.jwa.authorization_encryption_alg_values,
    authorizationEncryptionEncValues:
      config.oidc.jwa.authorization_encryption_enc_values,

    authorizationSigningAlgValues:
      config.oidc.jwa.authorization_signing_alg_values,

    // Client Authentication algorithms
    clientAuthSigningAlgValues: config.oidc.jwa.client_auth_signing_alg_values,

    // DPoP (Demonstration of Proof of Possession) algorithms
    dPoPSigningAlgValues: config.oidc.jwa.dpop_signing_alg_values,

    // ID Token algorithms
    idTokenEncryptionAlgValues: config.oidc.jwa.id_token_encryption_alg_values,

    idTokenEncryptionEncValues: config.oidc.jwa.id_token_encryption_enc_values,

    idTokenSigningAlgValues: config.oidc.jwa.id_token_signing_alg_values,

    // Token Introspection algorithms
    introspectionEncryptionAlgValues:
      config.oidc.jwa.introspection_encryption_alg_values,

    introspectionEncryptionEncValues:
      config.oidc.jwa.introspection_encryption_enc_values,

    introspectionSigningAlgValues:
      config.oidc.jwa.introspection_signing_alg_values,

    // Request Object algorithms
    requestObjectEncryptionAlgValues:
      config.oidc.jwa.request_object_encryption_alg_values,

    requestObjectEncryptionEncValues:
      config.oidc.jwa.request_object_encryption_enc_values,

    requestObjectSigningAlgValues:
      config.oidc.jwa.request_object_signing_alg_values,

    // UserInfo algorithms
    userinfoEncryptionAlgValues: config.oidc.jwa.userinfo_encryption_alg_values,
    userinfoEncryptionEncValues: config.oidc.jwa.userinfo_encryption_enc_values,
    userinfoSigningAlgValues: config.oidc.jwa.userinfo_signing_alg_values,
  };
}
