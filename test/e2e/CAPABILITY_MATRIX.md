# End-to-end capability matrix

This document is the acceptance contract for Parako.ID's end-to-end suite. It
is derived from the registered routes and supported runtime configuration, not
from documentation claims. A capability is complete only when its observable
behavior passes in every applicable deployment cell below.

The matrix covers phase-one visitor behavior, normal-user account behavior,
the Management API, and the protocol behavior needed to enter and leave those
flows. Admin, tenant-admin, platform-admin UI, `_ops` governance, and Docker
packaging are intentionally deferred.

## Deployment cells

| Cell                | Storage adapter | Tenancy mode  | Status         | Runtime prerequisite                                         |
| ------------------- | --------------- | ------------- | -------------- | ------------------------------------------------------------ |
| `sqlite-single`     | SQLite          | Single tenant | Required       | In-process temporary database                                |
| `postgresql-single` | PostgreSQL      | Single tenant | Required       | Disposable PostgreSQL database                               |
| `postgresql-multi`  | PostgreSQL      | Multi tenant  | Required       | Disposable PostgreSQL database with tenant isolation enabled |
| `mongodb-single`    | MongoDB         | Single tenant | Required       | Disposable MongoDB database                                  |
| `mongodb-multi`     | MongoDB         | Multi tenant  | Required       | Disposable MongoDB database with tenant extraction enabled   |
| `sqlite-multi`      | SQLite          | Multi tenant  | Not applicable | SQLite does not support Parako.ID multi-tenancy              |

Every required capability below runs in all five applicable cells unless its
row states a narrower, source-backed applicability rule. Multi-tenant runs must
prove both positive tenant behavior and negative cross-tenant isolation.

## Configuration partitions

Configuration is an input to behavior. The suite therefore covers named
partitions instead of attempting an undefined Cartesian product of every
possible scalar value:

- default configuration;
- feature enabled and disabled where a feature has a toggle;
- valid boundary values and schema-rejected invalid values;
- security-required and security-optional branches where supported;
- custom route and custom OIDC mount paths;
- localized and non-localized UI routes;
- external-service success and failure using deterministic local fakes;
- single-tenant defaults and tenant-specific overrides in multi-tenant cells.

When two settings interact, the suite adds an explicit combination for each
documented dependency, such as JWT introspection requiring introspection or
JWT UserInfo requiring the UserInfo endpoint. A new configuration branch is
not considered E2E-covered until it is added here and exercised.

## Browser quality contract

Every server-rendered visitor and account page must be checked in a real
browser for:

- successful document, stylesheet, script, image, and font requests;
- no uncaught page errors or unexpected console errors;
- the expected page landmark, heading, form, and actionable controls;
- usable keyboard focus and accessible names for primary controls;
- narrow and desktop viewport behavior without horizontal overflow;
- visible state changes after mutations without requiring a manual refresh;
- localized route rendering where the route supports locale prefixes.

## Visitor and public capabilities

