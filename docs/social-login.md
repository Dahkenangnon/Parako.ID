---
title: 'Social Login'
subtitle: 'Federate authentication with Google, GitHub, Microsoft, LinkedIn, and Facebook'
category: 'Authentication & Authorization'
order: 3
---

Parako.ID supports OAuth2 / OpenID Connect federation with five providers. PKCE (S256) is enforced on every flow via the `openid-client` library. In multi-tenant deployments, tenants may share platform-level credentials (Tier 1) or bring their own (Tier 2).

## Supported providers

| Provider  | Protocol       | Discovery               | Default scopes               |
| --------- | -------------- | ----------------------- | ---------------------------- |
| Google    | OpenID Connect | OIDC discovery          | `openid`, `profile`, `email` |
| GitHub    | OAuth2         | Manual endpoints        | `user:email`                 |
| Microsoft | OpenID Connect | Azure AD v2.0 discovery | `openid`, `profile`, `email` |
| LinkedIn  | OAuth2         | Manual endpoints        | `openid`, `profile`, `email` |
| Facebook  | OAuth2         | Manual endpoints        | `email`, `public_profile`    |

## Multi-tenant credential model

The platform operator configures each provider once. Each tenant is then classified per provider:

| Tier       | Trigger                                                   | Callback route                                              |
| ---------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| **Tier 1** | Tenant has no `client_id` override for the provider       | Routes via the `_ops` gateway, then redirects to the tenant |
| **Tier 2** | Tenant supplies its own `client_id` (and `client_secret`) | Direct tenant ↔ provider, like single-tenant mode           |

A tenant can be Tier 1 for one provider and Tier 2 for another. See [Multi-Tenancy](multi-tenancy.md) for the `_ops` gateway architecture.

### Tenant-overridable fields

| Field                                                | Effect                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `features.social_providers.enabled`                  | Which providers are active for this tenant |
| `features.social_providers.behavior`                 | Account-linking and registration behavior  |
| `features.social_providers.{provider}.client_id`     | Triggers Tier 2 mode for this provider     |
| `features.social_providers.{provider}.client_secret` | Tenant's own secret (encrypted at rest)    |

## Flow

### Single-tenant or Tier 2

```
User              Parako.ID                       Provider
 |                    |                              |
 | /auth/social/<p>/login                            |
 |------------------->|                              |
 |                    | Build auth URL + PKCE S256   |
 |  302 to provider   |                              |
 |<-------------------|                              |
 |                                                   |
 | (authenticate)                                    |
 |------------------------------------------------->|
 |                                                   |
 |  302 /auth/social/<p>/callback?code=...           |
 |<-------------------------------------------------|
 |                    |                              |
 |   token exchange + userinfo                       |
 |                    |----------------------------->|
 |                    |<-----------------------------|
 |    redirect / session                             |
 |<-------------------|                              |
```

### Tier 1 (via `_ops` gateway)

```
User    Tenant App      _ops Gateway     Redis    Provider
 |          |                |              |         |
 | /auth/social/<p>/login                             |
 |--------->|                                         |
 |          | Build auth URL (Tier 1 redirect_uri)    |
 |  302 _ops/social/<p>/callback                      |
 |<---------|                                         |
 |                                                    |
 | (authenticate)                                     |
 |--------------------------------------------------->|
 |                                                    |
 |  302 _ops?code=...                                 |
 |<---------------------------------------------------|
 |                            |          |             |
 |                  store     | SET ref  |             |
 |                            |--------->|             |
 |                                                    |
 |  302 https://<tenant>.<base>/auth/social/<p>/complete?ref=<uuid>
 |<---------------------------|                       |
 |                                                    |
 |          |  GETDEL ref + token exchange + userinfo |
 |          |--------------------------->|----------->|
 |          |<---------------------------|<-----------|
 |  redirect / session                                |
 |<---------|                                         |
```

Tier 1 token and userinfo endpoints are hardcoded per provider to prevent SSRF via compromised tenant configuration.

## Configuring providers

Set `client_id` and `client_secret` for every provider you enable. Secrets are encrypted at rest using `ENCRYPTION_KEY` (see [Configuration](configuration.md)).

