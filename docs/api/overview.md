---
title: 'Management API Overview'
subtitle: 'RESTful API for programmatic administration of Parako.ID'
category: 'Extending'
order: 1
---

The Management API exposes every administration capability over REST at `/api/v1`. It is always enabled — access is controlled entirely through JWT Bearer tokens (OAuth2 Client Credentials) and scope-based authorization. There is no configuration toggle.

Endpoint reference for each resource lives in [Management API Endpoints](endpoints.md).

## Deployment-mode URL patterns

The Management API respects the deployment's tenancy mode.

| Mode                          | OIDC issuer                              | Token endpoint    | API base                                | Admin                             |
| ----------------------------- | ---------------------------------------- | ----------------- | --------------------------------------- | --------------------------------- |
| Single-tenant                 | `https://auth.example.com/oidc/v1`       | `…/oidc/v1/token` | `https://auth.example.com/api/v1`       | `https://auth.example.com/admin`  |
| Multi-tenant — regular tenant | `https://acme.example.com/oidc/v1`       | `…/oidc/v1/token` | `https://acme.example.com/api/v1`       | `https://acme.example.com/admin`  |
| Multi-tenant — platform admin | `https://_platforms.example.com/oidc/v1` | `…/oidc/v1/token` | `https://_platforms.example.com/api/v1` | `https://_platforms.example.com/` |
| Multi-tenant — `_ops` gateway | n/a (not used for API requests)          | n/a               | n/a (relays social OAuth callbacks)     | n/a                               |

In multi-tenant mode, include the `x-tenant-id` header to scope API operations to a specific tenant when calling from a context that differs from the subdomain.

## Admin panel vs Management API vs Platform portal

| Interface       | Access                       | Auth                            | Scope                                    |
| --------------- | ---------------------------- | ------------------------------- | ---------------------------------------- |
| Admin panel     | `/admin` on tenant subdomain | Session (browser)               | Single tenant — users, clients, settings |
| Platform portal | `_platforms.<base>`          | Session (`platform_admin` role) | All tenants — cross-tenant operations    |
| Management API  | `/api/v1` on any subdomain   | JWT Bearer (M2M)                | Programmatic — CRUD, CI/CD, automation   |

The admin panel uses internal routes and does not call the Management API. They are independent interfaces to the same underlying services.

## Authentication

The Management API uses JWT Bearer tokens obtained via the OAuth2 Client Credentials grant. Tokens are verified against the tenant's JWKS using `RS256`, `PS256`, or `ES256`, with audience `urn:parako:api:v1` and a **15-second clock tolerance** (`features.oidc.clock_tolerance`).

### 1. Register an API client

Use the admin panel at `/admin/oidc-clients` and select the **Management API** preset. The preset pre-fills `grant_types: ['client_credentials']` and `allowedResources: ['urn:parako:api:v1']`. The CLI (`pnpm client add`) is also available — see [OIDC Clients](../oidc-clients.md).

### 2. Request an access token

```bash
# Single-tenant
curl -X POST https://auth.example.com/oidc/v1/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "resource=urn:parako:api:v1" \
  -d "scope=parako:clients:read parako:users:read"

# Multi-tenant (regular tenant): replace the host with the tenant subdomain.
# Multi-tenant (platform-only scopes): hit https://_platforms.<base>/oidc/v1/token instead.
```

The `resource` parameter must be `urn:parako:api:v1`.

### 3. Call the API

```bash
curl https://auth.example.com/api/v1/users \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

For platform-only scopes (`parako:tenants:*`, `parako:cross-tenant:*`, `parako:settings:*`), the API base must be the platform host (e.g. `https://_platforms.example.com/api/v1/tenants`).

## Authorization scopes

This is the canonical scope table. Other docs link here.

Scopes follow the pattern `parako:<domain>:<action>` and are classified into three risk tiers with different recommended TTLs:

| Tier        | TTL            | Operation kind         |
| ----------- | -------------- | ---------------------- |
| read        | 3,600 s (1 h)  | View data              |
| write       | 1,800 s (30 m) | Create, update, manage |
| destructive | 900 s (15 m)   | Delete, revoke, rotate |

| Scope                               | Tier        | Description                                   |
| ----------------------------------- | ----------- | --------------------------------------------- |
| `parako:clients:read`               | read        | View OIDC client applications                 |
| `parako:clients:write`              | write       | Create and update clients                     |
| `parako:clients:delete`             | destructive | Delete clients                                |
| `parako:users:read`                 | read        | View user accounts and activity               |
| `parako:users:write`                | write       | Create, update, lock / unlock users           |
| `parako:users:delete`               | destructive | Anonymize or delete users                     |
| `parako:sessions:read`              | read        | View active OIDC sessions                     |
| `parako:sessions:revoke`            | destructive | Revoke sessions                               |
| `parako:grants:read`                | read        | View authorization grants                     |
| `parako:grants:revoke`              | destructive | Revoke grants                                 |
| `parako:jwks:read`                  | read        | View signing keys                             |
| `parako:jwks:rotate`                | destructive | Rotate or retire keys                         |
| `parako:audit:read`                 | read        | Query audit trail                             |
| `parako:audit:write`                | destructive | Create audit entries                          |
| `parako:stats:read`                 | read        | Dashboard stats and health                    |
| `parako:registration-tokens:read`   | read        | View DCR initial access tokens                |
| `parako:registration-tokens:write`  | write       | Create DCR tokens                             |
| `parako:registration-tokens:delete` | destructive | Revoke DCR tokens                             |
| `parako:config:read`                | read        | View application configuration                |
| `parako:config:write`               | write       | Modify configuration                          |
| `parako:social:read`                | read        | View social provider configs                  |
| `parako:social:write`               | write       | Configure social providers                    |
| `parako:webhooks:manage`            | write       | Manage webhook subscriptions                  |
| `parako:tenants:read`               | read        | **Platform only.** View tenants               |
| `parako:tenants:write`              | write       | **Platform only.** Create / update tenants    |
| `parako:tenants:delete`             | destructive | **Platform only.** Delete tenants             |
| `parako:cross-tenant:read`          | read        | **Platform only.** Read cross-tenant config   |
| `parako:cross-tenant:write`         | write       | **Platform only.** Modify cross-tenant config |
| `parako:settings:read`              | read        | **Platform only.** View system settings       |
| `parako:settings:write`             | write       | **Platform only.** Modify system settings     |

