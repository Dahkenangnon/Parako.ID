---
title: 'Configuration'
subtitle: 'Complete reference for the multi-source configuration system'
category: 'Architecture'
order: 1
---

Parako.ID uses a multi-source configuration system that loads settings from environment variables, config files, and the database. This document is the definitive reference for every aspect of the configuration lifecycle.

## Configuration Hierarchy

Configuration is assembled from three sources, merged in priority order:

```
┌─────────────────────────────────────┐
│  1. Bootstrap (.env)                │  ← Always loaded first
│     Infrastructure fields           │     Cannot be changed at runtime
├─────────────────────────────────────┤
│  2a. File (parako.yaml / .jsonc)    │  ← Development only
│      OR                             │     USE_FILE_CONFIG=true
│  2b. Database (settings table)      │  ← Production default
│      Single source of truth         │     Managed via admin panel or API
├─────────────────────────────────────┤
│  3. Computed Fields                 │  ← Auto-generated secrets
│     Derived values (OIDC issuer,    │     Always recomputed on load
│     MFA settings, integration URLs) │
├─────────────────────────────────────┤
│  4. DEFAULT_FULL_CONFIG             │  ← Fallback defaults
│     Lowest priority                 │     For any unset fields
└─────────────────────────────────────┘
```

| Priority    | Source                                 | When used                                                                               |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| 1 (highest) | Bootstrap (`.env`)                     | Always — minimal config to start the application                                        |
| 2           | File (`parako.yaml` or `parako.jsonc`) | Development only — when `USE_FILE_CONFIG=true` AND `DEPLOYMENT_ENVIRONMENT=development` |
| 3           | Database (`settings` table/collection) | Production — stored and managed via admin panel                                         |
| 4           | Computed fields                        | Always — auto-generated secrets and derived values                                      |
| 5 (lowest)  | `DEFAULT_FULL_CONFIG`                  | Always — fallback for any missing fields                                                |

Bootstrap fields always win for infrastructure settings. File config is a development convenience — in production, the database is the single source of truth.

All configuration is validated against Zod schemas at startup. Invalid configuration causes the application to fail fast with descriptive error messages.

---

## Bootstrap Environment Variables

These variables are set in your `.env` file. Bootstrap fields cannot be changed at runtime via the admin panel — they require a restart.

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

### Core Settings

| Variable                 | Type   | Default                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_ENVIRONMENT` | enum   | `development`               | `development`, `staging`, or `production`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `DEPLOYMENT_SERVER_PORT` | number | `9007`                      | Server port (1–65535)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `DEPLOYMENT_URL`         | string | —                           | Public URL of your deployment (e.g., `https://auth.example.com`). Used to derive `oidc.issuer`, discovery URLs, and integration URLs (see [Computed Fields](#computed-fields)). In multi-tenant mode, tenant URLs are derived as `https://{tenant}.{base_domain}` (e.g., `https://acme.auth.example.com`). Optional — if unset, falls back to `deployment.url` from the database or file config (default: `http://localhost:9007`). Read-only in admin panel. |
| `STORAGE_ADAPTER`        | enum   | `sqlite`                    | Primary database: `sqlite`, `mongodb`, or `postgresql`                                                                                                                                                                                                                                                                                                                                                                                                        |
| `OIDC_STORAGE_ADAPTER`   | enum   | _(same as STORAGE_ADAPTER)_ | OIDC token and session storage: `sqlite`, `mongodb`, `redis`, or `postgresql`                                                                                                                                                                                                                                                                                                                                                                                 |

### Database Connection

| Variable                     | Required when                | Default             | Description                                                                                    |
| ---------------------------- | ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `STORAGE_MONGODB_URI`        | `STORAGE_ADAPTER=mongodb`    | —                   | MongoDB connection URI                                                                         |
| `STORAGE_SQLITE_PATH`        | `STORAGE_ADAPTER=sqlite`     | `./data/parako.db`  | Path to SQLite database file                                                                   |
| `STORAGE_POSTGRESQL_URL`     | `STORAGE_ADAPTER=postgresql` | —                   | PostgreSQL connection URL                                                                      |
| `PG_SSL_REJECT_UNAUTHORIZED` | `STORAGE_ADAPTER=postgresql` | `true` (production) | Set to `false` for self-signed certificates                                                    |
| `DATABASE_URL`               | _(Prisma CLI only)_          | —                   | Used by Prisma CLI commands (`db:push`, `db:migrate`). Not read by the application at runtime. |

### Redis

| Variable         | Type   | Default     | Description               |
| ---------------- | ------ | ----------- | ------------------------- |
| `REDIS_HOST`     | string | `localhost` | Redis host                |
| `REDIS_PORT`     | number | `6379`      | Redis port                |
| `REDIS_PASSWORD` | string | —           | Redis password (optional) |
| `REDIS_DATABASE` | number | `0`         | Redis database index      |

