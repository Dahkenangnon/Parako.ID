---
title: 'Installer'
subtitle: 'Install, update, roll back, and diagnose Parako.ID with the official installer'
category: 'DevOps'
order: 1
---

The Parako.ID installer is a single bash script published at `https://get.parako.id`. It handles fresh installation, in-place updates, post-hoc rollback, garbage collection of snapshots, and diagnostic reporting. The source lives at [`installer/install.sh`](https://github.com/Dahkenangnon/Parako.ID/tree/main/installer) in the project repo for full transparency.

## Quick reference

```bash
# Interactive install
curl -sSL https://get.parako.id | sudo bash

# Non-interactive production install with TLS
curl -sSL https://get.parako.id | sudo bash -s -- \
  --non-interactive --force \
  --domain auth.example.com \
  --db postgres --postgres-url 'postgresql://parako:***@localhost/parako' \
  --redis-url 'redis://localhost:6379' \
  --supervisor systemd \
  --with-nginx --with-tls --tls-email admin@example.com \
  --bootstrap-admin admin@example.com

# In-place update to latest stable
curl -sSL https://get.parako.id | sudo bash -s -- --update

# Preview the update without changing anything
curl -sSL https://get.parako.id | sudo bash -s -- --update --plan

# Roll back to the previous snapshot
curl -sSL https://get.parako.id | sudo bash -s -- --rollback

# Diagnose an existing install
curl -sSL https://get.parako.id | sudo bash -s -- --doctor
```

After install, all of the above are also available via the operator binary `parako`. See [parako CLI](parako-cli.md).

## Prerequisites

| Requirement     | Version    | Notes                                                    |
| --------------- | ---------- | -------------------------------------------------------- |
| bash            | ≥ 4.0      | On Alpine: `apk add bash` first                          |
| Node.js         | ≥ 24       | <https://nodejs.org>                                     |
| pnpm            | ≥ 11       | `corepack enable && corepack prepare pnpm@11 --activate` |
| openssl         | any recent | For secret generation                                    |
| curl OR wget    | any recent | TLS 1.2 capable                                          |
| sudo (or root)  | —          | For system-wide installs only                            |
| Free disk space | ≥ 2 GB     | Verified by preflight                                    |

The installer's preflight catches missing prerequisites, system time skew, port conflicts, DNS failures, and unwriteable directories **before** any download or mutation.

## What happens during an install

1. **Preflight** — every requirement above is checked and reported as `[OK]`, `[WARN]`, or `[FAIL]`. Any failure exits the installer with code 2 before any download.
2. **Sniff** — the installer probes your host for already-running services (PostgreSQL, MongoDB, Redis, nginx, certbot) and pre-fills wizard defaults from what it finds.
3. **Download** — release tarball, SHA256SUMS, cosign signature, and certificate fetched from GitHub Releases (over TLS 1.2+, with the `--proto '=https' --tlsv1.2` curl flags borrowed from rustup).
4. **Verify** — the tarball's SHA256 is matched against SHA256SUMS, and **the cosign signature is verified against the Sigstore transparency log** with the certificate identity bound to the `release.yml` workflow. Verification is mandatory.
5. **Wizard** — collects environment, port, deployment URL, supervisor, database, Redis. Smart defaults from the sniff step. Press Enter to accept any default.
6. **Beginning ritual** — before any mutation, the installer prints:
   - Preflight results
   - Detected services
   - Plan: every file that will be created or modified outside `INSTALL_DIR`
   - Install notes preview
   - Install log location
   - Safety assurances
     Then waits for `[y/N]` (60s timeout) or 5s grace under `--non-interactive --force`.
7. **Write `.env`** — atomically, mode 0600, owned by the `parako` user. Six cryptographic secrets generated via `openssl rand -hex 32`.
8. **Validate connections** — DB and Redis dial-tests using the release's bundled drivers.
9. **Install dependencies** — skipped if the tarball already ships `node_modules` (the default for v0.2.0+).
10. **Run migrations** — Prisma `migrate deploy` (PostgreSQL), `db push` (SQLite), no-op (MongoDB).
11. **Supervisor setup** — systemd unit files via `dist/scripts/manage/systemd.js install`, or PM2 via `runtime/ecosystem.config.cjs`.
12. **Generate `INSTALL_NOTES.md`** — every wizard answer, every selected flag, version, snapshot path. Secrets redacted to `***`.
13. **Install `parako` binary** — `/usr/local/bin/parako` (system) or `~/.local/bin/parako` (user).
14. **nginx + TLS (if requested)** — vhost rendered via `write_root_file()` with allowlist + backup + verify; certbot run for Let's Encrypt.
15. **Health check** — `/health` endpoint polled for 15 s.
16. **Recovery card** — prints URL, admin path, log location, common operations.

## Modes

The installer supports six mutually-exclusive modes:

| Mode         | When to use                                       |
| ------------ | ------------------------------------------------- |
| (no flag)    | Fresh install on a clean machine                  |
| `--update`   | In-place upgrade of an existing install           |
| `--rollback` | Restore the previous snapshot                     |
| `--doctor`   | Diagnose an existing install (no mutation)        |
| `--gc`       | Garbage-collect old snapshots                     |
| `--demo`     | Ephemeral SQLite install in `/tmp` for evaluation |

## Update flow

```bash
# Latest stable
curl -sSL https://get.parako.id | sudo bash -s -- --update

# Pin
curl -sSL https://get.parako.id | sudo bash -s -- --update --version 0.3.1

# Plan (no mutations)
curl -sSL https://get.parako.id | sudo bash -s -- --update --plan

# Everything except the directory swap
curl -sSL https://get.parako.id | sudo bash -s -- --update --dry-run
```

Update procedure:

1. **Snapshot** the current install to `${INSTALL_DIR}.backup.${ts}` (full directory copy).
2. **Stop the service** via the recorded supervisor.
3. **Back up the database** to `runtime/backups/pre-${ver}-${ts}.*` (`pg_dump` / `mongodump` / `sqlite3 .backup`). Failure to back up aborts the update.
4. **Download + verify** the target release (cosign mandatory).
5. **Extract** to `${INSTALL_DIR}.new.${ts}`.
6. **Preserve runtime state** — `runtime/{jwks,views,assets,config-backups,data,uploads}`, `runtime/.env`, and `.supervisor` marker carried over from the old install. **`runtime/locales` is intentionally refreshed** from the new tarball so new translations land.
7. **Run migrations** against the new code.
8. **Atomic swap** — the new directory takes over `${INSTALL_DIR}`; the old one becomes `${INSTALL_DIR}.old.${ts}`.
9. **Start the service** and **health-check** `/health`.
10. **Auto-rollback on health failure** — the snapshot is restored, the broken upgrade is preserved at `${INSTALL_DIR}.failed.${ts}` for inspection.

## Rollback flow

```bash
# Latest snapshot
curl -sSL https://get.parako.id | sudo bash -s -- --rollback

# Specific snapshot
curl -sSL https://get.parako.id | sudo bash -s -- --rollback --to 20260601T134208Z

# Also rewind DB migrations (use with care)
curl -sSL https://get.parako.id | sudo bash -s -- --rollback --migrate-back
```

Rollback explicitly does **not** auto-revert on health-check failure (the operator chose rollback; if the snapshot is broken, the operator wants to know loud and clear).

## Garbage collection

```bash
# Preview (default; no deletes)
curl -sSL https://get.parako.id | sudo bash -s -- --gc --keep 3

# Apply
curl -sSL https://get.parako.id | sudo bash -s -- --gc --keep 3 --yes
```

Removes `*.backup.*`, `*.old.*`, `*.failed.*`, and `runtime/backups/pre-*` older than the N most recent of each kind.

## Multi-tenant install

```bash
curl -sSL https://get.parako.id | sudo bash -s -- \
  --non-interactive --force \
  --multi-tenant --base-domain auth.example.com \
  --db postgres --postgres-url '...' \
  --redis-url 'redis://localhost:6379' \
  --supervisor systemd \
  --with-nginx --with-tls --tls-email admin@example.com \
  --certbot-dns-plugin cloudflare \
  --bootstrap-admin admin@example.com
```

Prerequisites:

- Wildcard DNS A record: `*.auth.example.com` → VPS IP
- Explicit A records for `_ops.auth.example.com` and `_platforms.auth.example.com`
- A certbot DNS plugin (`cloudflare`, `route53`, `digitalocean`, …) configured for wildcard cert issuance

See [Multi-tenancy](multi-tenancy.md) for application-level configuration.

## Air-gapped / offline install

```bash
curl -sSL https://get.parako.id | sudo bash -s -- \
  --offline \
  --tarball   ./parako-id-v0.2.0.tar.gz \
  --checksum  ./SHA256SUMS \
  --signature ./parako-id-v0.2.0.tar.gz.sig \
  --certificate ./parako-id-v0.2.0.tar.gz.pem
```

Cosign verification still runs against the supplied files; the same Sigstore-bound identity regex applies.

A release-manifest mirror can be configured via `PARAKO_RELEASE_MIRROR` for partially-disconnected environments where GitHub's API is intermittently unreachable but the release CDN is.

## Demo mode

```bash
curl -sSL https://get.parako.id | bash -s -- --demo
```

Ephemeral install under `/tmp/parako-id-demo-${pid}` with SQLite, a foreground-supervised server, an auto-seeded admin (one-time password printed), and a pre-registered sample OIDC client. Opens your default browser to the login page. Tear down with the printed `kill ... && rm -rf ...` command.

A red `DEMO MODE — DO NOT USE IN PRODUCTION` banner is printed; never confused with a production install.

## Install log

Every run writes a structured log to:

- `/var/log/parako-install-${ts}.log` (root install)
- `~/.local/state/parako/install-${ts}.log` (user install)

Mode 0600. Sensitive values (URI credentials, secret/key/token/password identifiers) are auto-redacted on every line. Set `PARAKO_LOG_LEVEL=debug` for trace-level capture.

## Beginning ritual

Before any mutation, every install and update prints six labeled panels in plain text (no Unicode box-drawing). Operators see exactly what's about to happen and can abort with Ctrl+C.

Example:

```
parako.id installer v0.2.0

== Preflight checks
  Node ............................. v24.5.0 [OK]
  pnpm ............................. 11.4.0 [OK]
  Disk free ........................ 14.2 GB [OK]
  Port 9007 ........................ free [OK]
  DNS .............................. github.com, api.github.com [OK]
  System time ...................... within 12s of UTC [OK]

== Detected on this host
  PostgreSQL ....................... localhost:5432
  Redis ............................ localhost:6379

== Plan
  Operation ........................ fresh install
  Version .......................... v0.2.0
  Install directory ................ /opt/parako-id
  Database ......................... postgresql
  Supervisor ....................... systemd
  URL .............................. https://auth.example.com

  Files that will be written outside /opt/parako-id:
    /etc/systemd/system/parako-id.service
    /etc/systemd/system/parako-id-worker.service
    /etc/nginx/sites-available/parako-id
    /usr/local/bin/parako
    /var/log/parako-install-20260601T134208Z.log

== Install notes
  Operator answers will be written to:
    /opt/parako-id/runtime/INSTALL_NOTES.md (mode 0600; secrets redacted)

== Install log
  /var/log/parako-install-20260601T134208Z.log

Before anything changes on your system:
  - Every preflight check above passed.
  - The release tarball will be verified via cosign (Sigstore).
  - A complete snapshot is taken before any mutation.
  - You can roll back later with `parako rollback`.

Proceed? [y/N]
```

## See also

- [parako CLI](parako-cli.md) — operator binary reference
- [Installer security](installer-security.md) — threat model and cosign chain-of-trust
- [Install from source](installer-from-source.md) — git-clone path with honest drawbacks
- [Updates & maintenance](updates-and-maintenance.md) — broader operational topics
- [Deployment](deployment.md) — nginx, TLS, multi-tenancy infrastructure notes
