import type { KoaContextWithOIDC, Client } from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create PKCE configuration
 * @returns PKCE configuration object
 */
export default function PKCE(configManager: IConfigManager) {
  /**
   * PKCE (Proof Key for Code Exchange) Configuration
   *
   * This configuration defines the PKCE settings for the OpenID Provider, including
   * supported PKCE methods and policies for requiring PKCE usage.
   *
   * PKCE is a security extension to OAuth 2.0 for public clients that prevents
   * authorization code interception attacks. It is defined in RFC 7636.
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#pkce}
   * @see {@link https://tools.ietf.org/html/rfc7636}
   */
  return {
    /**
     * Function to determine if PKCE is required for a given client.
     *
     * PKCE requirements are based on:
     * - RFC 9700: All public clients MUST use PKCE
     * - FAPI 2.0: All clients MUST use PKCE
     * - FAPI 1.0 Advanced: Required for pushed authorization requests
     * - Other cases: PKCE is RECOMMENDED but not enforced
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {Client} client - The client making the request
     * @returns {boolean} Whether PKCE is required for this client
     */
    required: (ctx: KoaContextWithOIDC, client: Client) => {
      if (configManager.getConfig().features.oidc.pkce.enabled) {
        // If required is set to true in config, immediately return true
        if (configManager.getConfig().features.oidc.pkce.required) return true;

        // All public clients MUST use PKCE as per
        // https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1-2.1
        if (client.clientAuthMethod === 'none') {
          return true;
        }
        const fapiProfile = client.fapiProfile || ctx.oidc.params?.fapi_profile;
        // FAPI 2.0 as per
        // https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.2.2-2.5
        if (fapiProfile === '2.0') {
          return true;
        }
        // FAPI 1.0 Advanced as per
        // https://openid.net/specs/openid-financial-api-part-2-1_0-final.html#authorization-server
        if (
          fapiProfile === '1.0 Final' &&
          ctx.oidc.route === 'pushed_authorization_request'
        ) {
          return true;
        }
        // In all other cases use of PKCE is RECOMMENDED as per
        // https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1-2.2
        // but the server doesn't force them to.
        return false;
      } else {
        return false;
      }
    },
  };
}