```jsonc
{
  "features": {
    "social_providers": {
      "available": ["google", "github", "microsoft", "linkedin", "facebook"],
      "enabled": ["google", "github"],
      "google": {
        "client_id": "...",
        "client_secret": "${GOOGLE_CLIENT_SECRET}",
        "discovery_url": "https://accounts.google.com/.well-known/openid-configuration",
        "scopes": ["openid", "profile", "email"],
      },
      "github": {
        "client_id": "...",
        "client_secret": "${GITHUB_CLIENT_SECRET}",
        "authorization_endpoint": "https://github.com/login/oauth/authorize",
        "token_endpoint": "https://github.com/login/oauth/access_token",
        "userinfo_endpoint": "https://api.github.com/user",
        "scopes": ["user:email"],
      },
    },
  },
}
```

`available` is the recognized set; `enabled` is the active subset. A provider must be in both lists and have a valid `client_id` / `client_secret` to function.

### Per-provider settings

| Provider  | Developer console                                 | Redirect URI to register                             | Discovery vs Manual       | Notes                                                                                                                                         |
| --------- | ------------------------------------------------- | ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Google    | <https://console.cloud.google.com/>               | `https://<your-host>/auth/social/google/callback`    | Discovery                 | `access_type=offline` and `prompt=consent` are added automatically to obtain refresh tokens. Workspace domains detectable via the `hd` claim. |
| GitHub    | <https://github.com/settings/developers>          | `https://<your-host>/auth/social/github/callback`    | Manual                    | No refresh tokens. Primary verified email fetched from `/user/emails` when not public.                                                        |
| Microsoft | <https://portal.azure.com/> → App registrations   | `https://<your-host>/auth/social/microsoft/callback` | Discovery (Azure AD v2.0) | Supports work / school (Azure AD) and personal accounts. Azure AD tenant ID via the `tid` claim.                                              |
| LinkedIn  | <https://www.linkedin.com/developers/>            | `https://<your-host>/auth/social/linkedin/callback`  | Manual                    | Requires the "Sign In with LinkedIn using OpenID Connect" product.                                                                            |
| Facebook  | <https://developers.facebook.com/> (Consumer app) | `https://<your-host>/auth/social/facebook/callback`  | Manual                    | See the Security section for the Tier 1 `email_verified` caveat.                                                                              |

For multi-tenant Tier 1, replace `<your-host>` with `_ops.<base-domain>` and the callback path with `/social/<provider>/callback`.

## Behavior configuration

```jsonc
{
  "features": {
    "social_providers": {
      "behavior": {
        "existing_user_no_integration": "require_manual_link",
        "no_user_account": "allow_registration",
        "missing_contact_info": "redirect_to_form",
        "require_password_on_registration": false,
        "options": {
          "allow_multiple_providers": true,
          "auto_verify_email": true,
          "show_helpful_errors": false,
          "max_providers_per_user": 5,
        },
      },
    },
  },
}
```

| Field                              | Values                                           | Default               | Effect                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `existing_user_no_integration`     | `auto_link`, `require_manual_link`               | `require_manual_link` | When a social email matches an existing user with no integration for this provider. `auto_link` requires `email_verified: true` from the provider. |
| `no_user_account`                  | `allow_registration`, `require_existing_account` | `allow_registration`  | When no matching user exists.                                                                                                                      |
| `missing_contact_info`             | `redirect_to_form`, `reject_login`               | `redirect_to_form`    | When the provider returns neither email nor phone.                                                                                                 |
| `require_password_on_registration` | `true`, `false`                                  | `false`               | Force password setup after social registration.                                                                                                    |
| `allow_multiple_providers`         | `true`, `false`                                  | `true`                | Whether a user can link multiple providers.                                                                                                        |
| `auto_verify_email`                | `true`, `false`                                  | `true`                | Auto-verify the user's email when the provider reports it verified.                                                                                |
| `show_helpful_errors`              | `true`, `false`                                  | `false`               | Include diagnostic hints in error messages. Disable in production.                                                                                 |
| `max_providers_per_user`           | 1–10                                             | 5                     | Cap on linked providers per user.                                                                                                                  |

## Account-linking decision tree

