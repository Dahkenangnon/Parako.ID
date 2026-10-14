# Parako.ID installer source

This directory contains the Parako.ID installer published at
`https://get.parako.id`. Operators install Parako.ID from the published
script rather than cloning this repository. For interactive use, download the
script before running it so standard input remains attached to the terminal.
Automation must pass `--non-interactive --force` explicitly.

Authoritative end-user reference: [docs/installer.md](../docs/installer.md). Threat model and chain-of-trust: [docs/installer-security.md](../docs/installer-security.md). Reference nginx vhosts: [docs/reference/nginx-vhost-examples/](../docs/reference/nginx-vhost-examples/).

## Files in this directory

| File         | Purpose                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `install.sh` | The installer / updater / rollback / doctor / gc, served at `get.parako.id`.                                                              |
| `parako.sh`  | The operator binary, shipped inside the release tarball at `contrib/parako.sh` and installed by the installer to `/usr/local/bin/parako`. |
| `index.html` | Landing page at `get.parako.id`.                                                                                                          |
| `test/`      | ShellCheck + Bats lint + multi-OS smoke matrix (Ubuntu 24.04/26.04 and Debian 12/13).                                                     |

## Files excluded from release tarballs

`installer/install.sh` is never part of a release tarball. It lives in source for audit transparency and is published alongside each GitHub release. The signed release checksum manifest authenticates the installer and `index.html`; the private distribution workflow consumes those exact assets and atomically updates `get.parako.id`. Release builds enforce the tarball exclusion with both an allowlist staging step and an explicit denylist in [`scripts/release.sh`](../scripts/release.sh).

Every release tarball includes `installer/parako.sh` at `contrib/parako.sh`.
The installer uses that file to create `/usr/local/bin/parako`.
