import { describe, it, expect } from 'vitest';
import { verifyHmacState } from '../../../src/utils/hmac-state.js';

/**
 * Tests for Social Provider Tier 1 / Tier 2 credential model.
 *
 * Tier 1: Tenant uses platform credentials → callback via _ops gateway → HMAC state
 * Tier 2: Tenant has own credentials → direct callback to tenant → session state
 */

const PLATFORM_CLIENT_ID = 'platform-google-client-id';
const TENANT_CLIENT_ID = 'tenant-acme-google-client-id';
const TENANT_CLIENT_SECRET = 'tenant-acme-google-client-secret';
const HMAC_SECRET = 'test-hmac-secret-for-tier-detection-32chars!!';
const BASE_DOMAIN = 'parako.id';

/**
 * Simulates the tier detection logic that will be added to BaseSocialLogin.
 * This function is tested here before it's implemented (TDD red phase).
 */
async function detectTier(
  provider: string,
  tenantOverrides: Record<string, any> | null
): Promise<'tier1' | 'tier2'> {
  // Dynamic import to test the actual implementation once it exists
  const mod =
    await import('../../../src/integration/social-tier-utils.js').catch(
      () => null
    );
  if (mod?.detectProviderTier) {
    return mod.detectProviderTier(provider, tenantOverrides);
  }
  throw new Error('detectProviderTier not yet implemented');
}

/**
 * Simulates Tier 1 auth URL building — callback goes to _ops gateway, state is HMAC-signed.
 */
async function buildTier1AuthUrl(
  provider: string,
  tenantId: string,
  platformConfig: { client_id: string; redirect_uri_base: string },
  hmacSecret: string
): Promise<{ authUrl: string; state: string }> {
  const mod =
    await import('../../../src/integration/social-tier-utils.js').catch(
      () => null
    );
  if (mod?.buildTier1AuthorizationParams) {
    return mod.buildTier1AuthorizationParams(
      provider,
      tenantId,
      platformConfig,
      hmacSecret
    );
  }
  throw new Error('buildTier1AuthorizationParams not yet implemented');
}

describe('Social Provider Tier Detection', () => {
  describe('detectProviderTier()', () => {
    it('returns tier1 when tenant has no overrides', async () => {
      const tier = await detectTier('google', null);
      expect(tier).toBe('tier1');
    });

    it('returns tier1 when tenant override exists but has no social provider client_id', async () => {
      const overrides = {
        features: {
          social_providers: {
            behavior: { existing_user_no_integration: 'auto_link' },
          },
        },
      };
      const tier = await detectTier('google', overrides);
      expect(tier).toBe('tier1');
    });

    it('returns tier1 when tenant override has empty client_id', async () => {
      const overrides = {
        features: {
          social_providers: {
            google: { client_id: '' },
          },
        },
      };
      const tier = await detectTier('google', overrides);
      expect(tier).toBe('tier1');
    });

    it('returns tier2 when tenant override has client_id for the provider', async () => {
      const overrides = {
        features: {
          social_providers: {
            google: {
              client_id: TENANT_CLIENT_ID,
              client_secret: TENANT_CLIENT_SECRET,
            },
          },
        },
      };
      const tier = await detectTier('google', overrides);
      expect(tier).toBe('tier2');
    });

    it('returns tier1 for provider X even when provider Y has tenant credentials', async () => {
      const overrides = {
        features: {
          social_providers: {
            github: {
              client_id: 'tenant-github-id',
              client_secret: 'tenant-github-secret',
            },
          },
        },
      };
      // GitHub is tier2, but Google should still be tier1
      const tier = await detectTier('google', overrides);
      expect(tier).toBe('tier1');
    });

    it('detects tier2 for each provider independently', async () => {
      const overrides = {
        features: {
          social_providers: {
            github: {
              client_id: 'tenant-github-id',
              client_secret: 'tenant-github-secret',
            },
            google: {
              client_id: TENANT_CLIENT_ID,
              client_secret: TENANT_CLIENT_SECRET,
            },
          },
        },
      };
      expect(await detectTier('github', overrides)).toBe('tier2');
      expect(await detectTier('google', overrides)).toBe('tier2');
      expect(await detectTier('facebook', overrides)).toBe('tier1');
    });
  });

  describe('Tier 1 Authorization URL Parameters', () => {
    it('redirect_uri points to _ops gateway', async () => {
      const result = await buildTier1AuthUrl(
        'google',
        'acme',
        {
          client_id: PLATFORM_CLIENT_ID,
          redirect_uri_base: `https://_ops.${BASE_DOMAIN}`,
        },
        HMAC_SECRET
      );

      // The authUrl contains URL-encoded params
      const params = new URLSearchParams(result.authUrl);
      expect(params.get('redirect_uri')).toBe(
        `https://_ops.${BASE_DOMAIN}/social/google/callback`
      );
    });

    it('state is HMAC-signed with tenant_id', async () => {
      const result = await buildTier1AuthUrl(
        'google',
        'acme',
        {
          client_id: PLATFORM_CLIENT_ID,
          redirect_uri_base: `https://_ops.${BASE_DOMAIN}`,
        },
        HMAC_SECRET
      );

      // Verify the state is a valid HMAC token containing acme as tenant_id
      const verified = verifyHmacState(result.state, HMAC_SECRET);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        expect(verified.tenant_id).toBe('acme');
      }
    });

    it('uses platform client_id in the auth URL', async () => {
      const result = await buildTier1AuthUrl(
        'google',
        'acme',
        {
          client_id: PLATFORM_CLIENT_ID,
          redirect_uri_base: `https://_ops.${BASE_DOMAIN}`,
        },
        HMAC_SECRET
      );

      const params = new URLSearchParams(result.authUrl);
      expect(params.get('client_id')).toBe(PLATFORM_CLIENT_ID);
    });
  });
});
