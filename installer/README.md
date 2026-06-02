# Parako.ID Installer (source)

This directory is the source tree for the Parako.ID installer, published to `https://get.parako.id`. Operators do not clone this repo to install Parako.ID — they pipe the published script to bash (or download and run it offline).

Authoritative end-user reference: [docs/installer.md](../docs/installer.md). Threat model and chain-of-trust: [docs/installer-security.md](../docs/installer-security.md). Reference nginx vhosts: [docs/reference/nginx-vhost-examples/](../docs/reference/nginx-vhost-examples/).

## Files in this directory

| File         | Purpose                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `install.sh` | The installer / updater / rollback / doctor / gc, served at `get.parako.id`.                                                              |
| `parako.sh`  | The operator binary, shipped inside the release tarball at `contrib/parako.sh` and installed by the installer to `/usr/local/bin/parako`. |
| `index.html` | Landing page at `get.parako.id`.                                                                                                          |
| `test/`      | ShellCheck + Bats lint + multi-OS smoke matrix (Ubuntu 22 / 24, Debian 12, Alpine 3.19).                                                  |

## Excluded from release tarballs

`installer/install.sh` is never part of a release tarball. It lives in source for audit transparency and is published to `get.parako.id` independently. Release builds enforce this with both an allowlist staging step and an explicit denylist in [`scripts/release.sh`](../scripts/release.sh).

`installer/parako.sh` IS shipped at `contrib/parako.sh` inside every release tarball, where the installer reads it to populate `/usr/local/bin/parako`.
