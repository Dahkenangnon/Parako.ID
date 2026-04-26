---
title: 'OIDC Endpoints'
subtitle: 'OpenID Connect endpoint reference, scopes, claims, and token TTLs'
category: 'Authentication & Authorization'
order: 5
---

## Discovery

Parako.ID publishes its OpenID Connect configuration at the standard discovery endpoint:

```
GET https://your-parako.example.com/oidc/v1/.well-known/openid-configuration
```

This returns a JSON document with all supported endpoints, scopes, claims, grant types, and signing algorithms. OIDC client libraries use this endpoint for automatic configuration.

## OIDC Base Path

All OIDC endpoints are mounted under a configurable base path. The default is `/oidc/v1`.

Change it in the `oidc.path` configuration:

```jsonc
{
  "oidc": {
    "path": "/oidc/v1",
  },
}
```

All endpoint paths below are relative to this base path.

## Endpoint Reference

### Authorization

```
GET /authorize
POST /authorize
```

Initiates the authentication flow. The client redirects the user here with the required parameters (`client_id`, `redirect_uri`, `response_type`, `scope`). Parako.ID presents the login UI, then redirects back to the client with an authorization code.

Supports response modes: `query`, `fragment`, `form_post`.

### Token

```
POST /token
```

Exchanges an authorization code, refresh token, client credentials, or device code for tokens. Confidential clients must authenticate using their configured `token_endpoint_auth_method` (default: `client_secret_basic`).

### UserInfo

```
GET /userinfo
POST /userinfo
```

Returns claims about the authenticated user. Requires a valid access token in the `Authorization: Bearer` header. CORS-enabled for browser-based clients.

### JWKS

```
GET /jwks
```

Returns the JSON Web Key Set containing the public keys used to sign tokens. Clients use these keys to verify token signatures. Keys are rotated according to the `security.key_store.rotation_interval_days` setting.

### Introspection

```
POST /token/introspection
```

Allows resource servers to validate access tokens and retrieve their metadata. Requires client authentication. Returns `active: true/false` and token metadata (scope, client_id, exp, etc.).

Enabled by default. Disable with `features.oidc.token_introspection.enabled: false`.

### Revocation

```
POST /token/revocation
```

Revokes an access token or refresh token. Requires client authentication. Returns `200 OK` regardless of whether the token was valid (per RFC 7009).

Enabled by default. Disable with `features.oidc.token_revocation.enabled: false`.

### End Session (Logout)

```
GET /session/end
POST /session/end
```

RP-Initiated Logout (OpenID Connect RP-Initiated Logout 1.0). Ends the user's session and optionally redirects to a `post_logout_redirect_uri` registered with the client.

Backchannel logout is also supported -- Parako.ID sends logout tokens to registered `backchannel_logout_uri` endpoints.

### Device Authorization

```
POST /device/auth
```

Initiates the device flow (RFC 8628). Returns a `device_code`, `user_code`, and `verification_uri`. The user visits the verification URI on a separate device and enters the user code.

```
GET /device
POST /device
```

Device flow verification page where users enter their user code.

Enabled by default. Disable with `features.oidc.device_flow.enabled: false`.

### Backchannel Authentication (CIBA)

```
POST /backchannel
```

Client-Initiated Backchannel Authentication (CIBA). Allows clients to initiate authentication of a user without direct browser interaction — the authentication request is sent server-to-server, and the user is authenticated out-of-band (e.g., via push notification).

The token endpoint is then polled with the `urn:openid:params:grant-type:ciba` grant type to retrieve the resulting tokens.

### Dynamic Client Registration

```
POST /register-rp
```

RFC 7591 Dynamic Client Registration. Allows clients to register programmatically. Requires an initial access token when `require_initial_access_token` is true (default).

Disabled by default. Enable with:

```jsonc
{
  "features": {
    "oidc": {
      "dynamic_client_registration": {
        "enabled": true,
      },
    },
  },
}
```

### Pushed Authorization Request (PAR)

```
POST /request
```

Allows clients to push authorization request parameters to the server before redirecting the user. Returns a `request_uri` that the client includes in the authorization request. Improves security by keeping sensitive parameters server-side.

## Additional OIDC Features

### Encryption

JWT encryption for ID tokens, UserInfo, and introspection responses. When enabled, the server supports accepting and issuing encrypted tokens.

Enable with `features.oidc.encryption.enabled: true`.

### JWT Response Modes (JARM)

Authorization responses can be returned as signed (and optionally encrypted) JWTs instead of plain query/fragment parameters.

Enable with `features.oidc.jwt_response_modes.enabled: true`.

### JWT UserInfo

The UserInfo endpoint can return a signed JWT instead of a plain JSON object.

Enable with `features.oidc.jwt_userinfo.enabled: true`.

### Request Objects

