# Upgrading Parako.ID

Parako.ID partitions its install tree into **shipped** state and
**operator-managed** state. Everything outside `runtime/` is shipped:
extracting a new release tarball over an existing install replaces it
wholesale. Everything inside `runtime/` is operator-managed:
configuration (`runtime/.env`, `runtime/parako.jsonc`,
`runtime/parako-rp.jsonc`), process tuning
(`runtime/ecosystem.config.cjs`), signing keys (`runtime/jwks/`),
uploads (`runtime/uploads/`), the sqlite database
(`runtime/data/parako.db`), logs (`runtime/logs/`), and config snapshots
(`runtime/config-backups/`). **A future Parako.ID release will never
overwrite anything under `runtime/`.**

## Today: manual review

Until the automated update mechanism lands (see below), the upgrade
flow is manual:

1. Pull the new release tarball or `git pull && pnpm install && pnpm
build`.
2. Read the release notes on the [GitHub Releases
   page](https://github.com/Dahkenangnon/Parako.ID/releases) for any
   notes that mention `runtime/` paths — most commonly
   `runtime/ecosystem.config.cjs` (when PM2 defaults change) or
   `runtime/views/` (when shipped templates change).
3. If a release note instructs you to merge a new value into your
   operator file, do so by hand.
4. Run `pnpm db:migrate:deploy` if migrations are present, then
   `pnpm restart`.

## Coming next: sidecar updates

A follow-up release will ship a `MANIFEST.json` alongside the tarball
listing the SHA256 of every file under `runtime/` classified as a
**managed default** (a file that ships with the release but that the
operator may have customized). An operator-side `scripts/update.sh`
will then, on each upgrade, compare your current files against the
previous manifest:

- **Unchanged** (you never customized): the new version overwrites
  silently.
- **Changed** (you customized it): the new version is dropped alongside
  yours as `<file>.update-vX.Y.Z`. You merge at your convenience, then
  delete the sidecar. The update is logged to `runtime/.update-log.md`.
- **Never touched** (your `runtime/.env`, your `runtime/parako.jsonc`,
  your `runtime/parako-rp.jsonc`, your `runtime/jwks/`, your
  `runtime/data/`, your `runtime/uploads/`, your `runtime/logs/`, your
  `runtime/config-backups/`): not in the manifest at all; the update
  never produces a sidecar.

Until that mechanism ships, the conservative rule is: **diff
`runtime/` against the previous release's tree manually** before
trusting the upgrade.
