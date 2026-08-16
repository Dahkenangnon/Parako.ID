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
 * Per-client TTL overrides honored when present on the Client metadata.
 *
 * `oidc-provider`'s Client type does not declare a `ttl` property — the
 * library accepts arbitrary metadata extensions and exposes them
 * untyped. This helper bridges the typed config with that opaque shape
 * so the rest of the module never needs to reach for `as any` or
 * `// @ts-ignore`.
 */
type TtlOverrideKey =
  | 'AccessToken'
  | 'BackchannelAuthenticationRequest'
  | 'ClientCredentials'
  | 'RefreshToken';

function getPositiveFiniteTtl(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getClientTtlOverride(
  client: Client | undefined,
  key: TtlOverrideKey
): number | undefined {
  if (!client) return undefined;
  const ttl = (client as { ttl?: Partial<Record<TtlOverrideKey, unknown>> })
    .ttl;
  return getPositiveFiniteTtl(ttl?.[key]);
}

export default function TTL(configManager: IConfigManager, logger: ILogger) {
  const config = configManager.getConfig();

  return {
    AccessToken: function AccessTokenTTL(
      _ctx: KoaContextWithOIDC,
      token: AccessToken,
      client: Client
    ): number {
      try {
        const resourceServerTtl = getPositiveFiniteTtl(
          token?.resourceServer?.accessTokenTTL
        );
        if (resourceServerTtl !== undefined) return resourceServerTtl;

        const override = getClientTtlOverride(client, 'AccessToken');
        if (override !== undefined) return override;

        return config.oidc.token_ttl.access_token;
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(err, {
          context: `Error in AccessTokenTTL: ${err.message}`,
        });
        return config.oidc.token_ttl.access_token; // Fallback to default in case of error
      }
    } as TTLFunction<AccessToken>,

    AuthorizationCode: config.oidc.token_ttl.authorization_code,

    BackchannelAuthenticationRequest:
      function BackchannelAuthenticationRequestTTL(
        ctx: KoaContextWithOIDC,
        _request: unknown,
        client: Client
      ): number {
        try {
          // If client requested a specific expiry, honor it but cap it at the maximum allowed
          if (ctx?.oidc?.params?.requested_expiry) {
            const requestedExpiry = Number(ctx.oidc.params.requested_expiry);
            if (Number.isSafeInteger(requestedExpiry) && requestedExpiry > 0) {
              return Math.min(
                config.oidc.token_ttl.backchannel_auth,
                requestedExpiry
              );
            }
          }

          const override = getClientTtlOverride(
            client,
            'BackchannelAuthenticationRequest'
          );
          if (override !== undefined) return override;

          return config.oidc.token_ttl.backchannel_auth;
        } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error(err, {
            context: `Error in BackchannelAuthenticationRequestTTL: ${err.message}`,
          });
          return config.oidc.token_ttl.backchannel_auth; // Fallback to default in case of error
        }
      } as TTLFunction<BackchannelAuthenticationRequest>,

    ClientCredentials: function ClientCredentialsTTL(
      _ctx: KoaContextWithOIDC,
      token: ClientCredentials,
      client: Client
    ): number {
      try {
        const resourceServerTtl = getPositiveFiniteTtl(
          token?.resourceServer?.accessTokenTTL
        );
        if (resourceServerTtl !== undefined) return resourceServerTtl;

        const override = getClientTtlOverride(client, 'ClientCredentials');
        if (override !== undefined) return override;

        return config.oidc.token_ttl.client_credentials;
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(err, {
          context: `Error in ClientCredentialsTTL: ${err.message}`,
        });
        return config.oidc.token_ttl.client_credentials; // Fallback to default in case of error
      }
    } as TTLFunction<ClientCredentials>,

    DeviceCode: config.oidc.token_ttl.device_code,
    Grant: config.oidc.token_ttl.grant,
    IdToken: config.oidc.token_ttl.id_token,
    Interaction: config.oidc.token_ttl.interaction,

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
          const remainingTtl = getPositiveFiniteTtl(rotatedToken.remainingTTL);
          if (remainingTtl !== undefined) return remainingTtl;
        }

        const override = getClientTtlOverride(client, 'RefreshToken');
        if (override !== undefined) return override;

        return config.oidc.token_ttl.refresh_token;
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(err, {
          context: `Error in RefreshTokenTTL: ${err.message}`,
        });
        return config.oidc.token_ttl.refresh_token; // Fallback to default in case of error
      }
    } as TTLFunction<RefreshToken>,

    Session: config.oidc.token_ttl.session,
  };
}
