---
title: 'Docker deployment'
subtitle: 'Install, operate, back up, and update Parako.ID with Docker Compose'
category: 'DevOps'
order: 2
---

Docker is a supported production deployment mode alongside the native systemd
release. Both modes use signed releases, the same application configuration,
the same database migrations, encrypted backups, readiness checks, and the
same external HTTPS ingress boundary.

Choose one mode for an installation. Do not mix native systemd services and the
Docker Compose stack in the same install directory or on the same loopback
port.

## Support boundary

| Layer       | Docker deployment contract                                                      |
| ----------- | ------------------------------------------------------------------------------- |
| Host        | Linux on x86_64 or AArch64 with Docker Engine and Docker Compose v2             |
| Image       | Signed GHCR image pinned to an immutable digest after installation              |
| Application | Unprivileged UID/GID 10001, read-only root filesystem, dropped capabilities     |
| Database    | Managed or external PostgreSQL/MongoDB; managed SQLite for single tenancy       |
| Redis       | Managed by the bundle or supplied as an external service                        |
| Ingress     | Operator-managed HTTPS reverse proxy or load balancer                           |
| Backups     | Encrypted database plus runtime data; off-host retention remains operator-owned |

SQLite supports single tenancy only. PostgreSQL and MongoDB support single- or
multi-tenant deployments. The Compose bundle does not install or configure
DNS, certificates, an internet-facing proxy, monitoring, or off-host backup
storage.

## Architecture

```text
Internet
   |
HTTPS proxy / load balancer                 operator managed
   |
127.0.0.1:9007
   |
Parako app + worker                         signed Parako image
   |             |
database        Redis                       managed containers or external services
```

The application port binds to loopback by default. Do not expose it directly to
the internet. Preserve `Host`, set `X-Forwarded-Proto: https`, and never cache
authentication, OIDC, account, or admin responses.

## Install the verified operator bundle

Install Docker Engine and the Compose v2 plugin using your operating system's
maintained packages. Confirm the current operator can access the daemon:

```bash
docker info
docker compose version
```

Then install the signed Parako release metadata, Compose files, operator CLI,
and bundled backup tools:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id \
  | sudo bash -s -- --docker
```

The installer verifies both the release archive and the GHCR image with
Cosign. It records the image by digest; it does not start services or create an
application configuration.

Preview the installation without additional installer network calls or filesystem
changes (the initial `curl` still downloads the installer):

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id \
  | sudo bash -s -- --docker --plan
```

## Create a backup identity

Generate the private identity outside the application data directory and keep a
second protected copy away from the host:

```bash
sudo parako backup-keygen /root/parako-backup-identity.txt
```

Use the printed `age1...` recipient during configuration. Never copy the
private identity into `runtime/.env` or a container secret.

## Configure managed services

SQLite and managed Redis, single tenancy:

```bash
sudo parako docker config init \
  --url https://auth.example.com \
  --adapter sqlite \
  --redis managed \
  --tenancy single \
  --backup-recipient 'age1...'
```

Managed PostgreSQL or MongoDB with multi-tenancy:

```bash
sudo parako docker config init \
  --url https://auth.example.com \
  --adapter postgresql \
  --database managed \
  --redis managed \
  --tenancy multi \
  --backup-recipient 'age1...'
```

Replace `postgresql` with `mongodb` for the managed MongoDB topology. The
operator generates database, Redis, cookie, session, encryption, and bootstrap
secrets locally. Secret values are excluded from `docker/topology.env` and
protected with mode `0600`.

## Configure external services

Write credentials to protected, one-line files so they do not enter shell
history:

```bash
sudo install -m 0600 /dev/null /root/parako-database-url
sudo install -m 0600 /dev/null /root/parako-redis-password
sudoedit /root/parako-database-url
sudoedit /root/parako-redis-password
```

Then initialize the topology:

```bash
sudo parako docker config init \
  --url https://auth.example.com \
  --adapter postgresql \
  --database external \
  --database-url-file /root/parako-database-url \
  --redis external \
  --redis-host redis.internal.example \
  --redis-port 6379 \
  --redis-password-file /root/parako-redis-password \
  --tenancy multi \
  --backup-recipient 'age1...'
```

Production PostgreSQL connections use strict TLS verification by default.
`PG_SSL_ENABLED=false` is written only for the private managed PostgreSQL
container network. For a private CA, keep TLS enabled and configure trust on the
host/container; use `PG_SSL_REJECT_UNAUTHORIZED=false` only when the residual
risk is explicitly accepted.

