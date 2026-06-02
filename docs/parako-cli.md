---
title: 'parako CLI'
subtitle: 'The parako operator binary — installed at /usr/local/bin/parako alongside Parako.ID'
category: 'Guides'
order: 3
---

The `parako` binary is a thin bash wrapper around `systemctl` / `pm2` / `journalctl` / `curl` that gives operators a uniform command surface regardless of supervisor choice. It is installed automatically by the [installer](installer.md) at `/usr/local/bin/parako` (system) or `~/.local/bin/parako` (user).

The source lives at [`installer/parako.sh`](https://github.com/Dahkenangnon/Parako.ID/tree/main/installer/parako.sh).

## Quick reference

```bash
parako                     # show help
parako status              # version, supervisor, /health, DB, Redis summary
parako start               # start the service
parako stop                # stop
parako restart             # restart
parako logs -f             # tail
parako doctor              # full preflight + post-install checks
parako diag                # bug-report bundle
parako update              # in-place upgrade
parako rollback            # revert to previous snapshot
parako backup --out F      # disaster-recovery archive
parako restore F           # restore from a backup archive
parako migrate             # re-run DB migrations
parako config get KEY      # read a runtime/.env value (redacted)
parako config set KEY VAL  # update a runtime/.env value
parako gc --keep 3 --yes   # prune old snapshots
parako version             # installed version + commit SHA
parako shell               # node REPL with PARAKO_RUNTIME_DIR set
```

## Verbs in detail

### Service control

```bash
parako start | stop | restart | status
```

`parako start | stop | restart` wraps `systemctl` (when the install's `.supervisor` is `systemd`) or `pm2` (when `.supervisor` is `pm2`).

`parako status` prints a labeled summary:

```
== parako status
  Install dir ................... /opt/parako-id
  Version ....................... v0.2.0
  Supervisor .................... systemd
  Database ...................... postgresql
  Server port ................... 9007
  URL ........................... https://auth.example.com
  Service ....................... active (systemd)
  Worker ........................ active (systemd)
  /health ....................... 200
```

### Diagnostics

```bash
parako doctor                  # full diagnostic
parako doctor --json           # structured output for tooling
parako logs [-f] [--since '1h'] [--worker]
parako diag [--out PATH]       # tar.gz of redacted env + logs + status
```

`parako doctor` delegates to the installer's `--doctor` mode. It runs the same preflight check set used at install time, plus post-install verification:

- `.env` parses against the schema
- DB connection works
- Redis connection works (if configured)
- JWKS keys present
- File ownership of `runtime/` correct
- Recent service crashes (warn if > 5/hr)
- `/health` endpoint returns 200

`parako logs` wraps `journalctl -u parako-id [-u parako-id-worker] [-f] [--since '1h']` or `pm2 logs parako-id [--lines 200]` depending on supervisor.

`parako diag` emits a single `tar.gz` containing:

- system info (`uname`, `/etc/os-release`, Node + pnpm versions)
- redacted `.env`
- `systemctl status` / `pm2 list` + last 500 log lines
- `/health` response
- `INSTALL_NOTES.md`

Every file in the bundle is passed through the same redactor used by the installer. Safe to share in bug reports.

### Maintenance

```bash
parako config get DEPLOYMENT_URL
parako config set DEPLOYMENT_URL https://auth.example.com
parako migrate
parako backup --out /var/backups/parako-$(date +%Y%m%d).tar.gz
parako restore /var/backups/parako-20260601.tar.gz
```

`parako config set` is atomic (write-temp + rename), creates a `.bak.${ts}` backup of the existing `.env`, and validates the new value against the bootstrap schema before applying.

`parako backup` archives `runtime/` plus a logical DB dump (`pg_dump` / `mongodump` / `sqlite3 .backup`) into a single tarball.

`parako restore` stops the service, replaces `runtime/` from the archive, optionally restores the DB, and restarts. The DB restore step is interactive: the operator confirms the command (you may want to skip if the dump is older than the schema).

### Lifecycle

```bash
parako update
parako update v0.3.1
parako update --plan
parako update --dry-run
parako rollback
parako rollback --to 20260520T091200Z
parako rollback --migrate-back
parako gc --keep 3 --dry-run
parako gc --keep 3 --yes
```

All four (`update`, `rollback`, `gc`, `doctor`) delegate to the installer at `https://get.parako.id` — `parako update` is equivalent to `curl -sSL https://get.parako.id | sudo bash -s -- --update --dir $INSTALL_DIR`. This means cosign signature verification, the beginning ritual, and the automatic rollback envelope all apply.

### Version + shell

```bash
parako version
parako shell
```

`parako version` shows the installed Parako.ID version, the `parako` binary version, and the commit SHA from `BUILD_INFO.json`.

`parako shell` drops into a Node REPL with `cwd` set to the install directory and `PARAKO_RUNTIME_DIR` set to `${INSTALL_DIR}/runtime`. Useful for ad-hoc inspection (`require('./dist/src/...')`). A full DI-bound REPL is on the roadmap for v0.3.0.

## State file

The binary reads `${INSTALL_DIR}/.parako-state`, a mode-0600 file written by the installer at install time:

```
INSTALL_DIR=/opt/parako-id
VERSION=v0.2.0
SUPERVISOR=systemd
SUPERVISOR_USER=parako
INSTALLED_AT=20260601T134208Z
DB=postgresql
PORT=9007
URL=https://auth.example.com
```

If `parako` is invoked outside a known install, set `PARAKO_INSTALL_DIR=/path/to/install`.

## Environment variables

| Variable             | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `PARAKO_INSTALL_DIR` | Override which install `parako` operates on |
| `NO_COLOR`           | Disable colored output                      |

## See also

- [Installer](installer.md)
- [Installer security](installer-security.md)
- [Updates & maintenance](updates-and-maintenance.md)
