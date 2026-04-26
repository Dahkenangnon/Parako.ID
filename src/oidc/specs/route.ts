import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
/**
 * Factory function to create route configuration
 * @param configManager - Configuration manager instance
 * @returns Route configuration object
 */
export default function Routes(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * OpenID Provider Route Configuration
   *
   * This configuration defines the URL paths for various OpenID Connect endpoints.
   * All routes must start with a forward slash ("/") and should be unique within
   * your application.
   *
   * The routes defined here are used by the OpenID Provider to handle:
   * - Authorization requests
   * - UserInfo requests
   * - Dynamic client registration
   * - Token management
   * - Device authorization
   * - Session management
   * - JWKS (JSON Web Key Set)
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#routes}
   *
   * @type {Object}
   * @property {string} authorization - The authorization endpoint path
   * @property {string} userinfo - The userinfo endpoint path
   * @property {string} registration - The dynamic client registration endpoint path
   * @property {string} backchannel_authentication - The backchannel authentication endpoint path
   * @property {string} challenge - The challenge endpoint path
   * @property {string} code_verification - The device code verification endpoint path
   * @property {string} device_authorization - The device authorization endpoint path
   * @property {string} end_session - The session end endpoint path
   * @property {string} introspection - The token introspection endpoint path
   * @property {string} jwks - The JSON Web Key Set endpoint path
   * @property {string} pushed_authorization_request - The pushed authorization request endpoint path
   * @property {string} revocation - The token revocation endpoint path
   * @property {string} token - The token endpoint path
   *
   * @example
   * // Example usage in OIDC Provider configuration
   * const provider = new Provider('http://localhost:3000', {
   *   routes: {
   *     authorization: '/authorize',
   *     userinfo: '/userinfo',
   *     registration: '/register'
   *   }
   * });
   */
  return {
    /** Authorization endpoint path */
    authorization: config.oidc.routes.authorization,

    /** UserInfo endpoint path */
    userinfo: config.oidc.routes.userinfo,

    /** Dynamic client registration endpoint path */
    registration: config.oidc.routes.registration,

    /** Backchannel authentication endpoint path */
    backchannel_authentication: config.oidc.routes.backchannel_authentication,

    /** Challenge endpoint path */
    challenge: config.oidc.routes.challenge,

    /** Device code verification endpoint path */
    code_verification: config.oidc.routes.code_verification,

    /** Device authorization endpoint path */
    device_authorization: config.oidc.routes.device_authorization,

    /** Session end endpoint path */
    end_session: config.oidc.routes.end_session,

    /** Token introspection endpoint path */
    introspection: config.oidc.routes.introspection,

    /** JSON Web Key Set endpoint path */
    jwks: config.oidc.routes.jwks,

    /** Pushed authorization request endpoint path */
    pushed_authorization_request:
      config.oidc.routes.pushed_authorization_request,

    /** Token revocation endpoint path */
    revocation: config.oidc.routes.revocation,

    /** Token endpoint path */
    token: config.oidc.routes.token,
  };
}
