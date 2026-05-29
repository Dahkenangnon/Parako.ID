---
title: 'Troubleshooting'
subtitle: 'Common issues and solutions for build, database, OIDC, authentication, and deployment'
category: 'DevOps'
order: 4
---

## Build Failures

### TypeScript compilation errors

```bash
# Clean and rebuild
pnpm clean
pnpm typecheck
pnpm build
```

If `typecheck` reports errors, fix the TypeScript issues before building.

### Tailwind CSS not generating

```bash
# Rebuild Tailwind
pnpm build:tailwind

# Check for CSS syntax errors in src/assets/css/app.css
```

### Prisma client out of sync

```bash
# Regenerate Prisma client (SQLite)
pnpm db:generate

# Regenerate Prisma client (PostgreSQL)
pnpm db:generate:pg

# Push schema changes
pnpm db:push
```

## Database Connection Issues

### MongoDB

**Symptom:** `MongooseServerSelectionError: connect ECONNREFUSED`

- Verify MongoDB is running: `sudo systemctl status mongod`
- Check the URI: `mongosh "STORAGE_MONGODB_URI"`
- Verify network access if using a remote database
- Check authentication credentials

**Symptom:** `MongooseError: Operation timed out`

- Check MongoDB logs: `sudo journalctl -u mongod`
- Verify available disk space: `df -h`
- Check memory usage: `free -m`

### PostgreSQL

**Symptom:** `Error: connect ECONNREFUSED`

- Verify PostgreSQL is running: `sudo systemctl status postgresql`
- Check connection URL format: `postgresql://user:password@host:port/database`
- Verify `pg_hba.conf` allows your connection method
- Test connection: `psql "STORAGE_POSTGRESQL_URL"`

**Symptom:** `Error: relation does not exist`

- Run migrations: `pnpm db:migrate:deploy`
- Or push schema: `pnpm db:push`

### SQLite

**Symptom:** `SQLITE_BUSY: database is locked`

- Ensure `PM2_INSTANCES=1` — SQLite does not support multiple writers
- Check for zombie processes: `ps aux | grep parako`
- Kill stuck processes and restart

**Symptom:** `SQLITE_CANTOPEN: unable to open database file`

- Verify the database path exists: `ls -la data/`
- Check directory permissions
- Ensure the `STORAGE_SQLITE_PATH` directory is writable

## OIDC Errors

### No JWKS keys

**Symptom:** `Error: No keys found` or OIDC provider fails to start

```bash
pnpm keys generate
```

JWKS keys must be generated before the first startup.

### Invalid client

**Symptom:** `invalid_client` error during token exchange

- Verify client exists: `pnpm client list`
- Check `client_id` and `client_secret` match
- Verify `token_endpoint_auth_method` matches your request (e.g., `client_secret_basic` requires HTTP Basic auth)
- Check if the client is active (not deactivated)

### Invalid redirect_uri

**Symptom:** `redirect_uri_mismatch` error

- The redirect URI in the authorization request must exactly match one registered with the client
- Check for trailing slashes, http vs https, port numbers
- View client redirect URIs: open `/admin` → OIDC Clients, or `cat parako-rp.jsonc`

### Invalid scope

**Symptom:** `invalid_scope` error

- Verify the requested scopes are registered with the client
- Check the client's allowed scopes: open `/admin` → OIDC Clients, or `cat parako-rp.jsonc`

## Login / Authentication Issues

### Invalid credentials

- Verify the user account exists and is not locked
- Check if the password has expired (`max_age_days` policy)
- Check if password breach detection is blocking the password

### MFA not working

- **TOTP:** Verify the user's device clock is synchronized (TOTP is time-based)
- **Email OTP:** Check SMTP configuration and email delivery logs
- **SMS:** Verify Twilio credentials and phone number format
- **WebAuthn:** Verify `rp_id` matches your domain in production

### Social login failures

- Verify provider credentials (`client_id`, `client_secret`) are correct
- Check that the redirect URI matches exactly: `https://your-domain/auth/social/{provider}/callback`
- Verify the provider app is in production mode (not sandbox/test mode)
- Check if the provider's OAuth consent screen is configured

## Session Issues

### Sessions not persisting

