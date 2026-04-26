import type { Client, KoaContextWithOIDC } from 'oidc-provider';

/**
 * Factory function to create client-based CORS function
 * @returns Client-based CORS function
 */
export default function ClientBasedCORS() {
  /**
   * Function used to check whether a given CORS request should be allowed based on the request's client.
   * This function is called for every CORS request to determine if it should be allowed based on the client making the request.
   *
   * The function can be used to:
   * 1. Allow CORS based on client metadata (e.g., allowed origins list)
   * 2. Exclude specific endpoints from CORS checks
   * 3. Allow known internal origins
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#clientbasedcors}
   * @see {@link https://github.com/panva/node-oidc-provider/discussions/1298}
   *
   * @param {KoaContextWithOIDC} ctx - The request context containing:
   *   - oidc.route: The current OIDC route being accessed
   *   - oidc.client: The client making the request
   * @param {string} origin - The origin of the request (e.g., 'https://client.example.com')
   * @param {Client} client - The client object containing:
   *   - client_id: The client's unique identifier
   *   - metadata: Client metadata including any custom CORS settings
   * @returns {boolean} Whether the CORS request should be allowed
   *
   * @example
   * // Example implementation using client metadata
   * clientBasedCORS(ctx, origin, client) {
   *   // Exclude specific endpoints from CORS checks
   *   if (ctx.oidc.route === 'some_endpoint') {
   *     return true;
   *   }
   *   // Check against client's allowed origins
   *   return client.metadata.allowed_origins?.includes(origin);
   * }
   *
   * Single-Page Apps (SPAs) using the Authorization Code + PKCE flow will often hit the OP's token, userinfo,
   * or jwks_uri endpoints directly via fetch or XMLHttpRequest.
   *  Browsers block those calls unless the server opts into CORS.
   *
   * OIDC Discovery 1.0 § 4.2 recommends that the Token Endpoint, UserInfo Endpoint, jwks_uri,
   * Dynamic Client Registration and related endpoints SHOULD support CORS so that JavaScript/RP-in-browser clients can use them .
   */
  return function clientBasedCORS(
    _ctx: KoaContextWithOIDC,
    origin: string,
    client: Client
  ) {
    // ctx.oidc.route can be used to exclude endpoints from this behaviour, in that case just return
    // true to always allow CORS on them, false to deny
    // you may also allow some known internal origins if you want to

    // Client can only request from their registered redirect URIs origins
    const allowed = client.redirectUris?.map((u: string) => new URL(u).origin);
    return allowed?.includes(origin) ?? false;
  };
}
