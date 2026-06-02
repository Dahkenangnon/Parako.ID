---
title: 'OIDC Endpoints'
subtitle: 'OpenID Connect endpoint reference, scopes, claims, and token TTLs'
category: 'Authentication & Authorization'
order: 5
---

All OIDC endpoints are mounted under a configurable base path (`oidc.path`, default `/oidc/v1`). Discovery is published at `<base>/.well-known/openid-configuration` and returns the full machine-readable configuration: endpoints, scopes, claims, grants, signing algorithms.

```bash
curl https://your-host/oidc/v1/.well-known/openid-configuration
```

OIDC client libraries use the discovery endpoint for automatic configuration.

## Endpoint reference

All paths are relative to the OIDC base path.

| Method     | Path                   | Auth                             | Use case                                                                               |
| ---------- | ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| GET / POST | `/authorize`           | session (interactive)            | Initiate authentication. Response modes: `query`, `fragment`, `form_post`.             |
| POST       | `/token`               | per `token_endpoint_auth_method` | Exchange code / refresh token / client credentials / device code for tokens.           |
| GET / POST | `/userinfo`            | `Bearer` access token            | Returns claims about the authenticated user (CORS-enabled).                            |
| GET        | `/jwks`                | public                           | JSON Web Key Set used to verify token signatures.                                      |
| POST       | `/token/introspection` | client auth                      | RFC 7662 — validate access / refresh tokens.                                           |
| POST       | `/token/revocation`    | client auth                      | RFC 7009 — revoke access / refresh tokens.                                             |
| GET / POST | `/session/end`         | session                          | RP-Initiated Logout. Supports `post_logout_redirect_uri`.                              |
| POST       | `/device/auth`         | client auth                      | RFC 8628 device authorization. Returns `device_code`, `user_code`, `verification_uri`. |
| GET / POST | `/device`              | session                          | Device-flow verification UI.                                                           |
| POST       | `/backchannel`         | client auth                      | CIBA — server-to-server-initiated authentication.                                      |
| POST       | `/register-rp`         | initial access token             | RFC 7591 Dynamic Client Registration.                                                  |
| POST       | `/request`             | client auth                      | RFC 9126 Pushed Authorization Request.                                                 |

Backchannel logout sends a `logout_token` JWT to each registered client's `backchannel_logout_uri`. Enable per feature toggle below.

## Optional features

Each feature is off-by-default unless noted. Toggle in `features.oidc.<feature>.enabled`.

| Feature                            | Default  | Config key                               | Spec / notes                                           |
| ---------------------------------- | -------- | ---------------------------------------- | ------------------------------------------------------ |
| Token introspection                | enabled  | `token_introspection.enabled`            | RFC 7662                                               |
| Token revocation                   | enabled  | `token_revocation.enabled`               | RFC 7009                                               |
| Device flow                        | enabled  | `device_flow.enabled`                    | RFC 8628                                               |
| Dynamic Client Registration (DCR)  | disabled | `dynamic_client_registration.enabled`    | RFC 7591; initial-access-token always required         |
| DCR Management                     | disabled | `client_registration_management.enabled` | RFC 7592; supports `rotate_registration_access_token`  |
| Pushed Authorization Request (PAR) | disabled | (always available at `/request`)         | RFC 9126                                               |
| JWT encryption                     | disabled | `encryption.enabled`                     | JWE for ID tokens / UserInfo / introspection           |
| JWT response modes (JARM)          | disabled | `jwt_response_modes.enabled`             | Signed (optionally encrypted) authorization responses  |
| JWT UserInfo                       | disabled | `jwt_userinfo.enabled`                   | Signed JWT instead of plain JSON                       |
| JWT introspection                  | disabled | `jwt_introspection.enabled`              | Per draft "JWT Response for OAuth Token Introspection" |
| Request objects                    | disabled | `request_objects.enabled`                | `request` / `request_uri` parameters                   |
| Backchannel logout                 | disabled | `backchannel_logout.enabled`             | Server-to-server logout via `logout_token`             |
| Resource indicators (RFC 8707)     | disabled | `resource_indicators.enabled`            | Audience-restricted tokens                             |
| Refresh token rotation             | enabled  | `rotate_refresh_token`                   | Rotates on each use                                    |
| Clock tolerance                    | 15s      | `clock_tolerance`                        | Validation skew tolerance                              |

