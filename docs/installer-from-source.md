---
title: 'Install from source (git)'
subtitle: 'The git-clone install path and its trade-offs vs the tarball installer'
category: 'DevOps'
order: 4
---

This page documents how to install and update Parako.ID directly from a `git clone` of the repository. It is the right choice for contributors, source auditors, and operators running in environments with an internal npm/pnpm mirror and a strict no-binary-from-internet policy.

For production deployments on a standard VPS, the [tarball installer](installer.md) is strongly preferred. Read the drawbacks below before choosing the source path.

## Trade-offs vs the tarball installer

1. **No automated rollback.** Neither install path runs auto-rollback; the tarball installer's `parako rollback` re-aims the `current` symlink to the previous release (app files only — DB is not rolled back), while the source path requires the operator to `git reset --hard` and rebuild. Both paths require manual DB backup + restore around any schema-changing release.
2. **Supply-chain risk on every update.** Each `pnpm install` reaches out to the configured registry. A compromised dependency ships straight to your IdP. The tarball installer ships pre-resolved `node_modules` whose tarball is itself cosign-signed in CI, eliminating this exposure at update time.
3. **Requires a full build toolchain on the target.** `pnpm`, `tsc`, swc, esbuild must all be present on the server. The tarball installer ships pre-built `dist/` so the target only needs `node`.
4. **No cosign signature verification.** The tarball installer verifies the release's Sigstore signature before extracting. The source path verifies nothing beyond the git working tree itself (which the operator must trust by other means — fingerprints, SCM signing, mirror integrity).
5. **No `parako doctor` integration.** The tarball installer ships `parako.sh` and installs it to `/usr/local/bin/parako`. From-source operators get the same script in `installer/parako.sh` but must copy it to PATH themselves.
6. **Updates take longer.** The build step adds 30–60 s on top of the dependency install. The tarball installer ships pre-built artifacts.
7. **No structured install log.** The tarball installer writes a redacted JSON-lines log at `/var/log/parako-install-${ts}.log`. The source path leaves operators to capture their own logs.

For an IdP — where compromise means full identity compromise of every relying party — these are not minor concerns.

## Fresh install from source

```bash
# Clone and check out the latest stable tag
git clone https://github.com/Dahkenangnon/Parako.ID.git /opt/parako-id
cd /opt/parako-id
git checkout "$(git tag -l 'v[0-9]*' | sort -V | tail -n1)"

# Install dependencies
pnpm install --frozen-lockfile

# Configure
mkdir -p runtime
cp .env.example runtime/.env
$EDITOR runtime/.env  # set secrets and DB connection

# Apply schema and generate JWKS (auto-generated on first start; this is for file-config setups)
pnpm db:push     # SQLite
# OR: pnpm db:migrate:deploy   # PostgreSQL

# Build
pnpm build

# Generate systemd units and install
sudo pnpm systemd install \
  --user "$(id -un)" \
  --dir "$(pwd)" \
  --env-file "$(pwd)/runtime/.env"

# Start
sudo systemctl start parako-id parako-id-worker
```

## Update from source

There is **no automated rollback** for source installs. Take a manual snapshot before you start.

```bash
cd /opt/parako-id

# Manual snapshot
SNAPSHOT="/opt/parako-id.manual-snapshot-$(date -u +%Y%m%dT%H%M%SZ)"
sudo cp -a /opt/parako-id "$SNAPSHOT"
echo "Snapshot at $SNAPSHOT"

# Manual database backup
case "$(grep -E '^STORAGE_ADAPTER=' runtime/.env | cut -d= -f2)" in
  postgresql)
    pg_dump --no-owner --format=custom \
      "$(grep -E '^STORAGE_POSTGRESQL_URL=' runtime/.env | cut -d= -f2-)" \
      | gzip > "${SNAPSHOT}.db.dump.gz" ;;
  mongodb)
    mongodump --uri="$(grep -E '^STORAGE_MONGODB_URI=' runtime/.env | cut -d= -f2-)" \
      --archive="${SNAPSHOT}.mongo.archive.gz" --gzip ;;
  sqlite)
    sqlite3 runtime/data/parako.db ".backup ${SNAPSHOT}.db" && gzip "${SNAPSHOT}.db" ;;
esac

# Stop the service
sudo systemctl stop parako-id parako-id-worker

# Save current commit for rollback
PREV_HEAD=$(git rev-parse HEAD)
echo "Pre-update HEAD: $PREV_HEAD"

# Pull and check out target version
git fetch --tags
git checkout "$(git tag -l 'v[0-9]*' | sort -V | tail -n1)"   # or git checkout v0.3.0

# Update dependencies (supply-chain exposure point)
pnpm install --frozen-lockfile

# Apply migrations
pnpm db:migrate:deploy   # PostgreSQL only; SQLite uses db:push; MongoDB is a no-op

# Build
pnpm build

# Start
sudo systemctl start parako-id parako-id-worker

# Verify health
sleep 5
if ! curl -fsS "http://127.0.0.1:9007/health" >/dev/null; then
  echo "Health check failed; rolling back to $PREV_HEAD"
  sudo systemctl stop parako-id parako-id-worker
  git checkout "$PREV_HEAD"
  pnpm install --frozen-lockfile
  pnpm build
  sudo systemctl start parako-id parako-id-worker
fi
```

If the database migration was forward-only and the rollback restored older code that expects the older schema, restore the database from the dump you took above before starting the rolled-back service.

## Adopting the `parako` operator binary on a source install

Even though the source path doesn't install `parako` automatically, you can copy it manually so `parako version`, `parako paths`, and `parako doctor` work:

```bash
sudo install -m 0755 installer/parako.sh /usr/local/bin/parako

# parako reads a small state file alongside the install. No secrets.
sudo tee /opt/parako-id/.parako-state <<EOF
# Parako.ID installer state — no secrets, safe to read.
INSTALL_DIR=/opt/parako-id
VERSION=$(jq -r .version package.json)
PREVIOUS_VERSION=
INSTALLED_AT=$(date -u +%Y%m%dT%H%M%SZ)
INSTALLER_VERSION=source-install
EOF
sudo chmod 0644 /opt/parako-id/.parako-state
```

After this, `parako version`, `parako paths`, and `parako doctor` work. `parako update` and `parako rollback` would invoke the tarball installer — they are not safe to use on a source install (`install.sh --update` refuses to operate on a directory containing `.git/`). For source upgrades, follow the manual `git pull && pnpm install && pnpm build && (operator-run migration + restart)` runbook.

## When to switch to the tarball installer

If your install was created via `git clone`, you can migrate to the tarball installer at any time. Recommended procedure:

1. Take a manual snapshot of the current install (`cp -a /opt/parako-id /opt/parako-id.pre-migrate`).
2. Take a full database backup.
3. Stop the service.
4. Move the source install aside (`mv /opt/parako-id /opt/parako-id.source`).
5. Run the tarball installer with the same `--db`, `--domain`, `--supervisor` choices.
6. Copy `runtime/jwks/`, `runtime/.env`, `runtime/uploads/`, and your existing database into the new install.
7. Start the service and verify with `parako doctor`.

Once verified, archive the old source clone.

## See also

- [Installer](installer.md) — the recommended path
- [Upgrades](upgrades.md) — manual `git pull` upgrade runbook
- [CLI tools](cli-tools.md) — `pnpm` operator tools used in source installs
- [Installer security](installer-security.md) — threat model
- [Updates & maintenance](updates-and-maintenance.md) — broader operational guidance
