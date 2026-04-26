---
title: 'Social Login'
subtitle: 'Federate authentication with Google, GitHub, Microsoft, LinkedIn, and Facebook'
category: 'Authentication & Authorization'
order: 3
---

## Overview

Parako.ID supports OAuth2/OIDC federation with five social identity providers. Users can sign in with their existing accounts from these providers, with configurable account linking behavior and PKCE-secured flows.

| Provider  | Protocol       | Discovery               | Default Scopes               |
| --------- | -------------- | ----------------------- | ---------------------------- |
| Google    | OpenID Connect | OIDC discovery endpoint | `openid`, `profile`, `email` |
| GitHub    | OAuth2         | Manual endpoints        | `user:email`                 |
| Microsoft | OpenID Connect | Azure AD v2.0 discovery | `openid`, `profile`, `email` |
| LinkedIn  | OAuth2         | Manual endpoints        | `openid`, `profile`, `email` |
| Facebook  | OAuth2         | Manual endpoints        | `email`, `public_profile`    |

All providers use PKCE with S256 challenge method on every flow via the `openid-client` library.

## Multi-Tenant Credential Inheritance

In multi-tenant deployments, social login uses a tiered credential model so that tenants can share platform-level OAuth credentials or bring their own.

### How It Works

The platform operator configures social provider credentials once in the global configuration. Tenants then fall into one of two tiers:

- **Tier 1** — Tenant has no `client_id` override for the provider. The OAuth flow uses the platform's credentials and routes the callback through the `_ops` gateway.
- **Tier 2** — Tenant has its own `client_id` (and `client_secret`) for the provider. The OAuth flow goes directly between the tenant and the provider, like single-tenant mode.

A tenant can be Tier 1 for one provider and Tier 2 for another simultaneously.

### Tier Detection Rule

If the tenant's settings override contains a non-empty `features.social_providers.{provider}.client_id`, the tenant is **Tier 2** for that provider. Otherwise it is **Tier 1**.

### Tenant-Overridable Fields

| Field                                                | Effect                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `features.social_providers.enabled`                  | Which providers are active for this tenant |
| `features.social_providers.behavior`                 | Account linking and registration behavior  |
| `features.social_providers.{provider}.client_id`     | Triggers Tier 2 mode for this provider     |
| `features.social_providers.{provider}.client_secret` | Tenant's own secret (encrypted at rest)    |

## How Social Login Works

### Single-Tenant Flow

Standard OAuth2 authorization code flow with PKCE:

```
User              Parako.ID                  Provider
 |                    |                          |
 | /auth/social/:provider/login                  |
 |------------------->|                          |
 |                    | Build auth URL + PKCE    |
 |  302 to provider   |                          |
 |<-------------------|                          |
 |                                               |
 |  Authorize at provider                        |
 |---------------------------------------------->|
 |                                               |
 |  302 ?code=...&state=...                      |
 |<----------------------------------------------|
 |                                               |
 | /auth/social/:provider/callback               |
 |------------------->|                          |
 |                    | Verify state             |
 |                    | Exchange code + PKCE --->|
 |                    |              Tokens <----|
 |                    | Fetch userinfo --------->|
 |                    |             Profile <----|
 |                    | Account linking logic    |
 |  Session created   |                          |
 |<-------------------|                          |
```

### Multi-Tenant Tier 1 (Platform Credentials via `_ops`)

For Tier 1 tenants, the OAuth callback lands on the `_ops` gateway (a special infrastructure tenant), which relays the authorization code to the originating tenant via a short-lived Redis reference.

