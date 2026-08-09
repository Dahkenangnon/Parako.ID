---
title: 'OIDC Clients'
subtitle: 'Register and configure OAuth2 / OIDC client applications'
category: 'Authentication & Authorization'
order: 1
---

An OIDC client represents an application that authenticates users through Parako.ID. Each client has a unique `client_id` and, for confidential clients, a `client_secret`. Six presets cover the standard application shapes; you can fine-tune any field after creation.

## Presets

| Preset                      | Auth method           | Secret | PKCE     | Use case                                     |
| --------------------------- | --------------------- | ------ | -------- | -------------------------------------------- |
| Regular Web Application     | `client_secret_basic` | Yes    | Optional | Server-rendered apps (Node.js, PHP, Ruby)    |
| Single Page Application     | `none`                | No     | Required | Client-side JavaScript (React, Vue, Angular) |
| Native / Mobile Application | `none`                | No     | Required | iOS, Android, desktop                        |
| Machine-to-Machine (M2M)    | `client_secret_basic` | Yes    | No       | Backend services, daemons                    |
| Device Flow                 | `client_secret_post`  | Yes    | No       | Smart TVs, CLIs, IoT (RFC 8628)              |
| Management API              | `client_secret_basic` | Yes    | No       | Programmatic access to the Management API    |

Each preset sets `application_type`, `grant_types`, `response_types`, `token_endpoint_auth_method`, and `scope` to safe defaults. The preset is immutable after creation.

## Registering a client

### Via the CLI (file-based, single-tenant)

```bash
pnpm client list   # list registered clients
pnpm client add    # interactive wizard
```

The wizard prompts for client type, name, redirect URIs, and allowed scopes, then prints the `client_id` and `client_secret`. Copy the secret immediately — it is encrypted at rest and cannot be retrieved afterward.