| Capability                         | Default routes                                                                                                                               | Configuration partitions                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Root and locale entry              | `GET /`, `GET /:locale`                                                                                                                      | supported locale; unsupported locale; custom auth route                                                      |
| Liveness and readiness             | `GET /health`, `GET /health?deep=true`, `GET /readyz`                                                                                        | healthy; database unavailable; shutdown drain                                                                |
| OIDC metadata and keys             | discovery and JWKS beneath the configured issuer                                                                                             | default and custom OIDC path; tenant issuer                                                                  |
| Registration                       | `GET/POST /auth/register`                                                                                                                    | enabled methods; required contacts; verification required; auto-approval branch; disabled/unavailable method |
| Login                              | `GET/POST /auth/login`                                                                                                                       | email; phone; enabled custom identifier; invalid credentials; locked user; rate limit                        |
| Password recovery                  | `GET/POST /auth/forgot-password`, `GET/POST /auth/reset-password`                                                                            | valid, invalid, expired, and replayed token; breach policy branch                                            |
| Email verification                 | `/auth/email-verification`, `/auth/verify-email`, `/auth/email-verification-success`                                                         | valid, invalid, expired, and replayed token                                                                  |
| Account selection and continuation | `/auth/account-select`, `/auth/continue`                                                                                                     | one and multiple accounts; valid and rejected continuation target                                            |
| MFA challenge                      | `/auth/multi-factor`, `/auth/mfa-verify`, `/auth/mfa-resend`, `/auth/mfa-select`, `/auth/mfa-webauthn`                                       | TOTP; recovery code; WebAuthn fake; resend; invalid and expired challenge                                    |
| Local and RP-initiated logout      | `GET/POST /auth/logout`, configured OIDC end-session endpoint                                                                                | local session only; `id_token_hint`; registered post-logout redirect; invalid redirect; visible RP state     |
| Account recovery                   | `/auth/account-recovery`, `/auth/recovery-method-select`, backup-code, secondary-email, security-question, SMS, and verification-code routes | each enabled method; each disabled method; invalid, expired, and replayed proof                              |
| Social entry and completion        | `/auth/social/:provider/{login,register,callback,complete}`, password and contact completion routes                                          | provider enabled/disabled; success; denial; invalid state; provider failure; account linking policy          |
| Visitor preferences                | `POST /auth/update-theme`, `/update-locale`, `/update-sidebar`, `/update-timezone`                                                           | valid CSRF; missing/invalid CSRF; persisted browser state                                                    |
| Public WebAuthn authentication     | `POST /api/v1/webauthn/authenticate/options`, `/authenticate/verify`                                                                         | deterministic authenticator success; invalid origin/challenge/signature                                      |
| Static and uploaded media          | emitted asset URLs and configured media routes                                                                                               | existing, missing, cache headers, content type, path traversal rejection                                     |
| Error and not-found pages          | invalid HTML route, invalid OIDC request, invalid API route                                                                                  | styled HTML for browser routes; Problem Details JSON for Management API                                      |

## Normal-user account capabilities

All account routes require an authenticated user. Each group must also prove
anonymous rejection, CSRF rejection for mutations, ownership checks, and
tenant isolation in multi-tenant cells.

| Capability                         | Default routes and actions                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard and settings navigation  | `GET /accounts/`, `/settings`, `/settings/profile`, `/settings/preferences`, `/settings/notifications`, `/settings/security`, `/settings/recovery`, `/settings/social` |
| Profile and avatar                 | `POST /accounts/update-profile`, `DELETE /accounts/remove-avatar`                                                                                                      |
| Password                           | `POST /accounts/change-password` with old-password, policy, breach, and session behavior                                                                               |
| MFA                                | `GET/POST /accounts/setup-mfa`, `POST /enable-mfa`, `POST /disable-mfa`, recovery-code display and regeneration                                                        |
| Passkeys                           | `GET /accounts/passkeys`, `/setup-webauthn`; authenticated WebAuthn register, list, rename, and delete endpoints                                                       |
| Authorized applications            | `GET /accounts/apps`, `POST /revoke-app`, `POST /revoke-all-apps`                                                                                                      |
| Sessions                           | `GET /accounts/sessions`, `POST /logout-session`, `POST /logout-all-other-sessions`                                                                                    |
| Account switcher                   | `POST /switch-account`, `/add-account`; `DELETE /remove-account`; `GET /account-switcher-data`                                                                         |
| Social links                       | `GET /accounts/social/:provider/link`, `POST /accounts/social/:provider/unlink`                                                                                        |
| Verification and recovery settings | resend verification; enable/disable recovery; recovery setup; backup codes; secondary-email verification; security-question setup                                      |
| Notification preferences           | `POST /accounts/update-notification-preferences` with enabled and disabled user-preference policy                                                                      |

## Management API