Redis is used for OIDC session storage (when `OIDC_STORAGE_ADAPTER=redis`), pub/sub for cross-process config invalidation, and caching.

### Multi-Tenancy

| Variable                                          | Type    | Default            | Description                                                                                  |
| ------------------------------------------------- | ------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `MULTI_TENANCY_ENABLED`                           | boolean | `false`            | Enable multi-tenant mode. SQLite does not support multi-tenancy — use MongoDB or PostgreSQL. |
| `MULTI_TENANCY_EXTRACTION_PRIORITY`               | string  | `header,subdomain` | Comma-separated tenant extraction strategies. Valid values: `header`, `subdomain`            |
| `MULTI_TENANCY_TENANT_HEADER`                     | string  | `x-tenant-id`      | HTTP header for tenant identification (when `header` strategy is active)                     |
| `MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE`            | number  | `50`               | Max OIDC provider instances in pool                                                          |
| `MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS`         | number  | `1800000`          | Provider idle timeout (30 min)                                                               |
| `MULTI_TENANCY_PROVIDER_POOL_CLEANUP_INTERVAL_MS` | number  | `60000`            | Pool cleanup interval (1 min)                                                                |

### Encryption

| Variable         | Type   | Description                                                                                                                                           |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY` | string | 64-character hex key (32 bytes) for encrypting secrets at rest. **Critical: back up this key — losing it means losing access to all encrypted data.** |

Generate with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Logging

| Variable                                  | Type    | Default | Description                                          |
| ----------------------------------------- | ------- | ------- | ---------------------------------------------------- |
| `SECURITY_LOGGING_ENABLED`                | boolean | `true`  | Enable application logging                           |
| `SECURITY_LOGGING_LEVEL`                  | enum    | `info`  | `trace`, `debug`, `info`, `warn`, `error`, `fatal`   |
| `SECURITY_LOGGING_PRETTY_PRINT`           | boolean | `true`  | Pretty-print logs (recommended for development only) |
| `SECURITY_LOGGING_FILE_LOGGING_ENABLED`   | boolean | `true`  | Write logs to files                                  |
| `SECURITY_LOGGING_FILE_LOGGING_DIRECTORY` | string  | `logs`  | Log file directory                                   |

### Secrets

These secrets are referenced in file configuration via `${VAR}` interpolation. When using database configuration, they are auto-generated at startup if not set (development only — production requires them to be explicitly configured).

| Variable          | Min Length | Description                                |
| ----------------- | ---------- | ------------------------------------------ |
| `JWT_SECRET`      | 32         | JWT signing secret                         |
| `COOKIE_SECRET_1` | 32         | Primary cookie encryption secret           |
| `COOKIE_SECRET_2` | 32         | Secondary cookie encryption secret         |
| `HMAC_SECRET`     | 32         | Cross-tenant OAuth state signing           |
| `PAIRWISE_SALT`   | —          | Salt for OIDC pairwise subject identifiers |
| `SMTP_PASSWORD`   | —          | SMTP server password                       |

> **Production behavior:** Missing secrets (`JWT_SECRET`, `COOKIE_SECRET_1`, `COOKIE_SECRET_2`, `HMAC_SECRET`, `PAIRWISE_SALT`) cause a **fatal startup error** in production via `resolveSecret()`. You must set them explicitly. In development, they are auto-generated with a warning.

### External Services

| Variable                 | Description                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `IPINFO_API_TOKEN`       | [ipinfo.io](https://ipinfo.io/) API token for IP geolocation. Can also be set via admin panel.                |
| `IPQUALITYSCORE_API_KEY` | [IPQualityScore](https://www.ipqualityscore.com/) API key for IP reputation. Can also be set via admin panel. |

### Development

| Variable          | Type    | Default | Description                                                                                                                                                                                           |
| ----------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USE_FILE_CONFIG` | boolean | `true`  | Load config from file instead of database. **Only effective when `DEPLOYMENT_ENVIRONMENT=development`.** In staging or production, this variable is ignored and the database provider is always used. |

---

## File Configuration (Development)

For local development, you can manage the full configuration in a single file instead of the database. This is the default setup when you first clone the repository.

**Requirements:** `USE_FILE_CONFIG=true` in `.env` AND `DEPLOYMENT_ENVIRONMENT=development`.

Parako.ID searches for config files in this order:

1. `parako.yaml`
2. `parako.yml`
3. `parako.jsonc`
4. `parako.json`

Sample files are provided in the repository root:

```bash
# YAML format (recommended)
cp parako.sample.yaml parako.yaml

# Or JSONC format
cp parako.sample.jsonc parako.jsonc
```