For inspecting, updating, removing, importing, or exporting clients, use the admin panel or the [Management API](api/overview.md). The shape of `runtime/parako-rp.jsonc` is documented in [`parako-rp.example.json`](https://github.com/Dahkenangnon/Parako.ID/blob/main/parako-rp.example.json).

### Via the admin panel

Sign in at `/admin` with an admin account. Under **OIDC Clients**, choose a preset, fill in the quick-start fields (name, description, redirect URIs, post-logout redirect URIs), and optionally expand OIDC Configuration / Advanced Settings / Resource Indicators / Management API Scope pickers. The secret is displayed once on save.

Edit, activate / deactivate, and delete are available from the same panel.
Secret regeneration is available for clients that use a `client_secret_*`
authentication method. See [Admin Panel](admin-panel.md).

### Static clients

Clients defined in `runtime/parako-rp.jsonc` are loaded at startup. They are not shown in the admin panel; edit the file to modify them.

## Client configuration fields

### Core OIDC

| Field                             | Type     | Description                                                                               |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `client_id`                       | string   | Unique identifier (auto-generated or custom)                                              |
| `client_secret`                   | string   | Encrypted at rest                                                                         |
| `client_name`                     | string   | Display name                                                                              |
| `application_type`                | string   | OIDC value `web` or `native`; the SPA preset uses `web`                                   |
| `redirect_uris`                   | string[] | Allowed redirect URIs                                                                     |
| `post_logout_redirect_uris`       | string[] | Allowed post-logout redirect URIs                                                         |
| `grant_types`                     | string[] | Allowed grant types                                                                       |
| `response_types`                  | string[] | Allowed response types                                                                    |
| `scope`                           | string   | Space-separated allowed scopes                                                            |
| `token_endpoint_auth_method`      | string   | How the client authenticates at the token endpoint                                        |
| `token_endpoint_auth_signing_alg` | string   | Optional assertion signing algorithm for JWT client authentication                        |
| `jwks_uri`                        | string   | URL of the client's public JWKS; required for `private_key_jwt` unless `jwks` is supplied |
| `jwks`                            | object   | Inline public JWKS; API-only and mutually exclusive with `jwks_uri`                       |
| `require_pkce`                    | boolean  | Whether PKCE is required                                                                  |
| `id_token_signed_response_alg`    | string   | ID-token signing algorithm (default: `RS256`)                                             |
| `subject_type`                    | string   | `public` or `pairwise`                                                                    |
| `allowedResources`                | string[] | Resource-server URIs this client can request tokens for (RFC 8707)                        |
| `resourcesScopes`                 | string   | Space-separated scopes for resource-server access                                         |
| `isInternalClient`                | boolean  | First-party flag — bypasses consent, blocked from DCR (admin-only)                        |

### Additional metadata

| Field             | Type     | Description                                                           |
| ----------------- | -------- | --------------------------------------------------------------------- |
| `description`     | string   | Free-text                                                             |
| `active`          | boolean  | `false` rejects the client at the token endpoint                      |
| `preset`          | string   | `web`, `spa`, `native`, `m2m`, `device`, `api_management` — immutable |
| `client_uri`      | string   | Home page URL                                                         |
| `logo_uri`        | string   | Logo URL                                                              |
| `policy_uri`      | string   | Privacy policy URL                                                    |
| `tos_uri`         | string   | Terms-of-service URL                                                  |
| `tags`            | string[] | Filtering and grouping                                                |
| `contacts`        | string[] | Owner emails                                                          |
| `default_max_age` | number   | Default max auth age (seconds)                                        |

## Grant types

| Grant                     | Use case                          | Auth method                    | Secret required           | PKCE                                    | Notes                                          |
| ------------------------- | --------------------------------- | ------------------------------ | ------------------------- | --------------------------------------- | ---------------------------------------------- |
| Authorization Code + PKCE | Web, SPA, native, mobile          | `client_secret_basic` / `none` | Confidential clients only | Required for public clients (OAuth 2.1) | Standard interactive flow                      |
| Client Credentials        | M2M, backend services             | `client_secret_basic`          | Yes                       | No                                      | No user context; `aud` from `resource`         |
| Device Flow (RFC 8628)    | Smart TVs, CLIs, IoT              | `client_secret_post`           | Yes                       | No                                      | `/oidc/v1/device/auth`; user-code TTL 600s     |
| Refresh Token             | Confidential clients, native apps | varies                         | varies                    | n/a                                     | Include `offline_access`; tokens rotate on use |

Token TTLs for each grant are listed in [OIDC Endpoints → Token TTLs](oidc-endpoints.md#token-ttls).

## Resource indicators (RFC 8707)

Resource Indicators let clients request audience-restricted tokens scoped to a specific resource server.

### Built-in Management API

Parako.ID ships a built-in resource server at `urn:parako:api:v1`. Management-API-preset clients have this resource pre-configured; tokens issued for it are JWTs with `aud: "urn:parako:api:v1"`. The full scope list and risk-tier taxonomy live in [Management API → Authorization Scopes](api/overview.md#authorization-scopes).

### Custom resource servers

M2M clients can target your own resource servers. Set `allowedResources` to your URIs and `resourcesScopes` to the space-separated scopes your resource server accepts. Tokens can be `jwt` (`aud = resource URI`) or `opaque` depending on your resource server.

## Dynamic Client Registration

RFC 7591 DCR can be enabled in configuration:

```jsonc
{
  "features": {
    "oidc": {
      "dynamic_client_registration": { "enabled": true },
    },
  },
}
```

> **Important:** When DCR is enabled, `require_initial_access_token` is always enforced regardless of configuration. Open registration without an initial access token is never permitted.

Generate an initial access token via the Management API with the `parako:registration-tokens:write` scope, then:

```bash
curl -X POST https://your-host/oidc/v1/register-rp \
  -H "Authorization: Bearer INITIAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Dynamic App",
    "redirect_uris": ["https://app.example.com/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'
```

## Management API

Programmatic management via REST. All endpoints require a valid token with the appropriate scope, issued for `urn:parako:api:v1`. See [Management API](api/overview.md) for authentication and the full scope list.

### Client endpoints

| Method | Path                                    | Scope                   | Description       |
| ------ | --------------------------------------- | ----------------------- | ----------------- |
| GET    | `/api/v1/clients`                       | `parako:clients:read`   | List              |
| POST   | `/api/v1/clients`                       | `parako:clients:write`  | Create            |
| GET    | `/api/v1/clients/:client_id`            | `parako:clients:read`   | Read              |
| PUT    | `/api/v1/clients/:client_id`            | `parako:clients:write`  | Full update       |
| PATCH  | `/api/v1/clients/:client_id`            | `parako:clients:write`  | Partial update    |
| DELETE | `/api/v1/clients/:client_id`            | `parako:clients:delete` | Delete            |
| POST   | `/api/v1/clients/:client_id/activate`   | `parako:clients:write`  | Activate          |
| POST   | `/api/v1/clients/:client_id/deactivate` | `parako:clients:write`  | Deactivate        |
| POST   | `/api/v1/clients/:client_id/secret`     | `parako:clients:write`  | Regenerate secret |
| GET    | `/api/v1/clients/:client_id/stats`      | `parako:clients:read`   | Usage stats       |

### Registration token endpoints

| Method | Path                               | Scope                               | Description |
| ------ | ---------------------------------- | ----------------------------------- | ----------- |
| GET    | `/api/v1/registration-tokens`      | `parako:registration-tokens:read`   | List        |
| POST   | `/api/v1/registration-tokens`      | `parako:registration-tokens:write`  | Create      |
| GET    | `/api/v1/registration-tokens/:jti` | `parako:registration-tokens:read`   | Read        |
| DELETE | `/api/v1/registration-tokens/:jti` | `parako:registration-tokens:delete` | Revoke      |

## Client secret management

Secrets are encrypted at rest using `ENCRYPTION_KEY`. For clients using
`client_secret_basic`, `client_secret_post`, or `client_secret_jwt`, rotate via
the Management API or the admin panel; the old secret is immediately
invalidated. Public (`none`) and key-authenticated (`private_key_jwt`) clients
do not have a rotatable shared secret.

```bash
curl -X POST https://your-host/api/v1/clients/CLIENT_ID/secret \
  -H "Authorization: Bearer API_TOKEN"
```

## See also

- [OIDC Endpoints](oidc-endpoints.md)
- [Management API](api/overview.md)
- [Admin Panel](admin-panel.md)
- [CLI Tools](cli-tools.md)
- [Integrating Your App](integrating-your-app.md)
