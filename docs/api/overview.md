---
title: 'Management API Overview'
subtitle: 'RESTful API for programmatic administration of Parako.ID'
category: 'Extending'
order: 1
---

## Overview

The Management API provides programmatic access to all Parako.ID administration features. It is a RESTful API at the `/api/v1` base path, secured with JWT access tokens obtained via the OAuth2 Client Credentials grant.

The API is always enabled and available at `/api/v1`. Access is controlled entirely through JWT authentication and scope-based authorization — there is no separate configuration toggle.

## Multi-Tenancy

The Management API respects the deployment's tenancy mode. URL patterns differ between single-tenant and multi-tenant deployments.

### Single-Tenant Mode (default)

All endpoints use the deployment URL directly:

```
OIDC issuer:       https://auth.example.com/oidc/v1
Discovery:         https://auth.example.com/oidc/v1/.well-known/openid-configuration
Token endpoint:    https://auth.example.com/oidc/v1/token
Management API:    https://auth.example.com/api/v1
Admin panel:       https://auth.example.com/admin
```

### Multi-Tenant Mode

In multi-tenant mode, the system derives three tenant tiers from the deployment URL. With `DEPLOYMENT_URL=https://example.com`:

**Regular tenant** — `{tenant}.example.com`

Each tenant is an isolated OIDC provider with its own users, clients, sessions, and signing keys.

```
Issuer:            https://acme.example.com/oidc/v1
Discovery:         https://acme.example.com/oidc/v1/.well-known/openid-configuration
Token endpoint:    https://acme.example.com/oidc/v1/token
Management API:    https://acme.example.com/api/v1
Admin panel:       https://acme.example.com/admin
```

**Platform admin** — `_platforms.example.com`

Cross-tenant control plane for managing all tenants. Issues tokens that carry platform-only scopes (`parako:tenants:*`, `parako:cross-tenant:*`, `parako:settings:*`).

```
Issuer:            https://_platforms.example.com/oidc/v1
Discovery:         https://_platforms.example.com/oidc/v1/.well-known/openid-configuration
Token endpoint:    https://_platforms.example.com/oidc/v1/token
Management API:    https://_platforms.example.com/api/v1
Admin portal:      https://_platforms.example.com/
```

**Ops gateway** — `_ops.example.com`

Stateless infrastructure gateway for cross-tenant social login (OAuth callback relay). Not used for API requests.

```
Callback relay:    https://_ops.example.com/social/{provider}/callback
Health probe:      https://_ops.example.com/health
```

In multi-tenant mode, include the `x-tenant-id` header to scope API operations to a specific tenant when calling from a context that differs from the subdomain.

## Admin Panel vs Management API

| Interface       | Access                                                 | Auth                            | Scope                                       |
| --------------- | ------------------------------------------------------ | ------------------------------- | ------------------------------------------- |
| Admin panel     | `/admin` on tenant subdomain                           | Session (browser)               | One tenant — users, clients, settings       |
| Platform portal | `_platforms` subdomain (e.g. `_platforms.example.com`) | Session (`platform_admin` role) | All tenants — cross-tenant ops              |
| Management API  | `/api/v1` on any subdomain                             | JWT Bearer (M2M)                | Programmatic — full CRUD, CI/CD, automation |

The admin panel uses internal routes and does not call the Management API. They are independent interfaces to the same underlying services.

## Authentication

The Management API uses JWT Bearer tokens obtained via the OAuth2 Client Credentials grant. Tokens are verified against the tenant's JWKS using algorithms **RS256**, **PS256**, or **ES256**, with audience `urn:parako:api:v1` and a 30-second clock tolerance.

**Source:** [`src/api/v1/middleware/jwt-auth.middleware.ts`](../../src/api/v1/middleware/jwt-auth.middleware.ts)

### Step 1: Register an API Client

The recommended way is through the admin panel. The CLI is available as an alternative.

**Admin panel (recommended):**

1. Navigate to `/admin/oidc-clients`
2. Click **Create Client**
3. Select the **"Management API"** preset — this pre-fills `grant_types: ['client_credentials']` and `allowedResources: ['urn:parako:api:v1']`
4. Enter a client name and description
5. Submit — you will see the generated `client_id` and `client_secret` (click the eye icon to reveal the secret)

**CLI alternative:**

```bash
pnpm client add
# Select "Service Account" or "API" type
# Follow the interactive prompts
```

### Step 2: Request an Access Token

**Single-tenant:**

```bash
curl -X POST https://auth.example.com/oidc/v1/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "resource=urn:parako:api:v1" \
  -d "scope=parako:clients:read parako:users:read"
```

**Multi-tenant (regular tenant):**

