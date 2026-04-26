---
title: 'API Endpoints'
subtitle: 'Complete Management API endpoint reference'
category: 'Extending'
order: 2
---

All examples use `auth.example.com` for single-tenant mode and `acme.example.com` / `_platforms.example.com` for multi-tenant mode. Replace with your deployment URL.

Every request requires `Authorization: Bearer <access_token>`. Mutating requests (POST/PUT/PATCH) require `Content-Type: application/json`. In multi-tenant mode, include `x-tenant-id: <tenant>` when targeting a tenant different from the subdomain. See [Overview](overview.md) for authentication and pagination details.

---

## Clients

Manage OIDC/OAuth2 client applications.

| Method | Endpoint                                | Scope                   | Rate Limit | Description                  |
| ------ | --------------------------------------- | ----------------------- | ---------- | ---------------------------- |
| GET    | `/api/v1/clients`                       | `parako:clients:read`   | read       | List all clients             |
| POST   | `/api/v1/clients`                       | `parako:clients:write`  | write      | Create a new client          |
| GET    | `/api/v1/clients/:client_id`            | `parako:clients:read`   | read       | Get client details           |
| PUT    | `/api/v1/clients/:client_id`            | `parako:clients:write`  | write      | Full update (replace) client |
| PATCH  | `/api/v1/clients/:client_id`            | `parako:clients:write`  | write      | Partial update client        |
| DELETE | `/api/v1/clients/:client_id`            | `parako:clients:delete` | delete     | Delete client                |
| POST   | `/api/v1/clients/:client_id/activate`   | `parako:clients:write`  | write      | Activate a disabled client   |
| POST   | `/api/v1/clients/:client_id/deactivate` | `parako:clients:write`  | write      | Deactivate a client          |
| POST   | `/api/v1/clients/:client_id/secret`     | `parako:clients:delete` | sensitive  | Regenerate client secret     |
| GET    | `/api/v1/clients/:client_id/stats`      | `parako:clients:read`   | read       | Get client usage statistics  |

### List Clients

**Query Parameters:**

| Parameter          | Type    | Default | Description                          |
| ------------------ | ------- | ------- | ------------------------------------ |
| `limit`            | number  | 25      | Items per page (1–100)               |
| `after`            | string  | —       | Opaque cursor from previous response |
| `include_count`    | boolean | false   | Include `total_count` in response    |
| `application_type` | string  | —       | Filter: `web`, `native`, or `spa`    |
| `active`           | string  | —       | Filter: `true` or `false`            |
| `q`                | string  | —       | Full-text search (max 200 chars)     |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "client_id": "abc123",
      "client_name": "My Web App",
      "application_type": "web",
      "redirect_uris": ["https://app.example.com/callback"],
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code"],
      "token_endpoint_auth_method": "client_secret_basic",
      "scope": "openid profile email",
      "..."
    }
  ],
  "pagination": {
    "has_more": true,
    "next_cursor": "eyJpZCI6IjY1...",
    "total_count": 150
  }
}
```

> `client_secret` is stripped from list responses.

### Create Client

**Request Body:**

| Field                          | Type     | Required | Description                                                                                    |
| ------------------------------ | -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `client_name`                  | string   | **Yes**  | Client display name (1–255 chars)                                                              |
| `application_type`             | string   | No       | `web` (default), `native`, or `spa`                                                            |
| `redirect_uris`                | string[] | No       | Valid URLs for OAuth redirects                                                                 |
| `post_logout_redirect_uris`    | string[] | No       | Valid URLs for post-logout redirects                                                           |
| `grant_types`                  | string[] | No       | OAuth grant types                                                                              |
| `response_types`               | string[] | No       | OAuth response types                                                                           |
| `scope`                        | string   | No       | Space-separated scope string                                                                   |
| `token_endpoint_auth_method`   | string   | No       | `none`, `client_secret_basic`, `client_secret_post`, `client_secret_jwt`, or `private_key_jwt` |
| `client_uri`                   | string   | No       | Valid URL to client website                                                                    |
| `logo_uri`                     | string   | No       | Valid URL to client logo                                                                       |
| `policy_uri`                   | string   | No       | Valid URL to privacy policy                                                                    |
| `tos_uri`                      | string   | No       | Valid URL to terms of service                                                                  |
| `contacts`                     | string[] | No       | Array of valid email addresses                                                                 |
| `description`                  | string   | No       | Client description (max 1000 chars)                                                            |
| `tags`                         | string[] | No       | Arbitrary tags for organization                                                                |
| `require_pkce`                 | boolean  | No       | Require PKCE for this client                                                                   |
| `id_token_signed_response_alg` | string   | No       | Algorithm for ID token signing                                                                 |
| `subject_type`                 | string   | No       | `public` or `pairwise`                                                                         |
| `default_max_age`              | number   | No       | Default max auth age (positive integer)                                                        |

```bash
curl -X POST https://auth.example.com/api/v1/clients \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Web App",
    "redirect_uris": ["https://app.example.com/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_basic",
    "scope": "openid profile email offline_access"
  }'
