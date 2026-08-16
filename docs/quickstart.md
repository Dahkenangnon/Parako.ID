---
title: 'Quickstart'
subtitle: 'Run locally or deploy a verified production release'
category: 'Getting Started'
order: 2
---

## Local development

Prerequisites are Node.js 24 or later, pnpm 11 or later, GNU util-linux
`script` for real-terminal CLI integration tests, PostgreSQL server tools, and
`redis-server`. A reachable externally managed PostgreSQL or Redis service can
be supplied instead of its local server binary.

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install --frozen-lockfile
pnpm setup:dev
pnpm dev
```

`pnpm setup:dev` creates `runtime/.env` from the repository's canonical
`.env.example`, generates fresh local secrets, copies the sample JSONC
configuration, installs Chrome for Playwright, applies the SQLite migrations,
and prepares PostgreSQL and Redis for the complete test suite. It preserves
existing files and explicit service settings. When no reachable service is
configured, it creates a private PostgreSQL cluster and Redis configuration
under the ignored `runtime/data` directory, binds them to loopback, and records
their reusable test settings in `runtime/.env`. Rerun the command to restart
the managed services after a reboot.

To generate only the private environment file, run:

```bash
pnpm setup:env
```

The development server listens on `http://localhost:9007`. Do not reuse
development secrets or the disposable test databases in production. Setup
fails with an actionable message when a required executable, network download,
or configured external service is unavailable.

Before opening a pull request, run the repository quality gate:

```bash
pnpm verify
```

After `setup:dev`, the complete adapter and browser matrix can run without
manually exporting local service variables:

```bash
pnpm verify:all
```

CI and custom environments may provide `PARAKO_E2E_POSTGRESQL_URL` and the
`PARAKO_E2E_REDIS_*` variables explicitly. Shell values take precedence over
the generated local settings. The PostgreSQL role is disposable and must be
allowed to create and drop isolated test databases.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for narrower test commands and the
five supported storage/tenancy cells.

## Production host

Supported hosts are Debian 12/13 or Ubuntu 24.04/26.04 on x86_64 or AArch64.
Choose either the native systemd release or the supported Docker Compose
release for an installation. DNS and an external HTTPS reverse proxy remain
operator-owned in both modes.

Install the signed release:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

This installs the verified native release. Operators who require local source
builds can instead use the [commit-pinned Git installer](installer-from-source.md).
For a signed Docker image with managed or external database and Redis choices,
use:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id \
  | sudo bash -s -- --docker
```

Continue with the [Docker deployment runbook](docker.md); Docker lifecycle
commands are namespaced under `parako docker`. The remaining production commands
in this quickstart apply to the native systemd installation.

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
- [Native production deployment](deployment.md)
- [Docker production deployment](docker.md)
- [parako CLI](parako-cli.md)
- [Upgrades and rollback](upgrades.md)
- [Integrating Your App](integrating-your-app.md)
