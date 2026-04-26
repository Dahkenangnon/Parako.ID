import type { KoaContextWithOIDC } from 'oidc-provider';

/**
 * Factory function to create extra token claims function
 * @returns Extra token claims function
 */
export default function ExtraTokenClaims() {
  /**
   * Extra Access Token Claims Configuration
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#extratokenclaims}
   *
   * This function allows adding custom claims to Access Tokens issued by the provider.
   * It is called during Access Token issuance, allowing for dynamic claim generation
   * based on the request context, client, account, or other factors.
   *
   * Important Notes:
   * - Claims added here are merged with the standard Access Token claims
   * - Custom claims should use a namespaced format (e.g., 'urn:example:claim')
   * - Claims should be relevant to the resource being accessed
   * - Consider token size limitations when adding claims
   * - These claims are only added to Access Tokens, not ID Tokens or other token types
   *
   * @param {KoaContextWithOIDC} ctx - The Koa request context containing:
   *   - ctx.oidc.client: The client requesting the token
   *   - ctx.oidc.account: The authenticated account (if applicable)
   *   - ctx.oidc.session: The current session
   *   - ctx.oidc.params: The request parameters
   * @param {Object} token - The Access Token being issued containing:
   *   - token.scope: The granted scopes
   *   - token.clientId: The client identifier
   *   - token.accountId: The account identifier (if applicable)
   *   - token.grantId: The grant identifier
   * @returns {Promise<Object>} An object containing the additional claims to be added to the Access Token
   *
   * @example
   * // Adding a custom claim to Access Tokens
   * return {
   *   'urn:example:custom_claim': 'value'
   * };
   *
   * @example
   * // Adding claims based on client
   * if (ctx.oidc.client.clientId === 'special_client') {
   *   return {
   *     'urn:example:special_claim': 'value'
   *   };
   * }
   */
  return async function extraTokenClaims(
    _ctx: KoaContextWithOIDC,
    _token: any
  ) {
    return {
      // This is an example of a custom claim that will be added to the Access Token
      'urn:idp:parako_id:foo': 'bar',
    };
  };
}
