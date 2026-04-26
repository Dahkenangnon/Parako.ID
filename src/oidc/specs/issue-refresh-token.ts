import type {
  KoaContextWithOIDC,
  AuthorizationCode,
  DeviceCode,
  BackchannelAuthenticationRequest,
  Client,
} from 'oidc-provider';

/**
 * Factory function to create refresh token issuance configuration
 * @returns Refresh token issuance decision function
 */
export default function IssueRefreshToken() {
  /**
   * Refresh Token Issuance Configuration
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#issuerefreshtoken}
   *
   * Function used to decide whether a refresh token will be issued or not. This function is called
   * during the authorization code grant flow to determine if a refresh token should be issued along
   * with the access token.
   *
   * The function considers several factors:
   * - Whether the client is allowed to use the refresh_token grant type
   * - Whether the 'offline_access' scope was requested
   * - The client's application type and token endpoint authentication method
   *
   * @param {KoaContextWithOIDC} ctx - The Koa request context
   * @param {Client} client - The client requesting the token
   * @param {AuthorizationCode} code - The authorization code being exchanged
   * @returns {Promise<boolean>} Whether a refresh token should be issued
   */
  return async function issueRefreshToken(
    _ctx: KoaContextWithOIDC,
    client: Client,
    code: AuthorizationCode | DeviceCode | BackchannelAuthenticationRequest
  ) {
    if (!client.grantTypeAllowed('refresh_token')) {
      return false;
    }

    // Only AuthorizationCode has scopes, others don't need offline_access check
    if ('scopes' in code) {
      return (
        code.scopes.has('offline_access') ||
        (client.applicationType === 'web' &&
          client.tokenEndpointAuthMethod === 'none')
      );
    }

    // For DeviceCode and BackchannelAuthenticationRequest, use client type check
    return (
      client.applicationType === 'web' &&
      client.tokenEndpointAuthMethod === 'none'
    );
  };
}
