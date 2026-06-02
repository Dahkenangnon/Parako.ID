---
title: 'Integrating Your App'
subtitle: 'Connect your web, mobile, and backend applications to Parako.ID'
category: 'Guides'
order: 3
---

Parako.ID is a standards-compliant OIDC / OAuth 2.0 provider. Any client library that supports OpenID Connect works out of the box; there is no Parako.ID-specific SDK.

## Pick the right grant

| Application type               | Grant                     | Secret | PKCE     | Token storage                                        |
| ------------------------------ | ------------------------- | ------ | -------- | ---------------------------------------------------- |
| Web app (server-rendered)      | Authorization Code + PKCE | Yes    | Required | Server-side session                                  |
| Single Page App (browser-only) | Authorization Code + PKCE | No     | Required | Memory or sessionStorage; refresh via silent re-auth |
| Native / mobile                | Authorization Code + PKCE | No     | Required | Secure keychain / keystore                           |
| Backend service (no user)      | Client Credentials        | Yes    | n/a      | Server-side, scoped per request                      |
| Smart TV / CLI / IoT           | Device Flow (RFC 8628)    | Yes    | n/a      | Device-local; refresh on demand                      |

See [OIDC Clients](oidc-clients.md) for the matching preset, allowed scopes, and PKCE enforcement rules, and [OIDC Endpoints](oidc-endpoints.md) for the endpoint reference and token TTLs.

## The integration flow

1. Register an OIDC client. See [OIDC Clients](oidc-clients.md).
2. Point your library at discovery: `https://your-host/oidc/v1/.well-known/openid-configuration`. Most libraries auto-configure from this endpoint.
3. Implement the grant from the table above.
4. Verify tokens (`/oidc/v1/jwks`) and fetch user info (`/oidc/v1/userinfo`).

The discovery URL is configurable via `oidc.path` (default `/oidc/v1`); see [Configuration](configuration.md).

## Web Application (Confidential)

Server-rendered applications (Express, Django, Rails, Laravel, Next.js) that can securely store a client secret.

**Grant type:** Authorization Code + PKCE

### Node.js / Express — `openid-client`

```bash
npm install openid-client
```

```typescript
import * as client from 'openid-client';

// Discover the provider
const config = await client.discovery(
  new URL('https://your-parako.example.com/oidc/v1'),
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET'
);

// Generate PKCE code verifier and challenge
const codeVerifier = client.randomPKCECodeVerifier();
const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

// Build authorization URL
const authUrl = client.buildAuthorizationUrl(config, {
  redirect_uri: 'https://app.example.com/callback',
  scope: 'openid profile email',
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
});

// Redirect user to authUrl...

// In callback handler:
const currentUrl = new URL(req.url, 'https://app.example.com');
const tokenSet = await client.authorizationCodeGrant(config, currentUrl, {
  pkceCodeVerifier: codeVerifier,
});

// tokenSet.access_token, tokenSet.id_token, tokenSet.refresh_token
const userinfo = await client.fetchUserInfo(
  config,
  tokenSet.access_token,
  tokenSet.claims().sub
);
```

### Other server-side libraries

The pattern above (discover → PKCE → authorize → callback → fetch userinfo) maps directly across languages. Point any of these libraries at `https://your-parako.example.com/oidc/v1/.well-known/openid-configuration`:

| Stack                   | Library                                           | Install                                         |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------- |
| PHP / Laravel           | `jumbojett/openid-connect-php`                    | `composer require jumbojett/openid-connect-php` |
| Python / Flask / Django | `Authlib`                                         | `pip install Authlib`                           |
| Ruby / Rails            | `omniauth_openid_connect`                         | `gem install omniauth_openid_connect`           |
| Java / Spring           | Spring Security OAuth2 Client                     | (Spring starter)                                |
| Go                      | `coreos/go-oidc`                                  | `go get github.com/coreos/go-oidc/v3`           |
| .NET                    | Microsoft.AspNetCore.Authentication.OpenIdConnect | NuGet                                           |

## Single-Page Application (Public)

Browser-based apps (React, Vue, Angular) that cannot store a client secret.

**Grant type:** Authorization Code + PKCE (no secret)

PKCE is required for public clients — Parako.ID rejects authorization requests from public clients without a code challenge.

### React — `react-oidc-context`

```bash
npm install react-oidc-context oidc-client-ts
```

```tsx
import { AuthProvider, useAuth } from 'react-oidc-context';

const oidcConfig = {
  authority: 'https://your-parako.example.com/oidc/v1',
  client_id: 'YOUR_SPA_CLIENT_ID',
  redirect_uri: 'https://app.example.com/callback',
  scope: 'openid profile email',
};

// Wrap your app
function App() {
  return (
    <AuthProvider {...oidcConfig}>
      <Dashboard />
    </AuthProvider>
  );
}

function Dashboard() {
  const auth = useAuth();

  if (auth.isLoading) return <div>Loading...</div>;
  if (!auth.isAuthenticated)
    return <button onClick={() => auth.signinRedirect()}>Log in</button>;

  return <div>Hello {auth.user?.profile.email}</div>;
}
```

### Other SPA libraries

