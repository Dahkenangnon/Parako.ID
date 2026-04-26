---
title: 'Integrating Your App'
subtitle: 'Connect your web, mobile, and backend applications to Parako.ID'
category: 'Guides'
order: 3
---

## Overview

Parako.ID is a standards-compliant OIDC/OAuth2 provider. Any client library that supports OpenID Connect works out of the box. You do not need a Parako.ID-specific SDK.

The integration flow is the same regardless of your application framework:

1. Register an OIDC client in Parako.ID
2. Discover endpoints via the discovery URL
3. Implement the appropriate grant type for your app
4. Verify tokens and fetch user info

## Step 1: Register a Client

Register a client using the CLI or admin panel. See [OIDC Clients](oidc-clients.md) for details.

```bash
yarn client add
```

Note the `client_id` and `client_secret` (if applicable) from the output.

## Step 2: Discover Endpoints

Point your OIDC client library to the discovery URL:

```
https://your-parako.example.com/oidc/v1/.well-known/openid-configuration
```

Most libraries auto-configure themselves from this endpoint — no need to manually specify authorization, token, or userinfo URLs.

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

### PHP / Laravel — `jumbojett/openid-connect-php`

```bash
composer require jumbojett/openid-connect-php
```

```php
use Jumbojett\OpenIDConnectClient;

$oidc = new OpenIDConnectClient(
    'https://your-parako.example.com/oidc/v1',
    'YOUR_CLIENT_ID',
    'YOUR_CLIENT_SECRET'
);

$oidc->setRedirectURL('https://app.example.com/callback');
$oidc->addScope(['openid', 'profile', 'email']);
$oidc->setCodeChallengeMethod('S256');

// Redirects to Parako.ID and handles callback automatically
$oidc->authenticate();

$sub     = $oidc->getVerifiedClaims('sub');
$email   = $oidc->getVerifiedClaims('email');
$name    = $oidc->getVerifiedClaims('name');
$token   = $oidc->getAccessToken();
```

### Python / Flask / Django — `Authlib`

```bash
pip install Authlib requests
```

```python
import requests as http_requests
from authlib.integrations.requests_client import OAuth2Session

ISSUER = 'https://your-parako.example.com/oidc/v1'

# Fetch OIDC provider metadata
metadata = http_requests.get(f'{ISSUER}/.well-known/openid-configuration').json()

client = OAuth2Session(
    client_id='YOUR_CLIENT_ID',
    client_secret='YOUR_CLIENT_SECRET',
    scope='openid profile email',
    redirect_uri='https://app.example.com/callback',
    code_challenge_method='S256',
)

# Step 1: Generate authorization URL
uri, state = client.create_authorization_url(metadata['authorization_endpoint'])
# Redirect user to `uri`...

# Step 2: In callback handler, exchange code for tokens
token = client.fetch_token(
    metadata['token_endpoint'],
    authorization_response=callback_url,
)

# Step 3: Fetch user info
userinfo = client.get(metadata['userinfo_endpoint']).json()
# userinfo['sub'], userinfo['email'], userinfo['name']
```

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

### Angular — `angular-auth-oidc-client`

```bash
npm install angular-auth-oidc-client
```

```typescript
// app.config.ts
import { provideAuth } from 'angular-auth-oidc-client';

export const appConfig = {
  providers: [
    provideAuth({
      config: {
        authority: 'https://your-parako.example.com/oidc/v1',
        clientId: 'YOUR_SPA_CLIENT_ID',
        redirectUrl: 'https://app.example.com/callback',
        postLogoutRedirectUri: 'https://app.example.com',
        scope: 'openid profile email',
        responseType: 'code',
      },
    }),
  ],
};

// In a component:
import { OidcSecurityService } from 'angular-auth-oidc-client';

export class AppComponent {
  constructor(private oidc: OidcSecurityService) {}
  login() {
    this.oidc.authorize();
  }
  logout() {
    this.oidc.logoff();
  }
  // Subscribe to this.oidc.userData$ for user info
}
```

### Vue.js — `oidc-client-ts`

```bash
npm install oidc-client-ts
```

```typescript
import { UserManager } from 'oidc-client-ts';

const userManager = new UserManager({
  authority: 'https://your-parako.example.com/oidc/v1',
  client_id: 'YOUR_SPA_CLIENT_ID',
  redirect_uri: 'https://app.example.com/callback',
  post_logout_redirect_uri: 'https://app.example.com',
  response_type: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
});

// Redirect to login
await userManager.signinRedirect();

// In callback page:
const user = await userManager.signinRedirectCallback();
// user.access_token, user.profile.sub, user.profile.email

// Sign out
await userManager.signoutRedirect();
```

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

### Flutter — `flutter_appauth`

```bash
flutter pub add flutter_appauth
```

```dart
import 'package:flutter_appauth/flutter_appauth.dart';

final appAuth = const FlutterAppAuth();

// Login — opens system browser
final result = await appAuth.authorizeAndExchangeCode(
  AuthorizationTokenRequest(
    'YOUR_MOBILE_CLIENT_ID',
    'com.example.myapp://callback',
    issuer: 'https://your-parako.example.com/oidc/v1',
    scopes: ['openid', 'profile', 'email'],
  ),
);

// result?.accessToken, result?.idToken, result?.refreshToken

// Refresh tokens
final refreshed = await appAuth.token(TokenRequest(
  'YOUR_MOBILE_CLIENT_ID',
  'com.example.myapp://callback',
  issuer: 'https://your-parako.example.com/oidc/v1',
  refreshToken: result?.refreshToken,
));
```

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

## Compatibility Note

Parako.ID follows the OpenID Connect and OAuth 2.0 specifications. The libraries listed in this guide are popular community-maintained projects — they are not developed or maintained by Parako.ID. While they work well with any standards-compliant provider, library updates could occasionally introduce breaking changes or non-standard behavior. Always refer to each library's own documentation for the most current API and configuration options.
