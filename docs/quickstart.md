---
title: 'Quickstart'
subtitle: 'Get Parako.ID running in minutes'
category: 'Getting Started'
order: 2
---

## Prerequisites

Before you begin, ensure you have:

- **Node.js** >= 24 — [Download](https://nodejs.org/)
- **pnpm** >= 11 — Install with `corepack enable && corepack prepare pnpm@11.4.0 --activate` (Corepack also reads the `packageManager` field in `package.json` and pins the exact version automatically.)

Optional for production:

- MongoDB or PostgreSQL (SQLite is used by default)
- Redis (for OIDC token storage or session caching)
- An SMTP server (for email verification and notifications)

## Install from Source

Clone the repository and install dependencies:

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install
```

Copy the example environment file and generate required secrets:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
DEPLOYMENT_ENVIRONMENT=development
DEPLOYMENT_SERVER_PORT=9007
DEPLOYMENT_URL=http://localhost:9007
STORAGE_ADAPTER=sqlite
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Push the database schema:

```bash
pnpm db:push
```

JWKS keys are automatically generated on first startup and stored in the database — no manual step needed.

> **Note:** For file-based single-tenant setups (`USE_FILE_CONFIG=true`), you can use `pnpm keys generate` after building (`pnpm build`) to write keys to a local file instead.

Start the development server:

```bash
pnpm dev
```

Parako.ID is now running at `http://localhost:9007`.

## One-Line Install

For a guided installation on a fresh Ubuntu server:

```bash
# User-local install
curl -sSL https://get.parako.id | bash

# Or system-wide (installs to /opt/parako-id, requires sudo)
curl -sSL https://get.parako.id | sudo bash
```

The installer prompts for environment, port, deployment URL, supervisor (systemd or PM2), database, and Redis. It generates a `.env` with cryptographically-random secrets, validates DB and Redis connectivity, runs schema migrations, and starts the service via your chosen supervisor.

Upgrade later with `--update`:

```bash
curl -sSL https://get.parako.id | sudo bash -s -- --update
```

This snapshots the install, swaps in the new version, runs migrations, health-checks the new release, and rolls back automatically if it fails.

## Create Your First Account

Open your browser and navigate to:

```
http://localhost:9007/auth/register
```

Fill in your name, email, and password to create your account. To access the admin panel, assign the `admin` role to your account — see [Admin Panel](admin-panel.md) for details.

## Register Your First OIDC Client

The recommended way to create OIDC clients is through the admin panel:

1. Navigate to `/admin/oidc-clients` and click **Create Client**
2. The wizard walks you through:
   - **Client type** — Web Application, SPA, Native, Device Flow, API, or Service Account
   - **Client name** — A human-readable name (e.g., "My Web App")
   - **Redirect URIs** — Where to redirect after login (e.g., `http://localhost:3000/callback`)
   - **Allowed scopes** — What user data the client can access
3. Note the `client_id` and `client_secret`. Store the secret securely — it is encrypted at rest and cannot be retrieved later.

> **Alternative:** For file-based single-tenant setups, you can use the CLI (`pnpm client add`) after building (`pnpm build`). The CLI writes to file-based config rather than the database. See [CLI Tools](cli-tools.md) for details.

See [OIDC Clients](oidc-clients.md) for full client management documentation.

## Test the OIDC Flow

Build the authorization URL with your client's details:

```
http://localhost:9007/oidc/v1/authorize?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=http://localhost:3000/callback&
  response_type=code&
  scope=openid+profile+email&
  code_challenge=YOUR_CODE_CHALLENGE&
  code_challenge_method=S256&
  state=random_state_value
```

Open this URL in your browser. You will see the Parako.ID login page. Sign in with the account you created earlier, then consent to share your profile data.

After consent, Parako.ID redirects to your `redirect_uri` with an authorization code:

```
http://localhost:3000/callback?code=AUTH_CODE&state=random_state_value
```

Exchange the code for tokens:

```bash
curl -X POST http://localhost:9007/oidc/v1/token \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=AUTH_CODE" \
  -d "redirect_uri=http://localhost:3000/callback" \
  -d "code_verifier=YOUR_CODE_VERIFIER"
```

The response contains your `access_token`, `id_token`, and `refresh_token`.

Fetch user info with the access token:

```bash
curl http://localhost:9007/oidc/v1/userinfo \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Next Steps

- [Configuration](configuration.md) — Customize your deployment settings
- [OIDC Clients](oidc-clients.md) — Manage client applications and scopes
- [Admin Panel](admin-panel.md) — Manage users, clients, settings, and audit logs
- [Social Login](social-login.md) — Add Google, GitHub, and other providers
- [Authentication](authentication.md) — Configure MFA, password policies, and account recovery
- [Deployment](deployment.md) — Deploy to production with PM2 or systemd
- [Integrating Your App](integrating-your-app.md) — Connect your applications to Parako.ID
