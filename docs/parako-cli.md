---
title: 'parako CLI'
subtitle: 'The parako operator binary installed alongside Parako.ID at /usr/local/bin/parako'
category: 'Guides'
order: 3
---

`parako` is a thin app-files helper that introspects the install layout and delegates upgrade / rollback / gc to `install.sh`. It never starts, stops, restarts, or configures services; never runs database migrations or backups; never touches nginx, TLS, or secrets — those remain operator-owned. Operator runbook: [Upgrades](upgrades.md).

## Verbs

| Verb                                      | Purpose                                                             | Delegates to                                   |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `parako version`                          | Print helper + app + previous-release versions                      | reads `current/package.json` + `.parako-state` |
| `parako paths`                            | Print resolved install paths                                        | reads `.parako-state`                          |
| `parako doctor [--json]`                  | File / config sanity (no service, no DB, no network)                | `install.sh --doctor`                          |
| `parako update [--version vX.Y.Z]`        | App-files update; atomic symlink swap                               | `install.sh --update`                          |
| `parako rollback [--to vX.Y.Z]`           | Re-aim `current` to a prior release                                 | `install.sh --rollback`                        |
| `parako gc [--keep N] [--yes]`            | Prune old `releases/v*/`; never touches `runtime/`                  | `install.sh --gc`                              |
| `parako clean-stale`                      | Auto-remove stale `current.tmp.*` symlinks left by a crashed run    | `install.sh --clean-stale --doctor`            |
| `parako self-update [--force]`            | Refresh the parako helper itself (prefers contrib/, falls back URL) | none (atomic local replace)                    |
| `parako uninstall [--purge] [--keep-bin]` | Remove the install; preserves `runtime/` unless `--purge`           | `install.sh --uninstall`                       |
| `parako --help`                           | Help text                                                           | —                                              |

## `parako version`

```text
== parako
  parako helper          0.2.0
  install dir            /opt/parako-id
  current release        v0.2.0
  previous release       <none>
  app version            0.2.0
```

## `parako paths`

```text
== Parako.ID paths
  install dir            /opt/parako-id
  current symlink        /opt/parako-id/current
  current target         /opt/parako-id/releases/v0.2.0
  runtime                /opt/parako-id/runtime
  env file               /opt/parako-id/runtime/.env
  jwks dir               /opt/parako-id/runtime/jwks
  logs dir               /opt/parako-id/runtime/logs
  releases dir           /opt/parako-id/releases
  state file             /opt/parako-id/.parako-state
```

Wire your supervisor (systemd `WorkingDirectory`, PM2 `cwd`, docker-compose volume) at `/opt/parako-id/current`.

## `parako doctor`

```text
== Parako.ID doctor
  Install dir            /opt/parako-id
  Current release        v0.2.0
  Previous               <none>
  Version                0.2.0
  Installed at           20260603T103244Z
  dist/src/index.js ...  present [OK]
  runtime/.env .......   missing (copy from current/contrib/.env.sample) [WARN]
  runtime/jwks/jwks.json absent [INFO] (only required for file-backed key storage)
  Releases on disk ...   1
```

`--json` emits the same data for scripting. Doctor does not probe `systemctl`, `pm2`, `curl /health`, or any database client.

## `parako update`

```bash
parako update                     # latest stable
parako update --version v0.2.1    # pin
parako update --plan              # no network, no writes
parako update --dry-run           # download + cosign verify, no writes
```

The atomic pointer swap leaves your `runtime/` untouched and your service running on the old code paths until you restart. See [Upgrades](upgrades.md) for the full operator runbook.

## `parako rollback`

```bash
parako rollback                   # previous release
parako rollback --to v0.1.5       # specific release on disk
```

> **Warning:** Application files revert, but database migrations are NOT reversed. See the [Upgrades → Rollback](upgrades.md#rollback) decision tree.

## `parako gc`

```bash
parako gc                          # preview
parako gc --keep 3 --yes           # apply, retain N from the deletable set
```

Two releases are always protected (current and previous, per `.parako-state`); `--keep N` (default 3) retains N more from `releases/v*/` sorted by mtime. GC never touches `runtime/`.

## `parako uninstall`

```bash
parako uninstall                 # remove releases/, current, .parako-state; also removes /usr/local/bin/parako
parako uninstall --keep-bin      # same, but preserves the parako helper binary
parako uninstall --purge         # also wipes runtime/ (operator data — requires explicit `yes` confirmation)
```

By default `parako uninstall` keeps `runtime/` (operator data — `.env`, JWKS, uploads). Pass `--purge` for a complete wipe.

## `parako self-update`

```bash
parako self-update               # refresh from contrib/parako.sh (cosign-verified) or get.parako.id
parako self-update --force       # reinstall even if version matches
parako self-update --from-url <URL>   # explicit fetch URL (HTTPS only)
```

`parako self-update` updates **only** the parako helper binary at `/usr/local/bin/parako` (or `~/.local/bin/parako` for non-root installs). For application updates, use `parako update`.

Source priority:

1. `<install>/current/contrib/parako.sh` if an install exists (already cosign-verified at install time).
2. `https://get.parako.id/parako.sh` otherwise (TLS-only trust).

## `parako clean-stale`

```bash
parako clean-stale
```

Removes any `current.tmp.*` symlink left over by a crashed installer run, then runs `parako doctor`. Safe to run anytime — acquires the installer lock first so it cannot race with a concurrent install.

## See also

- [Installer](installer.md)
- [Upgrades](upgrades.md)
- [Installer Security](installer-security.md)
