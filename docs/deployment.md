---
title: 'Deployment'
subtitle: 'Deploy Parako.ID to production with PM2, systemd, and nginx'
category: 'DevOps'
order: 1
---

## Pre-Deployment Checklist

Before deploying to production, verify these items:

- [ ] All secrets generated and set in `.env` (`ENCRYPTION_KEY`, `JWT_SECRET`, `COOKIE_SECRET_*`, etc.)
- [ ] `DEPLOYMENT_ENVIRONMENT=production`
- [ ] `DEPLOYMENT_URL` set to your public HTTPS URL
- [ ] Database configured and accessible (MongoDB or PostgreSQL for production)
- [ ] Redis configured (if using Redis for OIDC storage or sessions)
- [ ] JWKS keys generated (`pnpm keys generate`)
- [ ] SMTP configured for email delivery
- [ ] Cookie `secure` set to `true` (requires HTTPS)
- [ ] `USE_FILE_CONFIG=false` (use database config in production)
- [ ] Nginx or reverse proxy configured with SSL

## Database Setup

### MongoDB

```bash
# Install MongoDB (Ubuntu/Debian)
sudo apt install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod

# Verify connection
mongosh "mongodb://localhost:27017/parako"
```

Set in `.env`:

```bash
STORAGE_ADAPTER=mongodb
STORAGE_MONGODB_URI=mongodb://localhost:27017/parako
```

### PostgreSQL

```bash
# Install PostgreSQL (Ubuntu/Debian)
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql -c "CREATE USER parako WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE parako OWNER parako;"
```

Set in `.env`:

```bash
STORAGE_ADAPTER=postgresql
STORAGE_POSTGRESQL_URL=postgresql://parako:your_password@localhost:5432/parako
```

Run migrations:

```bash
pnpm db:generate:pg
pnpm db:migrate:deploy
```

### Redis

```bash
# Install Redis (Ubuntu/Debian)
sudo apt install -y redis-server
sudo systemctl enable redis-server

# Set password (recommended)
sudo sed -i 's/# requirepass foobared/requirepass your_redis_password/' /etc/redis/redis.conf
sudo systemctl restart redis-server
```

Set in `.env`:

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

## PM2 Deployment

PM2 is the default process manager. Parako.ID includes a pre-configured `ecosystem.config.cjs`.

### Build and Start

```bash
# Build for production
pnpm build

# Start with PM2
pnpm start
```

This starts two processes:

- **parako-id** — Main application (cluster mode, multiple instances)
- **parako-id-worker** — Background worker (fork mode, single instance)

### PM2 Configuration Options

Customize PM2 behavior via environment variables:

| Variable                | Default     | Description                            |
| ----------------------- | ----------- | -------------------------------------- |
| `APP_NAME`              | `parako-id` | PM2 process name                       |
| `PORT`                  | `9007`      | Server port                            |
| `PM2_INSTANCES`         | `max`       | Number of instances (`max` = all CPUs) |
| `PM2_MAX_MEMORY`        | `1G`        | Max memory before restart (app)        |
| `PM2_WORKER_MAX_MEMORY` | `512M`      | Max memory before restart (worker)     |
| `PM2_UID`               | —           | Run as specific user (optional)        |
| `PM2_GID`               | —           | Run as specific group (optional)       |

**SQLite constraint:** When using SQLite, you must set `PM2_INSTANCES=1`. SQLite does not support concurrent writes from multiple processes.

### PM2 Commands

```bash
pnpm start                           # Start all processes
pnpm restart                         # Restart all processes
pm2 stop ecosystem.config.cjs       # Stop all processes
pm2 logs                             # View all logs
pm2 logs parako-id                   # Application logs only
pm2 logs parako-id-worker            # Worker logs only
pm2 monit                            # PM2 monitoring dashboard
```

### Graceful Restart

PM2 is configured for zero-downtime restarts:

- `wait_ready: true` — Waits for the process to signal readiness before routing traffic
- `listen_timeout: 30000` — 30 seconds to become ready
- `kill_timeout: 10000` — 10 seconds to gracefully shut down
- `shutdown_with_message: true` — Sends shutdown message to the process

## Systemd Deployment

Use systemd as an alternative to PM2 for tighter OS integration.

### Install Services

```bash
# Preview generated unit files
pnpm systemd generate

# Install (requires sudo)
sudo pnpm systemd install

# Start services
sudo systemctl start parako-id

# Enable on boot
sudo systemctl enable parako-id
```

### Manage Services

```bash
# Status
pnpm systemd status

# Logs (tail both services live; Ctrl-C to stop)
pnpm systemd logs

# Worker only / time-windowed
pnpm systemd logs --worker
pnpm systemd logs --since "1 hour ago"

# Restart both services (main + worker)
sudo pnpm systemd restart

# Uninstall
sudo pnpm systemd uninstall
```

### Customizing Resource Limits

Override the default memory caps when generating or installing:

```bash
sudo pnpm systemd install \
  --memory-app 2G \
  --memory-worker 512M
```

Defaults are `1G` for the main app and `512M` for the worker.

### Safe Re-installs

`pnpm systemd install` validates that the service user, working directory, and environment file are present before writing unit files. If existing unit files differ from what would be written, it shows a diff and refuses to overwrite — pass `--force` to apply. Identical content is a safe no-op (no `daemon-reload`).

### Security Hardening

Generated systemd units include:

- `NoNewPrivileges=yes`
- `ProtectSystem=strict`
- `PrivateTmp=yes`
- Resource limits matching PM2 configuration
- Worker bound to main service via `BindsTo`

