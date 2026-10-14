# Parako.ID Installer (source)

This directory is the source tree for the Parako.ID installer, published to `https://get.parako.id`. Operators do not clone this repository to install Parako.ID. Interactive use downloads the script before execution so standard input remains attached to the terminal; automation must pass `--non-interactive --force` explicitly.

Authoritative end-user reference: [docs/installer.md](../docs/installer.md). Threat model and chain-of-trust: [docs/installer-security.md](../docs/installer-security.md). Reference nginx vhosts: [docs/reference/nginx-vhost-examples/](../docs/reference/nginx-vhost-examples/).

## Files in this directory

| File         | Purpose                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `install.sh` | The installer / updater / rollback / doctor / gc, served at `get.parako.id`.                                                              |
| `parako.sh`  | The operator binary, shipped inside the release tarball at `contrib/parako.sh` and installed by the installer to `/usr/local/bin/parako`. |
| `index.html` | Landing page at `get.parako.id`.                                                                                                          |
| `test/`      | ShellCheck + Bats lint + multi-OS smoke matrix (Ubuntu 24.04/26.04 and Debian 12/13).                                                     |

## Excluded from release tarballs

`installer/install.sh` is never part of a release tarball. It lives in source for audit transparency and is published alongside each GitHub release. The signed release checksum manifest authenticates the installer and `index.html`; the private distribution workflow consumes those exact assets and atomically updates `get.parako.id`. Release builds enforce the tarball exclusion with both an allowlist staging step and an explicit denylist in [`scripts/release.sh`](../scripts/release.sh).

`installer/parako.sh` IS shipped at `contrib/parako.sh` inside every release tarball, where the installer reads it to populate `/usr/local/bin/parako`.