| Framework | Library                                        |
| --------- | ---------------------------------------------- |
| Angular   | `angular-auth-oidc-client`                     |
| Vue       | `oidc-client-ts` (vanilla, framework-agnostic) |
| Svelte    | `oidc-client-ts` (vanilla)                     |

All three configure with the same fields: `authority`, `client_id`, `redirect_uri`, `scope`, `response_type: 'code'`, `automaticSilentRenew: true`.

## Native / Mobile App

Mobile and desktop applications use custom URL schemes or localhost for redirect URIs.

**Grant type:** Authorization Code + PKCE (no secret)

Register your client with a custom redirect URI:

```
com.example.myapp://callback
```

Or use a localhost redirect for desktop apps:

```
http://localhost:8080/callback
```

### React Native — `react-native-app-auth`

```bash
npm install react-native-app-auth
```

```typescript
import { authorize, refresh, revoke } from 'react-native-app-auth';

const config = {
  issuer: 'https://your-parako.example.com/oidc/v1',
  clientId: 'YOUR_MOBILE_CLIENT_ID',
  redirectUrl: 'com.example.myapp://callback',
  scopes: ['openid', 'profile', 'email'],
  usePKCE: true,
};

// Login — opens system browser
const result = await authorize(config);
// result.accessToken, result.idToken, result.refreshToken

// Refresh tokens
const refreshed = await refresh(config, { refreshToken: result.refreshToken });

// Revoke token
await revoke(config, {
  tokenToRevoke: result.refreshToken,
  sendClientId: true,
});
```

### Other mobile/desktop libraries

| Platform           | Library                                                             |
| ------------------ | ------------------------------------------------------------------- |
| Flutter            | `flutter_appauth`                                                   |
| iOS (Swift)        | AppAuth-iOS                                                         |
| Android (Kotlin)   | AppAuth-Android                                                     |
| Electron / desktop | `electron-oauth2` or `openid-client` with a local-loopback redirect |

All use the same flow: open the system browser, complete the authorization code grant with PKCE, exchange via the discovery `token_endpoint`.

## Machine-to-Machine

Backend services that need to access the Management API or other protected resources without user interaction.

**Grant type:** Client Credentials

```bash
curl -X POST https://your-parako.example.com/oidc/v1/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=parako:clients:read parako:users:read" \
  -d "resource=urn:parako:api:v1"
```

Response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "parako:clients:read parako:users:read"
}
```

Use the access token to call the Management API:

```bash
curl https://your-parako.example.com/api/v1/users \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

## Device Flow

For IoT devices, smart TVs, and CLI tools with limited input capabilities (RFC 8628).

**Grant type:** `urn:ietf:params:oauth:grant-type:device_code`

```bash
# Step 1: Request device authorization
curl -X POST https://your-parako.example.com/oidc/v1/device/auth \
  -d "client_id=DEVICE_CLIENT_ID" \
  -d "scope=openid profile"
```

Response:

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "123-4-567",
  "verification_uri": "https://your-parako.example.com/oidc/v1/device",
  "expires_in": 600,
  "interval": 5
}
```

Display the `user_code` and `verification_uri` to the user. They visit the URL on another device and enter the code.

```bash
# Step 2: Poll for token (repeat every `interval` seconds)
curl -X POST https://your-parako.example.com/oidc/v1/token \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  -d "client_id=DEVICE_CLIENT_ID" \
  -d "device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS"
```

The response returns `authorization_pending` until the user completes authentication, then returns the token set.

## Verifying Tokens

### JWKS Validation

Fetch Parako.ID's public keys and verify token signatures locally:

```typescript
import * as jose from 'jose';

const JWKS = jose.createRemoteJWKSet(
  new URL('https://your-parako.example.com/oidc/v1/jwks')
);

const { payload } = await jose.jwtVerify(accessToken, JWKS, {
  issuer: 'https://your-parako.example.com/oidc/v1',
  audience: 'YOUR_CLIENT_ID',
});

// payload.sub, payload.scope, payload.exp
```

### Token Introspection

Resource servers can validate tokens by calling the introspection endpoint:

```bash
curl -X POST https://your-parako.example.com/oidc/v1/token/introspection \
  -u "RESOURCE_SERVER_CLIENT_ID:CLIENT_SECRET" \
  -d "token=ACCESS_TOKEN"
```

Response:

```json
{
  "active": true,
  "sub": "user-id",
  "client_id": "client-id",
  "scope": "openid profile email",
  "exp": 1700000000
}
```

## Handling Logout

### RP-Initiated Logout

Redirect the user to the end session endpoint:

```
https://your-parako.example.com/oidc/v1/session/end?
  id_token_hint=ID_TOKEN&
  post_logout_redirect_uri=https://app.example.com&
  state=random_state
```

The `post_logout_redirect_uri` must be registered with the client.

### Backchannel Logout

Register a `backchannel_logout_uri` with your client to receive logout notifications server-to-server. Parako.ID sends a `logout_token` JWT to this URI when the user logs out.

Your application should validate the `logout_token` and invalidate the corresponding session.

## See also

- [OIDC Clients](oidc-clients.md)
- [OIDC Endpoints](oidc-endpoints.md)
- [Configuration](configuration.md)
- [Social Login](social-login.md)