See [CLI Tools](cli-tools.md) for all systemd command options.

## Nginx Reverse Proxy

Place nginx in front of Parako.ID for SSL termination and static asset caching.

### Basic Configuration

```nginx
upstream parako {
    server 127.0.0.1:9007;
    keepalive 64;
}

server {
    listen 80;
    server_name auth.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name auth.example.com;

    ssl_certificate /etc/letsencrypt/live/auth.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.example.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Proxy settings
    location / {
        proxy_pass http://parako;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
    }

    # Static assets
    location /css/ {
        proxy_pass http://parako;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /js/ {
        proxy_pass http://parako;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Set `deployment.server.proxy: true` in your Parako.ID configuration to trust proxy headers.

## SSL/TLS

### Let's Encrypt with Certbot

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Issue certificate
sudo certbot --nginx -d auth.example.com

# Auto-renewal (Certbot adds a cron job automatically)
sudo certbot renew --dry-run
```

### Secure Cookie Configuration

Once HTTPS is configured, enable secure cookies:

```jsonc
{
  "deployment": {
    "cookies": {
      "defaults": {
        "secure": true,
        "sameSite": "lax",
      },
    },
  },
}
```

## Multi-Tenancy Infrastructure

When running Parako.ID in multi-tenant mode, you need wildcard DNS, a wildcard SSL certificate, and an nginx configuration that routes all tenant subdomains to the same upstream.

### Domain Architecture

Multi-tenancy uses a three-tier subdomain model under your base domain:

| Subdomain                     | Tenant       | Purpose                                                        |
| ----------------------------- | ------------ | -------------------------------------------------------------- |
| `_ops.auth.example.com`       | `_ops`       | Health probes, metrics, social OAuth callback relay            |
| `_platforms.auth.example.com` | `_platforms` | Master tenant — login, admin panel, cross-tenant management    |
| `*.auth.example.com`          | Per-tenant   | Tenant-specific OIDC endpoints (e.g., `acme.auth.example.com`) |

Parako.ID resolves the tenant internally by extracting the subdomain from the `Host` header. Nginx does not need per-tenant `server` blocks — a single block handles all traffic.

### DNS Setup

Create three DNS records pointing to your VPS:

```
_ops.auth.example.com         A    <VPS_IP>
_platforms.auth.example.com   A    <VPS_IP>
*.auth.example.com            A    <VPS_IP>
```

The wildcard record (`*`) covers all tenant subdomains. The explicit `_ops` and `_platforms` records are required because most DNS providers do not match wildcard records against explicitly defined subdomains.

### SSL Certificates

A single wildcard certificate covers all three tiers:

```bash
# Using DNS challenge (required for wildcard certs)
sudo certbot certonly --dns-<plugin> \
  -d "auth.example.com" \
  -d "*.auth.example.com"
```

Replace `<plugin>` with your DNS provider's Certbot plugin (e.g., `cloudflare`, `route53`, `digitalocean`). The HTTP challenge cannot issue wildcard certificates.

### Nginx Configuration

A single `server` block handles all tenant subdomains, `_ops`, and `_platforms`:

```nginx
upstream parako {
    server 127.0.0.1:9007;
    keepalive 64;
}

server {
    listen 80;
    server_name *.auth.example.com _ops.auth.example.com _platforms.auth.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name *.auth.example.com _ops.auth.example.com _platforms.auth.example.com;

    ssl_certificate /etc/letsencrypt/live/auth.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.example.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Proxy settings
    location / {
        proxy_pass http://parako;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
    }

    # Static assets
    location /css/ {
        proxy_pass http://parako;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /js/ {
        proxy_pass http://parako;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

This replaces the single-tenant nginx block from the [Nginx Reverse Proxy](#nginx-reverse-proxy) section. The key differences are the wildcard `server_name` and the wildcard SSL certificate paths.

Set `deployment.server.proxy: true` in your Parako.ID configuration to trust proxy headers.

For application-level multi-tenancy configuration (extraction strategies, provider pool, per-tenant overrides), see [Multi-Tenancy](multi-tenancy.md).

### Bootstrap Admin

On first startup with multi-tenancy enabled, create the initial platform admin using shell-scoped exports (never in `.env` for production):

```bash
export PARAKO_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
export PARAKO_BOOTSTRAP_ADMIN_PASSWORD=your-secure-password
pnpm start
```

After logging in at `_platforms.<domain>`, create a permanent admin account, then close the shell session. See [Multi-Tenancy — Special Tenants](multi-tenancy.md#special-tenants) for details.

## Environment-Specific Settings

### Production Checklist

```bash
# .env (production)
DEPLOYMENT_ENVIRONMENT=production
DEPLOYMENT_URL=https://auth.example.com
DEPLOYMENT_SERVER_PORT=9007

STORAGE_ADAPTER=postgresql
STORAGE_POSTGRESQL_URL=postgresql://parako:password@localhost:5432/parako

OIDC_STORAGE_ADAPTER=redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

ENCRYPTION_KEY=<64-char-hex>
JWT_SECRET=<64-char-hex>
COOKIE_SECRET_1=<64-char-hex>
COOKIE_SECRET_2=<64-char-hex>
HMAC_SECRET=<64-char-hex>
PAIRWISE_SALT=<32-char-hex>

USE_FILE_CONFIG=false

SECURITY_LOGGING_LEVEL=info
SECURITY_LOGGING_PRETTY_PRINT=false
SECURITY_LOGGING_FILE_LOGGING_ENABLED=true
```
