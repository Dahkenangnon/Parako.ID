/**
 * Registration tokens controller — Management API v1.
 *
 * DCR Initial Access Token (IAT) lifecycle: create, list, get, and revoke.
 * Uses node-oidc-provider's InitialAccessToken model to create adapter-backed
 * tokens that the provider validates at the /reg endpoint.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Provider } from 'oidc-provider';

import { notFound } from '../errors.js';
import { apiSuccess, apiCreated, apiNoContent, apiList } from '../response.js';
import type { CreateRegistrationTokenInput } from '../validators/registration-tokens.validator.js';

/** Service and logger dependencies required by {@link RegistrationTokensController}. */
export interface RegistrationTokensControllerDeps {
  providerService: {
    getProviderForTenant(tenantId: string): Promise<Provider>;
  };
  oidcAdapter: {
    readonly adapter: (modelName: string) => {
      destroy(id: string): Promise<void>;
      find(id: string): Promise<unknown>;
      findAll(): Promise<unknown[]>;
      upsert(
        id: string,
        payload: Record<string, unknown>,
        expiresIn?: number
      ): Promise<void>;
    };
  };
  getTenantId: () => string;
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

/** Shape returned to API consumers — never exposes the raw token value. */
interface RegistrationTokenInfo {
  jti: string;
  expires_at: string;
  max_usage_count: number;
  current_usage_count: number;
  policies: string[];
  note?: string;
  created_at: string;
}

/**
 * Map an adapter-stored IAT payload to the public API shape.
 * The raw token string is intentionally excluded.
 */
function toTokenInfo(payload: Record<string, unknown>): RegistrationTokenInfo {
  const meta = (payload.policies_metadata as Record<string, unknown>) ?? {};
  return {
    jti: String(payload.jti ?? payload._id ?? ''),
    expires_at: payload.exp
      ? new Date((payload.exp as number) * 1000).toISOString()
      : '',
    max_usage_count: (meta.max_usage_count as number) ?? 0,
    current_usage_count: (meta.current_usage_count as number) ?? 0,
    policies: (payload.policies as string[]) ?? ['general-policy'],
    note: (meta.note as string) ?? undefined,
    created_at: payload.iat
      ? new Date((payload.iat as number) * 1000).toISOString()
      : '',
  };
}

export class RegistrationTokensController {
  private readonly providerService: RegistrationTokensControllerDeps['providerService'];
  private readonly oidcAdapter: RegistrationTokensControllerDeps['oidcAdapter'];
  private readonly getTenantId: RegistrationTokensControllerDeps['getTenantId'];
  private readonly logger: RegistrationTokensControllerDeps['logger'];

  constructor(deps: RegistrationTokensControllerDeps) {
    this.providerService = deps.providerService;
    this.oidcAdapter = deps.oidcAdapter;
    this.getTenantId = deps.getTenantId;
    this.logger = deps.logger;
  }

  // POST /registration-tokens

  /** Create a new Initial Access Token for DCR. Returns the raw token once. */
  create = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as CreateRegistrationTokenInput;
      const tenantId = this.getTenantId();
      const provider =
        await this.providerService.getProviderForTenant(tenantId);

      const iat = new provider.InitialAccessToken({
        policies: body.policies,
        expiresIn: body.expires_in,
      });
      const policiesMetadata = {
        max_usage_count: body.max_usage_count,
        current_usage_count: 0,
        ...(body.note !== undefined ? { note: body.note } : {}),
      };

      const tokenValue = await iat.save();
      const jti = String(
        (iat as unknown as Record<string, unknown>).jti ?? tokenValue
      );
      const adapter = this.oidcAdapter.adapter('InitialAccessToken');

      try {
        const storedPayload = await adapter.find(jti);
        if (!storedPayload) {
          throw new Error('Unable to persist registration token metadata');
        }

        const payload = storedPayload as Record<string, unknown>;
        const now = Math.floor(Date.now() / 1000);
        const remainingTtl =
          typeof payload.exp === 'number' && payload.exp > now
            ? payload.exp - now
            : body.expires_in;

        await adapter.upsert(
          jti,
          { ...payload, policies_metadata: policiesMetadata },
          remainingTtl
        );
      } catch (error) {
        try {
          await adapter.destroy(jti);
        } catch (cleanupError) {
          this.logger.error(cleanupError as Error, {
            context: 'registration_token_metadata_cleanup',
            tenantId,
            jti,
          });
        }
        throw error;
      }

      this.logger.info('DCR initial access token created via API', {
        tenantId,
        policies: body.policies,
        expiresIn: body.expires_in,
        maxUsageCount: body.max_usage_count,
      });

      apiCreated(res, {
        jti,
        token: tokenValue,
        expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
        max_usage_count: body.max_usage_count,
        current_usage_count: 0,
        policies: body.policies,
        note: body.note,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };

  /** List active IATs. Never returns the raw token value. */
  list = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = this.getTenantId();
      const adapter = this.oidcAdapter.adapter('InitialAccessToken');
      const payloads = await adapter.findAll();

      this.logger.info('DCR initial access tokens listed via API', {
        tenantId,
      });

      apiList(res, {
        data: payloads.map(payload =>
          toTokenInfo(payload as Record<string, unknown>)
        ),
        pagination: { has_more: false, next_cursor: null },
      });
    } catch (error) {
      next(error);
    }
  };

  /** Get a single IAT by JTI. Never returns the raw token value. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { jti } = req.params;
      const adapter = this.oidcAdapter.adapter('InitialAccessToken');
      const payload = await adapter.find(jti);

      if (!payload) {
        throw notFound(`Registration token '${jti}' not found`);
      }

      apiSuccess(res, toTokenInfo(payload as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  };

  /** Revoke an IAT by JTI. */
  destroy = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = this.getTenantId();
      const { jti } = req.params;
      const adapter = this.oidcAdapter.adapter('InitialAccessToken');
      const existing = await adapter.find(jti);
      if (!existing) {
        throw notFound(`Registration token '${jti}' not found`);
      }
      await adapter.destroy(jti);

      this.logger.info('DCR initial access token revoked via API', {
        tenantId,
        jti,
      });

      apiNoContent(res);
    } catch (error) {
      next(error);
    }
  };
}
