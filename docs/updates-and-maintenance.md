---
title: 'Updates & Maintenance'
subtitle: 'Version management, key rotation, database maintenance, logging, and monitoring'
category: 'DevOps'
order: 3
---

## Updating Parako.ID

### Tarball installs (recommended)

If you installed via the one-liner at `https://get.parako.id`, upgrade with:

```bash
curl -sSL https://get.parako.id | bash -s -- --update
```

This is the same script that handled the install. In `--update` mode it:

1. Detects the existing install at `INSTALL_DIR` (default `/opt/parako-id` for sudo installs, otherwise `./parako-id`)
2. Reads the supervisor (`systemd` or `pm2`) from the `.supervisor` marker written at install time
3. Snapshots the install directory to `*.backup.YYYYMMDDHHMMSS`
4. Stops the service
5. Downloads and verifies the new tarball (SHA256)
6. Extracts to a sibling `*.new.YYYYMMDDHHMMSS` directory
7. Preserves your instance state across the swap. Specifically:
   - `.env`, `.supervisor` marker, `data/` (SQLite DB + uploads), `logs/`
   - `runtime/jwks/` — signing keys
   - `runtime/views/` — instance custom view overrides
   - `runtime/assets/` — instance custom theme assets
   - `runtime/config-backups/` — admin-saved config snapshots
   - Only `runtime/locales/` is refreshed from the new tarball (so new translations land)
8. Runs database migrations against the new code (`yarn db:migrate:deploy` for PostgreSQL or `yarn db:push` for SQLite — MongoDB is no-op)
9. Atomically swaps directories (old archived as `*.old.YYYYMMDDHHMMSS`)
10. Starts the service via the recorded supervisor
11. Health-checks `http://127.0.0.1:<port>/.well-known/openid-configuration` for up to 30 seconds
12. **Automatically rolls back** if the health check fails — old version is restored, broken upgrade is preserved at `*.failed.YYYYMMDDHHMMSS` for inspection

Pin a specific version with `--update --version X.Y.Z`. Pass `--force` to skip the confirmation prompt.

After a successful upgrade, you can clean up the snapshots:

```bash
rm -rf /opt/parako-id.backup.* /opt/parako-id.old.*
```

### Source / dev installs

For installations cloned via `git clone`:

```bash
git pull
yarn install
yarn db:migrate:deploy   # PostgreSQL only
yarn build
yarn restart
```

There is no automatic rollback for source installs. Take a database backup first if upgrading across schema changes.

### Rolling back manually (any install method)

If you need to revert without triggering the automatic rollback (e.g., to roll back days after a successful upgrade):

```bash
# Tarball: restore from backup snapshot
sudo systemctl stop parako-id parako-id-worker   # or pm2 stop
sudo mv /opt/parako-id /opt/parako-id.broken
sudo mv /opt/parako-id.backup.YYYYMMDDHHMMSS /opt/parako-id
sudo systemctl start parako-id parako-id-worker

# Source: checkout previous tag
git checkout <previous-tag>
yarn install
yarn build
yarn restart
```

If the upgrade modified the database schema, restore the database from a pre-upgrade backup before reverting application code.

## Key Rotation

JWKS signing keys should be rotated periodically. Parako.ID supports automatic and manual rotation.

### Automatic Rotation

Configure automatic rotation in `security.key_store`:

```jsonc
{
  "security": {
    "key_store": {
      "rotation_interval_days": 90,
      "overlap_window_seconds": 7200,
      "algorithms": ["RS256", "ES256", "EdDSA"],
    },
  },
}
```

Keys are rotated every 90 days by default. During the overlap window (2 hours), both old and new keys are valid for token verification. This ensures tokens signed with the old key remain valid until they expire.

### Manual Rotation

Rotate keys via the admin panel at `/admin` or the Management API (`POST /api/v1/jwks/rotate` with `parako:jwks:rotate` scope). Inspect current keys via `GET /api/v1/jwks` (scope `parako:jwks:read`).

