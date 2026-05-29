<!-- omit in toc -->

> [!WARNING]
> **Early access — actively developed.** APIs and configuration format may change before v1.0.

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="240" />

# Parako.ID

Self-hosted OIDC/OAuth2 identity provider with SSO, MFA, passkeys, and federation — for teams who want to own their auth.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-orange.svg)](https://pnpm.io)
[![Releases](https://img.shields.io/github/v/release/Dahkenangnon/Parako.ID?include_prereleases)](https://github.com/Dahkenangnon/Parako.ID/releases)

[Website](https://parako.id) · [Documentation](https://docs.parako.id) · [Changelog](https://github.com/Dahkenangnon/Parako.ID/releases)

</div>

---

## Background

Most managed identity services charge per active user, store your user data on their infrastructure, and become a single point of failure when they raise prices or shut down. Parako.ID inverts that: deploy it on a single VPS in minutes, keep every byte of user data on disks you control, and never pay a per-seat fee.

It is built on the [OpenID Certified™ `node-oidc-provider`](https://github.com/panva/node-oidc-provider) library, so it speaks the full OAuth 2.0 and OIDC specification from day one. [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html) support is on the near-term roadmap via the dedicated [oidfed](https://github.com/Dahkenangnon/oidfed) project.

> Parako.ID uses the certified library but has not itself undergone OpenID Foundation certification.

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

Full documentation lives at [docs.parako.id](https://docs.parako.id), covering:

- [Configuration](https://docs.parako.id/configuration) — env vars, hierarchy, schema reference
- [Multi-tenancy](https://docs.parako.id/multi-tenancy) — per-tenant isolation, branding, OIDC instances
- [Social login](https://docs.parako.id/social-login) — Google, GitHub, Microsoft, LinkedIn, Facebook
- [Deployment](https://docs.parako.id/deployment) — systemd, PM2, reverse proxy, hardening
- [CLI tools](https://docs.parako.id/cli-tools) — `pnpm client`, `pnpm keys`, `pnpm systemd`

## Roadmap

> **OpenID Federation 1.0** support is planned. We are building [oidfed](https://github.com/Dahkenangnon/oidfed) — a runtime-agnostic, spec-compliant implementation for JavaScript — and Parako.ID will integrate it in a future release. Follow at [oidfed.com](https://oidfed.com).

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, commit conventions, and the review process.

## Security

Report vulnerabilities privately to <dah.kenangnon@gmail.com>. Public disclosure policy in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