All Management API scenarios use a real client-credentials token whose
audience is `urn:parako:api:v1`. Every endpoint must prove the success path,
missing token, invalid token, wrong audience, insufficient scope, malformed
input where applicable, not-found behavior, rate-limit response, audit event,
and tenant isolation where applicable.

### Clients — 10 operations

- `GET /api/v1/clients`
- `POST /api/v1/clients`
- `GET /api/v1/clients/:client_id`
- `PUT /api/v1/clients/:client_id`
- `PATCH /api/v1/clients/:client_id`
- `DELETE /api/v1/clients/:client_id`
- `POST /api/v1/clients/:client_id/activate`
- `POST /api/v1/clients/:client_id/deactivate`
- `POST /api/v1/clients/:client_id/secret`
- `GET /api/v1/clients/:client_id/stats`

### Users — 12 operations

- `GET /api/v1/users`
- `POST /api/v1/users`
- `GET /api/v1/users/:user_id`
- `PUT /api/v1/users/:user_id`
- `PATCH /api/v1/users/:user_id`
- `DELETE /api/v1/users/:user_id`
- `POST /api/v1/users/:user_id/lock`
- `DELETE /api/v1/users/:user_id/lock`
- `POST /api/v1/users/:user_id/password-reset`
- `POST /api/v1/users/:user_id/mfa/reset`
- `GET /api/v1/users/:user_id/activities`
- `GET /api/v1/users/:user_id/sessions`

### Sessions — 4 operations

- `GET /api/v1/sessions`
- `GET /api/v1/sessions/:jti`
- `DELETE /api/v1/sessions/:jti`
- `DELETE /api/v1/sessions`

### JWKS — 5 operations

- `GET /api/v1/jwks`
- `POST /api/v1/jwks/rotate`
- `POST /api/v1/jwks/retire-expired`
- `GET /api/v1/jwks/:kid`
- `DELETE /api/v1/jwks/:kid`

### Audit — 4 operations

- `GET /api/v1/audit`
- `GET /api/v1/audit/:id`
- `GET /api/v1/audit/types`
- `GET /api/v1/audit/stats`

### Statistics — 2 operations

- `GET /api/v1/stats`
- `GET /api/v1/stats/health`

### Registration tokens — 4 operations

- `GET /api/v1/registration-tokens`
- `POST /api/v1/registration-tokens`
- `GET /api/v1/registration-tokens/:jti`
- `DELETE /api/v1/registration-tokens/:jti`

### Tenants — 5 multi-tenant operations

These operations apply only to `postgresql-multi` and `mongodb-multi` and must
also reject tenant-local callers without platform scopes.

- `GET /api/v1/tenants`
- `POST /api/v1/tenants`
- `GET /api/v1/tenants/:slug`
- `GET /api/v1/tenants/:slug/config`
- `PUT /api/v1/tenants/:slug/config/:section`

## OIDC and OAuth admission coverage

The detailed protocol suite remains authoritative for supported OIDC/OAuth
variants. Each deployment cell must additionally pass a generic temporary RP
admission flow: discovery, Authorization Code with PKCE, consent, token
validation, UserInfo, refresh when issued, RP-initiated logout with an ID token
hint, and registered post-logout redirection. No demo-client identifier, URL,
or behavior may be hard-coded in Parako.ID production code.

Protocol expectations follow the installed `oidc-provider` version and the
applicable OIDC/OAuth specifications. If Parako.ID behavior conflicts with the
provider contract, investigate Parako.ID first and preserve provider semantics.

## Completion evidence

For each capability row, the final report must identify:

1. the spec file and scenario name;
2. the deployment cells that passed;
3. the configuration partitions exercised;
4. any intentionally unsupported cell and its source-backed reason;
5. any discovered production bug and its regression test;
6. the uninterrupted full-suite command and result.

Passing a unit test, a mocked controller test, or one storage adapter does not
mark an E2E capability complete.
