---
title: 'Installer'
subtitle: 'Place and update Parako application files. Operators own the rest.'
category: 'DevOps'
order: 1
---

The Parako.ID installer is a single bash script published at `https://get.parako.id`. It verifies the release artifact, stages it, preserves operator-owned runtime files, and atomically switches the application release pointer.

> **Important:** Infrastructure, database backups, database migrations, process management, reverse proxy, TLS, secrets, and production configuration remain operator responsibilities. The installer never performs any of these. The next-steps card it prints after every install or update names each operator action and links to the per-release migration command.

Source: [`installer/install.sh`](https://github.com/Dahkenangnon/Parako.ID/tree/main/installer).

## Quick reference

```bash
# Fresh install (system-wide)
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash

# Pinned version
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash -s -- --version v0.2.0

# Update / rollback / gc / doctor — see parako CLI for the helper
parako update
parako rollback
parako gc --keep 3 --yes
parako doctor
```

Full upgrade runbook: [Upgrades](upgrades.md). Operator CLI reference: [parako CLI](parako-cli.md).

## What the installer does

| Phase    | Action                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verify   | OS / arch check, download tarball + SHA256SUMS + cosign signature + certificate, verify SHA256, verify the cosign keyless signature against Sigstore.                                                        |
| Stage    | Extract into `INSTALL_DIR/releases/.staging.<tag>.<pid>/`, smoke-check `dist/src/index.js`, atomically promote to `releases/<tag>/`.                                                                         |
| Preserve | On first install only, populate `INSTALL_DIR/runtime/` with the shipped `locales/`, `views/`, `assets/` subtrees. Replace `releases/<tag>/runtime` with a symlink back to the shared `INSTALL_DIR/runtime/`. |
| Switch   | Atomic `mv -T` swap of the `INSTALL_DIR/current` symlink to the new release. Record metadata in `INSTALL_DIR/.parako-state` (mode `0644`, no secrets).                                                       |
| Hand off | Install `/usr/local/bin/parako` (non-fatal). Print the next-steps card.                                                                                                                                      |

Escape hatch: `--insecure-no-signature --reason "<text>"` when Sigstore is unreachable (reason is logged). See [Installer Security](installer-security.md).

## What the installer does NOT do

Operator-owned, never performed by the installer:

- **Database** — connections, migrations, backups, restores, schema rollbacks.
- **Services** — start, stop, restart, supervisor configuration (systemd, PM2, docker, runit, …).
- **Reverse proxy** — nginx, Caddy, Traefik, HAProxy configuration and reloads.
- **TLS** — certbot, Let's Encrypt, internal CA, certificate renewal.
- **Secrets** — `runtime/.env`, signing keys (`runtime/jwks/`), API tokens, admin passwords.
- **OS packages** — Node.js, pnpm, openssl, database client tooling, cosign.
- **Bootstrap admin** — create the first administrator via `/auth/register`, then promote.

The release notes for every version list the exact migration command (if any) and any breaking changes.

## Layout

```text
/opt/parako-id/
├── current        →  /opt/parako-id/releases/v0.2.0/      (atomic mv -T swap)
├── releases/
│   └── v0.2.0/
│       ├── dist/, node_modules/, package.json, public/, contrib/
│       └── runtime  →  /opt/parako-id/runtime/             (absolute symlink)
├── runtime/                                                (operator-managed)
│   ├── .env                                                (you create from contrib/.env.sample)
│   ├── jwks/                                               (only for file-backed key storage)
│   ├── parako-rp.jsonc                                     (your OIDC client registry)
│   ├── data/, uploads/, logs/, backups/, config-backups/   (operator data)
│   └── locales/, views/, assets/                           (populated on first install only)
├── .parako-state                                           (0644, no secrets)
└── .install-lock
```

Point your supervisor's `WorkingDirectory` (systemd) or `cwd` (PM2) at `/opt/parako-id/current`.

## Configuration setup (first install)

Copy the shipped samples into your operator-owned `runtime/` tree, edit `.env`, and (for file-backed key storage only) generate `runtime/jwks/jwks.json` with `jose`/`openssl`. The default DB-backed key store does not require it. See [Configuration](configuration.md) and [Deployment](deployment.md) for env-var and supervisor/nginx/TLS reference.

```bash
sudo cp /opt/parako-id/current/contrib/.env.sample            /opt/parako-id/runtime/.env
sudo cp /opt/parako-id/current/contrib/parako-rp.sample.jsonc /opt/parako-id/runtime/parako-rp.jsonc
sudo $EDITOR /opt/parako-id/runtime/.env
```

## Update procedure

```bash
parako update                     # latest stable
parako update --version v0.2.1    # pin
```

See [Upgrades](upgrades.md) for the full operator runbook (read notes → backup DB → dry-run → apply → migrate → restart → verify → rollback). Pre-change-window rehearsals:

| Mode                      | Network | Download + verify | INSTALL_DIR writes       |
| ------------------------- | ------- | ----------------- | ------------------------ |
| `parako update --plan`    | no      | no                | no                       |
| `parako update --dry-run` | yes     | yes               | no                       |
| `parako update` (real)    | yes     | yes               | yes (after confirmation) |

## Rollback

```bash
parako rollback                  # previous release
parako rollback --to v0.1.5      # specific release
```

Atomic re-aim of the `current` symlink. Application files revert.

> **Warning:** Database migrations are NOT reversed. See [Upgrades → Rollback](upgrades.md#rollback) for the decision tree.

## Garbage collection

```bash
parako gc                        # preview
parako gc --keep 3 --yes         # apply
```

Two releases are protected unconditionally: the currently-pointed release and the previous one. `--keep N` (default 3) retains N more from the deletable set. **GC never touches `runtime/`** — including `runtime/backups/`, `runtime/logs/`, and `runtime/uploads/`.

## Doctor

```bash
parako doctor                    # human-readable
parako doctor --json             # structured output
```

Reports file/config sanity only: resolves `current`, confirms `dist/src/index.js` exists, warns on missing `runtime/.env`, lists the releases on disk. Doctor does NOT call `systemctl`, `pm2`, `curl /health`, or any database client. Use your own tooling for service / DB / health probing.

## Air-gapped install

The installer itself must already be on the air-gapped host. **On a connected machine:**

```bash
VERSION=v0.2.0
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id/install.sh -o install.sh
gh release download "$VERSION" -R Dahkenangnon/Parako.ID \
  -p "parako-id-${VERSION}.tar.gz" \
  -p "parako-id-${VERSION}.tar.gz.sig" \
  -p "parako-id-${VERSION}.tar.gz.pem" \
  -p SHA256SUMS
# Also fetch a cosign binary for the air-gapped host's arch:
#   https://docs.sigstore.dev/cosign/system_config/installation/
```

**Transfer** all files plus the `cosign` binary to the air-gapped host. **On that host**, with `cosign` on `PATH`:

```bash
sudo bash ./install.sh \
  --offline --version v0.2.0 \
  --tarball     ./parako-id-v0.2.0.tar.gz \
  --checksum    ./SHA256SUMS \
  --signature   ./parako-id-v0.2.0.tar.gz.sig \
  --certificate ./parako-id-v0.2.0.tar.gz.pem
```

Under `--offline`: `--version` is required; `cosign` must be preinstalled (the installer refuses to fetch it); cosign verification still runs against the supplied files.

## Verifying the installer itself

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id -o /tmp/install.sh
EXPECTED="<sha256 from the release notes>"
[ "$(sha256sum /tmp/install.sh | awk '{print $1}')" = "$EXPECTED" ] \
  && bash /tmp/install.sh --help \
  || echo "MISMATCH — DO NOT RUN"
```

Full chain-of-trust: [Installer Security](installer-security.md).

## Prerequisites

| Requirement     | Version                    | Notes                                                     |
| --------------- | -------------------------- | --------------------------------------------------------- |
| Linux           | x86_64 or aarch64          | Other OS / arch fails fast in preflight                   |
| bash            | ≥ 4.0                      | Alpine: `apk add bash`                                    |
| GNU coreutils   | any recent                 | For `mv -T`. Alpine: `apk add coreutils`                  |
| util-linux      | any recent                 | For `flock`. Alpine: `apk add util-linux`                 |
| curl OR wget    | any recent                 | TLS 1.2 capable                                           |
| openssl, tar    | any recent                 | For checksum verification + extraction                    |
| Free disk space | ≥ 2 GB                     | Verified by preflight                                     |
| Node.js, pnpm   | per release notes          | Operator-provisioned; the installer does not install them |
| Database        | per release notes          | Operator-provisioned (PostgreSQL, MongoDB, or SQLite)     |
| Supervisor      | systemd / PM2 / docker / … | Operator-managed                                          |

If a preflight check fails, the installer exits with code 2 before any download or filesystem write.

## See also

- [Upgrades](upgrades.md)
- [parako CLI](parako-cli.md)
- [Installer Security](installer-security.md)
- [Install from Source](installer-from-source.md)
- [Configuration](configuration.md)
- [Deployment](deployment.md)
- [Quickstart](quickstart.md)
- [Troubleshooting](troubleshooting.md)
