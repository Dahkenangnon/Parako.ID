---
title: 'Database'
subtitle: 'Multi-database support with SQLite, MongoDB, and PostgreSQL'
category: 'Architecture'
order: 2
---

## Supported Databases

Parako.ID supports three database backends. Choose based on your deployment needs:

| Feature          | SQLite                         | MongoDB                   | PostgreSQL                        |
| ---------------- | ------------------------------ | ------------------------- | --------------------------------- |
| Setup complexity | Zero — file-based              | Moderate                  | Moderate                          |
| ORM              | Prisma                         | Mongoose                  | Prisma                            |
| Multi-tenancy    | Not supported                  | Mongoose tenant plugin    | Row-level security (RLS)          |
| Clustering (PM2) | Single instance only           | Multiple instances        | Multiple instances                |
| Best for         | Development, small deployments | Production, multi-tenancy | Production, strict data integrity |

Set the database via the `STORAGE_ADAPTER` environment variable in `.env`:

```bash
STORAGE_ADAPTER=sqlite      # Default
STORAGE_ADAPTER=mongodb
STORAGE_ADAPTER=postgresql
```

## SQLite (Default)

SQLite requires no external database server. Data is stored in a single file.

### Configuration

```bash
STORAGE_ADAPTER=sqlite
STORAGE_SQLITE_PATH=./data/parako.db
```

### Setup

```bash
# Generate Prisma client for SQLite
pnpm db:generate

# Push schema to database (creates file if needed)
pnpm db:push

# Open Prisma Studio to inspect data
pnpm db:studio
```

### Constraints

- **Single process only** — You must set `PM2_INSTANCES=1` in production. SQLite does not support concurrent writes from multiple processes. The application enforces this at startup and refuses to start if violated.
- **No multi-tenancy** — Multi-tenancy requires MongoDB or PostgreSQL.
- **WAL mode** — Parako.ID enables Write-Ahead Logging (WAL) for better read concurrency.

### Backups

For continuous SQLite backups, see [SQLite Backup with Litestream](litestream.md).

## MongoDB

MongoDB is the most battle-tested option, with full support for multi-tenancy via a global Mongoose tenant plugin.

### Configuration

```bash
STORAGE_ADAPTER=mongodb
STORAGE_MONGODB_URI=mongodb://localhost:27017/parako
```

### Setup

No schema push is needed — Mongoose creates collections automatically on first use.

```bash
# Start the application
pnpm dev
```

### Multi-Tenancy

When `MULTI_TENANCY_ENABLED=true`, a global Mongoose plugin automatically scopes all queries by `tenant_id`. This provides transparent data isolation without changes to your query code.

Special tenants:

| Tenant       | Purpose                                      |
| ------------ | -------------------------------------------- |
| `default`    | Used when no tenant is resolved              |
| `_ops`       | Internal operations tenant                   |
| `_platforms` | Platform administration (SaaS control plane) |

### Collections

Parako.ID creates these MongoDB collections:

**Application data:**

- `users` — User accounts and profiles
- `activities` — Audit log entries
- `settings` — Application configuration (versioned)
- `socialintegrations` — Social login provider configurations
- `tenants` — Tenant registry (not tenant-scoped)
- `jwks_keys` — JWKS signing keys
- `tenant_settings_overrides` — Per-tenant configuration overrides

**OIDC adapter collections** (created by `node-oidc-provider`, PascalCase names):

- `Session`, `Grant`, `Client`, `AccessToken`, `AuthorizationCode`, `RefreshToken`, `DeviceCode`, `ClientCredentials`, `InitialAccessToken`, `RegistrationAccessToken`, `Interaction`, `ReplayDetection`, `PushedAuthorizationRequest`, `BackchannelAuthenticationRequest`

## PostgreSQL

PostgreSQL uses Prisma as its ORM and supports row-level security (RLS) for multi-tenancy.

### Configuration

```bash
STORAGE_ADAPTER=postgresql
STORAGE_POSTGRESQL_URL=postgresql://user:password@localhost:5432/parako
```

### Setup

```bash
# Generate Prisma client for PostgreSQL
pnpm db:generate:pg

# Run migrations
pnpm db:migrate

# Deploy migrations (production, no prompts)
pnpm db:migrate:deploy

# Open Prisma Studio
pnpm db:studio
```

### Tables

Both PostgreSQL and SQLite use the same Prisma schema with these tables:

- `users` — User accounts with MFA, WebAuthn, and recovery sub-tables
- `user_mfa`, `user_mfa_totp`, `user_mfa_email_otp` — MFA configuration
- `user_webauthn_credentials` — WebAuthn/FIDO2 passkeys
- `user_recovery`, `user_backup_codes`, `user_security_questions` — Account recovery
- `user_notification_prefs` — Notification preferences
- `activities`, `activity_actors`, `activity_targets`, `activity_devices` — Audit log
- `settings` — Application configuration (versioned)
- `social_integrations` — Social login provider configurations
- `tenants` — Tenant registry
- `tenant_settings_overrides` — Per-tenant configuration overrides
- `jwks_keys` — JWKS signing keys
- `sessions` — Session store
- `oidc_store` — OIDC tokens, grants, and interactions (single table for all OIDC models)

### SSL Configuration

For production PostgreSQL with SSL:

```bash
STORAGE_POSTGRESQL_URL=postgresql://user:password@host:5432/parako?sslmode=require
```

### Multi-Tenancy

PostgreSQL multi-tenancy uses a Prisma extension (`src/db/extensions/tenant.extension.ts`) that injects `SET LOCAL app.tenant_id` and automatically filters all queries by `tenant_id`. Row-level security (RLS) policies provide a belt-and-suspenders safety net at the database level. Each table includes a `tenant_id` column.

## OIDC Storage Adapter

The OIDC storage adapter controls where tokens, sessions, grants, and other OIDC artifacts are persisted. By default, it uses the same backend as your primary database, but you can separate them.

```bash
# Use Redis for OIDC storage while keeping MongoDB for application data
STORAGE_ADAPTER=mongodb
OIDC_STORAGE_ADAPTER=redis
```

Available options:

| Adapter      | Storage type          | Best for                               |
| ------------ | --------------------- | -------------------------------------- |
| `sqlite`     | Persistent (file)     | Development                            |
| `mongodb`    | Persistent            | Production                             |
| `postgresql` | Persistent            | Production                             |
| `redis`      | Ephemeral (in-memory) | High-throughput, clustered deployments |

When using Redis for OIDC storage, configure the Redis connection:

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DATABASE=0
```

Redis provides faster token lookups at the cost of data loss on restart. This is acceptable for OIDC tokens since clients can re-authenticate, but you should use a persistent store if session continuity across restarts is important.

## Repository Pattern

Parako.ID abstracts database access through the repository pattern:

```
repositories/
├── interfaces/          # Database-agnostic contracts
│   ├── user.repository.interface.ts
│   ├── activity.repository.interface.ts
│   └── ...
├── mongoose/            # MongoDB implementations
│   ├── user.repository.ts
│   └── ...
└── prisma/              # SQLite/PostgreSQL implementations
    ├── user.repository.ts
    └── ...
```

The application selects the correct repository implementation at startup based on `STORAGE_ADAPTER`. This means switching databases requires only changing the environment variable and running the appropriate setup commands — no application code changes.