```

**Response:** `201 Created`

```json
{
  "data": {
    "client_id": "abc123",
    "client_secret": "generated-secret-shown-once",
    "client_name": "My Web App",
    "application_type": "web",
    "redirect_uris": ["https://app.example.com/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "..."
  }
}
```

> `client_secret` is only returned on creation and secret regeneration — store it immediately.

### Get Client

**Response:** `200 OK` — single client object (secret stripped).

**Errors:** `404` if client not found.

### Update Client (PUT / PATCH)

**Request Body:** Same fields as Create Client — all optional for PATCH, replaces mutable fields for PUT.

**Response:** `200 OK` — updated client object (secret stripped).

**Errors:** `404` if client not found.

### Delete Client

**Response:** `204 No Content`

**Errors:** `404` if client not found.

### Activate / Deactivate Client

**Request Body:** None.

**Response:** `200 OK` — updated client object (secret stripped).

**Errors:** `404` if client not found.

### Regenerate Client Secret

```bash
curl -X POST https://auth.example.com/api/v1/clients/CLIENT_ID/secret \
  -H "Authorization: Bearer TOKEN"
```

**Request Body:** None.

**Response:** `200 OK`

```json
{
  "data": {
    "client_id": "abc123",
    "client_secret": "new-secret-shown-once"
  }
}
```

The old secret is immediately invalidated.

### Get Client Stats

**Response:** `200 OK` — client usage statistics object.

**Errors:** `404` if client not found.

---

## Users

Manage user accounts.

| Method | Endpoint                                | Scope                  | Rate Limit | Description              |
| ------ | --------------------------------------- | ---------------------- | ---------- | ------------------------ |
| GET    | `/api/v1/users`                         | `parako:users:read`    | read       | List all users           |
| POST   | `/api/v1/users`                         | `parako:users:write`   | write      | Create a new user        |
| GET    | `/api/v1/users/:user_id`                | `parako:users:read`    | read       | Get user details         |
| PUT    | `/api/v1/users/:user_id`                | `parako:users:write`   | write      | Full update user         |
| PATCH  | `/api/v1/users/:user_id`                | `parako:users:write`   | write      | Partial update user      |
| DELETE | `/api/v1/users/:user_id`                | `parako:users:delete`  | delete     | Anonymize or delete user |
| POST   | `/api/v1/users/:user_id/lock`           | `parako:users:write`   | write      | Lock user account        |
| DELETE | `/api/v1/users/:user_id/lock`           | `parako:users:write`   | write      | Unlock user account      |
| POST   | `/api/v1/users/:user_id/password-reset` | `parako:users:write`   | sensitive  | Admin password reset     |
| POST   | `/api/v1/users/:user_id/mfa/reset`      | `parako:users:write`   | sensitive  | Reset user MFA           |
| GET    | `/api/v1/users/:user_id/activities`     | `parako:users:read`    | read       | Get user activity log    |
| GET    | `/api/v1/users/:user_id/sessions`       | `parako:sessions:read` | read       | Get user active sessions |

### List Users

**Query Parameters:**

| Parameter         | Type    | Default | Description                                  |
| ----------------- | ------- | ------- | -------------------------------------------- |
| `limit`           | number  | 25      | Items per page (1–100)                       |
| `after`           | string  | —       | Opaque cursor from previous response         |
| `include_count`   | boolean | false   | Include `total_count` in response            |
| `account_enabled` | string  | —       | Filter: `true` or `false`                    |
| `role`            | string  | —       | Filter by role (max 50 chars)                |
| `auth_provider`   | string  | —       | Filter by auth provider (max 50 chars)       |
| `q`               | string  | —       | Search email, username, name (max 200 chars) |

**Response:** `200 OK` — paginated user list.

> Sensitive fields stripped: `password`, `hashedPassword`, `mfa.secret`, `mfa.recovery_codes`, `webauthn.credentials`.

### Create User

**Request Body:**

| Field             | Type    | Required | Description                       |
| ----------------- | ------- | -------- | --------------------------------- |
| `email`           | string  | **Yes**  | Valid email address               |
| `password`        | string  | **Yes**  | User password (8–128 chars)       |
| `username`        | string  | No       | Username (1–100 chars)            |
| `given_name`      | string  | No       | First name (max 100 chars)        |
| `family_name`     | string  | No       | Last name (max 100 chars)         |
| `name`            | string  | No       | Full display name (max 200 chars) |
| `nickname`        | string  | No       | Nickname (max 100 chars)          |
| `role`            | string  | No       | User role                         |
| `account_enabled` | boolean | No       | Whether the account is active     |

```bash
curl -X POST https://auth.example.com/api/v1/users \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "given_name": "Jane",
    "family_name": "Doe",
    "role": "user"
  }'
