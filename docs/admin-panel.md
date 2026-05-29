---
title: 'Admin Panel'
subtitle: 'Web interface for managing users, clients, sessions, keys, and settings'
category: 'Guides'
order: 1
---

## Accessing the Admin Panel

Navigate to `/admin` and sign in with an account that has the `admin` or `superadmin` role.

New accounts are assigned the default `user` role. To create your first admin, either promote a user manually or — in multi-tenant deployments — set `PARAKO_BOOTSTRAP_ADMIN_EMAIL` and `PARAKO_BOOTSTRAP_ADMIN_PASSWORD` environment variables to seed a bootstrap admin on first startup (see [Multi-Tenancy](multi-tenancy.md#bootstrap-admin)).

The admin panel is a server-rendered web UI that provides full management capabilities without using the CLI or API.

## Dashboard

The dashboard displays an overview of your Parako.ID instance:

- **Quick access** — Shortcuts to create users, connect apps, open settings, and documentation
- **User metrics** — Total, active, and admin user counts
- **OIDC clients** — Registered application count
- **Active sessions** — Currently online users and active grants
- **Today's activity** — Login count for the current day

The dashboard also links to the management sections below (Users, Applications, Sessions, Authorizations, Data, Activity).

## User Management

View, search, and manage all user accounts.

**Available actions:**

- **Create user** — Register a new user account with profile details and role assignment
- **View user details** — Profile, roles, linked social providers, MFA status
- **Edit user** — Update profile fields, email, phone, roles
- **Lock/unlock** — Temporarily disable a user's access
- **Password reset** — Force a password reset on next login
- **Delete** — Anonymize the user's data (data masking), not permanent deletion

## OIDC Client Management

Manage registered OIDC/OAuth2 client applications.

**Available actions:**

- **Create client** — Register a new client with type, redirect URIs, scopes
- **Edit client** — Update configuration fields
- **Activate/deactivate** — Enable or disable a client
- **Rotate secret** — Generate a new client secret (old secret is immediately invalidated)
- **View statistics** — Token issuance counts and last activity
- **Delete client** — Permanently remove a client registration
- **Export** — Download client configurations as JSON

## Session Management

View and manage active OIDC sessions.

- **List sessions** — Browse all active sessions with user, client, IP, and creation time
- **Session details** — View session metadata, scopes, and grants
- **Revoke session** — End a specific user's session immediately
- **Bulk revoke** — End all sessions for a user or client

## Grant Management

View and manage authorization grants (user consents).

- **List grants** — Browse all active grants with user, client, and scopes
- **Grant details** — View granted scopes and expiration
- **Revoke grant** — Remove a user's consent for a specific client

## Activity Log

Browse the audit trail of all security-relevant events.

- **Filter by** — Event type, user, IP address, date range
- **Event types** — Login, logout, registration, password change, MFA setup, client CRUD, admin actions
- **Export** — Download filtered results as CSV

Every authentication event, admin action, and configuration change is logged with timestamp, user, IP address, and event details.

## Settings

Configure the application through the web UI. Settings are organized into sections:

| Section      | What you can configure                                             |
| ------------ | ------------------------------------------------------------------ |
| Application  | Instance name, available locales, default locale                   |
| Branding     | Logos (light/dark, icon variants), favicon, fonts, theme colors    |
| Deployment   | Base routes, proxy trust, public URL                               |
| Security     | Password policy, rate limiting, session settings, MFA requirements |
| Features     | OIDC features, social login providers, developer API, metrics      |
| OIDC         | Token TTLs, supported scopes, claims, provider behavior            |
| Integrations | SMTP email, IP geolocation, file storage                           |

Changes take effect immediately without restarting the server.

You can also **import/export** the full configuration as JSON and **rollback** to a previous configuration snapshot.

## JWKS Management

Manage the JSON Web Key Sets used for signing OIDC tokens.

- **View keys** — List all keys with algorithm, key ID, status, and creation date
- **Rotate keys** — Generate new keys and retire old ones after the overlap window
- **Retire expired keys** — Remove keys that have passed their rotation overlap period

Key generation and JWKS backup/download are available via the CLI (`pnpm keys generate`).

## Data Transfer

Import and export data for backup or migration.

- **Export users** — Download user data as CSV or JSON
- **Export clients** — Download client configurations as JSON
- **Export audit log** — Download activity log entries as CSV
- **Import clients** — Upload client configurations from JSON

## Platform Admin

Available only in multi-tenant mode with the `_platforms` tenant.

- **Tenant list** — View all tenants with status filtering and stats (user counts, creation date)
- **Create tenant** — Register a new tenant with slug, display name, and optional custom domain
- **View tenant** — Detail page showing tenant info and a paginated list of tenant users
- **Edit tenant** — Update display name and custom domain
- **Status management** — Suspend, activate, or archive tenants (no permanent deletion)
- **Tenant configuration** — Per-tenant setting overrides via the [Configuration](configuration.md) section

> The `_platforms` tenant is protected and cannot be suspended or archived.

See [Multi-Tenancy](multi-tenancy.md) for details on tenant management.
