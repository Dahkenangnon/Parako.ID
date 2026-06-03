<!-- omit in toc -->

![Parako.ID banner](./public/images/banner.png)

# Parako.ID

**Open-source, self-hosted OIDC/OAuth2 identity infrastructure for teams, SaaS platforms, schools, companies, and institutions that need modern authentication without per-user pricing.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-orange.svg)](https://pnpm.io)
[![Releases](https://img.shields.io/github/v/release/Dahkenangnon/Parako.ID?include_prereleases)](https://github.com/Dahkenangnon/Parako.ID/releases)

[Website](https://parako.id) · [Docs](https://docs.parako.id) · [Quickstart](https://docs.parako.id/quickstart) · [Releases](https://github.com/Dahkenangnon/Parako.ID/releases)

> [!WARNING]
> **Early access - actively developed.** APIs and configuration format may change before v1.0.

Parako.ID is an identity provider you deploy and operate yourself. It gives you standards-based SSO, OAuth2/OIDC, MFA, passkeys, social login, device flow, tenant-aware identity, branded login experiences, an admin panel, and a scoped Management API while keeping users, sessions, keys, grants, audit logs, and configuration inside your infrastructure.

It is built on the OpenID Certified [`node-oidc-provider`](https://github.com/panva/node-oidc-provider) library. Parako.ID itself has not undergone OpenID Foundation certification.

## Why Parako.ID

Managed auth is convenient until user count, data residency, tenant isolation, low-connectivity users, or institution-specific identifiers become business requirements. Parako.ID gives you a standards-based identity server that starts with SQLite, runs on your own Linux host, and can grow into a multi-tenant control plane backed by MongoDB, PostgreSQL, and optional Redis.

| Need                            | What Parako.ID gives you                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Avoid per-user pricing          | Flat infrastructure cost instead of MAU-based hosted-auth bills                                             |
| Own identity data               | Users, password hashes, sessions, JWKS, grants, audit logs, and tenant config stay in your database         |
| Serve unreliable networks       | Server-rendered login, account, and admin screens built to remain practical on 2G/3G-style links            |
| Start without database ceremony | SQLite default for local development, evaluation, and small single-process deployments                      |
| Scale the storage model         | MongoDB or PostgreSQL for production, optional Redis for sessions, OIDC storage, cache, and background jobs |
| Run many organizations          | Tenant isolation, per-tenant branding/config/OIDC provider instances, subdomain or header tenant resolution |
| Support local identity patterns | Email, phone, username, and custom identifiers such as employee IDs or student matricule numbers            |

## Core Capabilities

### Own Your Identity Data

Use Parako.ID when identity data needs to stay close to the organization that is responsible for it. User records, password hashes, MFA state, recovery settings, sessions, OIDC grants, signing keys, tenant configuration, and audit activity are stored in the database you choose and operate.

### Standards-First SSO/OIDC

Parako.ID speaks OAuth2 and OpenID Connect through `node-oidc-provider`: authorization code + PKCE, discovery, JWKS, access and refresh tokens, token introspection, revocation, device flow, resource indicators, dynamic client registration, and RP-initiated logout. Use it for web apps, mobile apps, APIs, CLIs, machine clients, and device-style flows.

### Authentication That Fits Real Users

Support email, phone, username, and custom-identifier login from the same deployment. Passwords use Argon2id, breach-password checks use Have I Been Pwned k-anonymity, and accounts can be protected with new-device verification, multi-account browser sessions, TOTP, email OTP, SMS OTP, backup codes, security questions, and WebAuthn/FIDO2 passkeys.

### Low-Bandwidth Friendly by Design

Parako.ID does not make authentication depend on a heavy SPA bundle. Auth, account, and admin flows are server-rendered with Nunjucks and enhanced with small client-side behavior, so core identity workflows remain usable on slower 2G and 3G connections, low-end devices, shared Wi-Fi, and institution networks where bandwidth is unreliable.

### Multi-Database Support

Choose the storage model that matches your stage:

| Database   | Best fit                                  | Notes                                             |
| ---------- | ----------------------------------------- | ------------------------------------------------- |
| SQLite     | Local development, evaluation, small apps | Zero external DB; single-process only             |
| MongoDB    | Production and multi-tenant deployments   | Tenant scoping via Mongoose plugin                |
| PostgreSQL | Production with strict relational data    | Prisma-based, with row-level security for tenants |

SQLite is the easiest starting point. Multi-tenancy requires MongoDB or PostgreSQL.

### Multi-Tenancy Built In

Run one Parako.ID instance for many organizations. Each tenant can have isolated data, sessions, OIDC provider instances, branding, security policy, social-provider config, notifications, and token settings. Tenant resolution supports subdomains and headers, with `_platforms` for platform administration and `_ops` for infrastructure callback routing.

### Admin Panel, CLI, and Management API

Manage users, OIDC clients, sessions, grants, JWKS keys, activities, settings, tenants, imports, exports, and platform configuration from the admin panel. Automate the same operational work through the Management API with scoped permissions, or use CLI tools for clients, keys, updates, and service helpers.

### Emerging-Market Friendly Defaults

Parako.ID is practical for environments where identity systems must work with constrained infrastructure and mixed user devices: SQLite for a low-friction start, server-rendered pages for low bandwidth, phone and custom identifiers for local login patterns, SMS/email recovery options, and 10 included locales for international deployments.

### Operator-Controlled Deployment

The installer verifies release artifacts, stages application files, preserves runtime data, switches the active release pointer, and gives you `parako update`, `parako rollback`, `parako doctor`, and `parako gc`. It intentionally does not take over your database, migrations, backups, process manager, reverse proxy, TLS, secrets, or production configuration.

## Built For Operators

Parako.ID is infrastructure you control, not a black-box auth tenant. The application handles identity workflows, OIDC protocol behavior, tenant-aware configuration, admin surfaces, and release staging. You keep ownership of the operational pieces that define your production posture.

| Parako.ID manages                              | You own and control                                |
| ---------------------------------------------- | -------------------------------------------------- |
| OIDC/OAuth2 server behavior and auth flows     | Database choice, migrations, backups, and restores |
| Users, sessions, grants, JWKS, and audit data  | Secrets, environment configuration, and TLS        |
| Admin UI, platform portal, CLI, Management API | Reverse proxy, DNS, process manager, and scaling   |
| Release staging, rollback, doctor, and cleanup | Upgrade timing, monitoring, and incident response  |

## What You Can Build With It

- A self-hosted SSO layer for internal tools and customer apps.
- A tenant-aware identity platform for SaaS products.
- A school, company, or government login system using institutional IDs.
- A low-bandwidth authentication portal for users on unreliable networks.
- A standards-based OAuth2/OIDC server with local data control.
- A private alternative to hosted identity platforms when vendor lock-in, data locality, or pricing control is unacceptable.

## Install

Install the latest release on a Linux host:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

The installer places application files and prints the exact operator next steps. Full production setup lives in the [installer](https://docs.parako.id/installer), [deployment](https://docs.parako.id/deployment), and [configuration](https://docs.parako.id/configuration) docs.

For local development:

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install
cp .env.example runtime/.env
pnpm db:push
pnpm dev
```

Open `http://localhost:9007/auth/register`, create the first user, then visit `/admin` to register your first OIDC client.

## Requirements

- Linux x86_64 or aarch64 for the installer path.
- Node.js >= 24 and pnpm >= 11.
- SQLite, MongoDB, or PostgreSQL.
- Optional Redis for clustered sessions, OIDC storage, cache invalidation, and background jobs.
- Optional SMTP/Twilio/social-provider credentials depending on enabled features.

## Project Status

Parako.ID is early-access open source infrastructure. The core identity server, admin UI, storage adapters, multi-tenancy foundation, installer, and management surfaces are active. OpenID Federation 1.0 work is in progress through the standalone [oidfed](https://github.com/Dahkenangnon/oidfed) library.

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, commit conventions, and review expectations.

## Security

Report vulnerabilities privately to <dah.kenangnon@gmail.com>. See [SECURITY.md](./SECURITY.md) for the disclosure policy.

## License

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
