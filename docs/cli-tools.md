---
title: 'CLI Tools'
subtitle: 'Command-line tools for managing clients, keys, and systemd services'
category: 'Guides'
order: 2
---

## Overview

Parako.ID includes three CLI tools for server-side management:

| Tool    | Command                  | Purpose                              |
| ------- | ------------------------ | ------------------------------------ |
| Client  | `pnpm client <command>`  | Manage OIDC client applications      |
| Keys    | `pnpm keys <command>`    | Manage JWKS signing keys             |
| Systemd | `pnpm systemd <command>` | Generate and manage systemd services |

All CLI tools work with local files (`parako-rp.jsonc`, `runtime/jwks/jwks.json`) and do not require the application server to be running.

For version updates, see [Updates & Maintenance](updates-and-maintenance.md). Updates are performed manually via `git pull` until a dedicated bash installer ships in a future release.

## Client Management

Manage OIDC/OAuth2 client registrations.

```bash
pnpm client <command>
```

### Commands

| Command | Aliases         | Description                         |
| ------- | --------------- | ----------------------------------- |
| `add`   | `create`, `new` | Add a new OIDC client (interactive) |
| `list`  | `ls`            | List all registered clients         |

The CLI exposes only `add` and `list`. For everything else — inspecting, updating, removing, importing, or exporting clients — use the **admin panel** at `/admin` or the [Management API](api/endpoints.md). For a programmatic starting point, copy the [`parako-rp.example.json`](https://github.com/Dahkenangnon/Parako.ID/blob/main/parako-rp.example.json) shipped at the repo root to `parako-rp.jsonc` and edit it directly.

### Adding a Client

```bash
pnpm client add
```

The interactive wizard prompts for:

1. **Client type** — Choose from six presets:
   - **Web Application** — Server-side app with client secret (`client_secret_basic`, authorization_code + refresh_token)
   - **Single Page Application** — Browser app without secret (PKCE required, authorization_code)
   - **Native Application** — Mobile/desktop app (PKCE required, authorization_code + refresh_token)
   - **Device Flow** — IoT/CLI devices (RFC 8628 device_code grant)
   - **Machine-to-Machine (M2M)** — Backend service or daemon (client_credentials)
   - **Management API** — Access the built-in Management API (client_credentials)

2. **Client name** — Human-readable display name
3. **Redirect URIs** — Comma-separated callback URLs
4. **Scopes** — Allowed scopes for this client

The wizard writes the new entry to `parako-rp.jsonc` and prints the `client_id` and `client_secret` (for confidential clients). The secret is stored in plain text in `parako-rp.jsonc`; protect that file accordingly.

### Listing Clients

```bash
pnpm client list
```

Displays all registered clients with their `client_id`, type, and active status.

### Editing a Client (without the CLI)

Open `parako-rp.jsonc` directly, edit the entry's fields, save, and restart Parako.ID. The shape is documented in [`parako-rp.example.json`](https://github.com/Dahkenangnon/Parako.ID/blob/main/parako-rp.example.json). For runtime edits without a restart, use the admin panel.

## Key Management

Manage JWKS (JSON Web Key Sets) for signing OIDC tokens.

```bash
pnpm keys <command>
```

### Commands

| Command    | Aliases | Description                                  |
| ---------- | ------- | -------------------------------------------- |
| `generate` | `gen`   | Generate new JWKS keys (RS256, ES256, EdDSA) |

### Generating Keys

```bash
pnpm keys generate
```

Generates a new key set with three algorithms: RS256, ES256, and EdDSA. Required before first startup — the OIDC provider cannot sign tokens without keys.

### Rotation and Listing

The CLI intentionally exposes only `generate` for first-boot bootstrap. In production, key rotation and listing are handled by the **DB-backed key store**, configured under `security.key_store` (`type: 'database'`):

- **Automatic rotation** every `rotation_interval_days` (default 90), with a configurable `overlap_window_seconds` (default 7200) during which both old and new keys remain valid for token verification
- **Manual rotation** via the admin panel or the Management API (`POST /api/v1/jwks/rotate` with `parako:jwks:rotate` scope)
- **Listing** via the admin panel or `GET /api/v1/jwks` with `parako:jwks:read` scope

See [Security](security.md) for full key-store configuration.

## Systemd Service

Generate and manage systemd unit files as an alternative to PM2.

```bash
pnpm systemd <command>
```

### Commands

| Command                     | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `generate [options]`        | Preview unit files (stdout) or write to a directory |
| `install [options]`         | Install systemd services (requires sudo)            |
| `uninstall [--name <name>]` | Remove systemd services (requires sudo)             |
| `status [--name <name>]`    | Show service status                                 |
| `restart [--name <name>]`   | Restart main + worker services (requires sudo)      |
| `logs [options]`            | Tail logs via `journalctl` (Ctrl-C to stop)         |

### Options

| Option                   | Default           | Description                                                     |
| ------------------------ | ----------------- | --------------------------------------------------------------- |
| `-u, --user <user>`      | current user      | Service user                                                    |
| `-d, --dir <directory>`  | current directory | Working directory                                               |
| `-e, --env-file <path>`  | `.env`            | Environment file path                                           |
| `-n, --node-path <path>` | auto-detected     | Node.js binary path                                             |
| `--name <name>`          | `parako-id`       | Service name prefix                                             |
| `--memory-app <size>`    | `1G`              | `MemoryMax` for the main app service                            |
| `--memory-worker <size>` | `300M`            | `MemoryMax` for the worker service                              |
| `-o, --output <dir>`     | —                 | (`generate` only) Write unit files to `<dir>` instead of stdout |
| `--force`                | off               | (`generate -o` and `install`) Overwrite existing files on diff  |
| `--worker`               | off               | (`logs` only) Tail only the worker service                      |
| `--since <time>`         | —                 | (`logs` only) e.g. `"1 hour ago"`, `"2025-01-01"`               |
| `--no-follow`            | off               | (`logs` only) Don't follow new entries                          |

### Installing

```bash
# Preview generated unit files
pnpm systemd generate

# Or write them to a directory
pnpm systemd generate -o /tmp/parako-units

# Install services (interactive prompts for missing flags)
sudo pnpm systemd install

# Non-interactive install with custom memory caps
sudo pnpm systemd install \
  --user parako --dir /opt/parako \
  --env-file /opt/parako/.env --node-path /usr/bin/node \
  --memory-app 2G --memory-worker 512M

# Check status
pnpm systemd status
```

`install` runs pre-install validation: it verifies the configured user exists, the working directory exists, and warns if the env file is missing. It refuses to overwrite existing unit files when content differs (showing a diff) unless you pass `--force`. Identical content is a safe no-op.

This creates two systemd services:

- `parako-id.service` — Main application
- `parako-id-worker.service` — Background worker (bound to main service via `BindsTo`)

### Restarting

```bash
sudo pnpm systemd restart
```

Restarts both the main app and the worker.

### Security Hardening

Generated unit files include systemd security hardening:

- `NoNewPrivileges=yes` — Prevent privilege escalation
- `ProtectSystem=strict` — Read-only filesystem except working directory
- `PrivateTmp=yes` — Isolated temporary directory
- Resource limits configurable via `--memory-app` / `--memory-worker`
- Graceful shutdown with configurable timeout

### Viewing Logs

```bash
# Tail both services (default)
pnpm systemd logs

# Tail only the worker
pnpm systemd logs --worker

# Recent logs (last hour)
pnpm systemd logs --since "1 hour ago"

# Show entries without following
pnpm systemd logs --no-follow --since "today"
```

Or use `journalctl` directly:

```bash
journalctl -u parako-id -u parako-id-worker -f
```
