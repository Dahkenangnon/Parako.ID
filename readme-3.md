<!-- omit in toc -->

> [!WARNING]
> **Early access — actively developed.** APIs and configuration format may change before v1.0.

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="240" />

# Parako.ID

**Own your auth. Pay nothing per user. Run anywhere.**

A production-grade OIDC/OAuth2 identity provider you deploy on your own infrastructure — SSO, MFA, passkeys, federation, and a clean admin panel — with no per-seat fees, no vendor lock-in, no telemetry.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-orange.svg)](https://pnpm.io)
[![Releases](https://img.shields.io/github/v/release/Dahkenangnon/Parako.ID?include_prereleases)](https://github.com/Dahkenangnon/Parako.ID/releases)

[Website](https://parako.id) · [Documentation](https://docs.parako.id) · [Changelog](https://github.com/Dahkenangnon/Parako.ID/releases)

</div>

---

## The problem

Managed identity vendors charge per monthly active user. As you grow, your auth bill grows with you — often becoming a top-three cost line. Your users' email addresses, password hashes, and session histories sit on someone else's infrastructure under their privacy policy, not yours. When a vendor raises prices, deprecates an API, or shuts down a region, you migrate on their schedule, not yours.

## The solution

Parako.ID runs on a single VPS — or scales out across many — and gives you the same OIDC/OAuth2 surface area as the managed services, with you holding every byte of user data and every line of configuration. Built on the [OpenID Certified™ `node-oidc-provider`](https://github.com/panva/node-oidc-provider) library, it speaks the full spec from day one and integrates with anything that talks OAuth2.

> Parako.ID uses the certified library but has not itself undergone OpenID Foundation certification.

## Why Parako.ID

- **Zero per-user cost.** Flat infrastructure bill; same price for 100 or 100,000 users.
- **Data sovereignty.** User records live in your database. No third party reads them.
- **Standards-first.** Full OAuth 2.0, OIDC, RFC 8628 device flow, RFC 9449 DPoP.
- **Multi-tenancy built in.** Isolate brands, configs, and OIDC instances per tenant.
- **Africa-friendly footprint.** Runs on 1 GB RAM, SQLite default, low-bandwidth admin UI.
- **Federation ready.** [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html) on the roadmap via [oidfed](https://github.com/Dahkenangnon/oidfed).

## Install

One-liner (recommended):

```bash
curl -sSL https://get.parako.id | sh
```

Manual tarball:

```bash
wget https://github.com/Dahkenangnon/Parako.ID/releases/latest/download/parako-id-v*.tar.gz
tar -xzf parako-id-v*.tar.gz && cd parako-id-release
cp .env.example .env   # edit DB, Redis, and admin credentials
pnpm start
```

**Requirements:** Node.js ≥ 24, pnpm ≥ 11. SQLite is the zero-setup default; MongoDB or PostgreSQL recommended for production along with Redis.

## Usage

After install, visit `http://localhost:9007/auth/register` to create the first user, then `/admin` to register OIDC clients and manage settings. Integrate any OAuth2/OIDC client through the discovery endpoint:

```
http://<your-host>/.well-known/openid-configuration
```

For local development:

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git && cd Parako.ID
pnpm install && cp .env.example .env
pnpm db:push && pnpm keys generate && pnpm dev
```

## Documentation

| Section                                               | What it covers                                        |
| ----------------------------------------------------- | ----------------------------------------------------- |
| [Quickstart](https://docs.parako.id/quickstart)       | Install, first-user, first-client in under 10 minutes |
| [Configuration](https://docs.parako.id/configuration) | Env vars, schema, hierarchy, secret rotation          |
| [Multi-tenancy](https://docs.parako.id/multi-tenancy) | Per-tenant isolation, branding, OIDC instances        |
| [Social login](https://docs.parako.id/social-login)   | Google, GitHub, Microsoft, LinkedIn, Facebook         |
| [Deployment](https://docs.parako.id/deployment)       | systemd, PM2, reverse proxy, TLS, hardening           |
| [CLI tools](https://docs.parako.id/cli-tools)         | `pnpm client`, `pnpm keys`, `pnpm systemd`            |
| [Management API](https://docs.parako.id/api/overview) | Programmatic admin via 30 scoped permissions          |

## Roadmap

> **OpenID Federation 1.0** support is planned. We are building [oidfed](https://github.com/Dahkenangnon/oidfed) — a runtime-agnostic, spec-compliant implementation for JavaScript — and Parako.ID will integrate it in a future release. Follow at [oidfed.com](https://oidfed.com) and star the [repo](https://github.com/Dahkenangnon/oidfed) to track progress.

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, commit conventions, and the review process.

## Security

Report vulnerabilities privately to <dah.kenangnon@gmail.com>. Public disclosure policy in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
