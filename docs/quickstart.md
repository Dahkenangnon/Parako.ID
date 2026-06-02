---
title: 'Quickstart'
subtitle: 'Get Parako.ID running in five minutes'
category: 'Getting Started'
order: 2
---

Two paths land you on a working Parako.ID. Choose the one that matches your goal.

| Path                        | Audience                        | Time                        |
| --------------------------- | ------------------------------- | --------------------------- |
| [From source](#from-source) | Contributors, local development | ~3 minutes                  |
| [Installer](#installer)     | Operators deploying to a host   | ~5 minutes + operator setup |

## Prerequisites

Linux x86_64 or aarch64, Node.js ≥ 24, pnpm ≥ 11. Enable pnpm via Corepack:

```bash
corepack enable && corepack prepare pnpm@11 --activate
```

## From source

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install
cp .env.example .env
pnpm db:push
pnpm dev
```

JWKS keys are generated automatically on first start and stored in the database. The server listens on `http://localhost:9007`.

> **Important:** `.env` ships with development defaults. Production secrets and database choices live in [Configuration](configuration.md).

## Installer

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

The installer verifies the release via cosign (Sigstore) and places files under `/opt/parako-id/`. It does not configure your supervisor, database, TLS, or secrets — see [Installer](installer.md) for the full contract.

> **Important:** The installer prints a next-steps card on completion. Complete those steps before starting the service.

Operator steps after install:

1. Create `/opt/parako-id/runtime/.env` from `/opt/parako-id/current/contrib/.env.sample` and fill in your DB / Redis / secrets.
2. Wire your process manager to `/opt/parako-id/current` (sample PM2 ecosystem ships at `current/contrib/ecosystem.config.cjs.sample`; nginx examples at [`docs/reference/nginx-vhost-examples/`](reference/nginx-vhost-examples/)).
3. Apply any database migration named in the release notes.
4. Start your service.
5. Probe `http://localhost:9007/health`.

The `parako` operator binary is on `PATH`; see [parako CLI](parako-cli.md) for the verb reference and [Upgrades](upgrades.md) for the upgrade runbook.

## Create your first admin

Open `http://localhost:9007/auth/register` and create an account. Promote that user to `admin` via the admin panel or by editing the user record directly. See [Admin Panel](admin-panel.md).

## Register your first OIDC client

Use the admin panel at `/admin/oidc-clients` — the wizard collects client type, redirect URIs, and scopes, then prints the `client_id` and `client_secret`. Store the secret immediately; it is encrypted at rest and not retrievable afterward.

See [OIDC Clients](oidc-clients.md) for the full client model and presets, or [CLI Tools](cli-tools.md) for `pnpm client add` (file-based single-tenant only).

## Test the OIDC flow

Walk through an end-to-end authorization-code + PKCE exchange against your local Parako.ID in [Integrating Your App](integrating-your-app.md#authorization-code-flow).

## See also

- [Installer](installer.md)
- [Configuration](configuration.md)
- [Integrating Your App](integrating-your-app.md)
- [Troubleshooting](troubleshooting.md)