```
User         Tenant App         _ops Gateway      Provider       Redis
 |               |                   |                |             |
 | /login        |                   |                |             |
 |-------------->|                   |                |             |
 |               | Tier 1 detected   |                |             |
 |               | redirect_uri =    |                |             |
 |               |   _ops.base/social/:provider/callback            |
 |               | state = HMAC(tenant_id, nonce, ts) |             |
 | 302           |                   |                |             |
 |<--------------|                   |                |             |
 |                                                    |             |
 | Authorize at provider                              |             |
 |--------------------------------------------------->|             |
 |                                                    |             |
 | 302 to _ops gateway                                |             |
 |<---------------------------------------------------|             |
 |                                                    |             |
 | _ops/social/:provider/callback                     |             |
 |------------------------------>|                    |             |
 |                               | Verify HMAC state  |             |
 |                               | Store ref (2 min) ------------>|
 | 302 to tenant/auth/social/:provider/complete?ref=uuid           |
 |<------------------------------|                    |             |
 |                                                    |             |
 | /auth/social/:provider/complete?ref=uuid           |             |
 |-------------->|                                    |             |
 |               | GETDEL ref from Redis --------------------------->|
 |               | Verify tenant_id matches           |             |
 |               | Exchange code (platform creds) --->|             |
 |               |                       Tokens <-----|             |
 |               | Fetch userinfo ------------------>|             |
 |               |                      Profile <-----|             |
 |               | Account linking logic              |             |
 | Session       |                                    |             |
 |<--------------|                                    |             |
```

### Multi-Tenant Tier 2 (Tenant-Owned Credentials)

Identical to the single-tenant flow. The tenant uses its own `client_id` and `client_secret`, with `redirect_uri` pointing to the tenant's own callback URL (`{tenant}.{base}/auth/social/{provider}/callback`).

## Enabling Social Providers

### `available` vs `enabled`

- **`available`** — The set of provider names that the system recognizes. Defaults to all five: `["google", "github", "microsoft", "linkedin", "facebook"]`. Providers not in this list are invisible to the application.
- **`enabled`** — The providers that are active for login. Defaults to `[]` (none). A provider must be in `available` **and** have a valid `client_id`/`client_secret` to actually work.

```jsonc
{
  "features": {
    "social_providers": {
      "enabled": ["google", "github"],
      "available": ["google", "github", "microsoft", "linkedin", "facebook"],
    },
  },
}
```

Each provider requires a `client_id` and `client_secret` obtained from the provider's developer console. Secrets are encrypted at rest using your `ENCRYPTION_KEY`.

## Provider Setup Guides

### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. Set application type to **Web application**
6. Add authorized redirect URI: `https://your-parako.example.com/auth/social/google/callback`
7. Copy the Client ID and Client Secret

Configure in Parako.ID:

```jsonc
{
  "features": {
    "social_providers": {
      "google": {
        "client_id": "YOUR_GOOGLE_CLIENT_ID",
        "client_secret": "${GOOGLE_CLIENT_SECRET}",
        "discovery_url": "https://accounts.google.com/.well-known/openid-configuration",
        "scopes": ["openid", "profile", "email"],
      },
    },
  },
}
```

Parako.ID automatically requests `access_type: offline` and `prompt: consent` when initiating the Google flow to obtain refresh tokens. Google Workspace domains are detected via the `hd` claim.

### GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set Homepage URL to your Parako.ID deployment URL
4. Set Authorization callback URL to: `https://your-parako.example.com/auth/social/github/callback`
5. Copy the Client ID, then generate a Client Secret

Configure:

```jsonc
{
  "features": {
    "social_providers": {
      "github": {
        "client_id": "YOUR_GITHUB_CLIENT_ID",
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

GitHub does not provide refresh tokens. Parako.ID fetches the user's primary verified email if it is not public.

### Microsoft

1. Go to [Azure Portal > App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Set a name and select **Accounts in any organizational directory and personal Microsoft accounts**
4. Add redirect URI (Web): `https://your-parako.example.com/auth/social/microsoft/callback`
5. Under **Certificates & secrets**, create a new client secret
6. Copy the Application (client) ID and the secret value

Configure:

```jsonc
{
  "features": {
    "social_providers": {
      "microsoft": {
        "client_id": "YOUR_MICROSOFT_CLIENT_ID",
        "client_secret": "${MICROSOFT_CLIENT_SECRET}",
        "discovery_url": "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
        "scopes": ["openid", "profile", "email"],
      },
    },
  },
}
```

Supports both work/school (Azure AD) and personal Microsoft accounts. Azure AD tenant ID is available via the `tid` claim.

### LinkedIn

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
2. Create a new app
3. Under **Auth**, add redirect URL: `https://your-parako.example.com/auth/social/linkedin/callback`
4. Request the **Sign In with LinkedIn using OpenID Connect** product
5. Copy the Client ID and Client Secret