## Resource indicators (RFC 8707)

Enable with `features.oidc.resource_indicators.enabled: true`. Clients then declare `allowedResources` (the URIs they can request) and `resourcesScopes` (the scopes for resource-server access).

```jsonc
{
  "client_id": "my-api-consumer",
  "allowedResources": ["urn:parako:api:v1"],
  "resourcesScopes": "parako:users:read parako:clients:read",
  "grant_types": ["client_credentials"],
}
```

### Built-in Management API resource

Parako.ID registers `urn:parako:api:v1` as a built-in resource. M2M clients request Management API tokens by passing `resource=urn:parako:api:v1`. Tokens are JWTs with that audience. Full scope list: [Management API → Authorization Scopes](api/overview.md#authorization-scopes).

### Auto-discovery of resource servers

Clients with the `client_credentials` grant (and not `authorization_code`) are automatically discovered as resource servers. Their `audience` (or `urn:resource:{client_id}`) becomes the resource identifier; their `scope` defines available scopes.

## Scopes

| Scope            | Returned claims                                                      |
| ---------------- | -------------------------------------------------------------------- |
| `openid`         | `sub`                                                                |
| `profile`        | `name`, `family_name`, `given_name`, `picture`, `locale`, `username` |
| `email`          | `email`, `email_verified`                                            |
| `phone`          | `phone_number`, `phone_number_verified`                              |
| `address`        | `address`                                                            |
| `offline_access` | (Issues a refresh token)                                             |

Claims appear in the ID token, the UserInfo response, or both, depending on `response_type` and client configuration.

## Subject types

| Type       | Effect                                                      |
| ---------- | ----------------------------------------------------------- |
| `public`   | Same `sub` value across all clients (default).              |
| `pairwise` | Different `sub` per client; prevents cross-client tracking. |

Configure with `features.oidc.subject_types`. Pairwise subjects use `oidc.secrets.pairwise_salt`; in production, set `PAIRWISE_SALT` to a strong random value.

## Token TTLs

This is the canonical Token-TTL table. Other docs link here.

| Token              | Default         | Description                                           |
| ------------------ | --------------- | ----------------------------------------------------- |
| Access token       | 3,600 s (1 h)   | Bearer token for API access                           |
| ID token           | 3,600 s (1 h)   | Identity assertion                                    |
| Refresh token      | 86,400 s (24 h) | Used to obtain new access tokens; rotated on each use |
| Authorization code | 600 s (10 m)    | One-time use; exchanged for tokens                    |
| Device code        | 600 s (10 m)    | User-code lifetime                                    |
| Client credentials | 3,600 s (1 h)   | M2M token                                             |
| Grant              | 3,600 s (1 h)   | User authorization grant                              |
| Session            | 86,400 s (24 h) | Browser session                                       |
| Interaction        | 600 s (10 m)    | Multi-step authentication flow timeout                |
| Backchannel auth   | 600 s (10 m)    | CIBA flow request timeout                             |

Configure in `oidc.token_ttl`:

```jsonc
{
  "oidc": {
    "token_ttl": {
      "access_token": 3600,
      "refresh_token": 86400,
      "id_token": 3600,
      "authorization_code": 600,
      "device_code": 600,
      "client_credentials": 3600,
      "grant": 3600,
      "session": 86400,
      "interaction": 600,
      "backchannel_auth": 600,
    },
  },
}
```

Refresh tokens rotate on each use by default (`features.oidc.rotate_refresh_token: true`). The clock tolerance for token validation is **15 seconds** (`features.oidc.clock_tolerance: 15`).

## See also

- [Configuration](configuration.md)
- [OIDC Clients](oidc-clients.md)
- [Management API](api/overview.md)
- [Integrating Your App](integrating-your-app.md)
