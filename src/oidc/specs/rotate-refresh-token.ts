import type { KoaContextWithOIDC } from 'oidc-provider';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

/**
 * Factory function to create refresh token rotation configuration
 * @param logger - Logger instance
 * @returns Refresh token rotation function
 */
export default function RotateRefreshToken(logger: ILogger) {
  /**
   * Refresh Token Rotation Configuration
   *
   * This function determines if and how the OpenID Provider should rotate refresh tokens
   * after they are used. Token rotation is a security measure that helps prevent token
   * theft and replay attacks.
   *
   * The function implements a policy that rotates refresh tokens based on:
   * 1. Total lifetime of the token (capped at 1 year)
   * 2. Client authentication method
   * 3. Token expiration proximity
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#rotaterefreshtoken}
   *
   * @param {KoaContextWithOIDC} ctx - The Koa request context containing:
   *   - oidc.entities.RefreshToken - The refresh token being used
   *   - oidc.entities.Client - The client requesting the refresh
   * @returns {boolean} Whether the refresh token should be rotated
   *
   * @example
   * // Example usage in OIDC Provider configuration
   * const provider = new Provider('http://localhost:3000', {
   *   rotateRefreshToken: rotateRefreshToken
   * });
   */
  return function rotateRefreshToken(ctx: KoaContextWithOIDC) {
    try {
      const { RefreshToken: refreshToken, Client: client } = ctx.oidc.entities;

      // Safety check for required entities
      if (!refreshToken || !client) {
        return false;
      }

      // rotated for up to 1 year, afterwards its TTL is final
      if (refreshToken.totalLifetime() >= 365.25 * 24 * 60 * 60) {
        return false;
      }

      // Rotate non sender-constrained public client refresh tokens
      if (
        client.tokenEndpointAuthMethod === 'none' &&
        !refreshToken.isSenderConstrained()
      ) {
        return true;
      }

      // Rotate if the token is nearing expiration (it's beyond 70% of its lifetime)
      return refreshToken.ttlPercentagePassed() >= 70;
    } catch (error) {
      logger.error(error as Error, {
        context: 'Error in refresh token rotation logic',
      });
      return false;
    }
  };
}
