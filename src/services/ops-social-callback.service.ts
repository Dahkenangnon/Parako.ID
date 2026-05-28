/**
 * Ops Social Callback Service
 *
 * Handles the _ops tenant's role in centralised social OAuth callbacks.
 * When a Tier-1 tenant (no own OAuth credentials) starts a social login,
 * the callback lands on `_ops.{baseDomain}/social/{provider}/callback`.
 *
 * This service:
 * 1. Verifies the HMAC-signed state parameter to extract the originating tenant_id
 * 2. Stores the authorization code + provider info in Redis (2-min TTL)
 * 3. Returns a redirect URL that sends the user back to the originating tenant's
 *    `/auth/social/{provider}/complete?ref={uuid}` endpoint
 *
 * The actual OAuth token exchange happens on the originating tenant's side
 * (Phase 4) where it reads the ref from Redis and completes the flow.
 */

import { randomUUID } from 'node:crypto';
import { injectable, inject, optional } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { verifyHmacState } from '../utils/hmac-state.js';
import {
  extractBaseDomain,
  SOCIAL_REF_REDIS_PREFIX,
} from '../integration/social-tier-utils.js';

/** Redis TTL for stored social callback refs (2 minutes). */
const REF_TTL_SECONDS = 120;

export interface OpsSocialCallbackResult {
  success: true;
  redirectUrl: string;
}

export interface OpsSocialCallbackError {
  success: false;
  error: string;
}

export type OpsSocialCallbackResponse =
  | OpsSocialCallbackResult
  | OpsSocialCallbackError;

/** Minimal Redis interface — only the commands these services use. */
export interface IOpsRedisClient {
  set(
    key: string,
    value: string,
    mode: string,
    ttl: number
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  getdel?(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

@injectable()
export class OpsSocialCallbackService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.OpsRedisClient)
    @optional()
    private readonly redis: IOpsRedisClient | null = null
  ) {}

  /**
   * Process an OAuth callback that arrived at the _ops gateway.
   *
   * @param provider - The social provider slug (google, github, etc.)
   * @param code     - The authorization code from the OAuth provider
   * @param state    - The HMAC-signed state parameter
   */
  async handleCallback(
    provider: string,
    code: string,
    state: string
  ): Promise<OpsSocialCallbackResponse> {
    // 0. Fail-fast if Redis is unavailable
    if (!this.redis) {
      this.logger.error('ops_social_callback_no_redis', {
        message: 'OpsRedisClient not bound. Social callback relay is disabled.',
      });
      return { success: false, error: 'Service unavailable' };
    }

    // 1. Verify HMAC state
    const config = this.configManager.getConfig();
    const hmacSecret = config.security?.secrets?.hmac_secret;

    if (!hmacSecret) {
      this.logger.error('ops_social_callback_no_hmac_secret', {
        message:
          'HMAC secret is not configured. Social callback relay is disabled.',
      });
      return { success: false, error: 'Service misconfigured' };
    }

    const stateResult = verifyHmacState(state, hmacSecret);

    if (stateResult.valid === false) {
      this.logger.warn('ops_social_callback_invalid_state', {
        provider,
        error: stateResult.error,
      });
      return { success: false, error: `Invalid state: ${stateResult.error}` };
    }

    const { tenant_id } = stateResult;

    this.logger.info('ops_social_callback', {
      provider,
      tenant_id,
      nonce: stateResult.nonce,
    });

    // 2. Generate ref UUID and store callback data in Redis
    const ref = randomUUID();
    const refKey = `${SOCIAL_REF_REDIS_PREFIX}${ref}`;
    const refData = JSON.stringify({
      provider,
      code,
      tenant_id,
      timestamp: Date.now(),
    });

    await this.redis.set(refKey, refData, 'EX', REF_TTL_SECONDS);

    // 3. Build redirect URL back to originating tenant
    const baseDomain = extractBaseDomain(config.deployment?.url || '');
    const redirectUrl = `https://${tenant_id}.${baseDomain}/auth/social/${provider}/complete?ref=${ref}`;

    this.logger.info('ops_social_callback_redirect', {
      provider,
      tenant_id,
      ref,
      redirectUrl,
    });

    return { success: true, redirectUrl };
  }
}
