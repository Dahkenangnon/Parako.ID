---
title: 'Installer'
subtitle: 'Verified release installation and production lifecycle bootstrap'
category: 'Getting Started'
order: 3
---

Parako.ID ships architecture-specific, self-contained Linux releases. Each
release bundles Node.js, the `age` backup tool, production dependencies,
database migrations, an SPDX SBOM, and a compatibility manifest. The installer
verifies the signed artifact and checksum before atomically activating it.

## Supported hosts

| Component        | Supported contract                                       |
| ---------------- | -------------------------------------------------------- |
| OS               | Debian 12/13 or Ubuntu 24.04/26.04                       |
| CPU              | x86_64 (`x64`) or AArch64 (`arm64`)                      |
| Database         | SQLite by default; PostgreSQL or MongoDB by complete URI |
| Required service | Operator-managed Redis; local default `127.0.0.1:6379`   |
| Service manager  | systemd through the `parako` CLI                         |
| Public ingress   | External HTTPS reverse proxy or load balancer            |

SQLite is appropriate for one application process and small deployments.
PostgreSQL is the recommended production database and is required for
PostgreSQL-backed multi-tenancy. Parako.ID never installs or administers Redis
or an external database. Provision those services, DNS, reverse proxy, and TLS
before the first public use.

## Install

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash
```

Pin a release when reproducibility matters:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id \
  | sudo bash -s -- --version vX.Y.Z
```

The low-level installer only verifies, stages, and activates release files.
The installed `parako` command owns bootstrap environment generation,
migrations, encrypted backups and restores, systemd services, health checks,
updates, and rollback safety.

Application and OIDC settings remain database-backed and are managed in the
admin panel. `parako` does not edit those settings. It also never configures
DNS, an HTTPS reverse proxy, certificates, or the database/Redis servers.

## Distribution choice

The signed native release is recommended for standard VPS and partner-demo
deployments. It minimizes target-host tooling and verifies the complete
architecture artifact. Environments that require a local source build can use
the separate [commit-pinned Git installer](installer-from-source.md). Both
methods create the same immutable release/runtime layout and use the same
mode-aware `parako` lifecycle commands.

## First deployment

Generate and store an `age` identity somewhere separate from the server:

```bash
sudo parako backup-keygen /root/parako-backup-identity.txt
```

The command prints the public recipient. Use it to create the bootstrap-only
environment, then deploy:

```bash
sudo parako config init \
  --url https://auth.example.com \
  --backup-recipient 'age1...'

sudo parako deploy
sudo parako diag
sudo parako admin bootstrap --email admin@example.com
```

That default uses SQLite at `/opt/parako-id/runtime/data/parako.db` and expects
operator-managed Redis at `127.0.0.1:6379`. For PostgreSQL or MongoDB, add
`--adapter postgresql|mongodb --database-url '<complete-working-uri>'`. For an
operator-provided remote Redis service, add `--redis-host` and `--redis-port`.
The installer does not create, repair, secure, back up, or upgrade those
external services.

Open the single-use HTTPS activation URL printed by the final command and set
the administrator password. Then configure the application and OIDC clients in
the admin panel. Do not send the activation URL through logs or shared chat.

`parako deploy` fails closed unless configuration is valid, Redis responds,
database migrations succeed, both systemd units are active, and `/readyz`
passes. It does not require public ingress to be active because it probes the
loopback service.

## Release verification

Normal online installation requires all of the following:

- A cosign signature and certificate matching the release artifact.
- An artifact entry in `SHA256SUMS`.
- A manifest matching the release version, Linux architecture, bundled runtime,
  Redis requirement, and migration contract.
- Recalculated SQLite/PostgreSQL migration hashes and the SPDX SBOM hash.

Unsigned installation requires the explicit break-glass flag and a recorded
reason. Do not use it in routine deployment.

## Offline installation

Download these files for the host architecture from the same release:

```text
install.sh
parako-id-vX.Y.Z-linux-x64.tar.gz       # or linux-arm64
parako-id-vX.Y.Z-linux-x64.tar.gz.sig
parako-id-vX.Y.Z-linux-x64.tar.gz.pem
SHA256SUMS
SHA256SUMS.sig
SHA256SUMS.pem
```

Then run:

```bash
sudo bash ./install.sh --offline --version vX.Y.Z \
  --tarball ./parako-id-vX.Y.Z-linux-x64.tar.gz \
  --checksum ./SHA256SUMS \
  --signature ./parako-id-vX.Y.Z-linux-x64.tar.gz.sig \
  --certificate ./parako-id-vX.Y.Z-linux-x64.tar.gz.pem
```

## Layout and ownership

```text
/opt/parako-id/
├── current -> releases/vX.Y.Z
├── releases/                 immutable, root-owned application releases
├── runtime/                  mutable service data
│   ├── .env                  bootstrap secrets, root/service-readable only
│   ├── data/                 SQLite when selected
│   ├── jwks/
│   ├── uploads/
│   ├── logs/
│   └── backups/
└── .parako-state             release pointer metadata, no secrets
```

Systemd runs the app and worker as the unprivileged `parako` user by default.
Units use the bundled Node.js binary, can write only to `runtime/`, and refuse
startup when database migration status is unhealthy.

## Existing installations

Databases previously created with `prisma db push` need a one-time baseline
after confirming their schema matches the release:

```bash
sudo parako db baseline --confirm-existing-schema
sudo parako db status
```

Do not baseline a fresh, empty, or structurally different database.

## Next steps

- [Production deployment](deployment.md)
- [parako CLI](parako-cli.md)
- [Upgrades and rollback](upgrades.md)
- [Configuration](configuration.md)
