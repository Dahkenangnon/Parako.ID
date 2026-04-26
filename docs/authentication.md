---
title: 'Authentication'
subtitle: 'Password policies, MFA, multi-account sessions, and account recovery'
category: 'Authentication & Authorization'
order: 2
---

## Email + Password

Parako.ID uses Argon2id for password hashing -- the winner of the Password Hashing Competition and recommended by OWASP.

Users can sign in with email + password, phone + password, or a custom dynamic username + password, depending on your configured login methods:

```jsonc
{
  "security": {
    "authentication": {
      "login": {
        "login_methods": [
          "email+password",
          "phone+password",
          "custom_identifier+password",
        ],
      },
    },
  },
}
```

The `custom_identifier+password` method requires `custom_identifiers.enabled = true` and at least one field with `usable_for_login: true` (see [Custom Identifiers](#custom-identifiers)).

When a user submits credentials, Parako.ID auto-detects the identifier type (email, phone, or custom identifier) if the form does not specify one explicitly. You can also send `login_method: "auto"` to let the server decide.

### Password Policy

Configure password requirements in the `security.authentication.login.password_policy` section:

| Field               | Default | Description                                |
| ------------------- | ------- | ------------------------------------------ |
| `min_length`        | 8       | Minimum password length                    |
| `require_uppercase` | `true`  | Require at least one uppercase letter      |
| `require_lowercase` | `true`  | Require at least one lowercase letter      |
| `require_numbers`   | `true`  | Require at least one digit                 |
| `require_symbols`   | `false` | Require at least one special character     |
| `max_age_days`      | 90      | Force password change after this many days |

### Password Breach Detection

Parako.ID integrates with the [Have I Been Pwned](https://haveibeenpwned.com/) (HIBP) API to check if a password has appeared in known data breaches. The check uses k-anonymity -- only a partial hash prefix is sent to the API, so the actual password is never exposed.

| Field                      | Default | Description                         |
| -------------------------- | ------- | ----------------------------------- |
| `enabled`                  | `true`  | Enable breach detection             |
| `api_timeout_ms`           | 3000    | Timeout for HIBP API calls          |
| `check_on_registration`    | `true`  | Check during signup                 |
| `check_on_login`           | `true`  | Check during login                  |
| `check_on_password_reset`  | `true`  | Check during password reset         |
| `check_on_password_change` | `true`  | Check during password change        |
| `min_breach_count`         | 1       | Minimum breach appearances to block |

When a breached password is detected, the user is prompted to choose a different password.

> **Config path:** `security.authentication.password_breach_detection` — this is a sibling of `login`, not nested under it.

## Multi-Factor Authentication

MFA adds a second verification step after password authentication. Enable or disable MFA globally and configure individual methods.

```jsonc
{
  "security": {
    "authentication": {
      "multi_factor": {
        "enabled": true,
      },
    },
  },
}
```

### TOTP

Time-based One-Time Password using authenticator apps (Google Authenticator, Authy, 1Password, etc.).

| Field         | Default           | Description                     |
| ------------- | ----------------- | ------------------------------- |
| `enabled`     | `true`            | Enable TOTP MFA                 |
| `issuer_name` | `"OIDC Provider"` | Name shown in authenticator app |

Users set up TOTP by scanning a QR code from their account settings page. During login, they enter the 6-digit code from their authenticator app.

### Email OTP

A one-time code sent to the user's email address.

| Field              | Default | Description                       |
| ------------------ | ------- | --------------------------------- |
| `enabled`          | `true`  | Enable email OTP                  |
| `code_ttl_seconds` | 600     | Code expiration time (10 minutes) |

Requires a configured SMTP server. See [Email & SMS](email-sms.md).

### SMS MFA

A one-time code sent via SMS using Twilio.

| Field     | Default | Description    |
| --------- | ------- | -------------- |
| `enabled` | `false` | Enable SMS MFA |

Requires Twilio credentials. See [Email & SMS](email-sms.md).

### WebAuthn / Passkeys

FIDO2/WebAuthn authentication using hardware security keys or platform authenticators (Touch ID, Windows Hello, Android biometrics).

| Field                      | Default           | Description                                                                                    |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `enabled`                  | `false`           | Enable WebAuthn                                                                                |
| `rp_name`                  | `"OIDC Provider"` | Relying party name shown to user                                                               |
| `rp_id`                    | `"localhost"`     | Relying party ID (your domain)                                                                 |
| `timeout`                  | 60000             | Authentication timeout in milliseconds                                                         |
| `attestation`              | `"none"`          | `none`, `indirect`, `direct`, or `enterprise`                                                  |
| `user_verification`        | `"preferred"`     | `required`, `preferred`, or `discouraged`                                                      |
| `authenticator_attachment` | —                 | Optional. Restrict to `"platform"` (built-in biometrics) or `"cross-platform"` (external keys) |
| `resident_key`             | `"preferred"`     | `required`, `preferred`, or `discouraged`                                                      |
| `max_credentials_per_user` | 10                | Maximum passkeys per user account                                                              |

For production, set `rp_id` to your domain (e.g., `"auth.example.com"`).

## Multi-Account Sessions

Users can sign in with multiple accounts in the same browser session and switch between them without re-entering credentials.

| Field                                          | Default | Description                              |
| ---------------------------------------------- | ------- | ---------------------------------------- |
| `session_management.multiple_accounts.enabled` | `true`  | Enable multi-account sessions            |
| `session.max_accounts_per_session`             | 5       | Maximum accounts per browser session     |
| `session.require_reauth_on_switch`             | `false` | Require password when switching accounts |

All paths above are relative to `security.authentication`.

When enabled, the OIDC provider presents an account selection screen during authorization if multiple accounts are active in the session.

> For session security settings (binding, timeouts, encryption) and new device verification, see [Security — Session Security](security.md#session-security).

## Account Recovery

Configure how users regain access when they lose their primary credentials.

```jsonc
{
  "security": {
    "authentication": {
      "recovery": {
        "enabled": true,
      },
    },
  },
}
```

### Backup Codes

| Field         | Default | Description               |
| ------------- | ------- | ------------------------- |
| `enabled`     | `true`  | Enable backup codes       |
| `count`       | 10      | Number of codes generated |
| `expiry_days` | 365     | Days until codes expire   |

Users generate backup codes from their account settings. Each code can be used once.

### Secondary Email

| Field     | Default | Description                     |
| --------- | ------- | ------------------------------- |
| `enabled` | `true`  | Enable secondary email recovery |

Users register a secondary email address. A verification code is sent to this address during recovery.

### SMS Recovery

| Field     | Default | Description         |
| --------- | ------- | ------------------- |
| `enabled` | `false` | Enable SMS recovery |

Requires Twilio. A code is sent to the user's verified phone number.

### Security Questions

| Field     | Default | Description               |
| --------- | ------- | ------------------------- |
| `enabled` | `false` | Enable security questions |

Users set up security questions from their account settings.

## Password Reset

Parako.ID provides a token-based password reset flow:

1. User requests a reset via `/auth/forgot-password` by submitting their email
2. A cryptographic token is generated, hashed, and stored on the user record
3. An email with a reset link (containing the plain token) is sent to the user
4. User submits the token and a new password via `/auth/reset-password`
5. The token is verified and the password is updated

The reset token expires after **1 hour** (hardcoded). If `password_breach_detection.check_on_password_reset` is enabled, the new password is checked against the HIBP database before being accepted.

## Email Verification

When `require_email_verification` is enabled in the signup configuration, new accounts are not activated until the user verifies their email address:

1. After registration, a verification token is generated and emailed to the user
2. User clicks the verification link
3. The token is validated and `email_verified` is set to `true`

The verification token expires after **24 hours** (hardcoded). Users who have not verified their email can request a new verification token.

## Signup Configuration

Control how new users register:

| Field                             | Default                                                           | Description                                          |
| --------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `signup_methods`                  | `["email+password+full_name", "phone_number+password+full_name"]` | Available registration methods                       |
| `require_email_verification`      | `false`                                                           | Require email verification before account activation |
| `require_phone_verification`      | `false`                                                           | Require phone verification                           |
| `auto_approval.enabled`           | `true`                                                            | Automatically approve new accounts                   |
| `auto_approval.domains_whitelist` | `[]`                                                              | Only auto-approve users from these email domains     |

### Contact Channels

| Field                  | Default | Description                         |
| ---------------------- | ------- | ----------------------------------- |
| `require_at_least_one` | `true`  | Require at least one contact method |
| `email.enabled`        | `true`  | Show email field on registration    |
| `email.required`       | `false` | Make email required                 |
| `phone.enabled`        | `true`  | Show phone field                    |
| `phone.required`       | `false` | Make phone required                 |
| `full_name.enabled`    | `true`  | Show full name field                |
| `full_name.required`   | `true`  | Make full name required             |

### Custom Identifiers

Configure up to 3 custom identifier fields that users can use for login alongside email/phone:

```jsonc
{
  "security": {
    "authentication": {
      "custom_identifiers": {
        "enabled": true,
        "fields": [
          {
            "slot": 1,
            "key": "company_name",
            "name": "Company Name",
            "hint_for_user": "Your company or organization name",
            "validation_type": "regex",
            "pattern": "^[A-Za-z0-9 -]+$",
            "min_length": 2,
            "max_length": 50,
            "case_sensitive": false,
            "required_for_registration": false,
            "edit_policy": "set_once",
            "usable_for_login": true,
          },
        ],
      },
    },
  },
}
```

> **Note:** `custom_identifiers.enabled` defaults to `false`. Each field supports three validation types: `none` (length only), `regex` (pattern matching), or `charset_mask` (charset + mask format). The `edit_policy` controls user editing: `admin_only`, `set_once` (default), `editable`, or `full` (edit + delete). Fields with `usable_for_login: true` are accepted at the unified login input — the server resolves which custom identifier the value belongs to by matching it against each enabled field's validation rule (regex pattern or charset/mask), then dispatches to the correct slot via `detectIdentifierType()` in `src/oidc/utils.ts`.

## User Roles

Parako.ID includes three built-in roles:

| Role         | Description                                   |
| ------------ | --------------------------------------------- |
| `user`       | Default role for all new accounts             |
| `admin`      | Access to admin panel, user management        |
| `superadmin` | Full access including platform-level settings |

All new accounts are assigned the default role (`user`). Admins can promote users to `admin` or `superadmin` via the admin panel or Management API. Configure the default role and available roles:

```jsonc
{
  "security": {
    "authentication": {
      "roles": {
        "available": ["user", "admin", "superadmin"],
        "default": "user",
      },
    },
  },
}
```

## OIDC Interaction Flows

When an OIDC client redirects a user to the authorization endpoint, Parako.ID walks the user through a series of interaction steps. Each step is handled by a dedicated handler.

### Flow Order

The typical interaction flow proceeds in this order:

1. **Login** — User enters email and password credentials
2. **New Device Verify** — If the device is unrecognized and `require_2fa_for_new_device` is enabled, the user must verify via email, SMS, or TOTP
3. **MFA / WebAuthn** — If MFA is enabled for the user, they verify with TOTP code or FIDO2/passkey
4. **Select Account** — If multiple accounts are active in the session, the user picks which account to use
5. **Consent** — The user reviews and approves the requested scopes for the client
6. **Redirect** — Parako.ID redirects back to the client with an authorization code

Steps 2–4 are conditional and skipped when not applicable.

### Interaction Handlers

| Handler           | Source                                                                                            | Description                             |
| ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Login             | [`src/oidc/flows/handlers/login.ts`](../src/oidc/flows/handlers/login.ts)                         | Email/password credential verification  |
| Consent           | [`src/oidc/flows/handlers/consent.ts`](../src/oidc/flows/handlers/consent.ts)                     | User approves scopes for client         |
| Select Account    | [`src/oidc/flows/handlers/select-account.ts`](../src/oidc/flows/handlers/select-account.ts)       | Multi-account session picker            |
| MFA               | [`src/oidc/flows/handlers/mfa.ts`](../src/oidc/flows/handlers/mfa.ts)                             | TOTP code verification                  |
| WebAuthn MFA      | [`src/oidc/flows/handlers/webauthn-mfa.ts`](../src/oidc/flows/handlers/webauthn-mfa.ts)           | FIDO2/passkey verification              |
| Social Login      | [`src/oidc/flows/handlers/social-login.ts`](../src/oidc/flows/handlers/social-login.ts)           | Redirect to external OAuth2 provider    |
| Social Callback   | [`src/oidc/flows/handlers/social-callback.ts`](../src/oidc/flows/handlers/social-callback.ts)     | Handle response from social provider    |
| New Device Verify | [`src/oidc/flows/handlers/new-device-verify.ts`](../src/oidc/flows/handlers/new-device-verify.ts) | Verify unrecognized device before login |
| Abort             | [`src/oidc/flows/handlers/abort.ts`](../src/oidc/flows/handlers/abort.ts)                         | Cancel the authentication flow          |
| Error             | [`src/oidc/flows/handlers/error.ts`](../src/oidc/flows/handlers/error.ts)                         | Handle OIDC errors during interaction   |

### Social Login Flow

When a user clicks a social login button (GitHub, Google, etc.), the flow diverges:

1. **Social Login** handler redirects the user to the external provider
2. **Social Callback** handler receives the provider's response
3. If the social account is linked to an existing user, the flow continues to consent
4. If the social account is new, the user is prompted to create an account or link to an existing one

### Customizing Interactions

Interaction views are Nunjucks templates located in [`src/views/auth/`](../src/views/auth/). You can customize the login page, consent screen, and MFA prompts by editing these templates.
