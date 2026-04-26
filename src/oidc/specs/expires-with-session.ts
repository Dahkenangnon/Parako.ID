import type {
  AuthorizationCode,
  AccessToken,
  DeviceCode,
  KoaContextWithOIDC,
} from 'oidc-provider';

/**
 * Factory function to create expires with session function
 * @returns Expires with session function
 */
export default function ExpiresWithSession() {
  /**
   * Function used to decide whether the given authorization code, device code,
   *  or authorization-endpoint returned opaque access token be bound to the user session.
   *  This will be applied to all opaque tokens issued from the authorization code, device code,
   *  or subsequent refresh token use in the future. When artifacts are session-bound
   * their originating session will be loaded by its uid every time they are encountered.
   *  Session bound artefacts will effectively get revoked if the end-user logs out.
   *
   * @param {Object} ctx - The context object
   * @param {Object} code - The code object
   * @returns {boolean} - True if the code should expire, false otherwise
   */
  return async function expiresWithSession(
    _ctx: KoaContextWithOIDC,
    token: AccessToken | AuthorizationCode | DeviceCode
  ) {
    // Only AuthorizationCode has scopes, others don't need session binding
    if ('scopes' in token) {
      return !token.scopes.has('offline_access');
    }
    return true; // For AccessToken and DeviceCode, always expire with session
  };
}