- Check session store configuration (MongoDB or Redis)
- Verify Redis is running if used for sessions: `redis-cli ping`
- Check cookie settings — `secure: true` requires HTTPS
- Verify `sameSite` cookie setting is compatible with your setup

### Cross-tenant session leak

- Verify `MULTI_TENANCY_ENABLED=true`
- Check `MULTI_TENANCY_EXTRACTION_PRIORITY` — session should be first
- Verify the `HMAC_SECRET` is set for cross-tenant state signing
- Check that tenant resolution is working: add debug logging

## PM2 Issues

### Viewing logs

```bash
# All logs
pm2 logs

# Application logs only
pm2 logs parako-id

# Worker logs only
pm2 logs parako-id-worker

# Clear logs
pm2 flush
```

### SQLite with multiple instances

**Symptom:** `SQLITE_BUSY` errors, data corruption

You must set `PM2_INSTANCES=1` when using SQLite. The application enforces this at startup — if you set more than 1 instance with SQLite, the app refuses to start.

For multi-process deployments, switch to PostgreSQL or MongoDB.

### Out of memory

**Symptom:** Process restarts frequently, `max_memory_restart` triggered

- Increase `PM2_MAX_MEMORY` (default: `1G`)
- Check for memory leaks: `pm2 monit`
- Consider adding more RAM or reducing `PM2_INSTANCES`

### Process not starting

```bash
# Check PM2 status
pm2 list

# View startup errors
pm2 logs parako-id --err --lines 50

# Delete and restart
pm2 delete ecosystem.config.cjs
pnpm start
```

## Systemd Issues

### Permission denied

- Ensure the service user has read/write access to the application directory
- Check file ownership: `ls -la /opt/parako/`
- Verify the `.env` file is readable by the service user

### Viewing journal logs

```bash
# Application logs
journalctl -u parako-id -f

# Worker logs
journalctl -u parako-id-worker -f

# Recent errors
journalctl -u parako-id --since "1 hour ago" -p err
```

### Service not starting

```bash
# Check status
pnpm systemd status

# Validate unit file
systemd-analyze verify /etc/systemd/system/parako-id.service

# Reload after editing unit files
sudo systemctl daemon-reload
sudo systemctl restart parako-id
```

## Multi-Tenancy Issues

### Tenant not resolving

- Check `MULTI_TENANCY_EXTRACTION_PRIORITY` order
- Verify the tenant exists in the database
- For header extraction, confirm the `x-tenant-id` header is being sent
- For subdomain extraction, verify DNS and nginx wildcard configuration

### SQLite limitation

Multi-tenancy is not supported with SQLite. Switch to MongoDB or PostgreSQL.

### Provider pool exhaustion

**Symptom:** Slow tenant switching, memory growth

- Increase `MULTI_TENANCY_PROVIDER_POOL_MAX_SIZE` (default: 50)
- Decrease `MULTI_TENANCY_PROVIDER_POOL_IDLE_TTL_MS` to evict idle providers faster
- Monitor memory usage with `pm2 monit` or Prometheus metrics

## Performance

### Slow responses

- Enable Redis for OIDC storage (`OIDC_STORAGE_ADAPTER=redis`) for faster token lookups
- Increase PM2 instances for multi-core utilization (PostgreSQL/MongoDB only)
- Check database query performance and add indexes if needed
- Enable response caching in nginx

### High memory usage

- Reduce `PM2_INSTANCES` count
- Lower `PM2_MAX_MEMORY` to trigger restarts earlier
- In multi-tenant mode, reduce provider pool size
- Check for memory leaks in custom view templates

### Database optimization

```bash
# MongoDB: check slow queries
mongosh parako --eval "db.setProfilingLevel(1, {slowms: 100})"
mongosh parako --eval "db.system.profile.find().sort({ts: -1}).limit(5)"

# PostgreSQL: analyze query performance
psql -d parako -c "SELECT * FROM pg_stat_user_tables ORDER BY seq_tup_read DESC;"
psql -d parako -c "VACUUM ANALYZE;"
```

## Getting Help

- **GitHub Issues** — Report bugs and request features at the [Parako.ID repository](https://github.com/Dahkenangnon/Parako.ID/issues)
- **Security vulnerabilities** — Report privately to [dah.kenangnon@gmail.com](mailto:dah.kenangnon@gmail.com)
