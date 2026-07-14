---
title: 'Quickstart'
subtitle: 'Run locally or deploy a verified production release'
category: 'Getting Started'
order: 2
---

## Local development

Prerequisites are Node.js 24 or later and pnpm 11 or later.

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install
cp .env.example runtime/.env
pnpm db:push
pnpm dev
```

The development server listens on `http://localhost:9007`. Development may use
SQLite and local Redis. Do not copy development secrets into production.

## Production host

Supported hosts are Debian 12 or Ubuntu 24.04 on x86_64 or AArch64. Provision
Redis, a database, DNS, and an external HTTPS reverse proxy first.

Install the signed release:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

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
  --adapter postgresql \
  --database-url 'postgresql://parako:password@db.example.com/parako' \
  --redis-host redis.example.com \
  --redis-port 6379 \
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
