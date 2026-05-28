/**
 * Social Tier 1 Completion Service
 *
 * Handles the final step of a Tier 1 social login flow. After the _ops gateway
 * receives the OAuth callback and stores the authorization code in Redis, the
 * user is redirected to their tenant's `/auth/social/:provider/complete?ref={uuid}`.
 *
 * This service:
 * 1. Reads the one-time ref from Redis (code + provider + tenant_id)
 * 2. Exchanges the code for an access token using platform credentials
 * 3. Fetches the user profile from the provider
 * 4. Delegates to SocialLoginManager.completeTier1Flow() for user integration
 */

import { injectable, inject, optional } from 'inversify';
import { Request } from 'express';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ISocialLoginManager } from '../di/interfaces/social-login-manager.interface.js';
import type { SocialLoginResult } from '../di/interfaces/base-social-login.interface.js';
import type { IOpsRedisClient } from './ops-social-callback.service.js';
import { type SocialProvider } from '../types/social-integration.js';
import {
  consumeSocialRef,
  resolveTier1Endpoints,
  exchangeTier1Code,
  fetchTier1UserProfile,
  mapTier1Profile,
  mapTier1Tokens,
  extractBaseDomain,
} from '../integration/social-tier-utils.js';
import { tenantContext } from '../multi-tenancy/tenant-context.js';

export interface ISocialTier1CompletionService {
  complete(
    ref: string,
    provider: SocialProvider,
    req: Request
  ): Promise<SocialLoginResult>;
}

@injectable()
export class SocialTier1CompletionService implements ISocialTier1CompletionService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.SocialLoginManager)
    private readonly socialLoginManager: ISocialLoginManager,
    @inject(TYPES.OpsRedisClient)
    @optional()
    private readonly redis: IOpsRedisClient | null = null
  ) {}

  /**
   * Complete the Tier 1 social login flow.
   *
   * @param ref      - The UUID ref from the query string (?ref=...)
   * @param provider - The social provider slug from the URL param
   * @param req      - The Express request (needed for session + user integration)
   */
  async complete(
    ref: string,
    provider: SocialProvider,
    req: Request
  ): Promise<SocialLoginResult> {
    // 1. Consume one-time ref from Redis
    if (!this.redis) {
      this.logger.error('tier1_completion_no_redis', {
        message:
          'OpsRedisClient not bound. Tier 1 social completion is disabled.',
      });
      return { success: false, error: 'Service unavailable' };
    }
    const refResult = await consumeSocialRef(this.redis, ref);

    if (refResult.success === false) {
      this.logger.warn('tier1_completion_ref_failed', {
        provider,
        error: refResult.error,
      });
      return { success: false, error: refResult.error };
    }

    const { code } = refResult;

    if (refResult.provider !== provider) {
      this.logger.warn('tier1_completion_provider_mismatch', {
        expected: provider,
        actual: refResult.provider,
      });
      return { success: false, error: 'Provider mismatch' };
    }

    // Verify the ref belongs to this tenant (cross-tenant protection)
    const currentTenantId = tenantContext.getTenantIdSafe();
    if (currentTenantId && refResult.tenant_id !== currentTenantId) {
      this.logger.warn('tier1_completion_tenant_mismatch', {
        expected: currentTenantId,
        actual: refResult.tenant_id,
        provider,
      });
      return { success: false, error: 'Invalid request' };
    }

    // 2. Resolve provider endpoints + credentials from platform config
    const config = this.configManager.getConfig();
    const featuresSocialProviders = config.features.social_providers;
    const providerConfig = featuresSocialProviders[
      provider as keyof typeof featuresSocialProviders
    ] as Record<string, unknown> | undefined;

    if (!providerConfig) {
      this.logger.warn('tier1_completion_provider_not_configured', {
        provider,
      });
      return { success: false, error: 'Social login is not available' };
    }

    const endpoints = resolveTier1Endpoints(provider, providerConfig);
    if (!endpoints) {
      this.logger.warn('tier1_completion_endpoints_unresolved', { provider });
      return { success: false, error: 'Social login is not available' };
    }

    const baseDomain = extractBaseDomain(config.deployment?.url || '');
    const opsRedirectUri = `https://_ops.${baseDomain}/social/${provider}/callback`;

    // 3. Exchange code for tokens
    let tokenResponse: { access_token: string; [key: string]: unknown };
    try {
      tokenResponse = await exchangeTier1Code(code, {
        token_endpoint: endpoints.token_endpoint,
        client_id: providerConfig.client_id as string,
        client_secret: providerConfig.client_secret as string,
        redirect_uri: opsRedirectUri,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'tier1_completion_token_exchange_failed',
        provider,
      });
      return { success: false, error: 'Failed to exchange authorization code' };
    }

    // 4. Fetch user profile
    let rawProfile: Record<string, unknown>;
    try {
      rawProfile = await fetchTier1UserProfile(
        tokenResponse.access_token,
        endpoints.userinfo_endpoint,
        provider
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'tier1_completion_profile_fetch_failed',
        provider,
      });
      return { success: false, error: 'Failed to fetch user profile' };
    }

    // 5. Map profile and tokens
    const providerData = mapTier1Profile(provider, rawProfile);
    const tokens = mapTier1Tokens(tokenResponse);

    this.logger.info('tier1_completion_profile_mapped', {
      provider,
      hasSub: !!providerData.sub,
      hasEmail: !!providerData.email,
    });

    // 6. Delegate to SocialLoginManager for user integration
    return this.socialLoginManager.completeTier1Flow(
      provider,
      providerData,
      tokens,
      req
    );
  }
}