## Deploy and bootstrap

```bash
sudo parako docker config check
sudo parako docker deploy
sudo parako docker diag
sudo parako docker admin bootstrap --email admin@example.com
```

`deploy` validates Compose and the bootstrap environment, waits for managed
dependencies, applies migrations, starts the app and worker, and requires
`/readyz` to pass. Open the printed one-time administrator activation URL over
the configured HTTPS origin.

## Routine operations

```bash
sudo parako docker status
sudo parako docker logs
sudo parako docker health
sudo parako docker diag
sudo parako docker restart
sudo parako docker stop
sudo parako docker start
sudo parako docker down
```

`stop` affects the application and worker. `down` removes Compose containers
and networks but deliberately preserves named data volumes. Neither command is
an uninstall or a data purge.

Database lifecycle commands are explicit:

```bash
sudo parako docker db status
sudo parako docker db migrate
sudo parako docker db baseline --confirm-existing-schema
```

Use `baseline` only for a legacy schema that has been independently verified
to match the release.

## Back up and restore

Create an encrypted backup and immediately copy both files to separate durable
storage:

```bash
sudo parako docker backup
```

The result contains an adapter-consistent database snapshot, runtime uploads,
key material, and bootstrap environment. The adjacent checksum detects storage
corruption; encryption protects confidentiality. A backup is not complete until
an isolated restore has been rehearsed.

Restore is intentionally destructive and never automatic:

```bash
sudo parako docker restore /path/to/parako-backup.tar.gz.age \
  --identity /root/parako-backup-identity.txt \
  --yes
sudo parako docker diag
```

Add `--restore-secrets` only when the archived bootstrap environment must
replace the current one. The operator rejects unsafe archive paths and backups
from a different storage adapter.

## Update and rollback

Review release notes and preview the operation:

```bash
sudo parako docker update --plan --version vX.Y.Z
sudo parako docker update --version vX.Y.Z
```

An update pulls the version tag, resolves it to the expected GHCR repository
digest, verifies the GitHub Actions signing identity with Cosign, creates a
mandatory encrypted backup, stops app/worker, applies migrations, and requires
readiness before success. Updates require the application to be running so the
pre-update snapshot is consistent.

Application rollback does not roll back the database:

```bash
sudo parako docker rollback
# or
sudo parako docker rollback --to vX.Y.Z
```

The target image is verified again. If its database status check fails, services
remain stopped. Restore the matching encrypted backup explicitly; Parako never
silently rewinds production data.

## Maintenance and removal

Keep Docker Engine, Compose, the host kernel, the reverse proxy, certificates,
and managed dependency images within your security maintenance policy. Monitor
app/worker state, `/health`, `/readyz`, database and Redis health, certificate
expiry, disk/volume usage, error rate, and backup age.

The general `parako uninstall` command refuses Docker installations because
removing an operator bundle while containers or named volumes remain would be
an unsafe partial uninstall. To retire a deployment:

1. Create and verify an encrypted off-host backup.
2. Run `parako docker down`.
3. Inventory the exact Compose project containers, networks, and named volumes.
4. Delete volumes only after a separately approved data-destruction procedure.
5. Remove the install directory and CLI only after the retained data decision is
   documented.

## Native versus Docker operations

| Task            | Native release            | Docker release                         |
| --------------- | ------------------------- | -------------------------------------- |
| Install         | `install.sh`              | `install.sh --docker`                  |
| Configure       | `parako config init`      | `parako docker config init`            |
| Deploy          | `parako deploy`           | `parako docker deploy`                 |
| Diagnose        | `parako diag`             | `parako docker diag`                   |
| Backup/restore  | `parako backup/restore`   | `parako docker backup/restore`         |
| Update/rollback | `parako update/rollback`  | `parako docker update/rollback`        |
| Runtime         | Bundled Node.js + systemd | Signed OCI image + Compose             |
| DB/Redis        | Operator provisioned      | Managed bundle or operator provisioned |

There is no zero-downtime promise in either mode. Schedule maintenance windows
for migrations and upgrades, and retain a tested recovery path.

## See also

- [Production deployment](deployment.md)
- [Installer security](installer-security.md)
- [parako CLI](parako-cli.md)
- [Upgrades and rollback](upgrades.md)
- [Troubleshooting](troubleshooting.md)