```

**Response:** `201 Created` — created user (sensitive fields stripped).

### Get User

**Response:** `200 OK` — single user object (sensitive fields stripped).

**Errors:** `404` if user not found.

### Update User (PUT / PATCH)

**Request Body:** Same fields as Create User except `password` — all optional, plus `email` is updatable. PATCH only modifies supplied fields; PUT replaces all mutable fields.

**Response:** `200 OK` — updated user (sensitive fields stripped).

**Errors:** `404` if user not found.

### Delete User

**Response:** `204 No Content` — user account is anonymized.

**Errors:** `404` if user not found.

### Lock / Unlock User

**Request Body:** None.

```bash
# Lock
curl -X POST https://auth.example.com/api/v1/users/USER_ID/lock \
  -H "Authorization: Bearer TOKEN"

# Unlock
curl -X DELETE https://auth.example.com/api/v1/users/USER_ID/lock \
  -H "Authorization: Bearer TOKEN"
```

**Response:** `200 OK` — updated user (sensitive fields stripped).

**Errors:** `404` if user not found.

### Reset User Password

**Request Body:**

| Field          | Type   | Required | Description                |
| -------------- | ------ | -------- | -------------------------- |
| `new_password` | string | **Yes**  | New password (8–128 chars) |

```bash
curl -X POST https://auth.example.com/api/v1/users/USER_ID/password-reset \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"new_password": "NewSecurePassword456!"}'
```

**Response:** `200 OK`

```json
{
  "data": {
    "message": "Password has been reset"
  }
}
```

**Errors:** `404` if user not found.

### Reset User MFA

**Request Body:** None.

**Response:** `200 OK`

```json
{
  "data": {
    "message": "MFA has been reset"
  }
}
```

Disables TOTP and clears recovery codes.

**Errors:** `404` if user not found.

### List User Activities

**Query Parameters:** `limit`, `after`, `include_count` (standard pagination).

**Response:** `200 OK` — paginated activity log entries.

**Errors:** `404` if user not found.

### List User Sessions

**Response:** `200 OK`

```json
{
  "data": [...]
}
```

Returns `[]` if the OIDC adapter does not support session listing.

**Errors:** `404` if user not found.

---

## Sessions

Manage active OIDC sessions.

| Method | Endpoint                | Scope                    | Rate Limit | Description          |
| ------ | ----------------------- | ------------------------ | ---------- | -------------------- |
| GET    | `/api/v1/sessions`      | `parako:sessions:read`   | read       | List all sessions    |
| GET    | `/api/v1/sessions/:jti` | `parako:sessions:read`   | read       | Get session details  |
| DELETE | `/api/v1/sessions/:jti` | `parako:sessions:revoke` | delete     | Revoke a session     |
| DELETE | `/api/v1/sessions`      | `parako:sessions:revoke` | delete     | Bulk revoke sessions |

### List Sessions

**Query Parameters:**

| Parameter       | Type    | Default | Description                          |
| --------------- | ------- | ------- | ------------------------------------ |
| `limit`         | number  | 25      | Items per page (1–100)               |
| `after`         | string  | —       | Opaque cursor from previous response |
| `include_count` | boolean | false   | Include `total_count` in response    |
| `username`      | string  | —       | Filter by account ID (max 255 chars) |
| `client_id`     | string  | —       | Filter by client ID (max 255 chars)  |
| `active`        | string  | —       | Filter: `true` or `false`            |

**Response:** `200 OK` — paginated session list.

### Get Session

**Response:** `200 OK` — single session object.

**Errors:** `404` if session not found.

### Revoke Session

**Response:** `204 No Content`

**Errors:** `404` if session not found.

### Bulk Revoke Sessions

At least one filter is required to prevent mass revocation.

**Query Parameters:**

| Parameter   | Type   | Required     | Description          |
| ----------- | ------ | ------------ | -------------------- |
| `username`  | string | At least one | Filter by account ID |
| `client_id` | string | At least one | Filter by client ID  |

```bash
curl -X DELETE "https://auth.example.com/api/v1/sessions?username=user@example.com" \
  -H "Authorization: Bearer TOKEN"
