---
title: 'OIDC Clients'
subtitle: 'Register and configure OAuth2/OIDC client applications'
category: 'Authentication & Authorization'
order: 1
---

## Overview

An OIDC client represents an application that authenticates users through Parako.ID. Each client has a unique `client_id` and, for confidential clients, a `client_secret`.

Parako.ID offers six client presets, each pre-configured with sensible OIDC defaults:

| Preset                      | Auth method           | Secret | PKCE     | Use case                                          |
| --------------------------- | --------------------- | ------ | -------- | ------------------------------------------------- |
| Regular Web Application     | `client_secret_basic` | Yes    | Optional | Server-rendered apps (Node.js, PHP, Ruby)         |
| Single Page Application     | `none`                | No     | Required | Client-side JavaScript (React, Vue, Angular)      |
| Native / Mobile Application | `none`                | No     | Required | iOS, Android, desktop apps                        |
| Machine-to-Machine (M2M)    | `client_secret_basic` | Yes    | No       | Backend services, daemon processes                |
| Device Flow                 | `client_secret_post`  | Yes    | No       | Smart TVs, CLIs, IoT (RFC 8628)                   |
| Management API              | `client_secret_basic` | Yes    | No       | Programmatic access to Parako.ID's Management API |

Each preset sets the `application_type`, `grant_types`, `response_types`, `token_endpoint_auth_method`, and `scope` to appropriate defaults. The preset is stored on the client record and is immutable after creation.

## Registering Clients via CLI

The fastest way to register a client is the interactive CLI:

```bash
yarn client add
```

The wizard prompts for:

1. Client type
2. Client name
3. Redirect URIs (comma-separated)
4. Allowed scopes

On success, it outputs the `client_id` and `client_secret`. Store the secret immediately — it is encrypted at rest and cannot be retrieved later.

### CLI Commands

```bash
yarn client list   # List all registered clients
yarn client add    # Add a new client (interactive)
```

