---
title: 'Quickstart'
subtitle: 'Run locally or deploy a verified production release'
category: 'Getting Started'
order: 2
---

## Local development

Prerequisites are Node.js 24 or later, pnpm 11 or later, and GNU util-linux
`script` for real-terminal CLI integration tests.

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install --frozen-lockfile
pnpm setup:dev
pnpm dev
```

`pnpm setup:dev` creates `runtime/.env` with fresh local secrets, copies the
sample JSONC configuration, and applies the SQLite migrations. It preserves
both files when they already exist. The development server listens on
`http://localhost:9007`; the default app process needs no external database.
Redis is required when developing worker, queue, distributed cache, pub/sub,
or Redis-backed session/OIDC behavior. Do not reuse development secrets in
production.

Before opening a pull request, run the repository quality gate:

```bash
pnpm verify
```

The complete adapter and browser matrix additionally needs Chrome and a
disposable PostgreSQL service whose role may create and drop test databases:

```bash
pnpm exec playwright install chrome
export PARAKO_E2E_POSTGRESQL_URL='postgresql://parako:password@127.0.0.1:5432/parako_e2e'
pnpm verify:all
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for narrower test commands and the
five supported storage/tenancy cells.

## Production host

Supported hosts are Debian 12/13 or Ubuntu 24.04/26.04 on x86_64 or AArch64.
Install and secure local Redis before deployment; Parako.ID expects it at
`127.0.0.1:6379` by default but does not manage it. SQLite is the default
database and needs no database server. Provision PostgreSQL or MongoDB only
when you choose one and have a complete working URI. DNS and an external HTTPS
reverse proxy remain operator-owned.

Install the signed release:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

This verified native path is recommended. Operators who require local source
builds can instead use the [commit-pinned Git installer](installer-from-source.md).
Both methods use the same `parako` deployment and lifecycle commands.

Create an offline backup identity and keep a second protected copy away from
the server:

```bash
sudo parako backup-keygen /root/parako-backup-identity.txt
```

Create the bootstrap environment. Replace the recipient with the public value
printed by `backup-keygen`:

```bash
sudo parako config init \
  --url https://auth.example.com \
  --backup-recipient 'age1...'
```

Apply migrations, install the hardened app and worker systemd units, start
them, and verify local readiness:

```bash
sudo parako deploy
sudo parako diag
```

Create the first administrator:

```bash
sudo parako admin bootstrap --email admin@example.com
```

Open the printed single-use HTTPS activation URL, choose a strong password,
then use the admin panel to complete application settings and register the
first OIDC client. Parako.ID configuration is managed through the admin panel;
the CLI only maintains the bootstrap environment and production lifecycle.

## Before connecting a product

- Verify the public issuer and callback URLs through the HTTPS proxy.
- Run an authorization-code with PKCE flow from a non-production test client.
- Confirm email delivery and account recovery.
- Create `sudo parako backup`, copy it off-host, and test an isolated restore.
- Connect monitoring to `/health` for liveness and `/readyz` for readiness.
- Record the service, database, Redis, proxy, and certificate on-call runbook.

## See also

- [Installer](installer.md)
- [Production deployment](deployment.md)
- [parako CLI](parako-cli.md)
- [Upgrades and rollback](upgrades.md)
- [Integrating Your App](integrating-your-app.md)
