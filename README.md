
> **Work in Progress: This project is under active development. Features and documentation may change.**

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="280" />

# Parako.ID

**Your auth server. Self-hosted. Free.**

Self-hosted identity server with SSO, MFA, passkeys, and OAuth2 — zero per-user fees.

<a href="https://parako.id">Website</a> · <a href="https://docs.parako.id">Docs</a> · <a href="./readme.fr.md">Français</a>

</div>

---

Parako.ID gives you complete control over authentication. Deploy on any VPS in minutes with built-in SSO, multi-factor auth, passkeys, social login, and multi-tenancy. Built on the [OpenID Certified node-oidc-provider](https://github.com/panva/node-oidc-provider) library.

> Parako.ID uses the certified library but has not itself undergone OpenID Foundation certification.

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

**Requirements:** Node.js >= 24, Yarn

## Develop from source

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git && cd Parako.ID
yarn install && cp .env.example .env
yarn db:push && yarn keys generate && yarn dev
```

Visit `http://localhost:9007/auth/register` to create your first account.

## What you get

- **SSO & OAuth2/OIDC** — full spec compliance, dynamic client registration
- **MFA** — TOTP, email codes, WebAuthn/passkeys
- **Social login** — GitHub, Google, Facebook, LinkedIn, Microsoft
- **Multi-tenancy** — tenant isolation with shared or separate databases
- **Multi-account sessions** — switch between identities seamlessly
- **Admin panel** — manage users, clients, settings from the browser
- **CLI tools** — `yarn client add`, `yarn client list`, `yarn keys generate`
- **Systemd support** — `yarn systemd install` as PM2 alternative

## Production

SQLite works for small deployments. For production, use MongoDB or PostgreSQL with Redis:

```bash
# Configure in .env
DATABASE_URI=mongodb://localhost:27017/parako-id
REDIS_HOST=localhost
REDIS_PORT=6379
```

Deploy with systemd (`yarn systemd install`) or PM2 (`pm2 start ecosystem.config.cjs`).

## Updating

If you installed via the one-liner (`curl -sSL https://get.parako.id | bash`), upgrade in place — backup, swap, migrate, health-check, and automatic rollback on failure are all handled:

```bash
curl -sSL https://get.parako.id | bash -s -- --update
```

Pin a specific version with `--update --version 0.1.1`. For source/dev installs:

```bash
git pull
yarn install
yarn db:migrate:deploy   # PostgreSQL only
yarn build
yarn restart
```

## Security

Report vulnerabilities to [dah.kenangnon@gmail.com](mailto:dah.kenangnon@gmail.com). See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