The `keys` CLI exposes only `generate`, used for first-boot bootstrap; production rotation/listing is handled by the DB-backed key store. See [CLI Tools](cli-tools.md) and [Security](security.md).

## Database Maintenance

### MongoDB

MongoDB handles most maintenance automatically. Periodic tasks:

```bash
# Check index usage
mongosh parako --eval "db.users.getIndexes()"

# Compact a collection (reclaim disk space)
mongosh parako --eval "db.runCommand({compact: 'activities'})"

# View collection stats
mongosh parako --eval "db.stats()"
```

### PostgreSQL

```bash
# Run VACUUM to reclaim space
psql -d parako -c "VACUUM ANALYZE;"

# Check table sizes
psql -d parako -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;"

# Run pending migrations
yarn db:migrate:deploy
```

### SQLite

SQLite maintenance is minimal. For backup, see [SQLite Backup with Litestream](litestream.md).

```bash
# Check database integrity
sqlite3 data/parako.db "PRAGMA integrity_check;"

# Check database size
ls -lh data/parako.db
```

## Logging

Parako.ID uses Pino for structured JSON logging in production and pretty-printed logs in development.

### Configuration

| Variable                                  | Default | Description                                                   |
| ----------------------------------------- | ------- | ------------------------------------------------------------- |
| `SECURITY_LOGGING_ENABLED`                | `true`  | Enable logging                                                |
| `SECURITY_LOGGING_LEVEL`                  | `info`  | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `SECURITY_LOGGING_PRETTY_PRINT`           | `true`  | Pretty-print (development only)                               |
| `SECURITY_LOGGING_FILE_LOGGING_ENABLED`   | `true`  | Write logs to files                                           |
| `SECURITY_LOGGING_FILE_LOGGING_DIRECTORY` | `logs`  | Log directory                                                 |

### Log Levels

| Level   | Use                                    |
| ------- | -------------------------------------- |
| `fatal` | Unrecoverable errors                   |
| `error` | Operation failures                     |
| `warn`  | Unexpected conditions that are handled |
| `info`  | Normal operations (default)            |
| `debug` | Detailed operational information       |
| `trace` | Very detailed debugging                |

### Viewing Logs

```bash
# PM2 logs
pm2 logs                         # All logs
pm2 logs parako-id               # Application only
pm2 logs parako-id-worker        # Worker only
pm2 monit                        # PM2 monitoring dashboard

# Systemd logs
journalctl -u parako-id -f
journalctl -u parako-id-worker -f

# Log files
tail -f logs/pm2_output.log
tail -f logs/pm2_error.log
```

In production, set `SECURITY_LOGGING_PRETTY_PRINT=false` to output JSON for log aggregation tools (ELK, Datadog, etc.).

## Monitoring

### Prometheus Metrics

Enable the built-in Prometheus metrics endpoint:

```jsonc
{
  "features": {
    "metrics": {
      "enabled": true,
      "path": "/metrics",
      "include_default_metrics": true,
      "prefix": "parako_",
    },
  },
}
```

Scrape `https://your-parako.example.com/metrics` with Prometheus.

### PM2 Monitoring

```bash
# Real-time process monitoring
pm2 monit

# Process list with CPU/memory
pm2 list
```

### Health Check

The Management API provides a health check endpoint:

```bash
curl https://your-parako.example.com/api/v1/stats/health \
  -H "Authorization: Bearer API_TOKEN"
```

## Activity Audit Log

Parako.ID logs all security-relevant events to the activity log, stored in the database.

### Logged Events

- User registration, login, logout
- Password changes and resets
- MFA setup, verification, and removal
- Social login linking and unlinking
- OIDC client CRUD operations
- Admin actions (user management, settings changes)
- Session creation, switching, and revocation
- Failed authentication attempts
- Configuration changes

### Viewing the Audit Log

- **Admin panel** — Navigate to `/admin` and view the Activity Log section
- **Management API** — `GET /api/v1/audit` with `parako:audit:read` scope
- **CSV export** — Export filtered results from the admin panel

### Filtering

Filter audit entries by:

- Event type
- User
- IP address
- Date range
- Tenant (in multi-tenant mode)