```

**Response:** `200 OK`

```json
{
  "data": {
    "revoked_count": 5
  }
}
```

**Errors:** `422` if neither `username` nor `client_id` is provided.

---

## JWKS

Manage JSON Web Key Sets for token signing.

| Method | Endpoint                      | Scope                | Rate Limit | Description             |
| ------ | ----------------------------- | -------------------- | ---------- | ----------------------- |
| GET    | `/api/v1/jwks`                | `parako:jwks:read`   | read       | List all signing keys   |
| GET    | `/api/v1/jwks/:kid`           | `parako:jwks:read`   | read       | Get key details         |
| POST   | `/api/v1/jwks/rotate`         | `parako:jwks:rotate` | sensitive  | Rotate signing keys     |
| POST   | `/api/v1/jwks/retire-expired` | `parako:jwks:rotate` | sensitive  | Retire all expired keys |
| DELETE | `/api/v1/jwks/:kid`           | `parako:jwks:rotate` | sensitive  | Retire a specific key   |

### List Keys

**Query Parameters:**

| Parameter | Type   | Description                                |
| --------- | ------ | ------------------------------------------ |
| `status`  | string | Filter: `active`, `expiring`, or `retired` |

**Response:** `200 OK` — flat array (no pagination).

```json
{
  "data": [
    {
      "kid": "key-id-123",
      "alg": "RS256",
      "use": "sig",
      "status": "active",
      "promoted": true,
      "publicKey": { "kty": "RSA", "n": "...", "e": "AQAB" },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "rotatedAt": "2024-04-01T00:00:00.000Z"
    }
  ]
}
```

> Private key material is never exposed.

### Get Key

**Response:** `200 OK` — single key object (same structure as above).

**Errors:** `404` if key not found.

### Rotate Keys

**Request Body:** None.

```bash
curl -X POST https://auth.example.com/api/v1/jwks/rotate \
  -H "Authorization: Bearer TOKEN"
```

**Response:** `200 OK`

```json
{
  "data": {
    "message": "Keys rotated successfully",
    "promoted": 1
  }
}
```

New keys are generated; old keys remain valid during the overlap window. A `jwks:rotated` event is published to Redis.

### Retire Expired Keys

**Request Body:** None.

**Response:** `200 OK`

```json
{
  "data": {
    "message": "Expired keys retired",
    "retired": 1
  }
}
```

### Retire Specific Key

**Response:** `202 Accepted`

```json
{
  "data": {
    "message": "Key 'key-id-123' has been marked for retirement and will be retired at the next rotation cycle",
    "kid": "key-id-123",
    "current_status": "active"
  }
}
```

**Errors:** `404` if key not found. `409` if key is already retired.

---

## Audit

Query the activity audit trail.

| Method | Endpoint              | Scope               | Rate Limit | Description                    |
| ------ | --------------------- | ------------------- | ---------- | ------------------------------ |
| GET    | `/api/v1/audit`       | `parako:audit:read` | read       | List audit log entries         |
| GET    | `/api/v1/audit/:id`   | `parako:audit:read` | read       | Get a single audit entry       |
| GET    | `/api/v1/audit/types` | `parako:audit:read` | read       | Get distinct activity types    |
| GET    | `/api/v1/audit/stats` | `parako:stats:read` | read       | Get audit aggregate statistics |

### List Audit Entries

**Query Parameters:**

| Parameter       | Type    | Default | Description                                       |
| --------------- | ------- | ------- | ------------------------------------------------- |
| `limit`         | number  | 25      | Items per page (1–100)                            |
| `after`         | string  | —       | Opaque cursor from previous response              |
| `include_count` | boolean | false   | Include `total_count` in response                 |
| `type`          | string  | —       | Filter by event type (exact match)                |
| `status`        | string  | —       | Filter: `success`, `failed`, `info`, or `warning` |
| `username`      | string  | —       | Filter by actor username                          |
| `client_id`     | string  | —       | Filter by client ID                               |
| `from`          | string  | —       | Start date (ISO 8601 datetime)                    |
| `to`            | string  | —       | End date (ISO 8601 datetime)                      |

```bash
curl "https://auth.example.com/api/v1/audit?type=login&status=failed&from=2024-01-01T00:00:00Z&limit=50" \
  -H "Authorization: Bearer TOKEN"