Clients can pass authorization request parameters as signed JWTs (`request` parameter) or by reference (`request_uri` parameter).

Enable with `features.oidc.request_objects.enabled: true`.

### Backchannel Logout

Server-to-server logout notifications. When a user logs out, Parako.ID sends a `logout_token` JWT to each registered client's `backchannel_logout_uri`.

Enable with `features.oidc.backchannel_logout.enabled: true`.

### JWT Introspection

The introspection endpoint returns a signed JWT instead of a plain JSON object, per the JWT Response for OAuth 2.0 Token Introspection draft specification.

Enable with `features.oidc.jwt_introspection.enabled: true`.

### Registration Management (RFC 7592)

Allows dynamically registered clients to update or delete their registration using the registration access token. Supports automatic rotation of registration access tokens.

Enable with:

```jsonc
{
  "features": {
    "oidc": {
      "client_registration_management": {
        "enabled": true,
        "rotate_registration_access_token": true,
      },
    },
  },
}
```

## Resource Indicators (RFC 8707)

Resource indicators let clients scope access tokens to specific APIs or resource servers.

Enable with `features.oidc.resource_indicators.enabled: true`.

### Built-in Management API Resource

Parako.ID registers a built-in resource server for its Management API:

- **URI:** `urn:parako:api:v1`
- **Scopes:** All `parako:*` management scopes
- **Token format:** JWT

M2M clients request Management API tokens by passing `resource=urn:parako:api:v1` in the token request.

### Client Configuration

Clients must declare which resource servers they can access:

| Field              | Type     | Description                                                       |
| ------------------ | -------- | ----------------------------------------------------------------- |
| `allowedResources` | string[] | Resource server URIs this client can request tokens for           |
| `resourcesScopes`  | string   | Space-separated scopes the client can request for resource access |

Example client configuration:

```jsonc
{
  "client_id": "my-api-consumer",
  "allowedResources": ["urn:parako:api:v1"],
  "resourcesScopes": "parako:users:read parako:clients:read",
  "grant_types": ["client_credentials"],
}
```

### Auto-Discovery of Resource Servers

Clients registered with `client_credentials` grant type (and without `authorization_code`) are automatically discovered as resource servers. Their `audience` or `urn:resource:{client_id}` becomes the resource identifier, and their `scope` defines available scopes.

## Supported Scopes

| Scope            | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `openid`         | Required for OIDC flows. Returns the `sub` claim         |
| `profile`        | Name, family name, given name, picture, locale, username |
| `email`          | Email address and verification status                    |
| `phone`          | Phone number and verification status                     |
| `address`        | Postal address                                           |
| `offline_access` | Request a refresh token                                  |

## Claims

Claims returned per scope:

| Scope     | Claims                                                               |
| --------- | -------------------------------------------------------------------- |
| `openid`  | `sub`                                                                |
| `profile` | `name`, `family_name`, `given_name`, `picture`, `locale`, `username` |
| `email`   | `email`, `email_verified`                                            |
| `phone`   | `phone_number`, `phone_number_verified`                              |
| `address` | `address`                                                            |

Claims are returned in the ID token and/or the UserInfo endpoint response, depending on the `response_type` and client configuration.

## Subject Types

Parako.ID supports two subject identifier types:

| Type       | Description                                                             |
| ---------- | ----------------------------------------------------------------------- |
| `public`   | Same `sub` value for all clients (default)                              |
| `pairwise` | Different `sub` value per client, preventing cross-client user tracking |

Configure per client or globally:

```jsonc
{
  "features": {
    "oidc": {
      "subject_types": ["public", "pairwise"],
    },
  },
}
```

Pairwise subjects require a salt configured in `oidc.secrets.pairwise_salt` (default: `parako-id-salt`). In production, set the `PAIRWISE_SALT` environment variable to override the default with a strong random value.

## Token TTL Defaults

| Token              | Default       | Description                            |
| ------------------ | ------------- | -------------------------------------- |
| Access token       | 3,600s (1h)   | Bearer token for API access            |
| ID token           | 3,600s (1h)   | Identity assertion                     |
| Refresh token      | 86,400s (24h) | Used to obtain new access tokens       |
| Authorization code | 600s (10m)    | One-time use, exchanged for tokens     |
| Device code        | 600s (10m)    | Device flow user code lifetime         |
| Client credentials | 3,600s (1h)   | Machine-to-machine token               |
| Grant              | 3,600s (1h)   | User authorization grant               |
| Session            | 86,400s (24h) | Browser session lifetime               |
| Interaction        | 600s (10m)    | Multi-step authentication flow timeout |
| Backchannel auth   | 600s (10m)    | CIBA flow request timeout              |

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

Refresh tokens are rotated on each use by default (`features.oidc.rotate_refresh_token: true`). A clock tolerance of 15 seconds is applied for token validation (`features.oidc.clock_tolerance: 15`).
