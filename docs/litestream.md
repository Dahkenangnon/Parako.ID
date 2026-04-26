---
title: 'SQLite Backup with Litestream'
subtitle: 'Continuous real-time replication of your SQLite database to cloud storage'
category: 'DevOps'
order: 2
---

## Overview

When using Parako.ID with the SQLite storage adapter, [Litestream](https://litestream.io/) provides continuous, real-time replication of your SQLite database to cloud object storage (S3, GCS, Azure Blob).

## Why Litestream?

SQLite is a single-file database — if the disk fails, you lose everything unless you have backups. Litestream streams WAL (Write-Ahead Log) changes to object storage in near-real-time, giving you:

- **Continuous backup** (not just periodic snapshots)
- **Point-in-time recovery** to any moment
- **Zero application changes** — works at the OS level
- **Minimal overhead** — only WAL deltas are shipped

## Prerequisites

- SQLite adapter configured: `STORAGE_ADAPTER=sqlite`
- WAL mode enabled (Parako.ID sets `PRAGMA journal_mode = WAL` automatically)
- Litestream installed: https://litestream.io/install/

## Configuration

Create `litestream.yml` in your project root:

```yaml
dbs:
  - path: ./data/parako.db
    replicas:
      # S3-compatible storage (AWS S3, MinIO, Backblaze B2, etc.)
      - type: s3
        bucket: your-backup-bucket
        path: parako/sqlite
        endpoint: https://s3.amazonaws.com # or MinIO/B2 endpoint
        access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
        region: us-east-1
        retention: 168h # 7 days of WAL segment retention
        sync-interval: 1s

      # Google Cloud Storage (alternative)
      # - type: gcs
      #   bucket: your-backup-bucket
      #   path: parako/sqlite

      # Azure Blob Storage (alternative)
      # - type: abs
      #   account-name: your-storage-account
      #   bucket: your-container
      #   path: parako/sqlite
```

## Running with Litestream

### Development

```bash
# Replicate in the background while running the app
litestream replicate -config litestream.yml &
yarn dev
```

### Production (with PM2)

Wrap the app process with Litestream so it starts replication before the app:

```bash
litestream replicate -config litestream.yml -exec "node dist/src/index.js"
```

Or run Litestream as a separate systemd service:

```ini
[Unit]
Description=Litestream SQLite Replication
After=network.target

[Service]
ExecStart=/usr/local/bin/litestream replicate -config /opt/parako/litestream.yml
Restart=always
User=parako
Group=parako

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM litestream/litestream:latest AS litestream
FROM node:24-slim

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY litestream.yml /etc/litestream.yml

# Litestream wraps the app process
CMD ["litestream", "replicate", "-config", "/etc/litestream.yml", "-exec", "node dist/src/index.js"]
```

## Restoring from Backup

```bash
# Restore to the original path
litestream restore -config litestream.yml ./data/parako.db

# Or restore to a different path
litestream restore -config litestream.yml -o /tmp/restored.db ./data/parako.db
```

## Important Notes

- **PM2_INSTANCES must be 1** when using SQLite — SQLite does not support concurrent writes from multiple processes.
- Litestream requires WAL mode (already configured by Parako.ID).
- The `cache_size` pragma (8MB) is set automatically for optimal read performance.
- For multi-process deployments, use PostgreSQL or MongoDB instead of SQLite.

See also: [Security — Key Management](security.md#key-management) for JWKS configuration and rotation.