```

**Response:** `200 OK` — paginated audit entries.

### Get Audit Entry

**Response:** `200 OK` — single audit entry.

**Errors:** `404` if entry not found.

### List Activity Types

**Response:** `200 OK` — flat array of distinct type strings (no pagination).

```json
{
  "data": ["login", "logout", "password_reset", "mfa_enabled", "..."]
}
```

### Get Audit Statistics

**Response:** `200 OK`

```json
{
  "data": {
    "totalActivities": 1000,
    "uniqueUsers": 50,
    "todayCount": 25,
    "successfulLogins": 20,
    "failedLogins": 5
  }
}
```

---

## Statistics

Dashboard overview and system health.

| Method | Endpoint               | Scope               | Rate Limit | Description                  |
| ------ | ---------------------- | ------------------- | ---------- | ---------------------------- |
| GET    | `/api/v1/stats`        | `parako:stats:read` | read       | Aggregate dashboard overview |
| GET    | `/api/v1/stats/health` | `parako:stats:read` | read       | System health check          |

### Dashboard Overview

**Response:** `200 OK`

```json
{
  "data": {
    "users": { "total": 100 },
    "clients": { "total": 25 },
    "sessions": { "..." },
    "grants": { "..." },
    "activity": {
      "totalActivities": 1000,
      "uniqueUsers": 50,
      "todayCount": 25,
      "successfulLogins": 20,
      "failedLogins": 5
    }
  }
}
```

Each section is isolated — if one fails, others still return. Failed sections include an `error` field instead.

### Health Check

```bash
curl https://auth.example.com/api/v1/stats/health \
  -H "Authorization: Bearer TOKEN"
