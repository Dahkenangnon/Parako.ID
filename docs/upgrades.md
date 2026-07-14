---
title: 'Upgrades and rollback'
subtitle: 'Encrypted backup, verified release switch, migration, and recovery'
category: 'DevOps'
order: 4
---

`parako update` is the production upgrade transaction. It validates the current
configuration and Redis, creates an encrypted backup, downloads and verifies an
architecture-specific release, stops services, atomically switches the release
pointer, applies shipped migrations, restarts app and worker, and requires
readiness to pass.

Database restore is intentionally never automatic.

## Before the change window

1. Read the target [release notes](https://github.com/Dahkenangnon/Parako.ID/releases).
2. Confirm free disk space for a release and backup.
3. Confirm the `age` identity is readable from a separate recovery location.
4. Run `sudo parako diag` and resolve every failure.
5. Test a recent backup restore on an isolated host.
6. Ensure the database vendor backup tools match the server major version.

Preview release selection without changing the installation:

```bash
sudo parako update --plan --version vX.Y.Z
sudo parako update --dry-run --version vX.Y.Z
```

`--plan` makes no network calls or writes. `--dry-run` downloads and verifies
the release but does not activate it.

## Upgrade

```bash
sudo parako update --version vX.Y.Z
```

Do not independently restart services while this command holds the installer
lock. A successful command means:

- the pre-update encrypted backup completed;
- artifact signature, checksum, manifest, migrations, and SBOM were verified;
- all forward migrations completed;
- app and worker services are active;
- local readiness passed.

Finish with an external smoke test through the public HTTPS endpoint and an
OIDC authorization-code flow from a non-production test client.

## Failure behavior

| Failure point                                | Result                                              |
| -------------------------------------------- | --------------------------------------------------- |
| Backup, download, or verification            | Old release remains active                          |
| Migration                                    | New pointer remains selected; services stay stopped |
| App readiness or worker activation           | Both services are stopped                           |
| Old-release DB compatibility during rollback | Services stay stopped                               |

Inspect logs and state:

```bash
sudo parako service logs --since '30 minutes ago'
sudo parako db status
sudo parako doctor
```

Retry a failed forward migration only after understanding and correcting the
database error:

```bash
sudo parako db migrate
sudo parako service start
sudo parako diag
```

## Application rollback

```bash
sudo parako rollback
# or
sudo parako rollback --to vX.Y.Z
```

Rollback switches application files only; it never guesses how to reverse data
migrations. The older release runs its own migration-status check before the
CLI restarts anything. If it is incompatible with the current schema, restore
the matching encrypted backup explicitly.

## Restore a pre-upgrade backup

```bash
sudo parako restore /opt/parako-id/runtime/backups/parako-....tar.gz.age \
  --identity /root/parako-backup-identity.txt \
  --yes
sudo parako diag
```

Restore stops services and replaces data for the configured adapter. For
SQLite, the current database is copied to a timestamped `before-restore` file
first. Bootstrap `.env` secrets are preserved unless `--restore-secrets` is
explicitly requested.

Choose one coherent recovery direction:

```text
Forward fix:   new application + forward-migrated database
Full rollback: old application + matching pre-upgrade database backup
```

Never start an old release against a partially migrated database merely to see
whether it works.

## Retention

After the release has remained healthy for the organization’s rollback window:

```bash
sudo parako gc --keep 3 --yes
```

GC preserves the active and previous releases and never deletes `runtime/` or
backup files. Move backups to separate durable storage and apply an independent
retention policy there.

Source checkouts are upgraded manually and are not eligible for installer
pointer updates. See [Install from Source](installer-from-source.md).
