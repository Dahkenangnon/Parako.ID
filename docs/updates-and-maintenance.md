---
title: 'Updates & Maintenance'
subtitle: 'Version management, key rotation, database maintenance, logging, and monitoring'
category: 'DevOps'
order: 3
---

## Updating Parako.ID

`parako update` is a release-pointer switcher; database migrations, service restart, backups, and health checks are operator-owned. The full operator runbook (read notes → backup → dry-run → apply → migrate → restart → verify → rollback) lives in [Upgrades](upgrades.md). Source-install upgrades follow the manual procedure in [Install from Source](installer-from-source.md).

> **Warning:** `parako rollback` reverts application files only. Database migrations are not reversed.

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
pnpm db:migrate:deploy
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

## See also

- [Upgrades](upgrades.md)
- [parako CLI](parako-cli.md)
- [Security](security.md)
- [Configuration](configuration.md)