Platform-only scopes are accepted only when the token's issuer ends with `/_platforms`. Non-platform issuers requesting them receive `403 Forbidden`.

## Rate limiting

Per-tier rate limits within a 60-second sliding window:

| Tier      | Limit   | Window | Operations                                               |
| --------- | ------- | ------ | -------------------------------------------------------- |
| read      | 100 req | 60 s   | GET list / detail                                        |
| write     | 30 req  | 60 s   | POST, PUT, PATCH                                         |
| delete    | 10 req  | 60 s   | DELETE                                                   |
| sensitive | 3 req   | 60 s   | Secret rotation, password reset, MFA reset, key rotation |

The rate-limit key is the `client_id` from the JWT, falling back to the request IP.

Every response includes:

| Header                  | Meaning                                           |
| ----------------------- | ------------------------------------------------- |
| `X-RateLimit-Limit`     | Window cap                                        |
| `X-RateLimit-Remaining` | Remaining requests                                |
| `X-RateLimit-Reset`     | Window reset (Unix epoch)                         |
| `Retry-After`           | Seconds until the next allowed request (429 only) |

When throttled, the API returns `429 Too Many Requests`.

## Error handling

Errors follow [RFC 9457 Problem Detail](https://www.rfc-editor.org/rfc/rfc9457) with URN-based types:

```json
{
  "type": "urn:parako:error:not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "User with ID 'abc123' was not found",
  "instance": "/api/v1/users/abc123"
}
```

### Error type URNs

| Type                                    | Status | When                                  |
| --------------------------------------- | ------ | ------------------------------------- |
| `urn:parako:error:unauthorized`         | 401    | Missing or invalid credentials        |
| `urn:parako:error:token-expired`        | 401    | Token TTL exceeded                    |
| `urn:parako:error:token-invalid`        | 401    | Bad signature or malformed JWT        |
| `urn:parako:error:forbidden`            | 403    | Authenticated but lacking permissions |
| `urn:parako:error:scope-insufficient`   | 403    | Missing required scope                |
| `urn:parako:error:not-found`            | 404    | Resource does not exist               |
| `urn:parako:error:tenant-not-found`     | 404    | Tenant lookup failed                  |
| `urn:parako:error:section-not-allowed`  | 400    | Requested config section not allowed  |
| `urn:parako:error:conflict`             | 409    | Duplicate resource                    |
| `urn:parako:error:body-too-large`       | 413    | Request body too large                |
| `urn:parako:error:validation`           | 422    | Request validation failed             |
| `urn:parako:error:constraint-violation` | 422    | Floor / ceiling constraint violated   |
| `urn:parako:error:rate-limit-exceeded`  | 429    | Too many requests                     |
| `urn:parako:error:internal`             | 500    | Unexpected server error               |

## Pagination

List endpoints use keyset cursor pagination.

| Parameter       | Type    | Default | Description                          |
| --------------- | ------- | ------- | ------------------------------------ |
| `limit`         | number  | 25      | Items per page (1–100)               |
| `after`         | string  | —       | Opaque cursor from previous response |
| `include_count` | boolean | false   | Include `total_count` in response    |

```json
{
  "data": [],
  "pagination": {
    "has_more": true,
    "next_cursor": "eyJpZCI6IjY1...",
    "total_count": 150
  }
}
```

Pass `next_cursor` back as `after` for the next page. `total_count` is present only when `include_count=true`.

## Audit logging

All Management API requests are logged asynchronously:

- **Activity type:** `api_request`
- **Actor:** `service` (identified by `client_id`)
- **Metadata:** `method`, `path`, `status_code`, `duration_ms`, `scope`

Audit entries are written after the response is sent and do not affect request latency.

## Common headers

| Header          | Required           | Description              |
| --------------- | ------------------ | ------------------------ |
| `Authorization` | Yes                | `Bearer <access_token>`  |
| `Content-Type`  | POST / PUT / PATCH | `application/json`       |
| `x-tenant-id`   | Multi-tenant only  | Target tenant identifier |

## See also

- [Management API Endpoints](endpoints.md)
- [OIDC Clients](../oidc-clients.md)
- [OIDC Endpoints](../oidc-endpoints.md)
