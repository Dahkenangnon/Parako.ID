---
title: 'Multi-Tenancy'
subtitle: 'Per-tenant data isolation, branding, configuration, and OIDC provider pooling'
category: 'Multi-Tenancy & Platform'
order: 1
---

## Overview

Parako.ID supports multi-tenancy for SaaS deployments where multiple organizations share a single instance. Each tenant gets isolated data, sessions, OIDC provider instances, and optionally custom branding and configuration.

Multi-tenancy is disabled by default. When disabled, the application operates as a single-tenant identity provider.

## Enabling Multi-Tenancy

Set the following environment variables in `.env`:

```bash
MULTI_TENANCY_ENABLED=true
MULTI_TENANCY_EXTRACTION_PRIORITY=header,subdomain
MULTI_TENANCY_TENANT_HEADER=x-tenant-id
```

Multi-tenancy is **not supported with SQLite**. Use MongoDB or PostgreSQL.

For production infrastructure setup (DNS, SSL, nginx), see [Deployment — Multi-Tenancy Infrastructure](deployment.md#multi-tenancy-infrastructure).

## Tenant Extraction

Parako.ID resolves the current tenant from incoming requests using configurable strategies. The `MULTI_TENANCY_EXTRACTION_PRIORITY` variable defines the order in which strategies are tried:

| Strategy    | How it works                        | Example                 |
| ----------- | ----------------------------------- | ----------------------- |
| `header`    | Reads the `x-tenant-id` HTTP header | `x-tenant-id: acme`     |
| `subdomain` | Extracts tenant from the subdomain  | `acme.auth.example.com` |

The first strategy that returns a valid tenant wins. In development, unresolved requests fall back to the `default` tenant with a warning. In production and staging, unresolved requests receive a `400` error — every request must identify a tenant.

Tenant slugs must match `^[a-z0-9][a-z0-9_-]{0,62}$` — lowercase alphanumeric start, up to 63 characters total, hyphens and underscores allowed. Invalid slugs receive a `400` error.

The resolved tenant is automatically bound to the user's session. This is internal middleware behavior — not a configurable strategy. If a subdomain is present and conflicts with the session tenant, the subdomain always wins and authentication state is cleared.

Configure the extraction priority as a comma-separated list:

```bash
MULTI_TENANCY_EXTRACTION_PRIORITY=header,subdomain
```

The custom header name is configurable:

```bash
MULTI_TENANCY_TENANT_HEADER=x-tenant-id
```

## Data Isolation

### MongoDB

A global Mongoose plugin automatically injects `tenant_id` into all queries and document creation. This provides transparent data isolation without any changes to query code.

Every document includes a `tenant_id` field, and all find/update/delete operations are automatically scoped to the current tenant via Node.js `AsyncLocalStorage`.

### PostgreSQL

Row-level security (RLS) policies enforce tenant isolation at the database level. Each table includes a `tenant_id` column, and RLS policies ensure queries only return rows matching the current tenant context.

## Special Tenants

Parako.ID reserves three tenant identifiers for internal use:

| Tenant       | Purpose                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `default`    | Used when no tenant is resolved from the request                                     |
| `_ops`       | Stateless infrastructure gateway — cross-tenant OAuth state management               |
| `_platforms` | Master tenant — full auth + admin panel, plus cross-tenant management at `/platform` |

The `_ops` tenant is a stateless infrastructure gateway — it has no session binding, no config cache, and returns JSON only. It serves health/metrics probes and relays social OAuth callbacks for tenants where the OAuth redirect cannot go directly to a tenant subdomain.

The `_platforms` tenant is the **master tenant** (similar to Keycloak's master realm). It is automatically created at first startup and operates as a fully functional tenant with its own OIDC provider, login page, admin panel, and session management. In addition to standard tenant capabilities, it mounts platform-level routes at `/platform/*` for cross-tenant management (listing tenants, creating tenants, viewing tenant users, updating tenant status). These platform routes are guarded by `PlatformTenantMiddleware` which requires `platform_admin` role.

To create the initial admin user for `_platforms`, set the following environment variables before first startup.

**Production (recommended):** Use shell-scoped exports so credentials never touch disk:

```bash
export PARAKO_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
export PARAKO_BOOTSTRAP_ADMIN_PASSWORD=your-secure-password
pnpm start
# Credentials exist only in this shell session — gone when it exits.
```

**Development:** Setting them in `.env` is acceptable for convenience:

```bash
PARAKO_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
PARAKO_BOOTSTRAP_ADMIN_PASSWORD=your-secure-password
```

The bootstrap admin is temporary. Create a permanent admin account and remove the bootstrap credentials from your environment after first login. Parako.ID logs a warning on every startup while these variables remain set.

The `default` tenant is the implicit tenant for single-tenant deployments and the development fallback. It is hard-coded (not a database record) and represents the base configuration without overrides.

## Provider Pool

Each tenant gets its own OIDC Provider instance, managed by a connection pool:

```bash
MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE=50
MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS=1800000
MULTI_TENANCY_PROVIDER_POOL_CLEANUP_INTERVAL_MS=60000
```

| Field                 | Default   | Description                                 |
| --------------------- | --------- | ------------------------------------------- |
| `max_size`            | 50        | Maximum OIDC provider instances in the pool |
| `idle_ttl_ms`         | 1,800,000 | Evict idle providers after 30 minutes       |
| `cleanup_interval_ms` | 60,000    | Run cleanup every 60 seconds                |

When a request arrives for a tenant, Parako.ID retrieves or creates an OIDC Provider instance configured with that tenant's settings. Idle providers are automatically evicted to free memory.

If the pool reaches `max_size`, the least recently used provider is evicted to make room.

Each tenant's OIDC Provider subscribes to tenant-specific key rotation events via Redis Pub/Sub. When JWKS keys are rotated for a tenant, all application instances are notified to refresh the provider's keystore.

## Per-Tenant Configuration

Each tenant can override sections of the global configuration:

- **Application** — Title, description, default and available locales
- **Branding** — Company name, logos (light/dark), favicon, fonts, color palettes (light/dark)
- **Security** — Password policy, MFA and WebAuthn settings, session configuration, signup rules, rate limiting, device matching
- **Features** — Social login providers and their credentials
- **OIDC** — Discovery metadata, token TTLs
- **Integrations** — SMTP email configuration, external URLs (website, privacy policy, terms of service)
- **Notifications** — Email/SMS channel configuration, security alert defaults

Overrides are subject to platform-level constraints: floor values prevent tenants from weakening security requirements (e.g., disabling MFA if globally required), and ceiling values cap token lifetimes and rate limits. Sensitive fields (SMTP passwords, social provider secrets, SMS API keys) are encrypted at rest.

Manage tenant configuration via:

- **Admin panel** — Navigate to `/admin` as a `_platforms` superadmin
- **Management API** — `PUT /api/v1/tenants/:slug/config/:section` with `parako:cross-tenant:write` scope

Tenant-specific settings are merged with the global configuration at runtime, with tenant values taking precedence.

## Tenant Management

### Admin Panel

Sign in as a superadmin on the `_platforms` tenant to access the platform administration panel. From there you can:

- Create and update tenants
- View tenant details and configuration
- Override per-tenant settings

### Management API

Use the tenant endpoints with appropriate scopes:

```bash
# List tenants
curl https://your-parako.example.com/api/v1/tenants \
  -H "Authorization: Bearer API_TOKEN"

# Create a tenant
curl -X POST https://your-parako.example.com/api/v1/tenants \
  -H "Authorization: Bearer API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "slug": "acme"}'

# Get tenant config
curl https://your-parako.example.com/api/v1/tenants/acme/config \
  -H "Authorization: Bearer API_TOKEN"

# Update tenant branding
curl -X PUT https://your-parako.example.com/api/v1/tenants/acme/config/branding \
  -H "Authorization: Bearer API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"companyName": "Acme Corp", "logo": "/uploads/acme-logo.png"}'
```

Required scopes: `parako:tenants:read`, `parako:tenants:write`, `parako:tenants:delete`, `parako:cross-tenant:read`, `parako:cross-tenant:write`.

See [API Endpoints](api/endpoints.md) for the full tenant API reference.