### Partial Overrides

You only need to provide the keys you want to override. Missing keys fall back to `DEFAULT_FULL_CONFIG` defaults. For example, to only customize branding:

```yaml
branding:
  companyName: My Company
  logo: /images/my-logo.svg
```

All other sections (security, features, oidc, etc.) use their defaults.

### Secret Interpolation

Reference environment variables in your config file with `${VAR}` syntax:

```yaml
security:
  secrets:
    jwt_secret: ${JWT_SECRET}
    cookie_secrets:
      - ${COOKIE_SECRET_1}
      - ${COOKIE_SECRET_2}
    hmac_secret: ${HMAC_SECRET}
```

Default values are supported with `${VAR:-default}` syntax:

```yaml
features:
  social_providers:
    google:
      client_id: ${GOOGLE_CLIENT_ID:-your-google-client-id}
```

### File Config Limitations

- **Read-only at runtime** — changes require restarting the development server.
- **Not supported in production** — even if `USE_FILE_CONFIG=true`, it is ignored when `DEPLOYMENT_ENVIRONMENT` is `staging` or `production`.
- **No version history** — unlike database config, file config has no rollback capability.
- **No admin panel editing** — the admin panel shows a warning banner when file config is active, and changes made there will not persist.

---

## Database Configuration (Production)

In production, configuration is stored in the database `settings` table (or collection, when using MongoDB) under the key `parako_config`. This works with all supported storage adapters — MongoDB, SQLite, and PostgreSQL. The database is the single source of truth for all non-bootstrap settings.

### Initial Flush

On first startup, if no configuration exists in the database, `DEFAULT_FULL_CONFIG` is automatically flushed to the database. This ensures the database always has a complete configuration document.

### Managing Configuration

**Admin Panel** — navigate to `/admin/settings` to view and edit all configuration sections. See [Admin Panel](admin-panel.md) for details.

**Management API** — use the `parako:config:read` and `parako:config:write` scopes to manage configuration programmatically. See [Management API](api/overview.md) for endpoint details.

### Immediate Effect

Changes made via the admin panel or API take effect immediately — no server restart is required for most settings. The exceptions are settings that require OIDC provider re-initialization (see impact analysis warnings in the admin panel).

---

## Configuration Sections Reference

The full configuration is organized into 9 top-level sections. For the complete schema with all fields and defaults, see `parako.sample.yaml` in the repository root.

### `application`

Core identity and metadata.

| Field               | Type     | Default                                    | Description                   |
| ------------------- | -------- | ------------------------------------------ | ----------------------------- |
| `title`             | string   | `Parako.ID`                                | Application title shown in UI |
| `description`       | string   | _(from package.json)_                      | Application description       |
| `locales.default`   | string   | `en`                                       | Default locale                |
| `locales.available` | string[] | `[en, fr, es, pt, de, it, ru, zh, ja, ko]` | Available locales             |

### `branding`

UI appearance and theming. See [Branding](branding.md) for full customization guide.

| Field                               | Type   | Default                   | Description                                 |
| ----------------------------------- | ------ | ------------------------- | ------------------------------------------- |
| `companyName`                       | string | `Your Organization`       | Company name (also used as MFA issuer name) |
| `logo` / `logoDark`                 | string | `/images/logo-*.svg`      | Logo paths for light/dark mode              |
| `logoIcon` / `logoIconDark`         | string | `/images/logo-icon-*.svg` | Icon logo paths                             |
| `favicon`                           | string | `/favicon.svg`            | Favicon path                                |
| `fonts.sans` / `.heading` / `.mono` | string | System fonts              | Font family stacks                          |
| `colors.light.*` / `colors.dark.*`  | string | _(33 tokens each)_        | Theme color hex values                      |
| `ui.customization`                  | object | `{enabled: false}`        | Custom Nunjucks view template overrides     |

### `deployment`