```
Provider returns profile
  │
  ▼
Has email or phone? ── no ──► missing_contact_info → redirect_to_form | reject_login
  │ yes
  ▼
Existing integration (provider + sub)? ── yes ──► update tokens & profile, log in
  │ no
  ▼
User currently logged in? ── yes ──► link to current account (respecting max_providers_per_user)
  │ no
  ▼
Email matches existing user? ── yes ──► existing_user_no_integration
  │                                       │
  │ no                                    ▼
  │                              auto_link (needs email_verified) | require_manual_link
  ▼
no_user_account
  │
  ▼
allow_registration (create user) | require_existing_account (fail)
```

## Route reference

### Auth routes (under `/auth`)

| Method | Path                              | Description                                      |
| ------ | --------------------------------- | ------------------------------------------------ |
| GET    | `/auth/social/:provider/login`    | Initiate social login                            |
| GET    | `/auth/social/:provider/register` | Initiate social registration                     |
| GET    | `/auth/social/:provider/callback` | OAuth callback (single-tenant + Tier 2)          |
| GET    | `/auth/social/:provider/complete` | Tier 1 completion (receives `?ref=` from `_ops`) |
| GET    | `/auth/social-password-setup`     | Set password after social registration           |
| POST   | `/auth/social-password-setup`     | Submit password setup                            |
| GET    | `/auth/social-contact-info`       | Collect missing contact info                     |
| POST   | `/auth/social-contact-info`       | Submit contact info                              |

### OIDC interaction routes (under `{oidcPath}`)

| Method | Path                                   | Description                                   |
| ------ | -------------------------------------- | --------------------------------------------- |
| GET    | `{oidcPath}/social/:provider`          | Initiate social login during OIDC interaction |
| GET    | `{oidcPath}/social/:provider/callback` | OAuth callback during OIDC interaction        |

### `_ops` gateway routes

| Method | Path                         | Description                                                                                                |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/social/:provider/callback` | Receives OAuth callbacks for Tier 1 tenants; stores the code in Redis; redirects to the originating tenant |
| GET    | `/health`                    | Health-check probe                                                                                         |

All social routes are rate-limited via `socialLoginLimiter`. `_ops` routes are guarded by the ops-tenant middleware.

### Redirect URI patterns

| Mode                   | Pattern                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| Single-tenant + Tier 2 | `https://<your-host>/auth/social/{provider}/callback`                          |
| Tier 1 (via `_ops`)    | `https://_ops.{base-domain}/social/{provider}/callback`                        |
| Tier 1 completion      | `https://{tenant_id}.{base-domain}/auth/social/{provider}/complete?ref={uuid}` |

## Security

> **Warning:** Facebook in Tier 1 (via the `_ops` gateway) does NOT set `email_verified: true`. For Tier 1 Facebook deployments, keep `behavior.existing_user_no_integration: require_manual_link` to prevent silent account-linking on unverified emails. In Tier 2 (direct callback), Parako.ID can verify `email_verified` from the Facebook profile and `auto_link` works correctly.

- **PKCE S256** — Every authorization flow uses PKCE S256 via the `openid-client` library.
- **HMAC-signed state** — Tier 1 flows sign the `state` parameter with `security.secrets.hmac_secret`. The state includes `tenant_id`, a random nonce, and a timestamp. State expires after **10 minutes**.
- **Redis ref (2-minute TTL)** — The `_ops` gateway stores the authorization code in Redis with a 2-minute TTL. The originating tenant consumes it atomically via `GETDEL` (Redis 6.2+) to prevent replay.
- **Hardcoded Tier 1 endpoints** — For Tier 1 flows, token and userinfo endpoints are hardcoded per provider (not read from config) to prevent SSRF via tenant configuration.
- **Session regeneration** — After successful social login the session is regenerated; tenant context, locale, and OIDC context are preserved.
- **Rate limiting** — All social login routes are rate-limited.
- **`email_verified` guard** — `auto_link` is gated on `email_verified: true` from the provider, preventing email-takeover via unverified-email accounts.
- **Token encryption at rest** — Provider `access_token` and `refresh_token` values are encrypted with `ENCRYPTION_KEY`.
- **CSRF protection** — POST routes (password setup, contact info) validate CSRF tokens.

## See also

- [Multi-Tenancy](multi-tenancy.md)
- [Configuration](configuration.md)
- [Security](security.md)
- [Authentication](authentication.md)