The CLI is intentionally minimal. For inspecting, updating, removing, importing, or exporting clients, use the admin panel at `/admin` or the [Management API](api/endpoints.md). For a programmatic starting point, copy [`parako-rp.example.json`](https://github.com/Dahkenangnon/Parako.ID/blob/main/parako-rp.example.json) (at the repo root) to `parako-rp.jsonc` and edit it directly.

## Registering Clients via Admin Panel

Navigate to `/admin` and sign in with an admin or superadmin account. The **OIDC Clients** section provides a full web interface for client management.

### Creating a Client

1. Click **Add Client** to open the creation form.
2. **Choose a preset** — six cards are displayed, each with an icon, label, and short description:
   - **Regular Web Application** — server-side app with secure backend
   - **Single Page Application** — client-side JavaScript, public client with PKCE
   - **Native / Mobile Application** — iOS, Android, or desktop, public client with PKCE
   - **Machine-to-Machine (M2M)** — backend service using client credentials for your own resource servers
   - **Device Flow** — limited-input device, user authorizes on a separate screen (RFC 8628)
   - **Management API** — access the built-in Management API; select scopes after creation
3. Fill in the **quick-start fields**: client name, description, redirect URIs, and post-logout redirect URIs.
4. Optionally expand the **OIDC Configuration** section to customise grant types, response types, scopes, token endpoint auth method, PKCE enforcement, ID token signing algorithm, and subject type.
5. Optionally expand **Advanced Settings** to set `client_uri`, `logo_uri`, `policy_uri`, `tos_uri`, contacts, tags, and `default_max_age`.
6. For **M2M** clients, a resource indicators panel lets you define custom resource server URIs and their scopes.
7. For **Management API** clients, a scope picker lists all `parako:*` Management API scopes grouped by domain (Clients, Users, Sessions, etc.).
8. Click **Create** to save. The client secret is displayed once — copy it immediately.

### Managing Existing Clients

- **Edit** — all fields except `client_id` and `preset` can be modified.
- **Activate / Deactivate** — toggle the `active` flag. Inactive clients are rejected at the token endpoint.
- **Regenerate Secret** — issues a new secret and immediately invalidates the old one.
- **Delete** — permanently removes the client after confirmation.

### Static Clients

Clients defined in `parako-rp.jsonc` are loaded at startup and made available to the OIDC provider automatically. They are not shown in the admin panel — the admin panel only displays managed clients. To modify static clients, edit `parako-rp.jsonc` directly.

## Client Configuration Fields

### Core OIDC Fields

| Field                          | Type     | Description                                                         |
| ------------------------------ | -------- | ------------------------------------------------------------------- |
| `client_id`                    | string   | Unique identifier (auto-generated or custom)                        |
| `client_secret`                | string   | Secret for confidential clients (encrypted at rest)                 |
| `client_name`                  | string   | Human-readable name                                                 |
| `application_type`             | string   | `web`, `native`, or `spa` (per OIDC spec + extension)               |
| `redirect_uris`                | string[] | Allowed redirect URIs after authentication                          |
| `post_logout_redirect_uris`    | string[] | Allowed redirect URIs after logout                                  |
| `grant_types`                  | string[] | Allowed grant types                                                 |
| `response_types`               | string[] | Allowed response types                                              |
| `scope`                        | string   | Space-separated allowed scopes                                      |
| `token_endpoint_auth_method`   | string   | How the client authenticates at the token endpoint                  |
| `require_pkce`                 | boolean  | Whether PKCE is required                                            |
| `id_token_signed_response_alg` | string   | Algorithm for signing ID tokens (default: RS256)                    |
| `subject_type`                 | string   | `public` or `pairwise`                                              |
| `allowedResources`             | string[] | Resource server URIs this client can request tokens for (RFC 8707)  |
| `resourcesScopes`              | string   | Space-separated scopes for resource server access                   |
| `isInternalClient`             | boolean  | Whether this is a first-party/internal client for your organization |

> **First-party apps:** Set `isInternalClient` to `true` for your organization's own applications (e.g., your main web app, internal tools). These first-party clients are trusted and skip the user consent screen — all requested scopes are granted automatically. Third-party clients (`isInternalClient: false`, the default) always require explicit user consent. This flag cannot be set via Dynamic Client Registration and is reserved for clients created through the admin panel or CLI.
>
> Specifically, when `isInternalClient` is `true`:
>
> - **Consent bypass** — the consent screen is skipped entirely; all requested scopes are auto-granted.
> - **Auto-grant** — authorization grants are created automatically without user approval.
> - **DCR blocked** — this flag cannot be set via Dynamic Client Registration; it is reserved for admin-provisioned clients only.

### Additional Metadata

| Field             | Type     | Description                                                                                          |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `description`     | string   | Free-text description for admin reference                                                            |
| `active`          | boolean  | Whether the client is active (default: `true`)                                                       |
| `preset`          | string   | Client preset (`web`, `spa`, `native`, `m2m`, `device`, `api_management`) — immutable after creation |
| `client_uri`      | string   | URL of the client's home page                                                                        |
| `logo_uri`        | string   | URL of the client's logo                                                                             |
| `policy_uri`      | string   | URL of the client's privacy policy                                                                   |
| `tos_uri`         | string   | URL of the client's terms of service                                                                 |
| `tags`            | string[] | Arbitrary tags for filtering and grouping                                                            |
| `contacts`        | string[] | Contact email addresses for the client owner                                                         |
| `default_max_age` | number   | Default maximum authentication age in seconds                                                        |

## Grant Types

### Authorization Code + PKCE

The standard flow for web and mobile applications. The client redirects the user to Parako.ID's authorization endpoint, receives an authorization code, and exchanges it for tokens.

PKCE (Proof Key for Code Exchange) is required by default for public clients and recommended for all clients (OAuth 2.1 standard).

```bash
# Grant types: authorization_code, refresh_token
# Response types: code
```

### Client Credentials

For machine-to-machine communication where no user is involved. The client authenticates directly with its `client_id` and `client_secret`.

```bash
curl -X POST https://your-parako.example.com/oidc/v1/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=parako:clients:read" \
  -d "resource=urn:parako:api:v1"
```

### Device Flow (RFC 8628)

For devices with limited input capabilities (smart TVs, IoT). The device displays a user code, and the user authenticates on a separate device.

```bash
# Grant type: urn:ietf:params:oauth:grant-type:device_code
# Device authorization endpoint: /oidc/v1/device/auth
# User code lifetime: 600 seconds
```

### Refresh Tokens

Confidential clients and native apps can request refresh tokens by including `offline_access` in the scope. Refresh tokens are rotated on each use by default.

## Resource Indicators (RFC 8707)

Resource Indicators allow clients to specify which API (resource server) they are requesting a token for. This enables audience-restricted tokens — each access token is scoped to a single resource server.

### Built-in Management API

Parako.ID ships with a built-in resource server at `urn:parako:api:v1`. Clients with the **Management API** preset have this resource pre-configured. Tokens issued for this resource are JWTs with `aud: "urn:parako:api:v1"`.

### Management API Scopes

Scopes follow the `parako:<domain>:<action>` taxonomy:

| Scope                               | Description                                           |
| ----------------------------------- | ----------------------------------------------------- |
| `parako:clients:read`               | View OIDC client applications and their configuration |
| `parako:clients:write`              | Create and update OIDC client applications            |
| `parako:clients:delete`             | Permanently delete OIDC client applications           |
| `parako:users:read`                 | View user accounts, profiles, and activity logs       |
| `parako:users:write`                | Create, update, lock/unlock users and reset passwords |
| `parako:users:delete`               | Anonymize or permanently remove user accounts         |
| `parako:sessions:read`              | View active OIDC sessions                             |
| `parako:sessions:revoke`            | Revoke individual or bulk OIDC sessions               |
| `parako:grants:read`                | View authorization grants issued to clients           |
| `parako:grants:revoke`              | Revoke authorization grants                           |
| `parako:jwks:read`                  | View JSON Web Key Sets and key lifecycle state        |
| `parako:jwks:rotate`                | Trigger key rotation, retire expired keys             |
| `parako:audit:read`                 | Query the audit trail and activity log                |
| `parako:audit:write`                | Create entries in the audit trail                     |
| `parako:config:read`                | View application configuration                        |
| `parako:config:write`               | Modify application configuration                      |
| `parako:social:read`                | View social login provider configurations             |
| `parako:social:write`               | Configure social login providers                      |
| `parako:stats:read`                 | View aggregate dashboard stats and system health      |
| `parako:webhooks:manage`            | Create, update, and delete webhook subscriptions      |
| `parako:registration-tokens:read`   | View issued DCR initial access tokens                 |
| `parako:registration-tokens:write`  | Create DCR initial access tokens                      |
| `parako:registration-tokens:delete` | Revoke DCR initial access tokens                      |

Scopes are classified by risk tier — `read`, `write`, or `destructive` — which drives recommended TTLs and audit severity.

### Custom Resource Servers

**M2M** clients can target your own resource servers. Configure the `allowedResources` array with your resource URIs and set `resourcesScopes` to the space-separated scopes your resource server accepts. Tokens can be issued as `jwt` (with the resource URI as `aud`) or `opaque` depending on your resource server's needs.

## Dynamic Client Registration

Parako.ID supports RFC 7591 Dynamic Client Registration when enabled in configuration:

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

> **Security note:** When DCR is enabled, `require_initial_access_token` is always enforced regardless of configuration. Open registration (without an initial access token) is never permitted to prevent unauthorized client creation.

Dynamic registration requires an initial access token. Generate one via the [Management API](api/endpoints.md) using a client with the `parako:registration-tokens:write` scope (see [Management API Scopes](#management-api-scopes)).

```bash
curl -X POST https://your-parako.example.com/oidc/v1/register-rp \
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

Client management is also available programmatically through the REST Management API. All endpoints require a valid access token with the appropriate scope, issued for the `urn:parako:api:v1` resource.

### Client Endpoints

| Method   | Endpoint                                | Scope                   | Description         |
| -------- | --------------------------------------- | ----------------------- | ------------------- |
| `GET`    | `/api/v1/clients`                       | `parako:clients:read`   | List all clients    |
| `POST`   | `/api/v1/clients`                       | `parako:clients:write`  | Create a new client |
| `GET`    | `/api/v1/clients/:client_id`            | `parako:clients:read`   | Get a single client |
| `PUT`    | `/api/v1/clients/:client_id`            | `parako:clients:write`  | Full update         |
| `PATCH`  | `/api/v1/clients/:client_id`            | `parako:clients:write`  | Partial update      |
| `DELETE` | `/api/v1/clients/:client_id`            | `parako:clients:delete` | Delete a client     |
| `POST`   | `/api/v1/clients/:client_id/activate`   | `parako:clients:write`  | Activate a client   |
| `POST`   | `/api/v1/clients/:client_id/deactivate` | `parako:clients:write`  | Deactivate a client |
| `POST`   | `/api/v1/clients/:client_id/secret`     | `parako:clients:delete` | Regenerate secret   |
| `GET`    | `/api/v1/clients/:client_id/stats`      | `parako:clients:read`   | Client usage stats  |

### Registration Token Endpoints

| Method   | Endpoint                           | Scope                               | Description      |
| -------- | ---------------------------------- | ----------------------------------- | ---------------- |
| `GET`    | `/api/v1/registration-tokens`      | `parako:registration-tokens:read`   | List active IATs |
| `POST`   | `/api/v1/registration-tokens`      | `parako:registration-tokens:write`  | Create a new IAT |
| `GET`    | `/api/v1/registration-tokens/:jti` | `parako:registration-tokens:read`   | Get a single IAT |
| `DELETE` | `/api/v1/registration-tokens/:jti` | `parako:registration-tokens:delete` | Revoke an IAT    |

## Client Secret Management

Client secrets are encrypted at rest using the `ENCRYPTION_KEY` from your `.env` file.

To rotate a client's secret:

```bash
# Via Management API
curl -X POST https://your-parako.example.com/api/v1/clients/CLIENT_ID/secret \
  -H "Authorization: Bearer API_TOKEN"
```

You can also rotate the secret from the admin panel at `/admin` → OIDC Clients → select the client → Rotate Secret.

The old secret is immediately invalidated. Update your application with the new secret before the next token request.

## Token TTLs

Token lifetimes are configurable per token type:

| Token              | Default TTL        | Description                                      |
| ------------------ | ------------------ | ------------------------------------------------ |
| Access token       | 3,600s (1 hour)    | Short-lived token for API access                 |
| ID token           | 3,600s (1 hour)    | Identity assertion                               |
| Refresh token      | 86,400s (24 hours) | Long-lived token for obtaining new access tokens |
| Authorization code | 600s (10 min)      | One-time use, exchanged for tokens               |
| Device code        | 600s (10 min)      | User code for device flow                        |
| Client credentials | 3,600s (1 hour)    | Machine-to-machine token                         |
| Grant              | 3,600s (1 hour)    | User authorization grant                         |
| Session            | 86,400s (24 hours) | Browser session                                  |
| Backchannel auth   | 600s (10 min)      | CIBA backchannel authentication request          |
| Interaction        | 600s (10 min)      | OIDC login/consent interaction                   |

Configure TTLs in the `oidc.token_ttl` section of your configuration file or via the admin panel.
