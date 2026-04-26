/**
 * Social Provider Tier Utilities
 *
 * Determines whether a tenant uses Tier 1 (platform credentials via _ops gateway)
 * or Tier 2 (tenant-owned credentials with direct callback) for a given provider.
 *
 * Also builds the Tier 1 authorization parameters (HMAC-signed state, _ops redirect_uri).
 */

import { randomUUID } from 'node:crypto';
import { createHmacState } from '../utils/hmac-state.js';
import {
  type ProviderUserData,
  type TokenData,
} from '../types/social-integration.js';

/**
 * Extract the base domain (hostname without protocol or trailing slash)
 * from a deployment URL. Used by both the _ops callback service and the
 * Tier 1 completion service for consistent URL construction.
 */
export function extractBaseDomain(deploymentUrl: string): string {
  return (deploymentUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Detect whether a tenant should use Tier 1 or Tier 2 for a given social provider.
 *
 * - Tier 1: No tenant override for the provider's client_id → use platform credentials
 * - Tier 2: Tenant has its own client_id → use tenant-owned credentials
 *
 * @param provider  - Social provider slug (google, github, etc.)
 * @param tenantOverrides - The tenant's settings override document (null if no overrides)
 */
export function detectProviderTier(
  provider: string,
  tenantOverrides: Record<string, any> | null
): 'tier1' | 'tier2' {
  if (!tenantOverrides) return 'tier1';

  const clientId =
    tenantOverrides?.features?.social_providers?.[provider]?.client_id;

  if (typeof clientId === 'string' && clientId.length > 0) {
    return 'tier2';
  }

  return 'tier1';
}

/**
 * Build Tier 1 authorization parameters.
 *
 * For Tier 1 tenants, the OAuth callback lands on the _ops gateway, so:
 * - redirect_uri points to `_ops.{baseDomain}/social/{provider}/callback`
 * - state is HMAC-signed with the tenant_id so the gateway can relay back
 *
 * @returns Object with authUrl (partial — caller appends to provider's auth endpoint)
 *          and state (HMAC-signed token)
 */
export function buildTier1AuthorizationParams(
  provider: string,
  tenantId: string,
  platformConfig: { client_id: string; redirect_uri_base: string },
  hmacSecret: string
): { authUrl: string; state: string } {
  const redirectUri = `${platformConfig.redirect_uri_base}/social/${provider}/callback`;

  const state = createHmacState(
    {
      tenant_id: tenantId,
      nonce: randomUUID(),
      timestamp: Date.now(),
    },
    hmacSecret
  );

  // The actual provider-specific URL (scopes, PKCE, etc.) is built by the
  // provider class — this provides the Tier 1 overrides for redirect_uri and state.
  const params = new URLSearchParams({
    client_id: platformConfig.client_id,
    redirect_uri: redirectUri,
    state,
  });

  return {
    authUrl: params.toString(),
    state,
  };
}

/** Redis key prefix for social callback refs. Shared with ops-social-callback.service. */
export const SOCIAL_REF_REDIS_PREFIX = 'social:ref:';

interface SocialRefData {
  provider: string;
  code: string;
  tenant_id: string;
  timestamp: number;
}

/**
 * Consume a one-time social login ref from Redis.
 *
 * After a Tier 1 OAuth callback lands on the _ops gateway, the gateway stores
 * the auth code + provider info in Redis under `social:ref:{uuid}` and redirects
 * the user back to their tenant with `?ref={uuid}`. This function atomically
 * reads and deletes the ref using Redis GETDEL (Redis 6.2+) to prevent race
 * conditions where concurrent requests could both consume the same ref.
 *
 * @param redis - Redis client with getdel (or get/del) methods
 * @param ref   - The UUID ref from the query string
 */
export async function consumeSocialRef(
  redis: {
    getdel?: (key: string) => Promise<string | null>;
    get: (key: string) => Promise<string | null>;
    del: (key: string) => Promise<number>;
  },
  ref: string
): Promise<
  | { success: true; provider: string; code: string; tenant_id: string }
  | { success: false; error: string }
> {
  const key = `${SOCIAL_REF_REDIS_PREFIX}${ref}`;

  // Use atomic GETDEL (Redis 6.2+) to prevent TOCTOU race conditions.
  // Falls back to get+del for older Redis or mock implementations.
  let raw: string | null;
  if (typeof redis.getdel === 'function') {
    raw = await redis.getdel(key);
  } else {
    raw = await redis.get(key);
    if (raw !== null) {
      await redis.del(key);
    }
  }

  if (raw === null) {
    return { success: false, error: 'Ref not found or expired' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Malformed ref data' };
  }

  const data = parsed as Partial<SocialRefData>;
  if (!data.provider || !data.code || !data.tenant_id) {
    return { success: false, error: 'Missing required fields in ref data' };
  }

  return {
    success: true,
    provider: data.provider,
    code: data.code,
    tenant_id: data.tenant_id,
  };
}

// Tier 1 token exchange & profile helpers

/**
 * Hardcoded Tier 1 provider endpoints. For Tier 1 flows (platform credentials),
 * we ALWAYS use these known-safe endpoints to prevent SSRF via compromised config.
 * Config-supplied endpoints are only used for Tier 2 (tenant-owned credentials).
 */
const TIER1_PROVIDER_ENDPOINTS: Record<
  string,
  { token_endpoint: string; userinfo_endpoint: string }
> = {
  google: {
    token_endpoint: 'https://oauth2.googleapis.com/token',
    userinfo_endpoint: 'https://www.googleapis.com/oauth2/v2/userinfo',
  },
  microsoft: {
    token_endpoint:
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfo_endpoint: 'https://graph.microsoft.com/oidc/userinfo',
  },
  github: {
    token_endpoint: 'https://github.com/login/oauth/access_token',
    userinfo_endpoint: 'https://api.github.com/user',
  },
  linkedin: {
    token_endpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
    userinfo_endpoint: 'https://api.linkedin.com/v2/userinfo',
  },
  facebook: {
    token_endpoint: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userinfo_endpoint: 'https://graph.facebook.com/me',
  },
};

/**
 * Resolve the token_endpoint and userinfo_endpoint for a Tier 1 social provider.
 *
 * Uses hardcoded endpoints for known providers (SSRF prevention — never trust
 * config-supplied URLs for Tier 1 platform credentials).
 * Falls back to config-supplied endpoints only for unknown providers.
 */
export function resolveTier1Endpoints(
  provider: string,
  providerConfig: Record<string, unknown>
): { token_endpoint: string; userinfo_endpoint: string } | null {
  // Prefer hardcoded endpoints for known providers (SSRF-safe)
  if (TIER1_PROVIDER_ENDPOINTS[provider]) {
    return TIER1_PROVIDER_ENDPOINTS[provider];
  }

  // Fallback for unknown providers — use config (Zod-validated URLs only)
  const tokenEndpoint = providerConfig.token_endpoint as string | undefined;
  const userinfoEndpoint = providerConfig.userinfo_endpoint as
    | string
    | undefined;

  if (tokenEndpoint && userinfoEndpoint) {
    return {
      token_endpoint: tokenEndpoint,
      userinfo_endpoint: userinfoEndpoint,
    };
  }

  return null;
}

/**
 * Exchange an authorization code for an access token using a standard
 * OAuth2 token endpoint (Tier 1 — no PKCE, no session state).
 */
export async function exchangeTier1Code(
  code: string,
  config: {
    token_endpoint: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  }
): Promise<{ access_token: string; [key: string]: unknown }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.client_id,
    client_secret: config.client_secret,
    redirect_uri: config.redirect_uri,
  });

  const response = await fetch(config.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'parako-id/1.0.0',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Token exchange failed (${response.status}): ${errorText.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (!data.access_token || typeof data.access_token !== 'string') {
    throw new Error('Token exchange response missing access_token');
  }

  return data as { access_token: string; [key: string]: unknown };
}

/**
 * Fetch a user profile from a provider's userinfo endpoint.
 */
export async function fetchTier1UserProfile(
  accessToken: string,
  userinfoEndpoint: string,
  provider: string
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'parako-id/1.0.0',
  };

  const response = await fetch(userinfoEndpoint, { headers });

  if (!response.ok) {
    throw new Error(
      `Userinfo fetch failed for ${provider} (${response.status})`
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Map a raw provider profile to the standard `ProviderUserData` shape.
 *
 * Each provider has a slightly different profile format — this mapper
 * handles the common cases. Unknown providers get a best-effort mapping.
 */
export function mapTier1Profile(
  provider: string,
  raw: Record<string, unknown>
): ProviderUserData {
  switch (provider) {
    case 'github':
      return {
        sub: String(raw.id ?? ''),
        email: (raw.email as string) ?? undefined,
        name: (raw.name as string) ?? undefined,
        picture: (raw.avatar_url as string) ?? undefined,
        provider_username: (raw.login as string) ?? undefined,
        raw_data: raw,
      };

    case 'google':
      return {
        sub: String(raw.sub ?? raw.id ?? ''),
        email: (raw.email as string) ?? undefined,
        email_verified: (raw.email_verified as boolean) ?? undefined,
        name: (raw.name as string) ?? undefined,
        given_name: (raw.given_name as string) ?? undefined,
        family_name: (raw.family_name as string) ?? undefined,
        picture: (raw.picture as string) ?? undefined,
        locale: (raw.locale as string) ?? undefined,
        raw_data: raw,
      };

    case 'microsoft':
      return {
        sub: String(raw.sub ?? ''),
        email: (raw.email as string) ?? undefined,
        email_verified: (raw.email_verified as boolean) ?? undefined,
        name: (raw.name as string) ?? undefined,
        given_name: (raw.given_name as string) ?? undefined,
        family_name: (raw.family_name as string) ?? undefined,
        picture: (raw.picture as string) ?? undefined,
        raw_data: raw,
      };

    case 'linkedin':
      return {
        sub: String(raw.sub ?? ''),
        email: (raw.email as string) ?? undefined,
        email_verified: (raw.email_verified as boolean) ?? undefined,
        name: (raw.name as string) ?? undefined,
        given_name: (raw.given_name as string) ?? undefined,
        family_name: (raw.family_name as string) ?? undefined,
        picture: (raw.picture as string) ?? undefined,
        raw_data: raw,
      };

    case 'facebook':
      return {
        sub: String(raw.id ?? ''),
        email: (raw.email as string) ?? undefined,
        name: (raw.name as string) ?? undefined,
        picture:
          ((
            (raw.picture as Record<string, unknown>)?.data as Record<
              string,
              unknown
            >
          )?.url as string) ?? undefined,
        raw_data: raw,
      };

    default:
      // Best-effort for unknown providers
      return {
        sub: String(raw.sub ?? raw.id ?? ''),
        email: (raw.email as string) ?? undefined,
        name: (raw.name as string) ?? undefined,
        raw_data: raw,
      };
  }
}

/**
 * Map raw token exchange response to the standard `TokenData` shape.
 */
export function mapTier1Tokens(raw: Record<string, unknown>): TokenData {
  return {
    access_token: raw.access_token as string,
    refresh_token: (raw.refresh_token as string) ?? undefined,
    id_token: (raw.id_token as string) ?? undefined,
    token_type: (raw.token_type as string) ?? undefined,
    expires_at: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000)
      : undefined,
    scope: (raw.scope as string) ?? undefined,
  };
}
