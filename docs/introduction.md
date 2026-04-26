---
title: 'Introduction'
subtitle: 'Self-hosted OIDC/OAuth2 identity provider built on OpenID Certified node-oidc-provider'
category: 'Getting Started'
order: 1
---

## What is Parako.ID

Parako.ID is a self-hosted OpenID Connect (OIDC) and OAuth 2.0 identity provider built on the [OpenID Certified](https://openid.net/certification/) `node-oidc-provider` library. It gives you full control over user authentication and authorization without per-user fees or vendor lock-in.

Deploy Parako.ID on your own infrastructure and use it as the central identity layer for all your applications — web apps, SPAs, mobile apps, APIs, IoT devices, and machine-to-machine services.

Parako.ID replaces managed identity services like Auth0, Okta, or Keycloak with a lightweight, TypeScript-native solution you own and operate.

## Key Features

- **Single Sign-On (SSO)** — One login across all your applications via standard OIDC/OAuth2 flows
- **Multi-Factor Authentication** — TOTP (authenticator apps), email OTP, SMS (Twilio), and WebAuthn/FIDO2 passkeys
- **Social Login** — Federate with Google, GitHub, Microsoft, LinkedIn, and Facebook out of the box
- **Multi-Tenancy** — Per-tenant data isolation, branding, configuration, and OIDC provider instances
- **[Admin Panel](admin-panel.md)** — Web UI for managing users, clients, sessions, keys, settings, and audit logs
- **[CLI Tools](cli-tools.md)** — Manage OIDC clients, JWKS keys, version updates, and systemd services from the terminal
- **[Management API](api/overview.md)** — RESTful API with 30 scoped permissions for programmatic administration
- **[Multi-Database](configuration.md)** — SQLite (zero-setup default), MongoDB, or PostgreSQL with easy switching
- **Password Breach Detection** — Integration with Have I Been Pwned to block compromised passwords
- **Device Verification** — Detect new devices and require additional verification
- **Account Recovery** — Backup codes, secondary email, SMS, and security questions
- **Multi-Account Sessions** — Users can sign in with multiple accounts and switch between them
- **Internationalization** — 10 locales included (en, fr, es, pt, de, it, ru, zh, ja, ko)
- **[Custom Branding](branding.md)** — Logos, colors, fonts, and custom view templates per tenant
- **Dynamic Client Registration** — RFC 7591 support with initial access tokens
- **Device Flow** — RFC 8628 for IoT devices and CLI tools
- **Prometheus Metrics** — Built-in metrics endpoint for monitoring

## Architecture at a Glance

Parako.ID is a Node.js application built with:

| Layer                | Technology                                                  |
| -------------------- | ----------------------------------------------------------- |
| Web framework        | Express.js                                                  |
| OIDC provider        | node-oidc-provider (OpenID Certified)                       |
| Dependency injection | InversifyJS                                                 |
| Primary database     | SQLite (Prisma), MongoDB (Mongoose), or PostgreSQL (Prisma) |
| OIDC storage         | Same as primary, or Redis for ephemeral data                |
| Session store        | MongoDB or Redis                                            |
| Templating           | Nunjucks                                                    |
| Styling              | Tailwind CSS 4+                                             |
| Build system         | SWC + esbuild (tsc for type-checking)                       |
| Process manager      | PM2 or systemd                                              |
| Testing              | Vitest                                                      |

The application follows a layered architecture:

1. **Controllers** handle HTTP requests and delegate to services
2. **Services** contain business logic (authentication, user management, OIDC client management)
3. **Repositories** abstract database access through interfaces, enabling database switching
4. **OIDC Provider** wraps node-oidc-provider with custom adapters and interaction handlers
5. **Middleware** handles security (CORS, CSRF, rate limiting, session binding)

All components are wired together via the InversifyJS dependency injection container.

## Supported Environments

**Runtime requirements:**

| Requirement | Version    |
| ----------- | ---------- |
| Node.js     | >= 24      |
| Yarn        | >= 1.22.22 |

**Database options (choose one):**

| Database   | Use case                                             |
| ---------- | ---------------------------------------------------- |
| SQLite     | Development, small deployments (single process only) |
| MongoDB    | Production, multi-tenancy                            |
| PostgreSQL | Production, row-level security                       |

**Optional services:**

| Service        | Purpose                                         |
| -------------- | ----------------------------------------------- |
| Redis          | OIDC token storage, session store, caching      |
| Twilio         | SMS-based MFA and recovery                      |
| SMTP server    | Email verification, OTP delivery, notifications |
| ipinfo.io      | IP geolocation                                  |
| IPQualityScore | IP reputation scoring                           |

**Deployment targets:**

- Linux VPS (recommended for production)
- macOS or Linux (development)

## How This Documentation is Organized

| Category                           | What you will find                                            |
| ---------------------------------- | ------------------------------------------------------------- |
| **Getting Started**                | Installation, first login, first OIDC client                  |
| **Architecture**                   | Configuration system, database setup                          |
| **Authentication & Authorization** | OIDC clients, auth methods, social login, security, endpoints |
| **Multi-Tenancy & Platform**       | Tenant isolation, provider pooling, platform management       |
| **Guides**                         | Admin panel, CLI tools, app integration, email/SMS, branding  |
| **DevOps**                         | Deployment, backups, updates, monitoring, troubleshooting     |
| **Extending**                      | Management API overview and endpoint reference                |

Start with the [Quickstart](quickstart.md) to get a running instance in minutes, then explore [Configuration](configuration.md) to customize your deployment.

## Getting Help

- **GitHub Issues** — Report bugs and request features at the [Parako.ID repository](https://github.com/Dahkenangnon/Parako.ID/issues)
- **Security vulnerabilities** — Report privately to [dah.kenangnon@gmail.com](mailto:dah.kenangnon@gmail.com)
