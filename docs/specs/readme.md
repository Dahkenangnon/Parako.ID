---
title: 'OIDC Provider Specifications'
subtitle: 'OpenID Connect and OAuth 2.0 feature support in Parako.ID'
category: 'OIDC Provider Specs'
order: 0
---

Parako.ID is built on [node-oidc-provider](https://github.com/panva/node-oidc-provider), an [OpenID Certified](https://openid.net/certification/) implementation of OpenID Connect. The tables below summarize which OIDC features and configuration options Parako.ID supports, their current status, and where to configure them.

For deeper customization or to understand the full range of provider options, refer to the [official node-oidc-provider documentation](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md). Every configuration option available upstream can potentially be wired into Parako.ID.

## Features

| Feature                 | Standard                     | Provider Default | Parako.ID Status | Config Path                                            |
| ----------------------- | ---------------------------- | ---------------- | ---------------- | ------------------------------------------------------ |
| Back-Channel Logout     | OIDC Back-Channel Logout 1.0 | `false`          | Enabled          | `features.oidc.backchannel_logout.enabled`             |
| Client Credentials      | RFC 6749                     | `false`          | Enabled          | `features.oidc.client_credentials.enabled`             |
| Device Flow             | RFC 8628                     | `false`          | Enabled          | `features.oidc.device_flow.enabled`                    |
| Introspection           | RFC 7662                     | `false`          | Enabled          | `features.oidc.token_introspection.enabled`            |
| Request Objects         | RFC 9101                     | `false`          | Enabled          | `features.oidc.request_objects.enabled`                |
| Resource Indicators     | RFC 8707                     | `true`           | Enabled          | `features.oidc.resource_indicators.enabled`            |
| Revocation              | RFC 7009                     | `false`          | Enabled          | `features.oidc.token_revocation.enabled`               |
| RP-Initiated Logout     | OIDC RP-Initiated Logout 1.0 | `true`           | Enabled          | `features.oidc.rp_initiated_logout.enabled`            |
| UserInfo                | OIDC Core 1.0                | `true`           | Enabled          | `features.oidc.userinfo_endpoint.enabled`              |
| Encryption              | JWE (RFC 7516)               | `false`          | Available        | `features.oidc.encryption.enabled`                     |
| JARM                    | JARM                         | `false`          | Available        | `features.oidc.jwt_response_modes.enabled`             |
| JWT Introspection       | RFC 9701                     | `false`          | Available        | `features.oidc.jwt_introspection.enabled`              |
| JWT UserInfo            | OIDC Core 1.0                | `false`          | Available        | `features.oidc.jwt_userinfo.enabled`                   |
| Registration            | RFC 7591 / OIDC DCR          | `false`          | Available        | `features.oidc.dynamic_client_registration.enabled`    |
| Registration Management | RFC 7592                     | `false`          | Available        | `features.oidc.client_registration_management.enabled` |
| Dev Interactions        | --                           | `true`           | Available        | `features.oidc.dev_interactions.enabled`               |
| DPoP                    | RFC 9449                     | `true`           | Inherited        | --                                                     |
| PAR                     | RFC 9126                     | `true`           | Inherited        | --                                                     |
| CIBA                    | OIDC CIBA                    | `false`          | Not Configured   | --                                                     |
| Claims Parameter        | OIDC Core 1.0                | `false`          | Not Configured   | --                                                     |
| FAPI                    | FAPI 1.0 / 2.0               | `false`          | Not Configured   | --                                                     |
| mTLS                    | RFC 8705                     | `false`          | Not Configured   | --                                                     |

**Status legend:** **Enabled** = wired and on by default. **Available** = wired but off by default (toggle via config). **Inherited** = uses provider default. **Not Configured** = not wired; see upstream docs to implement.

## Configuration

| Configuration                      | Provider Option                            | Integrated   | Config Path                                                   |
| ---------------------------------- | ------------------------------------------ | ------------ | ------------------------------------------------------------- |
| Adapter                            | `adapter`                                  | Yes          | `oidc_storage.oidc_adapter.type`                              |
| Claims                             | `claims`                                   | Yes          | `features.oidc.claims`                                        |
| Client-Based CORS                  | `clientBasedCORS`                          | Yes (custom) | `features.oidc.client_based_cors`                             |
| Clients                            | `clients`                                  | Yes (custom) | --                                                            |
| Find Account                       | `findAccount`                              | Yes (custom) | --                                                            |
| Interactions                       | `interactions`                             | Yes (custom) | --                                                            |
| JWKS                               | `jwks`                                     | Yes          | --                                                            |
| PKCE                               | `pkce`                                     | Yes          | `features.oidc.pkce.*`                                        |
| TTL                                | `ttl`                                      | Yes          | `oidc.token_ttl.*`                                            |
| Accept Query Param Access Tokens   | `acceptQueryParamAccessTokens`             | Yes          | `features.oidc.accept_query_param_access_tokens`              |
| ACR Values                         | `acrValues`                                | Yes          | `features.oidc.acr_values.supported`                          |
| Allow Omitting Single Redirect URI | `allowOmittingSingleRegisteredRedirectUri` | Yes          | `features.oidc.allow_omitting_single_registered_redirect_uri` |
| Clock Tolerance                    | `clockTolerance`                           | Yes          | `features.oidc.clock_tolerance`                               |
| Conform ID Token Claims            | `conformIdTokenClaims`                     | Yes          | `features.oidc.conform_id_token_claims`                       |
| Cookies                            | `cookies`                                  | Yes          | `security.secrets.cookie_secrets`                             |
| Discovery                          | `discovery`                                | Yes          | `oidc.discovery.*`                                            |
| Enabled JWA                        | `enabledJWA`                               | Yes          | `oidc.jwa.*`                                                  |
| Enable HTTP POST Methods           | `enableHttpPostMethods`                    | Yes          | `features.oidc.enable_http_post_methods`                      |
| Expires With Session               | `expiresWithSession`                       | Yes          | `features.oidc.expires_with_session`                          |
| Extra Client Metadata              | `extraClientMetadata`                      | Yes          | `features.oidc.extra_client_metadata.*`                       |
| Extra Params                       | `extraParams`                              | Yes          | `features.oidc.extra_params.*`                                |
| Extra Token Claims                 | `extraTokenClaims`                         | Yes (custom) | --                                                            |
| Issue Refresh Token                | `issueRefreshToken`                        | Yes (custom) | --                                                            |
| Load Existing Grant                | `loadExistingGrant`                        | Yes (custom) | --                                                            |
| Pairwise Identifier                | `pairwiseIdentifier`                       | Yes          | `oidc.secrets.pairwise_salt`                                  |
| Render Error                       | `renderError`                              | Yes (custom) | --                                                            |
| Rotate Refresh Token               | `rotateRefreshToken`                       | Yes (custom) | `features.oidc.rotate_refresh_token`                          |
| Routes                             | `routes`                                   | Yes          | `oidc.routes.*`                                               |
| Scopes                             | `scopes`                                   | Yes          | `features.oidc.scopes`                                        |
| Subject Types                      | `subjectTypes`                             | Yes          | `features.oidc.subject_types`                                 |
| Client Auth Methods                | `clientAuthMethods`                        | Inherited    | --                                                            |
| Response Types                     | `responseTypes`                            | Inherited    | --                                                            |
| Revoke Grant Policy                | `revokeGrantPolicy`                        | Inherited    | --                                                            |
| Assert JWT Client Auth             | `assertJwtClientAuthClaimsAndHeader`       | No           | --                                                            |
| Client Defaults                    | `clientDefaults`                           | No           | --                                                            |
| Fetch                              | `fetch`                                    | No           | --                                                            |
| Fetch Response Body Limits         | `fetchResponseBodyLimits`                  | No           | --                                                            |
| Sector Identifier URI Validate     | `sectorIdentifierUriValidate`              | No           | --                                                            |

**Integrated legend:** **Yes** = configured via schema. **Yes (custom)** = custom implementation in code. **Inherited** = uses provider default. **No** = not integrated; see upstream docs.

## Grant Types

| Grant Type                                     | Description                     | Status         |
| ---------------------------------------------- | ------------------------------- | -------------- |
| `authorization_code`                           | Standard code exchange flow     | Enabled        |
| `refresh_token`                                | Refresh access tokens           | Enabled        |
| `client_credentials`                           | Machine-to-machine auth         | Enabled        |
| `implicit`                                     | Legacy implicit flow            | Enabled        |
| `urn:ietf:params:oauth:grant-type:device_code` | Device authorization (RFC 8628) | Enabled        |
| `urn:openid:params:grant-type:ciba`            | Backchannel authentication      | Not Configured |

## Client Authentication Methods

| Method                        | Description                             | Status                    |
| ----------------------------- | --------------------------------------- | ------------------------- |
| `client_secret_basic`         | HTTP Basic with client_id/secret        | Enabled                   |
| `client_secret_post`          | Client credentials in request body      | Enabled                   |
| `client_secret_jwt`           | Symmetric key JWT assertion             | Enabled                   |
| `private_key_jwt`             | Asymmetric key JWT assertion            | Enabled                   |
| `none`                        | Public clients (no secret)              | Enabled                   |
| `tls_client_auth`             | Mutual TLS with CA-signed certificate   | Available (requires mTLS) |
| `self_signed_tls_client_auth` | Mutual TLS with self-signed certificate | Available (requires mTLS) |

## Related Documentation

- [OIDC Endpoints](../oidc-endpoints.md) -- endpoint paths, scopes, claims, and token TTLs
- [OIDC Clients](../oidc-clients.md) -- client presets, registration, and configuration
- [Authentication](../authentication.md) -- password policies, MFA, and multi-account sessions
- [Security](../security.md) -- rate limiting, session binding, and encryption
