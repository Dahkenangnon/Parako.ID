---
title: 'Deployment'
subtitle: 'Supported production topology and operations runbook'
category: 'DevOps'
order: 1
---

The supported release deployment uses the verified installer, the `parako`
operator CLI, and native systemd services. The CLI owns release files,
bootstrap secrets, migrations, encrypted backup/restore, app and worker
lifecycle, and local dependency checks.

The operator still owns the database and Redis servers, DNS, HTTPS ingress,
certificates, monitoring, off-host backup storage, and incident response.
Application and OIDC configuration stays in the admin panel.

## Production topology

```text
Internet
   |
HTTPS reverse proxy / load balancer   (operator managed)
   |
127.0.0.1:9007
   |
parako-id.service ---------------- database
   |                                  |
parako-id-worker.service ---------- Redis
```

Do not expose port 9007 directly to the internet. Terminate TLS at a maintained
reverse proxy or load balancer and forward the original host, scheme, and
client address.

## Support boundary

| Layer           | Required production choice                                                       |
| --------------- | -------------------------------------------------------------------------------- |
| Host            | Debian 12 or Ubuntu 24.04, x64 or arm64                                          |
| Runtime         | Node.js bundled in the release                                                   |
| Database        | PostgreSQL recommended; MongoDB supported; SQLite for one-process small installs |
| Queue/pub-sub   | Redis is required                                                                |
| Process manager | systemd units installed by `parako deploy`                                       |
| Ingress         | External HTTPS reverse proxy/load balancer                                       |
| Configuration   | Bootstrap in `runtime/.env`; application/OIDC in admin panel                     |

PostgreSQL deployments should use a dedicated non-superuser role, encrypted
connections, restricted network access, and automated server-side backups. The
shipped baseline enables and forces row-level policies on tenant-scoped tables.
Do not grant the application role `BYPASSRLS`.

## Host preparation

Provision a database and Redis before installing Parako.ID. Also install the
database client tools needed by backup and restore:

| Adapter    | Required host tools                                          |
| ---------- | ------------------------------------------------------------ |
| SQLite     | None beyond the bundled application dependencies             |
| PostgreSQL | `pg_dump` and `pg_restore` matching the server major version |
| MongoDB    | `mongodump` and `mongorestore`                               |

Allow the host to connect outbound to the release host during online updates,
or use the documented offline artifacts. Ensure NTP/time synchronization is
healthy because OIDC tokens, activation links, and signatures are time-bound.

## Install and configure

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash

sudo parako backup-keygen /root/parako-backup-identity.txt

sudo parako config init \
  --url https://auth.example.com \
  --adapter postgresql \
  --database-url 'postgresql://parako:password@db.example.com/parako' \
  --redis-host redis.example.com \
  --redis-port 6379 \
  --backup-recipient 'age1...'
```

`config init` writes `/opt/parako-id/runtime/.env` with mode `0600`, generates
bootstrap secrets, and sets database/Redis connectivity. Deployment keeps it
root-owned and grants only the service group read access. It does not replace
the admin-panel configuration model.

For an existing schema created with `prisma db push`, baseline only after
verifying it already matches the release:

```bash
sudo parako db baseline --confirm-existing-schema
```

Fresh databases do not need that command.

## HTTPS reverse proxy

Configure the public proxy to:

- terminate TLS with a certificate covering the deployment hostname;
- forward to `http://127.0.0.1:9007`;
- preserve `Host`;
- set `X-Forwarded-Proto https` and a trustworthy client-address header;
- allow the request/response sizes and timeouts required by login and admin
  flows;
- pass WebSocket upgrade headers if enabled by future features;
- never cache authentication, token, user-info, admin, or callback responses.

Set the public URL passed to `config init` to the exact HTTPS origin clients
will use. For nginx examples, see
[`docs/reference/nginx-vhost-examples/`](reference/nginx-vhost-examples/).

The proxy trust setting itself remains part of application configuration in the
admin panel.

## Deploy

```bash
sudo parako deploy
sudo parako diag
```

Deployment performs these gates in order:

1. Validate the bootstrap environment and secret file mode.
2. Connect to Redis and require `PONG`.
3. Apply all shipped database migrations.
4. Create the unprivileged service user and restrictive filesystem ownership.
5. Install hardened app and worker systemd units.
6. Start both units and require each to remain active.
7. Require the loopback `/readyz` database probe to succeed.

The units use the release’s bundled Node.js runtime. Immutable releases are
root-owned; only `/opt/parako-id/runtime` is writable by the service user.

## Create the first administrator

```bash
sudo parako admin bootstrap --email admin@example.com
```

Open the printed single-use activation URL over the configured HTTPS origin.
After setting the password, finish application and OIDC client configuration in
the admin panel. The CLI refuses to replace an activated administrator.

Multi-tenant platform bootstrap has additional role and hostname requirements;
see [Multi-Tenancy](multi-tenancy.md).

## Health and monitoring

| Endpoint or command        | Meaning                                                |
| -------------------------- | ------------------------------------------------------ |
| `GET /health`              | Process liveness; does not restart-loop on a DB outage |
| `GET /readyz`              | Readiness backed by a real database query              |
| `GET /health?deep=true`    | Deep health alias for readiness                        |
| `sudo parako diag`         | DB migrations, Redis, systemd, and local HTTP check    |
| `sudo parako service logs` | App and worker journal output                          |

Use `/health` as a liveness probe and `/readyz` as a readiness/load-balancer
probe. Alert separately on app unit state, worker unit state, Redis, database,
certificate expiry, disk space, backup age, error rate, and login latency.

## Backups

```bash
sudo parako backup
```

The backup includes database data plus runtime uploads and key material, then
encrypts it to the configured `age` recipient. Copy the `.age` file and its
checksum to separate durable storage. The private identity must not live only
on the Parako.ID host.

Define and test recovery objectives. At minimum, rehearse an isolated restore
before first product traffic and after material database changes:

```bash
sudo parako restore /path/to/backup.tar.gz.age \
  --identity /root/parako-backup-identity.txt \
  --yes
sudo parako diag
```

## Operations

```bash
sudo parako service status
sudo parako service logs --since '1 hour ago'
sudo parako service restart
sudo parako db status
sudo parako update --plan --version vX.Y.Z
sudo parako update --version vX.Y.Z
```

Review [Upgrades and rollback](upgrades.md) before every production change.
Keep at least the current and previous application release until the rollback
window closes.

## Go-live checklist

- [ ] Signed release installed on a supported OS/architecture.
- [ ] Dedicated database credentials and network restrictions applied.
- [ ] Redis authentication/network restrictions applied.
- [ ] HTTPS proxy passes external smoke tests and does not cache auth traffic.
- [ ] `parako diag` passes.
- [ ] First admin activation completed and bearer URL destroyed.
- [ ] Application and OIDC settings reviewed in the admin panel.
- [ ] Test client completes authorization code with PKCE.
- [ ] Email delivery, MFA, and recovery paths tested as applicable.
- [ ] Encrypted backup copied off-host and isolated restore tested.
- [ ] Liveness, readiness, worker, DB, Redis, disk, certificate, and backup alerts enabled.
- [ ] Upgrade, rollback, restore, and incident owners documented.

## See also

- [Installer](installer.md)
- [parako CLI](parako-cli.md)
- [Upgrades and rollback](upgrades.md)
- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)