Environment and infrastructure. Several fields are [bootstrap-only](#bootstrap-only-fields).

| Field                    | Type    | Default                 | Description                                          |
| ------------------------ | ------- | ----------------------- | ---------------------------------------------------- |
| `url`                    | string  | `http://localhost:9007` | Public URL _(bootstrap-only)_                        |
| `server.allowed_origins` | string  | `*`                     | CORS allowed origins                                 |
| `server.proxy`           | boolean | `false`                 | Trust proxy headers                                  |
| `redis_prefix`           | string  | `parako`                | Redis key namespace prefix                           |
| `cookies`                | object  | _(see sample)_          | Cookie configuration (session, locale, theme)        |
| `routes`                 | object  | _(see sample)_          | Route path customization (auth, accounts, API, home) |

### `security`

Security settings and authentication policies.

| Field                                      | Type     | Default                            | Description                                           |
| ------------------------------------------ | -------- | ---------------------------------- | ----------------------------------------------------- |
| `secrets.jwt_secret`                       | string   | _(auto-generated)_                 | JWT signing secret (min 32 chars)                     |
| `secrets.cookie_secrets`                   | string[] | _(auto-generated)_                 | Cookie encryption secrets (2 required)                |
| `secrets.hmac_secret`                      | string   | _(auto-generated)_                 | HMAC signing secret                                   |
| `protection.rate_limiting`                 | object   | `{enabled: true, 100/15min}`       | Rate limiting configuration                           |
| `protection.device_matching`               | object   | _(see sample)_                     | Device fingerprint matching thresholds                |
| `key_store`                                | object   | `{type: "database", 90d rotation}` | JWKS key store configuration                          |
| `authentication.multi_factor`              | object   | _(see sample)_                     | MFA settings (TOTP, email, SMS, WebAuthn)             |
| `authentication.session`                   | object   | _(see sample)_                     | Session binding, timeouts, limits                     |
| `authentication.login`                     | object   | _(see sample)_                     | Login methods, password policy                        |
| `authentication.signup`                    | object   | _(see sample)_                     | Signup methods, email verification, auto-approval     |
| `authentication.roles`                     | object   | `{default: "user"}`                | Available roles and default role                      |
| `authentication.recovery`                  | object   | _(see sample)_                     | Account recovery (backup codes, secondary email, SMS) |
| `authentication.password_breach_detection` | object   | `{enabled: true}`                  | HaveIBeenPwned breach checking                        |

### `features`

Feature toggles and capabilities.

| Field                         | Type     | Default                                           | Description                                                                                                        |
| ----------------------------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `oidc.*`                      | object   | _(see sample)_                                    | OIDC feature toggles: device flow, PKCE, introspection, revocation, backchannel logout, dynamic registration, etc. |
| `social_providers.enabled`    | string[] | `[]`                                              | Active social login providers                                                                                      |
| `social_providers.available`  | string[] | `[google, github, microsoft, linkedin, facebook]` | Supported providers                                                                                                |
| `social_providers.behavior`   | object   | _(see sample)_                                    | Social login behavior (new user handling, manual linking)                                                          |
| `social_providers.<provider>` | object   | _(see sample)_                                    | Per-provider OAuth credentials and endpoints                                                                       |
| `metrics`                     | object   | `{enabled: false}`                                | Prometheus metrics endpoint                                                                                        |
| `multi_tenancy`               | object   | `{enabled: false}`                                | Multi-tenancy settings _(infrastructure fields are bootstrap-only)_                                                |

### `oidc`

OIDC protocol configuration.

| Field                   | Type   | Default            | Description                                                            |
| ----------------------- | ------ | ------------------ | ---------------------------------------------------------------------- |
| `issuer`                | string | _(computed)_       | OIDC issuer URL — always computed from `deployment.url` + `oidc.path`  |
| `path`                  | string | `/oidc/v1`         | OIDC provider base path                                                |
| `routes`                | object | _(see sample)_     | OIDC endpoint paths (authorize, token, userinfo, etc.)                 |
| `secrets.pairwise_salt` | string | _(auto-generated)_ | Salt for pairwise subject identifiers                                  |
| `token_ttl`             | object | _(see sample)_     | Token TTLs in seconds (access_token: 3600, refresh_token: 86400, etc.) |
| `discovery`             | object | _(see sample)_     | OIDC discovery document metadata                                       |
| `jwa`                   | object | _(see sample)_     | JWA algorithm configuration                                            |

### `oidc_storage`

**Computed from bootstrap — never persisted.** This section is built entirely from bootstrap environment variables (`STORAGE_ADAPTER`, `OIDC_STORAGE_ADAPTER`, `REDIS_*`, `STORAGE_MONGODB_URI`) at runtime. It cannot be set via file config or admin panel.

| Field                                                           | Type   | Source                                      |
| --------------------------------------------------------------- | ------ | ------------------------------------------- |
| `oidc_adapter.type`                                             | enum   | `OIDC_STORAGE_ADAPTER` or `STORAGE_ADAPTER` |
| `oidc_adapter.mongodb.uri` / `.database`                        | string | Extracted from `STORAGE_MONGODB_URI`        |
| `oidc_adapter.redis.host` / `.port` / `.password` / `.database` | mixed  | From `REDIS_*` env vars                     |

### `integrations`

External service connections.

| Field                                                                            | Type   | Default                          | Description                |
| -------------------------------------------------------------------------------- | ------ | -------------------------------- | -------------------------- |
| `email.smtp_host` / `.smtp_port` / `.smtp_username` / `.smtp_password` / `.from` | mixed  | _(placeholder)_                  | SMTP configuration         |
| `urls.website` / `.privacy_policy` / `.terms_of_service` / `.contact`            | string | _(computed from deployment.url)_ | Public URLs                |
| `ipinfo`                                                                         | object | `{enabled: false}`               | IP geolocation service     |
| `ipqualityscore`                                                                 | object | `{enabled: false}`               | IP reputation service      |
| `fingerprintjs`                                                                  | object | `{enabled: false}`               | Browser fingerprinting     |
| `file_storage`                                                                   | object | `{provider: "local"}`            | File storage (local or S3) |

### `notifications`

Notification channels and preferences.

| Field                             | Type    | Default            | Description                                                                         |
| --------------------------------- | ------- | ------------------ | ----------------------------------------------------------------------------------- |
| `channels.email.enabled`          | boolean | `true`             | Email notifications                                                                 |
| `channels.sms`                    | object  | `{enabled: false}` | SMS notifications (Twilio: provider, api_key, api_secret, from_number, rate_limits) |
| `defaults.security_alerts`        | boolean | `true`             | Security alert notifications                                                        |
| `defaults.new_session_alerts`     | boolean | `true`             | New session login alerts                                                            |
| `defaults.allow_user_preferences` | boolean | `true`             | Let users customize notification preferences                                        |

---

## Computed Fields

Computed fields are automatically generated or derived from other configuration values. They are managed by `src/config/computed-fields.ts` and applied on every config load and update.

### Auto-Generated Secrets

These secrets are generated once if their value is `null` or `undefined`, then persisted. They are **not** regenerated if the value is an empty string (which indicates data corruption — delete the field to trigger regeneration).

| Field Path                        | Length                     | Description                |
| --------------------------------- | -------------------------- | -------------------------- |
| `security.secrets.jwt_secret`     | 128 hex chars (64 bytes)   | JWT signing key            |
| `security.secrets.cookie_secrets` | Array of 2 × 128 hex chars | Cookie encryption keys     |
| `security.secrets.hmac_secret`    | 128 hex chars (64 bytes)   | HMAC signing key           |
| `oidc.secrets.pairwise_salt`      | 64 hex chars (32 bytes)    | OIDC pairwise subject salt |

> **Production:** If any of these secrets are missing at startup, `resolveSecret()` in `DEFAULT_FULL_CONFIG` throws a fatal error. Auto-generation only works in development.

### Derived Fields

These fields are **always recomputed** on every config load or update. They cannot be manually set — any value you provide will be overwritten.

| Derived Field                                           | Computed From                                   |
| ------------------------------------------------------- | ----------------------------------------------- |
| `oidc.issuer`                                           | `deployment.url` + `oidc.path`                  |
| `oidc.discovery.op_policy_uri`                          | `deployment.url` + `/privacy` _(only if empty)_ |
| `oidc.discovery.op_tos_uri`                             | `deployment.url` + `/terms` _(only if empty)_   |
| `oidc.discovery.service_documentation`                  | `deployment.url` + `/docs` _(only if empty)_    |
| `security.authentication.multi_factor.totp.issuer_name` | `branding.companyName`                          |
| `security.authentication.multi_factor.webauthn.rp_name` | `branding.companyName`                          |
| `security.authentication.multi_factor.webauthn.rp_id`   | Hostname from `deployment.url`                  |
| `integrations.urls.website`                             | `deployment.url` _(only if empty)_              |
| `integrations.urls.privacy_policy`                      | `deployment.url` + `/privacy` _(only if empty)_ |
| `integrations.urls.terms_of_service`                    | `deployment.url` + `/terms` _(only if empty)_   |
| `integrations.urls.contact`                             | `deployment.url` + `/contact` _(only if empty)_ |

### Tenant-Aware URL Derivation

In multi-tenant mode, when computing derived fields within a tenant context, URLs use the tenant's domain instead of the platform URL:

1. **Custom domain** (if `tenant_domain` is set): `https://{tenant_domain}`
2. **Subdomain**: `https://{tenantId}.{base_domain}` (preserves port if present)
3. **Fallback**: platform `deployment.url`

For WebAuthn `rp_id`, custom domain tenants use the custom domain as the relying party ID, while subdomain tenants use the base domain (since `rp_id` must be an ancestor of the origin).

---

## Runtime Resolution

### Single-Tenant Mode

```
1. .env (bootstrap)           ← highest priority
2. Database or file config
3. Computed defaults
4. DEFAULT_FULL_CONFIG         ← lowest priority
```

### Multi-Tenant Mode

```
1. .env (bootstrap)                           ← highest priority
2. Per-tenant overrides (tenant_settings_override collection)
3. Platform config (global from database)
4. Computed defaults (tenant-aware)
5. DEFAULT_FULL_CONFIG                        ← lowest priority
```

### How `getConfig()` Works

`ConfigManager.getConfig()` checks `features.multi_tenancy.enabled`:

- **If enabled:** looks up the current tenant via `tenantContext.getTenantIdSafe()`, returns the tenant-specific cached config if available, otherwise falls back to the platform config.
- **If disabled:** returns the cached platform config directly.

Tenant configs are loaded on demand via `ensureTenantConfig()` and cached in memory. Concurrent requests for the same uncached tenant coalesce on a single Promise (mutex pattern) to avoid duplicate database loads.

---

## Bootstrap-Only Fields

These 12 fields can **only** be set via `.env`. They are stripped from any database or file config before persisting, and shown as read-only in the admin panel.

| #   | Field Path                                                 | Set By                                            |
| --- | ---------------------------------------------------------- | ------------------------------------------------- |
| 1   | `deployment.environment`                                   | `DEPLOYMENT_ENVIRONMENT`                          |
| 2   | `deployment.url`                                           | `DEPLOYMENT_URL`                                  |
| 3   | `deployment.server.port`                                   | `DEPLOYMENT_SERVER_PORT`                          |
| 4   | `storage.adapter`                                          | `STORAGE_ADAPTER`                                 |
| 5   | `storage.mongodb.uri`                                      | `STORAGE_MONGODB_URI`                             |
| 6   | `storage.sqlite.path`                                      | `STORAGE_SQLITE_PATH`                             |
| 7   | `storage.postgresql.url`                                   | `STORAGE_POSTGRESQL_URL`                          |
| 8   | `features.multi_tenancy.extraction_priority`               | `MULTI_TENANCY_EXTRACTION_PRIORITY`               |
| 9   | `features.multi_tenancy.tenant_header`                     | `MULTI_TENANCY_TENANT_HEADER`                     |
| 10  | `features.multi_tenancy.provider_pool.max_size`            | `MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE`            |
| 11  | `features.multi_tenancy.provider_pool.idle_ttl_ms`         | `MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS`         |
| 12  | `features.multi_tenancy.provider_pool.cleanup_interval_ms` | `MULTI_TENANCY_PROVIDER_POOL_CLEANUP_INTERVAL_MS` |

> **Note:** `features.multi_tenancy.enabled` is not in this list, but is effectively bootstrap-only — `createRuntimeConfig()` always overrides it from `bootstrapConfig.multiTenancy.enabled` regardless of the database value.

---

## Sensitive Fields and Encryption

14 configuration field paths contain secrets that are encrypted at rest using `ENCRYPTION_KEY`:

| #   | Field Path                                          |
| --- | --------------------------------------------------- |
| 1   | `security.secrets.jwt_secret`                       |
| 2   | `security.secrets.cookie_secrets`                   |
| 3   | `integrations.email.smtp_password`                  |
| 4   | `integrations.ipinfo.api_token`                     |
| 5   | `integrations.ipqualityscore.api_key`               |
| 6   | `integrations.fingerprintjs.api_key`                |
| 7   | `notifications.channels.sms.api_key`                |
| 8   | `notifications.channels.sms.api_secret`             |
| 9   | `features.social_providers.google.client_secret`    |
| 10  | `features.social_providers.github.client_secret`    |
| 11  | `features.social_providers.microsoft.client_secret` |
| 12  | `features.social_providers.linkedin.client_secret`  |
| 13  | `features.social_providers.facebook.client_secret`  |
| 14  | `oidc.secrets.pairwise_salt`                        |

**Behavior:**

- **Encrypted on save** — `SettingsService.encryptSensitiveFields()` encrypts before writing to the database.
- **Decrypted on load** — `SettingsService.decryptSensitiveFields()` decrypts when reading from the database.
- **Masked in admin UI** — displayed as `•••••••` in settings forms.
- **Reveal rate-limited** — 10 reveals per minute per user, activity-logged for audit.

If `ENCRYPTION_KEY` is missing, the application refuses to save or load configuration. If the key is wrong (e.g., after rotation without re-encrypting), decryption fails and the application logs an error.

---

## Admin Panel Settings

The admin panel at `/admin/settings` provides a web interface for managing all configuration sections. See [Admin Panel](admin-panel.md) for the full UI guide.

### Features

- **Section editors** — dedicated forms for each config section: application, branding, deployment, security, OIDC, features, integrations, notifications.
- **Version history** — view and rollback to previous configuration versions.
- **Health check** — configuration validation status.
- **Import/Export** — download or upload configuration as JSON.
- **Impact analysis** — warnings about the effects of changes (e.g., "changing OIDC issuer invalidates all tokens").

### File Config Warning

When `USE_FILE_CONFIG=true` is active, the admin panel displays a warning banner indicating that changes will not persist — the file is the source of truth in that mode.

---

## Version History and Rollback

Every configuration save creates a **new document** rather than updating in place. This provides a complete audit trail and safe rollback.

### How It Works

1. **Atomic save** — existing active document is deactivated, then the new version is inserted (2-phase: deactivate old → insert new).
2. **Semver versioning** — each save increments the patch version: `1.0.0` → `1.0.1` → `1.0.2`.
3. **Automatic cleanup** — only the last 10 versions are kept. Older versions are deleted by `cleanupOldVersions()`.
4. **Optimistic locking** — the `_version` counter prevents concurrent modification conflicts. If another user saves between your load and save, you get: _"Configuration was modified by another user. Please refresh the page and try again."_
5. **Mutex** — `configUpdateLock` serializes concurrent save operations within the same process.

### Rollback Flow

1. Open **Version History** in the admin panel.
2. Select a previous version to inspect.
3. Click **Restore** — this creates a _new_ version with the old config values (not a destructive revert).

### Metadata

Each version stores:

- `last_modified_by` — user who made the change
- `change_reason` — description of why the change was made
- `tags` — categorization labels (e.g., `["main", "configuration"]`)
- `environment` — deployment environment at time of save

---

## Change Propagation

When configuration changes in the database, all running processes must be notified. Parako.ID uses a multi-layer strategy:

### MongoDB Change Streams

If the MongoDB deployment supports Change Streams (replica set or sharded cluster), the `DatabaseConfigProvider` watches the `settings` collection for real-time change detection. This is the preferred method.

### Polling Fallback

If Change Streams are unavailable (standalone MongoDB, or when using SQLite/PostgreSQL), the provider polls the database every **30 seconds** to check for changes by comparing `updated_at` timestamps. This is the default for SQLite and PostgreSQL deployments.

### Redis Pub/Sub

When a configuration update occurs, `ConfigManager` publishes an invalidation message to:

```
{redis_prefix}:*:config:invalidated
```

All other processes subscribe to this pattern and react by:

1. Clearing their in-memory config cache
2. Clearing all tenant config caches
3. Reloading config from the database

This ensures cross-process consistency even in clustered deployments.

### In-Memory Caching

- **Full config cache** — the complete `RuntimeConfig` is cached in memory after load.
- **Section cache** — individual sections are lazily cached with a **60-second TTL**.
- **Tenant config cache** — per-tenant merged configs are cached and invalidated on global config change.
- **Cache invalidation** — all caches are cleared when a change is detected (via Change Streams for MongoDB replica sets, polling for all other setups, or Redis Pub/Sub).

### Propagation Flow

```
Admin saves config
  → SettingsService encrypts + saves new version
  → DatabaseConfigProvider detects change (Change Stream, or poll for SQLite/PG)
  → ConfigManager rebuilds RuntimeConfig
  → Section cache cleared
  → Tenant config caches cleared
  → Redis Pub/Sub publishes invalidation
  → Other processes receive message
  → Each process reloads config from database
```

---

## Tenant Configuration Overrides

In multi-tenant mode, individual tenants can override a subset of the platform configuration. Overrides are stored in the `tenant_settings_override` table (or collection in MongoDB), scoped per tenant. See [Multi-Tenancy](multi-tenancy.md) for the overall tenant architecture.

### Allowed Override Sections

Tenants can override fields in these sections:

`application`, `branding`, `security`, `features`, `oidc`, `integrations`, `notifications`

Tenants **cannot** override: `deployment`, `storage`, `oidc_storage`.

### Field-Level Whitelist

Only fields listed in `ALLOWED_TENANT_FIELDS` (~140 fields) are accepted. Any other path is silently stripped. This prevents tenants from modifying infrastructure or security-critical settings not intended for their scope.

### Floor Constraints

The platform can set minimums that tenants cannot lower:

- **Boolean floors** — if the platform enables a security feature (e.g., MFA, email verification, session binding), tenants cannot disable it.
- **Numeric floors** — tenant values must be ≥ platform values (e.g., `min_password_length`, `min_confidence_score`).
- **Absolute minimum** — password length cannot go below **8** regardless of platform setting (NIST SP 800-63B).
- **Ordered enum** — WebAuthn `user_verification` uses ordered values (`discouraged` < `preferred` < `required`). Tenants cannot weaken below the platform level.

### Ceiling Constraints

Tenants cannot exceed platform limits:

- Token TTLs (all 10 types), session timeouts, rate limits, SMS rate limits, max credentials per user, trust duration.
- **Zero means unlimited** — for `max_concurrent_sessions`, `idle_timeout_minutes`, and `absolute_timeout_hours`, a value of `0` means unlimited. If the platform sets a limit (non-zero), tenants cannot set `0` (unlimited).

### Constraint Enforcement

Violations are **silently adjusted** (not rejected). The adjusted value is used, and a `ConstraintViolation` is logged for audit purposes with the original and adjusted values.

### Tenant-Sensitive Fields

8 field paths are encrypted separately per tenant when stored in override documents:

- `integrations.email.smtp_password`
- `notifications.channels.sms.api_key`
- `notifications.channels.sms.api_secret`
- `features.social_providers.google.client_secret`
- `features.social_providers.github.client_secret`
- `features.social_providers.microsoft.client_secret`
- `features.social_providers.linkedin.client_secret`
- `features.social_providers.facebook.client_secret`

---

## Validation Rules

All configuration is validated against Zod schemas at startup and on every update. Invalid configuration causes a fail-fast with descriptive error messages.

Key validation rules:

- **Secrets** (JWT, HMAC, cookie) — must be at least 32 characters.
- **Port** — must be between 1 and 65535.
- **Routes** — must start with `/` and be at least 2 characters.
- **Colors** — must be valid 3 or 6-digit hex codes (e.g., `#fff` or `#2563eb`).
- **Redis prefix** — allows only alphanumeric characters, hyphens, and underscores.
- **Application URL** — must be a valid URL format.
- **ENCRYPTION_KEY** — must be 64 hex characters (32 bytes) or 44 base64 characters.

If you see validation errors at startup, check the error message for the specific field and constraint that failed.

---

## Generating Secrets

Generate all required secrets before your first deployment:

```bash
# Encryption key (required — 64 hex characters)
export ENCRYPTION_KEY=$(openssl rand -hex 32)

# JWT secret (min 32 characters)
export JWT_SECRET=$(openssl rand -hex 32)

# Cookie secrets (two required)
export COOKIE_SECRET_1=$(openssl rand -hex 32)
export COOKIE_SECRET_2=$(openssl rand -hex 32)

# HMAC secret (for cross-tenant OAuth state signing)
export HMAC_SECRET=$(openssl rand -hex 32)

# Pairwise salt (for OIDC pairwise subject types)
export PAIRWISE_SALT=$(openssl rand -hex 16)
```

Store these values in your `.env` file. Never commit secrets to version control.

---

## Troubleshooting

### Multiple Active Configurations

**Symptom:** Warning logs about multiple active configurations.

**Cause:** Race condition or interrupted save left more than one active record in the `settings` table.

**Fix:** Automatic — `validateAndFixActiveConfigs()` runs at startup and auto-heals by keeping the newest active config and deactivating older ones.

### Encrypted Field Mismatch

**Symptom:** Garbled or unreadable secrets in the admin panel, or decryption errors in logs.

**Cause:** `ENCRYPTION_KEY` was changed or is different from the key used to encrypt the stored configuration.

**Fix:** Restore the original `ENCRYPTION_KEY`. If lost, you must re-save all secrets through the admin panel with the new key.

### File Config Not Loading

**Symptom:** Application ignores your `parako.yaml` / `parako.jsonc` file.

**Checklist:**

1. Verify `USE_FILE_CONFIG=true` in `.env`.
2. Verify `DEPLOYMENT_ENVIRONMENT=development` in `.env`. File config is ignored in staging/production.
3. Verify the config file exists in the project root with a supported name (`parako.yaml`, `parako.yml`, `parako.jsonc`, or `parako.json`).

### Bootstrap Fields in Admin Panel

**Symptom:** Fields like port, database URI, or environment are read-only in the admin panel.

**Expected behavior:** These are [bootstrap-only fields](#bootstrap-only-fields) that can only be changed in `.env`. This is by design for security.

### Missing Secrets in Production

**Symptom:** Fatal startup error: `[FATAL] JWT_SECRET is not set`.

**Fix:** Set all required secret environment variables in `.env`. Auto-generation is disabled in production to prevent running with non-persistent secrets.

### Config Changes Not Propagating

**Symptom:** Configuration changes made in one process are not reflected in others.

**Checklist:**

1. **Redis** — verify Redis is connected for Pub/Sub invalidation.
2. **Change detection** — Change Streams only work with MongoDB replica sets. SQLite, PostgreSQL, and standalone MongoDB use 30-second polling instead.
3. **Caching** — section caches have a 60-second TTL. Wait or restart.

---

## Related Documentation

- [Admin Panel](admin-panel.md) — settings UI details
- [Multi-Tenancy](multi-tenancy.md) — tenant architecture and override system
- [Security](security.md) — security hardening guide
- [Management API](api/overview.md) — configuration API endpoints
- [Database](database.md) — storage setup and adapters
- [Branding](branding.md) — theme and UI customization
