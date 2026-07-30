---
title: 'Install from source (Git)'
subtitle: 'Commit-pinned production installation from a trusted repository'
category: 'DevOps'
order: 4
---

Parako.ID supports two production distribution methods:

| Method                       | Runtime                                                               | Supply-chain verification                                                                                                  | Target host                      |
| ---------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Native release (recommended) | Bundled Node.js, production dependencies, and `age`                   | Cosign-signed architecture artifact plus checksums, SBOM, and release manifest                                             | Minimal Debian or Ubuntu host    |
| Git source                   | Host Node.js 24+, pnpm 11+, Git, build tools, `age`, and `age-keygen` | Exact stable tag or full commit SHA from an explicitly trusted HTTPS/SSH repository, frozen lockfile, and production audit | Audited source-build environment |

Both methods use the same immutable release layout, shared runtime directory,
`parako` operator command, systemd services, backup policy, migrations, health
checks, updates, rollback, garbage collection, and uninstall behavior. The Git
method is not an in-place clone: it never runs `git pull` against the active
application tree.

The signed native release is the safer default for a partner demo and ordinary
VPS deployment. Choose Git when policy requires local source review/builds or a
trusted internal mirror.

## Host contract

Supported operating systems are Debian 12/13 and Ubuntu 24.04/26.04 on x64 or
arm64. The Git method additionally requires:

- Git, Node.js 24 or later, pnpm 11 or later, and the normal native build toolchain.
- `age` and `age-keygen` on `PATH` for encrypted backup and restore.
- An existing non-root build owner. Root is never accepted as `--owner`.
- Network access to the trusted Git endpoint and configured pnpm registry/mirror.
- Redis installed, secured, monitored, and maintained by the operator.

Parako.ID does not install system packages, Redis, a database server, reverse
proxy, DNS, or TLS certificates.

## Obtain and verify the installer

Download `install-git.sh`, `install-git.sh.sig`, `install-git.sh.pem`, and
`SHA256SUMS` from the same GitHub Release. Verify the checksum and Cosign
certificate before running the script. Release certificates are accepted only
when issued for this repository's `release.yml` workflow on a stable `vX.Y.Z`
tag.

Use `--plan` first; it performs no network calls and writes nothing:

```bash
BUILD_OWNER=$(id -un)
sudo bash ./install-git.sh \
  --repository https://github.com/Dahkenangnon/Parako.ID.git \
  --ref v0.3.0 \
  --owner "$BUILD_OWNER" \
  --dir /opt/parako-id \
  --plan
```

Install the exact stable tag:

```bash
sudo bash ./install-git.sh \
  --repository https://github.com/Dahkenangnon/Parako.ID.git \
  --ref v0.3.0 \
  --owner "$BUILD_OWNER" \
  --dir /opt/parako-id \
  --non-interactive
```

A full 40-character commit SHA is also accepted. Branch names, abbreviated
SHAs, arbitrary version-like refs, repositories containing embedded
credentials, and commits not reachable from the repository's `main` branch are
rejected. A custom mirror must be passed explicitly and must use trusted HTTPS
or SSH.

The installer maintains a separate bare mirror, exports only the selected
commit into staging, runs `pnpm install --frozen-lockfile`, a high-severity
production audit, the production build, and `pnpm prune --prod` as the non-root
owner. It validates the build, makes the release read-only, and atomically
switches `current` only after every gate passes.

## Database and Redis defaults

SQLite and local Redis are the default local services. SQLite data is stored at
`/opt/parako-id/runtime/data/parako.db`. Redis defaults to
`127.0.0.1:6379`; the operator is responsible for installing it and for its
persistence, authentication, network restrictions, monitoring, and upgrades.

Generate an offline backup identity, then initialize the default SQLite/local
Redis configuration:

```bash
sudo parako backup-keygen /root/parako-backup-identity.txt
sudo parako config init \
  --url https://auth.example.com \
  --backup-recipient 'age1...'
```

For PostgreSQL or MongoDB, provision the service separately and provide a full
working URI. The installer never assembles credentials or creates a database:

```bash
sudo parako config init \
  --url https://auth.example.com \
  --adapter postgresql \
  --database-url 'postgresql://parako:secret@db.example.com:5432/parako?sslmode=require' \
  --backup-recipient 'age1...'

# Or:
sudo parako config init \
  --url https://auth.example.com \
  --adapter mongodb \
  --database-url 'mongodb+srv://parako:secret@cluster.example.com/parako?retryWrites=true&w=majority' \
  --backup-recipient 'age1...'
```

Use `--redis-host` and `--redis-port` only when the operator provides a remote
Redis service.

## Deploy and operate

```bash
sudo parako deploy
sudo parako diag
sudo parako admin bootstrap --email admin@example.com
```

`parako version` and `parako paths` show `install mode: git`. State is stored in
`/opt/parako-id/.parako-state` without secrets and records the repository, exact
ref/commit, current and previous releases, build owner, and managed CLI path.

Lifecycle commands are mode-aware:

```bash
# Stable tag, both methods
sudo parako update --version v0.3.1

# Exact commit, Git method only
sudo parako update --ref 0123456789abcdef0123456789abcdef01234567

sudo parako rollback
sudo parako gc --keep 2 --yes
sudo parako uninstall --yes          # preserves runtime/
sudo parako uninstall --purge --yes  # explicitly removes runtime/
```

Updates validate configuration and Redis, create an encrypted backup, stage and
activate the new release, apply migrations, restart services when previously
active, and require readiness. A build failure leaves `current` unchanged.
Database restore is always explicit. Application rollback never pretends to
reverse a forward database migration.

## Layout

```text
/opt/parako-id/
├── current -> releases/git-<40-character-commit>
├── repository.git/          bare trusted-source mirror
├── releases/                immutable commit-addressed builds
├── runtime/                 shared mutable data and secrets
├── .parako-state            mode/ref/commit metadata, no secrets
└── .install-lock
```

Never replace this process with `git pull`, `git reset --hard`, or a build in
the active `current` tree.

## See also

- [Native installer](installer.md)
- [parako CLI](parako-cli.md)
- [Upgrades and rollback](upgrades.md)
- [Installer security](installer-security.md)
