# Parako.ID Installer

One-liner installer + operator binary for [Parako.ID](https://parako.id) — the self-hosted OIDC/OAuth2 identity provider.

This directory is **deployer-facing only**: every file here is consumed by operators who run `curl -sSL https://get.parako.id | bash` (or a derivative) to install, update, doctor, or roll back a Parako.ID server.

The installer is published to `https://get.parako.id`. Operators do not need to clone this repo to install Parako.ID.

## Install

```bash
# User-local install (./parako-id)
curl -sSL https://get.parako.id | bash

# System-wide install (/opt/parako-id, requires sudo)
curl -sSL https://get.parako.id | sudo bash

# Pin a specific version
curl -sSL https://get.parako.id | bash -s -- --version 0.2.0

# Non-interactive (CI, scripted)
curl -sSL https://get.parako.id | bash -s -- --non-interactive --force

# With nginx + Let's Encrypt TLS in one shot
curl -sSL https://get.parako.id | sudo bash -s -- \
  --non-interactive --force \
  --domain auth.example.com \
  --db postgres --postgres-url 'postgresql://parako:***@localhost/parako' \
  --redis-url 'redis://localhost:6379' \
  --supervisor systemd \
  --with-nginx --with-tls --tls-email admin@example.com \
  --bootstrap-admin admin@example.com
```

Before any mutation, the installer runs every preflight check (Node, pnpm, disk, ports, DNS, system time, `/dev/urandom`), shows the operator a plain-text plan card, and waits for confirmation. Cosign verifies the release artifacts via Sigstore (keyless via GitHub OIDC). If anything fails, automatic rollback restores the prior working state.

## Update

```bash
# Latest stable
curl -sSL https://get.parako.id | sudo bash -s -- --update

# Pin
curl -sSL https://get.parako.id | sudo bash -s -- --update --version 0.2.1

# See what would happen (no mutations)
curl -sSL https://get.parako.id | sudo bash -s -- --update --plan

# Everything except the directory swap (no mutations)
curl -sSL https://get.parako.id | sudo bash -s -- --update --dry-run
```

The update flow snapshots the install, backs up the database, swaps in the new version, runs migrations, and health-checks. If the new version fails its `/health` probe, automatic rollback restores the previous snapshot. Old snapshots are pruned by `parako gc`.

## Operator binary (`parako`)

After install, the `parako` command is on `PATH`:

```bash
parako status                      # supervisor + /health + DB + Redis summary
parako doctor                      # post-install health + security checks
parako logs -f                     # tail journalctl / pm2 logs
parako update [vX.Y.Z]             # in-place upgrade
parako rollback [--to <ts>]        # restore previous snapshot
parako backup [--out <path>]       # full archive (runtime/ + DB dump)
parako restore <archive>           # disaster recovery
parako diag                        # bug-report bundle
parako gc [--keep N] [--yes]       # clean old snapshots
parako --help                      # all commands
```

## Files in this directory

| File           | Purpose                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `install.sh`   | The installer + updater + rollback + doctor + gc — served at `get.parako.id`.                    |
| `parako.sh`    | The operator binary, copied to `/usr/local/bin/parako` (system) or `~/.local/bin/parako` (user). |
| `index.html`   | Landing page at `get.parako.id`.                                                                 |
| `templates/`   | nginx vhost templates rendered by `--with-nginx` / `--multi-tenant`.                             |
| `test/`        | ShellCheck + Bats lint + 4-OS smoke matrix (Ubuntu 22/24, Debian 12, Alpine 3.19).               |
| `CHANGELOG.md` | Installer-only changelog (separate from the project CHANGELOG).                                  |

## Security

The installer's threat model and signature-verification chain-of-trust are documented in [`docs/installer-security.md`](../docs/installer-security.md). To verify the installer itself, compare its SHA256 against the value published on the GitHub release page for the corresponding Parako.ID version.

## Excluded from release tarballs

`installer/` is not part of the Parako.ID release tarball. It lives in source for transparency and is published to `get.parako.id` independently. Release builds enforce this with both an allowlist staging step and an explicit denylist in `scripts/release.sh`.
