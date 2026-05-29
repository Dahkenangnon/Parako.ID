---
title: 'Security'
subtitle: 'Defense-in-depth security controls for rate limiting, session binding, device matching, and encryption'
category: 'Authentication & Authorization'
order: 4
---

## Security Overview

Parako.ID applies defense-in-depth security across multiple layers:

| Layer          | Controls                                                     |
| -------------- | ------------------------------------------------------------ |
| Transport      | HTTPS, secure cookies, HSTS                                  |
| Input          | HPP protection, mongo-sanitize, express-validator            |
| Session        | Binding, timeouts, concurrent limits, CSRF tokens            |
| Authentication | Argon2id hashing, MFA, breach detection, device verification |
| Authorization  | RBAC, permission checks, tenant isolation                    |
| Network        | CORS, rate limiting, trusted proxies                         |
| Data           | Encryption at rest, pairwise subjects                        |

## Password Security

### Hashing

Passwords are hashed with Argon2id using OWASP-recommended parameters:

| Parameter   | Value               |
| ----------- | ------------------- |
| Variant     | argon2id            |
| Memory cost | 19 MiB (19,456 KiB) |
| Time cost   | 2 iterations        |
| Parallelism | 1                   |

Hashes are stored in PHC format (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`). On login, existing hashes are checked for parameter drift and automatically rehashed if the parameters have been upgraded.

### Breach Detection

Parako.ID checks passwords against the [Have I Been Pwned](https://haveibeenpwned.com/Passwords) Pwned Passwords database using k-anonymity:

1. The password is SHA-1 hashed locally
2. Only the first 5 characters of the hash are sent to the HIBP API
3. The full hash never leaves the server
4. The API returns all matching suffixes, and Parako.ID checks for a local match

Breach checks run with a 3-second timeout. If the HIBP API is unreachable, the check is silently skipped — it never blocks authentication.

## Rate Limiting

Rate limiting is enabled by default. In production, it connects to Redis for distributed tracking across cluster instances (if `REDIS_URL` is configured); otherwise it uses an in-memory store. Development mode always uses in-memory.

```jsonc
{
  "security": {
    "protection": {
      "rate_limiting": {
        "enabled": true,
        "requests_per_minute": 100,
        "window_minutes": 15,
      },
    },
  },
}
```

| Field                 | Default | Description                    |
| --------------------- | ------- | ------------------------------ |
| `enabled`             | `true`  | Enable rate limiting           |
| `requests_per_minute` | 100     | Max requests per window        |
| `window_minutes`      | 15      | Sliding window size in minutes |

The Management API applies tiered rate limits per operation type:

| Tier      | Operations                 | Limit    |
| --------- | -------------------------- | -------- |
| read      | GET requests               | Higher   |
| write     | POST, PUT, PATCH           | Medium   |
| delete    | DELETE operations          | Lower    |
| sensitive | Secret rotation, MFA reset | Very low |

Rate limit headers are included in API responses: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Security Headers

Parako.ID sets the following security headers on all responses:

| Header                      | Value                                          | Purpose                           |
| --------------------------- | ---------------------------------------------- | --------------------------------- |
| `X-XSS-Protection`          | `1; mode=block`                                | Enables browser XSS filtering     |
| `X-Frame-Options`           | `DENY`                                         | Prevents clickjacking via iframes |
| `X-Content-Type-Options`    | `nosniff`                                      | Prevents MIME-type sniffing       |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Enforces HTTPS for 1 year         |

These headers are applied unconditionally via middleware in `src/app.ts`. In production, HTTP requests are automatically redirected to HTTPS with a 301 status.

## CORS

Cross-Origin Resource Sharing is configured per environment:

- **Production**: Only origins listed in `deployment.server.allowed_origins` are permitted
- **Development**: All origins are allowed

All CORS responses include `credentials: true` and a 24-hour preflight cache (`Access-Control-Max-Age: 86400`). Allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`.

## Session Security

Configure session binding and timeouts in `security.authentication.session`:

| Field                         | Default                 | Description                                                       |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `cookie_name`                 | `"application_session"` | Session cookie name                                               |
| `same_site`                   | `"lax"`                 | SameSite cookie attribute                                         |
| `bind_ip`                     | `false`                 | Invalidate session if IP changes                                  |
| `bind_user_agent`             | `false`                 | Invalidate session if User-Agent changes                          |
| `bind_device`                 | `false`                 | Invalidate session if device fingerprint changes                  |
| `idle_timeout_minutes`        | 30                      | Session expires after inactivity                                  |
| `absolute_timeout_hours`      | 24                      | Session expires regardless of activity                            |
| `max_concurrent_sessions`     | 0                       | Max active sessions per user (0 = unlimited)                      |
| `max_accounts_per_session`    | 5                       | Maximum accounts per multi-account session                        |
| `require_reauth_on_switch`    | `false`                 | Require re-authentication when switching accounts                 |
| `encrypt_session_data`        | `false`                 | Encrypt session data at rest                                      |
| `notify_new_session`          | `false`                 | Email user on new session                                         |
| `store_metadata`              | `false`                 | Store verbose session metadata (creation source, browser details) |
| `max_flash_messages_per_type` | 10                      | Maximum flash messages per type (success, error, info, warning)   |
| `max_flash_messages_total`    | 20                      | Maximum total flash messages across all types                     |

### New Device Verification

When enabled, Parako.ID detects unrecognized devices and requires additional verification before granting access.

| Field                             | Default  | Description                                                     |
| --------------------------------- | -------- | --------------------------------------------------------------- |
| `require_2fa_for_new_device`      | `false`  | Require MFA for unrecognized devices                            |
| `new_device_2fa_method`           | `"auto"` | MFA method: `auto`, `email`, or `totp`                          |
| `new_device_confidence_threshold` | 70       | Confidence score below which a device is considered new (0–100) |

## CSRF Protection

Parako.ID generates a unique CSRF token per session and injects it into all rendered views via `res.locals.csrfToken`. All state-changing POST routes validate the token via the `validateCsrfToken` middleware.

Forms must include the token as a hidden field:

```html
<input type="hidden" name="_csrf" value="{{ csrfToken }}" />
```

## Device Matching

Parako.ID tracks devices using a confidence scoring system that compares browser fingerprint, IP address, and geolocation data.

```jsonc
{
  "security": {
    "protection": {
      "device_matching": {
        "min_confidence_score": 70,
        "ip_similarity_threshold": 0.8,
        "enable_impossible_travel": true,
        "impossible_travel_max_speed_kmh": 900,
        "trust_duration_days": 30,
      },
    },
  },
}
```

| Field                             | Default | Description                                        |
| --------------------------------- | ------- | -------------------------------------------------- |
| `min_confidence_score`            | 70      | Minimum score to consider a device trusted (0–100) |
| `ip_similarity_threshold`         | 0.8     | IP similarity threshold (0.0–1.0)                  |
| `enable_impossible_travel`        | `true`  | Detect physically impossible location changes      |
| `impossible_travel_max_speed_kmh` | 900     | Maximum travel speed before flagging (km/h)        |
| `trust_duration_days`             | 30      | Days a device stays trusted                        |

### Impossible Travel Detection

When enabled, Parako.ID flags logins where the user would have had to travel faster than the configured speed between their last known location and the new login location. This detects credential theft from a different geographic region.

## IP Services

Parako.ID integrates with external IP intelligence services for enhanced security.

### Geolocation (ipinfo.io)

Provides geographic location data for IP addresses, used in device matching and audit logs.

```jsonc
{
  "integrations": {
    "ipinfo": {
      "enabled": false,
      "cache_ttl_hours": 24,
    },
  },
}
```

Set the `IPINFO_API_TOKEN` environment variable with your API token.

### IP Reputation (IPQualityScore)

Scores IP addresses for fraud risk, detecting proxies, VPNs, and known malicious IPs.

```jsonc
{
  "integrations": {
    "ipqualityscore": {
      "enabled": false,
      "fraud_score_threshold": 75,
      "cache_ttl_hours": 6,
    },
  },
}
```

Set the `IPQUALITYSCORE_API_KEY` environment variable. IPs scoring above the `fraud_score_threshold` (0–100) are flagged in the audit log.

## JWKS / Key Management

Parako.ID uses JSON Web Key Sets (JWKS) for signing OIDC tokens. Configure key management in `security.key_store`:

| Field                    | Default                       | Description                                    |
| ------------------------ | ----------------------------- | ---------------------------------------------- |
| `type`                   | `"database"`                  | Key storage: `database` or `file`              |
| `rotation_interval_days` | 90                            | Auto-rotate keys every N days                  |
| `overlap_window_seconds` | 7200                          | Keep old keys valid for 2 hours after rotation |
| `algorithms`             | `["RS256", "ES256", "EdDSA"]` | Signing algorithms to generate                 |
| `promotion_delay_ms`     | 0                             | Delay before new key becomes active            |

### Key Lifecycle

1. **Generate** — Initial keys are created with `pnpm keys generate` (CLI bootstrap) or auto-generated by the DB key store on first boot
2. **Active** — Keys are used to sign tokens
3. **Rotated** — Triggered automatically (per `rotation_interval_days`) or manually; old keys remain valid during the overlap window
4. **Retired** — Keys are no longer valid for verification

### Bootstrap CLI

The CLI exposes only `generate`, used for first-boot bootstrap when no keys exist yet:

```bash
pnpm keys generate    # Generate new JWKS keys (RS256, ES256, EdDSA)
```

For production, keys are managed by the DB-backed key store and the admin panel. Use the admin panel at `/admin` or the [Management API](api/endpoints.md) — `GET /api/v1/jwks` (scope `parako:jwks:read`) and `POST /api/v1/jwks/rotate` (scope `parako:jwks:rotate`) — to inspect, rotate, or retire keys.

### JWA Algorithm Configuration

Configure which JSON Web Algorithms (JWA) are enabled for each token and response type. All values are arrays of algorithm identifiers.

| Config Key                                      | Purpose                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| `oidc.jwa.authorization_signing_alg_values`     | Signing algorithms for JARM authorization responses       |
| `oidc.jwa.authorization_encryption_alg_values`  | Key encryption algorithms for authorization responses     |
| `oidc.jwa.authorization_encryption_enc_values`  | Content encryption algorithms for authorization responses |
| `oidc.jwa.client_auth_signing_alg_values`       | Client authentication signing algorithms                  |
| `oidc.jwa.dpop_signing_alg_values`              | DPoP proof-of-possession signing algorithms               |
| `oidc.jwa.id_token_signing_alg_values`          | ID token signing algorithms                               |
| `oidc.jwa.id_token_encryption_alg_values`       | ID token key encryption algorithms                        |
| `oidc.jwa.id_token_encryption_enc_values`       | ID token content encryption algorithms                    |
| `oidc.jwa.introspection_signing_alg_values`     | Introspection response signing algorithms                 |
| `oidc.jwa.introspection_encryption_alg_values`  | Introspection response key encryption algorithms          |
| `oidc.jwa.introspection_encryption_enc_values`  | Introspection response content encryption algorithms      |
| `oidc.jwa.request_object_signing_alg_values`    | Request object signing algorithms                         |
| `oidc.jwa.request_object_encryption_alg_values` | Request object key encryption algorithms                  |
| `oidc.jwa.request_object_encryption_enc_values` | Request object content encryption algorithms              |
| `oidc.jwa.userinfo_signing_alg_values`          | UserInfo response signing algorithms                      |
| `oidc.jwa.userinfo_encryption_alg_values`       | UserInfo response key encryption algorithms               |
| `oidc.jwa.userinfo_encryption_enc_values`       | UserInfo response content encryption algorithms           |
| `oidc.jwa.attest_signing_alg_values`            | Signing algorithms for WebAuthn attestation               |

Configure in your `parako.jsonc` or via the admin panel under OIDC settings.

## Encryption at Rest

The `ENCRYPTION_KEY` environment variable (64-character hex, 32 bytes) is used to encrypt sensitive data stored in the database:

- OIDC client secrets
- Social login provider tokens (access tokens, refresh tokens)
- Social login provider client secrets

Generate the key with:

```bash
openssl rand -hex 32
```

If you lose this key, encrypted data cannot be recovered. Back it up securely.

When `security.authentication.session.encrypt_session_data` is enabled, sensitive session fields are also encrypted with AES-256-GCM using the same `ENCRYPTION_KEY`:

- `authenticatedUsers`
- `csrfToken`
- `authTime`, `ipAddress`, `userAgent`, `deviceId`
- `_metadata`

If decryption fails (e.g., after key rotation), the session continues with unencrypted data to avoid lockouts.

### Pairwise Subject Identifiers

When `features.oidc.subject_types` includes `pairwise`, each OIDC client receives a unique, non-correlatable subject identifier for the same user. This prevents clients from tracking users across services.

Pairwise identifiers are computed as `SHA256(sectorIdentifier + accountId + salt)` using the `oidc.secrets.pairwise_salt` configuration value. The salt must be set before issuing tokens and should never change (existing tokens would become invalid).

## Cookie Security

Cookie settings are configured in `deployment.cookies`:

```jsonc
{
  "deployment": {
    "cookies": {
      "defaults": {
        "httpOnly": true,
        "secure": false,
        "sameSite": "lax",
        "path": "/",
      },
    },
  },
}
```

In production (`NODE_ENV=production`), the `secure` flag is automatically set to `true` — no manual configuration is needed. The application manages three cookie types:

| Cookie  | Purpose                    | Default max age |
| ------- | -------------------------- | --------------- |
| Session | Authentication state       | 24 hours        |
| Locale  | User language preference   | 1 year          |
| Theme   | Light/dark mode preference | 1 year          |

## Trusted Domains and Proxies

Configure trusted domains and proxy IPs for accurate client IP detection:

```jsonc
{
  "security": {
    "protection": {
      "trusted_domains": ["example.com", "app.example.com"],
      "trusted_proxies": ["10.0.0.0/8", "172.16.0.0/12"],
      "high_risk_countries": ["XX"],
    },
  },
}
```

| Field                 | Description                                         |
| --------------------- | --------------------------------------------------- |
| `trusted_domains`     | Domains allowed for CORS and redirect validation    |
| `trusted_proxies`     | IP addresses/CIDR ranges of trusted reverse proxies |
| `high_risk_countries` | ISO 3166-1 country codes flagged in audit logs      |

When behind a reverse proxy (nginx, Cloudflare), set `deployment.server.proxy: true` and add the proxy IPs to `trusted_proxies` for correct `X-Forwarded-For` handling.
