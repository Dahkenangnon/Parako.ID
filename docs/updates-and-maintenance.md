---
title: 'Updates & Maintenance'
subtitle: 'Version management, key rotation, database maintenance, logging, and monitoring'
category: 'DevOps'
order: 3
---

## Updating Parako.ID

`parako update` validates Redis, creates the required encrypted pre-update backup, verifies the native artifact or builds the exact trusted Git ref, activates the new immutable release, applies shipped migrations, restarts app and worker, and requires readiness to pass. Database restore remains explicit. Follow the recovery decisions in [Upgrades and rollback](upgrades.md). Both supported distribution methods use this same lifecycle.

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

# Inspect and apply shipped migrations on a release install
sudo parako db status
sudo parako db migrate
```

### SQLite

SQLite maintenance is minimal. Release installs should use `sudo parako backup`;
see [SQLite Backup with Litestream](litestream.md) for optional continuous
replication.

```bash
# Check database integrity
sqlite3 /opt/parako-id/runtime/data/parako.db "PRAGMA integrity_check;"

# Check database size
ls -lh /opt/parako-id/runtime/data/parako.db
```

## Logging

Parako.ID uses Pino for structured JSON logging in production and pretty-printed logs in development.

### Configuration

| Variable                                  | Default          | Description                                                   |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `SECURITY_LOGGING_ENABLED`                | `true`           | Enable logging                                                |
| `SECURITY_LOGGING_LEVEL`                  | `info`           | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `SECURITY_LOGGING_PRETTY_PRINT`           | `false`          | Pretty-print (development only)                               |
| `SECURITY_LOGGING_FILE_LOGGING_ENABLED`   | `false`          | Write logs to files instead of relying on stdout collection   |
| `SECURITY_LOGGING_FILE_LOGGING_DIRECTORY` | `./runtime/logs` | Mutable log directory                                         |

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
sudo parako service logs
sudo parako service logs --worker --since '1 hour ago'
sudo journalctl -u parako-id.service -f
sudo journalctl -u parako-id-worker.service -f
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

### Health Check

Use liveness and readiness separately, and run the dependency diagnostic after
maintenance:

```bash
curl --fail https://your-parako.example.com/health
curl --fail https://your-parako.example.com/readyz
sudo parako diag
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
