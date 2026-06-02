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

> **Parako's installer/updater safely places and updates Parako application files.** It verifies the release artifact, stages it, preserves operator-owned runtime/config files, and switches the application release pointer. **Infrastructure, database backups, database migrations, process management, reverse proxy, TLS, secrets, and production configuration remain operator responsibilities.**

One-liner:

```bash
# Install the latest stable application release
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

After install the `parako` operator binary is on `PATH`. The minimal verb set is intentional — the installer never manages your supervisor, DB, or proxy:

```bash
parako version            # parako + app + previous version
parako paths              # resolved install paths
parako doctor             # file/config sanity (no service / DB / network)
parako update             # in-place application-files update
parako rollback           # app-files-only rollback (DOES NOT roll back DB migration)
parako gc --keep 3 --yes  # prune old releases/ (never touches runtime/)
```

After install, operator next steps:

1. **Provision** Node.js ≥ 24 + pnpm ≥ 11, a database (PostgreSQL or MongoDB recommended for production; SQLite for evaluation), and optionally Redis.
2. **Create your `.env`**: `cp /opt/parako-id/current/contrib/.env.sample /opt/parako-id/runtime/.env` and edit.
3. **Wire your supervisor** to `/opt/parako-id/current` (systemd / PM2 / docker / your tool of choice). A sample PM2 ecosystem file ships at `/opt/parako-id/current/contrib/ecosystem.config.cjs.sample`. Reference nginx vhost examples live under [`docs/reference/`](./docs/reference/).
4. **Apply any DB migration** named in the release notes (the installer does not run migrations).
5. **Start your service** and verify `/health`.

See [docs/installer](https://docs.parako.id/installer) and [docs/parako-cli](https://docs.parako.id/parako-cli) for the full reference.

Manual tarball (when piping `curl | bash` is not acceptable):

```bash
VERSION=v0.2.0
wget "https://github.com/Dahkenangnon/Parako.ID/releases/download/${VERSION}/parako-id-${VERSION}.tar.gz"
wget "https://github.com/Dahkenangnon/Parako.ID/releases/download/${VERSION}/parako-id-${VERSION}.tar.gz.sig"
wget "https://github.com/Dahkenangnon/Parako.ID/releases/download/${VERSION}/parako-id-${VERSION}.tar.gz.pem"
wget "https://github.com/Dahkenangnon/Parako.ID/releases/download/${VERSION}/SHA256SUMS"
# Install cosign first: https://docs.sigstore.dev/cosign/system_config/installation/
cosign verify-blob \
  --signature "parako-id-${VERSION}.tar.gz.sig" \
  --certificate "parako-id-${VERSION}.tar.gz.pem" \
  --certificate-identity-regexp 'https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "parako-id-${VERSION}.tar.gz"
# Then run the installer in --offline mode against the verified files (see docs/installer for full args).
```

**Requirements:** Linux x86_64 or aarch64, bash ≥ 4.0, GNU coreutils (`mv -T`), util-linux (`flock`), curl/wget, openssl, tar. Node.js / pnpm / database / Redis are operator-provisioned.

## Usage

After install, visit `http://localhost:9007/auth/register` to create the first user, then `/admin` to register OIDC clients and manage settings. Integrate any OAuth2/OIDC client through the discovery endpoint:

```
http://<your-host>/.well-known/openid-configuration
```

For local development:

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git && cd Parako.ID
pnpm install && cp .env.example runtime/.env
pnpm db:push && pnpm keys generate && pnpm dev
```

## Documentation

| Section                                                             | What it covers                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Quickstart](https://docs.parako.id/quickstart)                     | Install, first-user, first-client in under 10 minutes            |
| [Installer](https://docs.parako.id/installer)                       | Every flag for install / update / rollback / doctor / gc         |
| [parako CLI](https://docs.parako.id/parako-cli)                     | `parako` operator binary verbs                                   |
| [Installer security](https://docs.parako.id/installer-security)     | Threat model, cosign chain-of-trust, verifying install.sh itself |
| [Install from source](https://docs.parako.id/installer-from-source) | git-clone path and trade-offs vs the tarball installer           |
| [Configuration](https://docs.parako.id/configuration)               | Env vars, schema, hierarchy, secret rotation                     |
| [Multi-tenancy](https://docs.parako.id/multi-tenancy)               | Per-tenant isolation, branding, OIDC instances                   |
| [Social login](https://docs.parako.id/social-login)                 | Google, GitHub, Microsoft, LinkedIn, Facebook                    |
| [Deployment](https://docs.parako.id/deployment)                     | systemd, PM2, reverse proxy, TLS, hardening                      |
| [CLI tools](https://docs.parako.id/cli-tools)                       | `pnpm client`, `pnpm keys`, `pnpm systemd`                       |
| [Management API](https://docs.parako.id/api/overview)               | Programmatic admin via 30 scoped permissions                     |
| [Upgrades](https://docs.parako.id/upgrades)                         | What survives an upgrade and how to apply new defaults           |

## Roadmap

[OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html) integration is in development via the standalone [oidfed](https://github.com/Dahkenangnon/oidfed) library. Track progress at [oidfed.com](https://oidfed.com).

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, commit conventions, and the review process.

## Security

Report vulnerabilities privately to <dah.kenangnon@gmail.com>. Public disclosure policy in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