```bash
curl -X POST https://acme.example.com/oidc/v1/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "resource=urn:parako:api:v1" \
  -d "scope=parako:clients:read parako:users:read"
```

**Multi-tenant (platform — for cross-tenant scopes):**

```bash
curl -X POST https://_platforms.example.com/oidc/v1/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "resource=urn:parako:api:v1" \
  -d "scope=parako:tenants:read parako:tenants:write"
```

The `resource` parameter must be `urn:parako:api:v1` — this is the audience for Management API tokens.

### Step 3: Call the API

**Single-tenant:**

```bash
curl https://auth.example.com/api/v1/users \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

**Multi-tenant (regular tenant):**

```bash
curl https://acme.example.com/api/v1/users \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

**Multi-tenant (platform — cross-tenant operations):**

```bash
curl https://_platforms.example.com/api/v1/tenants \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

## Authorization (Scopes)

The API uses a 30-scope taxonomy following the pattern `parako:<domain>:<action>`.

### Scope Classification

Scopes are classified into three tiers with different recommended token TTLs:

| Tier        | TTL          | Actions                | Use case                |
| ----------- | ------------ | ---------------------- | ----------------------- |
| read        | 3,600s (1h)  | View data              | Safe data retrieval     |
| write       | 1,800s (30m) | Create, update, manage | Modifying resources     |
| destructive | 900s (15m)   | Delete, revoke, rotate | Irreversible operations |

**Source:** [`src/api/v1/scopes.ts`](../../src/api/v1/scopes.ts)

### Full Scope Reference

| Scope                               | Classification | Description                                    |
| ----------------------------------- | -------------- | ---------------------------------------------- |
| `parako:clients:read`               | read           | View OIDC client applications                  |
| `parako:clients:write`              | write          | Create and update clients                      |
| `parako:clients:delete`             | destructive    | Delete clients                                 |
| `parako:users:read`                 | read           | View user accounts and activity                |
| `parako:users:write`                | write          | Create, update, lock/unlock users              |
| `parako:users:delete`               | destructive    | Anonymize or delete users                      |
| `parako:sessions:read`              | read           | View active OIDC sessions                      |
| `parako:sessions:revoke`            | destructive    | Revoke sessions                                |
| `parako:grants:read`                | read           | View authorization grants                      |
| `parako:grants:revoke`              | destructive    | Revoke grants                                  |
| `parako:jwks:read`                  | read           | View signing keys                              |
| `parako:jwks:rotate`                | destructive    | Rotate or retire keys                          |
| `parako:audit:read`                 | read           | Query audit trail                              |
| `parako:audit:write`                | destructive    | Create audit entries                           |
| `parako:stats:read`                 | read           | View dashboard stats and health                |
| `parako:registration-tokens:read`   | read           | View DCR initial access tokens                 |
| `parako:registration-tokens:write`  | write          | Create DCR tokens                              |
| `parako:registration-tokens:delete` | destructive    | Revoke DCR tokens                              |
| `parako:config:read`                | read           | View application configuration                 |
| `parako:config:write`               | write          | Modify configuration                           |
| `parako:social:read`                | read           | View social provider configs                   |
| `parako:social:write`               | write          | Configure social providers                     |
| `parako:webhooks:manage`            | write          | Manage webhook subscriptions                   |
| `parako:tenants:read`               | read           | View tenants **(platform only)**               |
| `parako:tenants:write`              | write          | Create/update tenants **(platform only)**      |
| `parako:tenants:delete`             | destructive    | Delete tenants **(platform only)**             |
| `parako:cross-tenant:read`          | read           | Read cross-tenant config **(platform only)**   |
| `parako:cross-tenant:write`         | write          | Modify cross-tenant config **(platform only)** |
| `parako:settings:read`              | read           | View system settings **(platform only)**       |
| `parako:settings:write`             | write          | Modify system settings **(platform only)**     |

### Platform-Only Scopes

Platform-only scopes (`parako:tenants:*`, `parako:cross-tenant:*`, `parako:settings:*`) can only be used by tokens whose issuer ends with `/_platforms`. In multi-tenant mode, this means the token must be obtained from the `_platforms.example.com` OIDC provider. Non-platform issuers requesting these scopes receive `403 Forbidden`.

**Source:** [`src/api/v1/middleware/jwt-auth.middleware.ts`](../../src/api/v1/middleware/jwt-auth.middleware.ts)

## Rate Limiting

API rate limits are applied per tier within a 60-second sliding window:

| Tier      | Limit   | Window | Operations                                               |
| --------- | ------- | ------ | -------------------------------------------------------- |
| read      | 100 req | 60s    | GET list/detail                                          |
| write     | 30 req  | 60s    | POST, PUT, PATCH                                         |
| delete    | 10 req  | 60s    | DELETE                                                   |
| sensitive | 3 req   | 60s    | Secret rotation, password reset, MFA reset, key rotation |

The rate limit key is the `client_id` from the JWT, with a fallback to the request IP address.

**Source:** [`src/api/v1/middleware/rate-limiter.middleware.ts`](../../src/api/v1/middleware/rate-limiter.middleware.ts)

Rate limit headers are included in every response:

| Header                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `X-RateLimit-Limit`     | Maximum requests in the window                |
| `X-RateLimit-Remaining` | Remaining requests                            |
| `X-RateLimit-Reset`     | Window reset timestamp (Unix epoch)           |
| `Retry-After`           | Seconds until the window resets (only on 429) |

When rate limited, the API returns `429 Too Many Requests` with a `Retry-After` header.

## Error Handling

The API returns errors in [RFC 9457 Problem Detail](https://www.rfc-editor.org/rfc/rfc9457) format with URN-based type identifiers:

```json
{
  "type": "urn:parako:error:not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "User with ID 'abc123' was not found",
  "instance": "/api/v1/users/abc123"
}
```

**Source:** [`src/api/v1/errors.ts`](../../src/api/v1/errors.ts)

### Error Type URNs

| Type URN                                | Status | When                                  |
| --------------------------------------- | ------ | ------------------------------------- |
| `urn:parako:error:unauthorized`         | 401    | Missing or invalid credentials        |
| `urn:parako:error:token-expired`        | 401    | Token TTL exceeded                    |
| `urn:parako:error:token-invalid`        | 401    | Bad signature or malformed JWT        |
| `urn:parako:error:forbidden`            | 403    | Authenticated but lacking permissions |
| `urn:parako:error:scope-insufficient`   | 403    | Missing required scope(s)             |
| `urn:parako:error:not-found`            | 404    | Resource doesn't exist                |
| `urn:parako:error:tenant-not-found`     | 404    | Tenant lookup failed                  |
| `urn:parako:error:section-not-allowed`  | 400    | Requested config section not allowed  |
| `urn:parako:error:conflict`             | 409    | Duplicate resource                    |
| `urn:parako:error:body-too-large`       | 413    | Request body too large                |
| `urn:parako:error:validation`           | 422    | Request validation failed             |
| `urn:parako:error:constraint-violation` | 422    | Floor/ceiling constraint violated     |
| `urn:parako:error:rate-limit-exceeded`  | 429    | Too many requests                     |
| `urn:parako:error:internal`             | 500    | Unexpected server error               |

### HTTP Status Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 200  | Success                                 |
| 201  | Created                                 |
| 204  | No content (successful delete)          |
| 400  | Bad request (invalid config section)    |
| 401  | Unauthorized (missing or invalid token) |
| 403  | Forbidden (insufficient scope)          |
| 404  | Not found                               |
| 409  | Conflict (duplicate resource)           |
| 413  | Request body too large                  |
| 422  | Validation error / constraint violation |
| 429  | Too many requests (rate limited)        |
| 500  | Internal server error                   |

## Pagination

List endpoints use keyset cursor-based pagination.

**Source:** [`src/api/v1/pagination.ts`](../../src/api/v1/pagination.ts)

### Request Parameters

| Parameter       | Type    | Default | Description                          |
| --------------- | ------- | ------- | ------------------------------------ |
| `limit`         | number  | 25      | Items per page (1–100)               |
| `after`         | string  | —       | Opaque cursor from previous response |
| `include_count` | boolean | false   | Include `total_count` in response    |

### Response Shape

```json
{
  "data": [...],
  "pagination": {
    "has_more": true,
    "next_cursor": "eyJpZCI6IjY1...",
    "total_count": 150
  }
}
```

Use the `next_cursor` value as the `after` parameter in the next request to fetch the next page. The `total_count` field is only present when `include_count=true`.

## Audit Logging

All Management API requests are logged to the audit trail:

- **Activity type**: `api_request`
- **Actor type**: `service` (identified by `client_id` from the JWT)
- **Metadata**: `method`, `path`, `status_code`, `duration_ms`, `scope`

Audit entries are created asynchronously after the response is sent and do not affect request latency.

**Source:** [`src/api/v1/middleware/audit-logger.middleware.ts`](../../src/api/v1/middleware/audit-logger.middleware.ts)

## Common Headers

| Header          | Required           | Description              |
| --------------- | ------------------ | ------------------------ |
| `Authorization` | Yes                | `Bearer <access_token>`  |
| `Content-Type`  | For POST/PUT/PATCH | `application/json`       |
| `x-tenant-id`   | Multi-tenant only  | Target tenant identifier |