Configure:

```jsonc
{
  "features": {
    "social_providers": {
      "linkedin": {
        "client_id": "YOUR_LINKEDIN_CLIENT_ID",
        "client_secret": "${LINKEDIN_CLIENT_SECRET}",
        "authorization_endpoint": "https://www.linkedin.com/oauth/v2/authorization",
        "token_endpoint": "https://www.linkedin.com/oauth/v2/accessToken",
        "userinfo_endpoint": "https://api.linkedin.com/v2/userinfo",
        "scopes": ["openid", "profile", "email"],
      },
    },
  },
}
```

### Facebook

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app (Consumer type)
3. Add **Facebook Login** product
4. Under **Settings**, add valid OAuth redirect URI: `https://your-parako.example.com/auth/social/facebook/callback`
5. Copy the App ID and App Secret from **Settings > Basic**

Configure:

```jsonc
{
  "features": {
    "social_providers": {
      "facebook": {
        "client_id": "YOUR_FACEBOOK_APP_ID",
        "client_secret": "${FACEBOOK_APP_SECRET}",
        "authorization_endpoint": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_endpoint": "https://graph.facebook.com/v19.0/oauth/access_token",
        "userinfo_endpoint": "https://graph.facebook.com/me",
        "scopes": ["email", "public_profile"],
      },
    },
  },
}
```

In Tier 2 mode (direct callback), Parako.ID hardcodes `email_verified: true` for Facebook users because Facebook always verifies email addresses before allowing login. In Tier 1 mode (via `_ops` gateway), the profile mapper does **not** set `email_verified` for Facebook — this means `auto_link` will not work for Tier 1 Facebook users unless the behavior is set to `require_manual_link`.

## Behavior Configuration

Control how social login interacts with existing accounts:

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

| Field                              | Values                                           | Default               | Description                                                                                              |
| ---------------------------------- | ------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `existing_user_no_integration`     | `auto_link`, `require_manual_link`               | `require_manual_link` | What happens when a social login email matches an existing user who has no integration for this provider |
| `no_user_account`                  | `allow_registration`, `require_existing_account` | `allow_registration`  | Whether to create a new account when no matching user exists                                             |
| `missing_contact_info`             | `redirect_to_form`, `reject_login`               | `redirect_to_form`    | What happens when the provider doesn't return an email or phone number                                   |
| `require_password_on_registration` | `true`, `false`                                  | `false`               | Whether to require a password when registering via social login                                          |
| `allow_multiple_providers`         | `true`, `false`                                  | `true`                | Whether users can link multiple social providers to one account                                          |
| `auto_verify_email`                | `true`, `false`                                  | `true`                | Auto-verify email from provider when the provider reports it as verified                                 |
| `show_helpful_errors`              | `true`, `false`                                  | `false`               | Show detailed errors including hints (disable in production)                                             |
| `max_providers_per_user`           | 1–10                                             | 5                     | Maximum number of social integrations per user account                                                   |

### Behavior Details

- **`existing_user_no_integration: auto_link`** — Automatically creates a social integration and logs the user in. Only works when the provider reports `email_verified: true`. If `email_verified` is not `true`, the auto-link is blocked and the user is asked to verify their email or link manually. This prevents email takeover attacks.
- **`existing_user_no_integration: require_manual_link`** — Returns an error telling the user to log in first, then link from account settings. With `show_helpful_errors: true`, the error message includes the user's email for context.
- **`no_user_account: allow_registration`** — Creates a new user and redirects to the password setup flow if `require_password_on_registration` is `true`, or the contact info form if the provider didn't return an email.
- **`no_user_account: require_existing_account`** — Rejects the login with a message to create an account first.
- **`missing_contact_info: redirect_to_form`** — Redirects to `/social-contact-info` so the user can provide their email/phone. Only applies during registration flows.
- **`missing_contact_info: reject_login`** — Rejects the login entirely if the provider doesn't return an email or phone.

## Account Linking Decision Tree

When a user completes social authentication, Parako.ID follows this logic to determine what happens next:

```
Provider returns profile
        |
        v
  Has email or phone? ----NO----> Check missing_contact_info
        |                              |                |
       YES                      redirect_to_form   reject_login
        |                        (collect info)      (fail)
        v
  Existing integration
  by provider + sub? -----YES----> Update tokens & profile, log in
        |
       NO
        v
  User already
  logged in? -------------YES----> Link to current user's account
        |                          (check max_providers_per_user,
       NO                           check for duplicates)
        v
  Email matches
  existing user? ---------YES----> Check existing_user_no_integration
        |                              |                   |
       NO                          auto_link         require_manual_link
        |                     (needs email_verified)   (fail + hint)
        v
  Check no_user_account
     |                    |
 allow_registration   require_existing_account
  (create user)        (fail + hint)
```

## Route Reference

### Auth Routes (mounted under `/auth`)

| Method | Path                              | Description                                               |
| ------ | --------------------------------- | --------------------------------------------------------- |
| GET    | `/auth/social/:provider/login`    | Initiate social login flow                                |
| GET    | `/auth/social/:provider/register` | Initiate social registration flow                         |
| GET    | `/auth/social/:provider/callback` | OAuth callback (Tier 2 and single-tenant)                 |
| GET    | `/auth/social/:provider/complete` | Tier 1 completion endpoint (receives `?ref=` from `_ops`) |
| GET    | `/auth/social-password-setup`     | Set password after social registration                    |
| POST   | `/auth/social-password-setup`     | Submit password setup form                                |
| GET    | `/auth/social-contact-info`       | Collect missing contact info                              |
| POST   | `/auth/social-contact-info`       | Submit contact info form                                  |

### OIDC Interaction Routes (mounted under `{oidcPath}`)

| Method | Path                                   | Description                                   |
| ------ | -------------------------------------- | --------------------------------------------- |
| GET    | `{oidcPath}/social/:provider`          | Initiate social login during OIDC interaction |
| GET    | `{oidcPath}/social/:provider/callback` | OAuth callback during OIDC interaction        |

### `_ops` Gateway Routes

| Method | Path                         | Description                                                                                        |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/social/:provider/callback` | Receives OAuth callbacks for Tier 1 tenants, stores code in Redis, redirects to originating tenant |
| GET    | `/health`                    | Health check probe                                                                                 |

All social routes are rate-limited via `socialLoginLimiter`. The `_ops` routes are guarded by `OpsTenantMiddleware`.

## Security

- **PKCE S256** — All five providers use PKCE with S256 challenge method on every authorization flow via the `openid-client` library.
- **HMAC-signed state** — Tier 1 flows sign the OAuth `state` parameter with HMAC (using `security.secrets.hmac_secret`). The state includes `tenant_id`, a random nonce, and a timestamp. State tokens expire after **10 minutes**.
- **Redis ref (2-minute TTL)** — The `_ops` gateway stores the authorization code in Redis with a 2-minute TTL. The originating tenant consumes it atomically via `GETDEL` (Redis 6.2+) to prevent replay attacks.
- **Hardcoded Tier 1 endpoints** — For Tier 1 flows, token and userinfo endpoints are hardcoded per provider (not read from config) to prevent SSRF via compromised tenant configuration.
- **Session regeneration** — After successful social login, the session is regenerated to prevent session fixation. All session data (tenant context, locale, OIDC context) is preserved.
- **Rate limiting** — All social login routes are rate-limited to prevent brute-force and abuse.
- **`email_verified` guard** — The `auto_link` behavior only links accounts when the provider reports `email_verified: true`, preventing email takeover attacks.
- **Token encryption at rest** — Provider tokens (`access_token`, `refresh_token`) are encrypted at rest using the `ENCRYPTION_KEY`.
- **CSRF protection** — POST routes (password setup, contact info) validate CSRF tokens.

## Redirect URI Format

The redirect URI for each provider follows this pattern:

**Single-tenant and Tier 2:**

```
https://your-parako.example.com/auth/social/{provider}/callback
```

**Tier 1 (via `_ops` gateway):**

```
https://_ops.{baseDomain}/social/{provider}/callback
```

Where `{provider}` is one of: `google`, `github`, `microsoft`, `linkedin`, `facebook`.

After the `_ops` gateway receives the callback, it redirects back to:

```
https://{tenant_id}.{baseDomain}/auth/social/{provider}/complete?ref={uuid}
```
