---
title: 'parako CLI'
subtitle: 'Production deployment, backup, update, and service management'
category: 'DevOps'
order: 2
---

`parako` is installed with a verified release. It operates the standard
`/opt/parako-id` layout and uses only the runtime and tools bundled with that
release. Set `PARAKO_INSTALL_DIR` when using a different installation path.

Application and OIDC configuration is intentionally outside this CLI and stays
in the admin panel. DNS, TLS, and reverse-proxy configuration are also external.

## Command summary

| Command                                                      | Purpose                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `parako version`                                             | Show helper, installer, current, and previous versions    |
| `parako paths`                                               | Show resolved release and runtime paths                   |
| `parako config init ...`                                     | Create a bootstrap-only production `.env` and secrets     |
| `parako config check\|path`                                  | Validate or locate the bootstrap environment              |
| `parako db status\|migrate`                                  | Inspect or apply shipped database migrations              |
| `parako db baseline --confirm-existing-schema`               | Adopt a matching schema previously created with `db push` |
| `parako admin bootstrap --email EMAIL`                       | Issue a single-use first-admin activation URL             |
| `parako backup-keygen FILE`                                  | Create an `age` identity and print its public recipient   |
| `parako backup [--recipient AGE]`                            | Create an encrypted database/runtime backup               |
| `parako restore FILE --identity FILE --yes`                  | Explicitly restore a compatible encrypted backup          |
| `parako service install\|start\|stop\|restart\|status\|logs` | Manage native systemd app and worker units                |
| `parako deploy [--user USER]`                                | Validate, migrate, install, start, and verify             |
| `parako health`                                              | Query local `/readyz`                                     |
| `parako diag`                                                | Check database, Redis, systemd, and HTTP readiness        |
| `parako update [--version vX.Y.Z]`                           | Back up, update, migrate, restart, and verify             |
| `parako rollback [--to vX.Y.Z]`                              | Revert application files after a DB compatibility check   |
| `parako doctor`                                              | Inspect release layout and bootstrap file presence        |
| `parako gc [--keep N] [--yes]`                               | Prune inactive releases, never runtime data               |
| `parako clean-stale`                                         | Remove abandoned temporary release pointers               |
| `parako self-update [--force]`                               | Refresh only the helper binary                            |
| `parako uninstall [--purge]`                                 | Remove releases; preserve runtime unless purged           |

## Configure and deploy

```bash
sudo parako backup-keygen /root/parako-backup-identity.txt

sudo parako config init \
  --url https://auth.example.com \
  --adapter postgresql \
  --database-url 'postgresql://parako:password@db/parako' \
  --redis-host redis \
  --redis-port 6379 \
  --backup-recipient 'age1...'

sudo parako config check
sudo parako deploy
sudo parako diag
```

`config init` generates the bootstrap secrets used to start the server. It sets
`USE_FILE_CONFIG=false`; application and OIDC settings are then managed through
the database-backed admin panel.

`deploy` requires root because it creates the service account, installs systemd
units, fixes restrictive ownership, and controls services. It checks Redis
before activation, applies database migrations, requires both app and worker to
be active, and requires `/readyz` to return success.

## First administrator

After migrations succeed:

```bash
sudo parako admin bootstrap --email admin@example.com
```

The URL contains a bearer credential. It is printed once, stored only as a
SHA-256 hash in the database, expires, and is invalidated when the password is
set. If an activated administrator already exists, the command refuses to
replace it.

## Backups and restores

```bash
sudo parako backup
sudo parako restore /opt/parako-id/runtime/backups/parako-....tar.gz.age \
  --identity /root/parako-backup-identity.txt \
  --yes
```

Backups are encrypted before being written to their final file. They contain
the selected database plus runtime uploads and key material. The restore path
rejects absolute/traversal paths and symbolic links, stops services, confirms
the database adapter matches, and requires explicit `--yes`.

Bootstrap secrets are not restored unless `--restore-secrets` is also passed.
Keep the `age` identity off-host and periodically test restores on an isolated
host.

PostgreSQL requires `pg_dump`/`pg_restore`; MongoDB requires
`mongodump`/`mongorestore`. The release bundles `age`, not database vendor tools.

## Updates and rollback

```bash
sudo parako update --version vX.Y.Z
sudo parako rollback                 # previous application release
sudo parako rollback --to vX.Y.Z
```

Update always creates an encrypted backup first. If migration or readiness
fails, services remain stopped and the CLI prints recovery guidance. Database
restore is never automatic.

Rollback changes the application pointer only. It checks migration status
against the older release before restarting. If the schema is incompatible,
services remain stopped until the matching backup is explicitly restored.

## Diagnostics and logs

```bash
sudo parako diag
sudo parako service status
sudo parako service logs --since '1 hour ago'
sudo parako health
```

`doctor` is file-oriented and works even when services are absent. `diag` is the
production dependency check and expects a configured database, Redis, systemd,
and a running HTTP service.

## Safety properties

- Releases are immutable and activated by an atomic `current` symlink swap.
- Concurrent installer mutation is blocked with a file lock.
- Runtime data survives update, rollback, and normal uninstall.
- Migration failures and partial app/worker activation fail closed.
- The systemd service cannot write into immutable release directories.
