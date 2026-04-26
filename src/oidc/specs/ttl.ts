/* eslint-disable @typescript-eslint/ban-ts-comment */
import type {
  AccessToken,
  BackchannelAuthenticationRequest,
  Client,
  ClientCredentials,
  KoaContextWithOIDC,
  RefreshToken,
  TTLFunction,
} from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

/**
 * Factory function to create TTL configuration
 * @param configManager - Configuration manager instance
 * @param logger - Logger instance
 * @returns TTL configuration object
 */
export default function TTL(configManager: IConfigManager, logger: ILogger) {
  const config = configManager.getConfig();

  /**
   * Token and Session Time-to-Live (TTL) Configuration
   *
   * This configuration defines the expiration times for various tokens and sessions
   * used by the OpenID Provider. Each value can be either:
   * - A number (in seconds)
   * - A synchronous function that dynamically returns a value based on the context
   *
   * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#ttl}
   *
   * @type {Object}
   */
  return {
    /**
     * Access Token TTL configuration
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {Object} token - The token object
     * @param {Client} client - The client requesting the token
     * @returns {number} TTL in seconds
     */
    AccessToken: function AccessTokenTTL(
      _ctx: KoaContextWithOIDC,
      token: AccessToken,
      client: Client
    ): number {
      try {
        if (token?.resourceServer?.accessTokenTTL) {
          return token.resourceServer.accessTokenTTL;
        }

        // @ts-ignore
        if (client?.ttl?.AccessToken) {
          //@ts-ignore
          return client.ttl.AccessToken;
        }

        return config.oidc.token_ttl.access_token;
      } catch (error: unknown) {
        const err = error as Error;
        logger.error(err, {
          context: `Error in AccessTokenTTL: ${err.message}`,
        });
        return config.oidc.token_ttl.access_token; // Fallback to default in case of error
      }
    } as TTLFunction<AccessToken>,

    /** Authorization Code TTL: 10 minutes in seconds */
    AuthorizationCode: config.oidc.token_ttl.authorization_code,

    /**
     * Backchannel Authentication Request TTL configuration
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {object} request - The authentication request
     * @param {object} client - The client making the request
     * @returns {number} TTL in seconds
     */
    BackchannelAuthenticationRequest:
      function BackchannelAuthenticationRequestTTL(
        ctx: KoaContextWithOIDC,
        _request: unknown,
        client: Client
      ): number {
        try {
          // If client requested a specific expiry, honor it but cap it at the maximum allowed
          if (ctx?.oidc?.params?.requested_expiry) {
            const requestedExpiry = parseInt(
              ctx.oidc.params.requested_expiry as string,
              10
            );
            if (!isNaN(requestedExpiry) && requestedExpiry > 0) {
              return Math.min(
                config.oidc.token_ttl.backchannel_auth,
                requestedExpiry
              );
            }
          }

          // @ts-ignore
          if (client?.ttl?.BackchannelAuthenticationRequest) {
            // @ts-ignore
            return client.ttl.BackchannelAuthenticationRequest;
          }

          return config.oidc.token_ttl.backchannel_auth;
        } catch (error: unknown) {
          const err = error as Error;
          logger.error(err, {
            context: `Error in BackchannelAuthenticationRequestTTL: ${err.message}`,
          });
          return config.oidc.token_ttl.backchannel_auth; // Fallback to default in case of error
        }
      } as TTLFunction<BackchannelAuthenticationRequest>,

    /**
     * Client Credentials TTL configuration
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {object} token - The token object
     * @param {object} client - The client requesting the token
     * @returns {number} TTL in seconds
     */
    ClientCredentials: function ClientCredentialsTTL(
      _ctx: KoaContextWithOIDC,
      token: ClientCredentials,
      client: Client
    ): number {
      try {
        if (token?.resourceServer?.accessTokenTTL) {
          return token.resourceServer.accessTokenTTL;
        }

        // @ts-ignore
        if (client?.ttl?.ClientCredentials) {
          // @ts-ignore
          return client.ttl.ClientCredentials;
        }

        return config.oidc.token_ttl.client_credentials;
      } catch (error: unknown) {
        const err = error as Error;
        logger.error(err, {
          context: `Error in ClientCredentialsTTL: ${err.message}`,
        });
        return config.oidc.token_ttl.client_credentials; // Fallback to default in case of error
      }
    } as TTLFunction<ClientCredentials>,

    /** Device Code TTL: 10 minutes in seconds */
    DeviceCode: config.oidc.token_ttl.device_code,

    /** Grant TTL: 1 hour in seconds */
    Grant: config.oidc.token_ttl.grant,

    /** ID Token TTL: 1 hour in seconds */
    IdToken: config.oidc.token_ttl.id_token,

    /** Interaction TTL: 1 hour in seconds */
    Interaction: config.oidc.token_ttl.interaction,

    /**
     * Refresh Token TTL configuration
     *
     * @param {KoaContextWithOIDC} ctx - The Koa request context
     * @param {object} token - The token object
     * @param {object} client - The client requesting the token
     * @returns {number} TTL in seconds
     */
    RefreshToken: function RefreshTokenTTL(
      ctx: KoaContextWithOIDC,
      token: RefreshToken,
      client: Client
    ): number {
      try {
        if (
          ctx?.oidc?.entities?.RotatedRefreshToken &&
          client?.applicationType === 'web' &&
          client?.clientAuthMethod === 'none' &&
          token &&
          typeof token.isSenderConstrained === 'function' &&
          !token.isSenderConstrained()
        ) {
          // Non-Sender Constrained SPA RefreshTokens do not have infinite expiration through rotation
          const rotatedToken = ctx.oidc.entities
            .RotatedRefreshToken as unknown as { remainingTTL?: number };
          return (
            rotatedToken.remainingTTL || config.oidc.token_ttl.refresh_token
          );
        }

        // @ts-ignore
        if (client?.ttl?.RefreshToken) {
          // @ts-ignore
          return client.ttl.RefreshToken;
        }

        return config.oidc.token_ttl.refresh_token;
      } catch (error: unknown) {
        const err = error as Error;
        logger.error(err, {
          context: `Error in RefreshTokenTTL: ${err.message}`,
        });
        return config.oidc.token_ttl.refresh_token; // Fallback to default in case of error
      }
    } as TTLFunction<RefreshToken>,

    /** Session TTL: 24 hours in seconds */
    Session: config.oidc.token_ttl.session,
  };
}