```

**Response:** `200 OK` (or `503 Service Unavailable` if degraded)

```json
{
  "data": {
    "status": "healthy",
    "checks": {
      "database": { "status": "healthy" },
      "oidc": { "status": "healthy" },
      "config": { "status": "healthy" }
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

Each check status is `healthy`, `unhealthy`, or `unknown`. If any check is unhealthy, the overall status is `degraded` and the HTTP status is `503`.

---

## Registration Tokens

Manage Dynamic Client Registration (DCR) initial access tokens.

| Method | Endpoint                           | Scope                               | Rate Limit | Description        |
| ------ | ---------------------------------- | ----------------------------------- | ---------- | ------------------ |
| GET    | `/api/v1/registration-tokens`      | `parako:registration-tokens:read`   | read       | List active tokens |
| POST   | `/api/v1/registration-tokens`      | `parako:registration-tokens:write`  | write      | Create a new token |
| GET    | `/api/v1/registration-tokens/:jti` | `parako:registration-tokens:read`   | read       | Get token details  |
| DELETE | `/api/v1/registration-tokens/:jti` | `parako:registration-tokens:delete` | delete     | Revoke a token     |

### Create Registration Token

**Request Body:**

| Field             | Type     | Required | Description                                                                         |
| ----------------- | -------- | -------- | ----------------------------------------------------------------------------------- |
| `expires_in`      | number   | **Yes**  | Token lifetime in seconds (300–2,592,000 = 5 min to 30 days)                        |
| `max_usage_count` | number   | **Yes**  | Max client registrations allowed (1–1,000)                                          |
| `policies`        | string[] | No       | Registration policies (1–10 items, 1–128 chars each). Default: `["general-policy"]` |
| `note`            | string   | No       | Admin note for identifying the token (max 500 chars)                                |

```bash
curl -X POST https://auth.example.com/api/v1/registration-tokens \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "expires_in": 86400,
    "max_usage_count": 5,
    "note": "CI/CD pipeline token"
  }'
```

**Response:** `201 Created`

```json
{
  "data": {
    "jti": "token-id",
    "token": "raw-token-value-shown-once",
    "expires_at": "2024-01-08T00:00:00.000Z",
    "max_usage_count": 5,
    "current_usage_count": 0,
    "policies": ["general-policy"],
    "note": "CI/CD pipeline token",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

> The raw `token` value is only returned on creation — store it immediately. Use it in the `Authorization: Bearer` header when calling `POST /oidc/v1/register-rp`.

### Get Registration Token

**Response:** `200 OK` — token metadata without the raw token value.

**Errors:** `404` if token not found.

### List Registration Tokens

**Response:** `200 OK` — paginated list.

### Revoke Registration Token

**Response:** `204 No Content`

**Errors:** `404` if token not found.

---

## Tenants (Platform Only)

Manage tenants in multi-tenant deployments. Requires platform-only scopes. Tokens must be issued by the `_platforms` tenant issuer (e.g. `https://_platforms.example.com/oidc/v1`).

These endpoints are only available in multi-tenant mode. In single-tenant mode, there are no tenants to manage.

| Method | Endpoint                                | Scope                       | Rate Limit | Description                    |
| ------ | --------------------------------------- | --------------------------- | ---------- | ------------------------------ |
| GET    | `/api/v1/tenants`                       | `parako:tenants:read`       | read       | List all tenants               |
| POST   | `/api/v1/tenants`                       | `parako:tenants:write`      | write      | Create a new tenant            |
| GET    | `/api/v1/tenants/:slug`                 | `parako:tenants:read`       | read       | Get tenant details             |
| GET    | `/api/v1/tenants/:slug/config`          | `parako:cross-tenant:read`  | read       | Get tenant config overrides    |
| PUT    | `/api/v1/tenants/:slug/config/:section` | `parako:cross-tenant:write` | write      | Update a tenant config section |

### List Tenants

**Query Parameters:**

| Parameter | Type   | Default | Description                          |
| --------- | ------ | ------- | ------------------------------------ |
| `limit`   | number | 25      | Items per page (1–100)               |
| `after`   | string | —       | Opaque cursor from previous response |
| `status`  | string | —       | Filter by tenant status              |

**Response:** `200 OK` — paginated tenant list.

### Create Tenant

**Request Body:**

| Field          | Type   | Required | Description                                                                                       |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------- |
| `slug`         | string | **Yes**  | Unique identifier (2–63 chars, lowercase alphanumeric with hyphens, cannot start/end with hyphen) |
| `display_name` | string | **Yes**  | Display name (1–255 chars)                                                                        |
| `domain`       | string | No       | Custom domain for the tenant                                                                      |

```bash
curl -X POST https://_platforms.example.com/api/v1/tenants \
  -H "Authorization: Bearer PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "acme",
    "display_name": "Acme Corp"
  }'
```

**Response:** `201 Created` — created tenant object.

**Errors:** `409 Conflict` if slug already exists.

### Get Tenant

**Response:** `200 OK` — single tenant object.

**Errors:** `404` if tenant not found.

### Get Tenant Config

```bash
curl https://_platforms.example.com/api/v1/tenants/acme/config \
  -H "Authorization: Bearer PLATFORM_TOKEN"
```

**Response:** `200 OK` — configuration overrides object (or `{}` if none set).

**Errors:** `404` if tenant not found.

### Update Tenant Config Section

**Path Parameters:**

| Parameter  | Description                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `:slug`    | Tenant slug                                                                                        |
| `:section` | One of: `application`, `branding`, `security`, `features`, `oidc`, `integrations`, `notifications` |

**Request Body:** JSON object with the section fields to override.

```bash
curl -X PUT https://_platforms.example.com/api/v1/tenants/acme/config/branding \
  -H "Authorization: Bearer PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corp",
    "logo": "/uploads/acme-logo.png"
  }'
```

**Response:** `200 OK` — updated configuration.

**Errors:**

- `404` if tenant not found.
- `422` if section is not in the allowed list.

---

## Error Responses

All errors follow [RFC 9457 Problem Detail](https://www.rfc-editor.org/rfc/rfc9457) format. See [Overview — Error Handling](overview.md#error-handling) for the full error type reference.

**Validation errors** include an `errors` array:

```json
{
  "type": "urn:parako:error:validation",
  "title": "Validation Error",
  "status": 422,
  "detail": "Request validation failed",
  "instance": "/api/v1/users",
  "errors": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "password", "message": "Password must be at least 8 characters" }
  ]
}
```
