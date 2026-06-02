---
title: 'Upgrading Parako.ID'
subtitle: 'Operator runbook for parako update and rollback'
category: 'DevOps'
order: 4
---

`parako update` is a release-pointer switcher: download, verify, stage, atomic symlink swap. The database, services, reverse proxy, and TLS remain operator-owned. The release notes for every version list the exact migration command (if any) and any breaking changes. See [Installer](installer.md) for the full installer contract.

## Pre-upgrade checklist

| Step | Action                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Read the [release notes](https://github.com/Dahkenangnon/Parako.ID/releases) for the target version. Note any migration command. |
| 2    | Back up the database if a migration is required (see step 2 below).                                                              |
| 3    | Confirm your supervisor and reverse-proxy configuration are unchanged.                                                           |

## Applying an upgrade

### 1. Verify the new release

```bash
parako update --dry-run --version vX.Y.Z
```

Downloads and cosign-verifies the artifact against a TMPDIR scratch space, prints what would change, and exits. No filesystem mutation on the install directory.

### 2. Back up the database

```bash
# PostgreSQL
sudo -u postgres pg_dump --no-owner --format=custom parako > parako-pre-vX.Y.Z.dump

# MongoDB
mongodump --uri="${MONGO_URI}" --archive=parako-pre-vX.Y.Z.archive --gzip

# SQLite
sqlite3 /opt/parako-id/runtime/data/parako.db ".backup parako-pre-vX.Y.Z.db"
```

Skip if the release notes specify no migration command and you accept the risk.

### 3. Apply the release-pointer swap

```bash
sudo parako update --version vX.Y.Z
```

Atomic `mv -T` on `/opt/parako-id/current`. The previous release directory is retained for rollback.

### 4. Run the migration (if release notes specify one)

```bash
cd /opt/parako-id/current
sudo -u parako pnpm db:migrate:deploy
```

> **Warning:** If the release notes name no migration command, skip this step.

### 5. Restart your service and verify

```bash
sudo systemctl restart parako-id parako-id-worker   # or: pm2 restart … / docker compose restart parako-id
curl -sf http://localhost:9007/health
```

## Rollback

```bash
sudo parako rollback                  # previous release
sudo parako rollback --to v0.1.5      # specific release
```

`parako rollback` atomically re-aims the `current` symlink to a prior release directory. The application files revert.

> **Warning:** Database migrations are NOT rolled back. If you ran a forward migration in step 4, apply the reverse migration manually before restarting on the older release.

### Rollback decision tree

```
Did you run a migration this upgrade?
├── No  → parako rollback → restart your service. Done.
└── Yes → apply reverse migration → parako rollback → restart your service.
```

## Source installs

Source installs (git clone) upgrade manually: `git pull && pnpm install && pnpm build`, then any migration named in the release notes, then restart. The bash installer refuses `--update` against a directory containing `.git/`. See [Install from Source](installer-from-source.md). Everything under `runtime/` is operator-managed and survives every upgrade — see [Installer → Layout](installer.md#layout).

## See also

- [Installer](installer.md)
- [parako CLI](parako-cli.md)
- [Updates & Maintenance](updates-and-maintenance.md)
- [Install from Source](installer-from-source.md)
