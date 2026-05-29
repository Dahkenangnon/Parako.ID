> [!WARNING]
> **Early access — actively developed.** APIs and configuration format may change before v1.0.

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="280" />

# Parako.ID

**Own your identity layer. No vendor. No per-seat bill. No limits.**

A production-grade identity provider you deploy once and forget about — SSO, MFA, passkeys, and OAuth2 out of the box, at any scale.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![Releases](https://img.shields.io/github/v/release/Dahkenangnon/Parako.ID?include_prereleases)](https://github.com/Dahkenangnon/Parako.ID/releases)

[Website](https://parako.id) · [Docs](https://docs.parako.id) · [Changelog](https://github.com/Dahkenangnon/Parako.ID/releases)

</div>

---

Most auth services charge per user, own your data, and disappear when funding dries up. Parako.ID flips that: deploy it on your own infrastructure in minutes, keep every byte of your user data, and never pay a per-seat fee. Built on the [OpenID Certified™ node-oidc-provider](https://github.com/panva/node-oidc-provider) library, it speaks the full OAuth2/OIDC spec from day one. Near-term, it will support [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html) — letting your identity service join a trust chain and participate in federated trust ecosystems for a more robust and verifiable infrastructure.

> Parako.ID uses the certified library but has not itself undergone OpenID Foundation certification.

## Features

- **SSO & OAuth2/OIDC** — full spec compliance, dynamic client registration
- **MFA** — TOTP, email codes, WebAuthn/passkeys
- **Social login** — GitHub, Google, Facebook, LinkedIn, Microsoft
- **Multi-tenancy** — tenant isolation with shared or separate databases
- **Multi-account sessions** — switch between identities seamlessly
- **Admin panel** — manage users, clients, and settings from the browser
- **CLI tools** — `yarn client add`, `yarn client list`, `yarn keys generate`
- **Systemd support** — `yarn systemd install` as a PM2 alternative

## Install

```bash
curl -sSL https://get.parako.id | sh
```

Or manually:

```bash
wget https://github.com/Dahkenangnon/Parako.ID/releases/latest/download/parako-id-v*.tar.gz
tar -xzf parako-id-v*.tar.gz && cd parako-id-release
cp .env.example .env   # edit with your settings
yarn start
```

**Requirements:** Node.js ≥ 24, Yarn

## Development

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git && cd Parako.ID
yarn install && cp .env.example .env
yarn db:push && yarn keys generate && yarn dev
```

Visit `http://localhost:9007/auth/register` to create your first account.

## Production

SQLite works for small deployments. For production, use MongoDB or PostgreSQL with Redis:

```bash
# .env
DATABASE_URI=mongodb://localhost:27017/parako-id
REDIS_HOST=localhost
REDIS_PORT=6379
```

Deploy with systemd (`yarn systemd install`) or PM2 (`pm2 start ecosystem.config.cjs`).

## Updating

For one-liner installs, upgrade in place — backup, swap, migrate, health-check, and automatic rollback on failure are all handled:

```bash
curl -sSL https://get.parako.id | bash -s -- --update
```

Pin a specific version: `--update --version 0.1.1`

For source installs:

```bash
git pull
yarn install
yarn db:migrate:deploy   # PostgreSQL only
yarn build
yarn restart
```

## Documentation

Full documentation is at [docs.parako.id](https://docs.parako.id), covering configuration, multi-tenancy, social login, CLI tools, and deployment.

---

> [!NOTE]
> **Coming soon — OpenID Federation 1.0 support.**
> We are actively building [oidfed](https://github.com/Dahkenangnon/oidfed) — the complete OpenID Federation 1.0 implementation for JavaScript, runtime-agnostic, spec-compliant, and built on Web API standards. Federation support is planned for integration into Parako.ID in a future release.
> Follow the project at [oidfed.com](https://oidfed.com) and star the [repo](https://github.com/Dahkenangnon/oidfed) to stay updated.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and contribution guidelines.

## Security

Report vulnerabilities privately to [dah.kenangnon@gmail.com](mailto:dah.kenangnon@gmail.com). See [SECURITY.md](./SECURITY.md) for our disclosure policy.

## License

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
