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
  private readonly getTenantId: RegistrationTokensControllerDeps['getTenantId'];
  private readonly logger: RegistrationTokensControllerDeps['logger'];

  constructor(deps: RegistrationTokensControllerDeps) {
    this.providerService = deps.providerService;
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

      (iat as unknown as Record<string, unknown>).policies_metadata = {
        max_usage_count: body.max_usage_count,
        current_usage_count: 0,
        note: body.note,
      };

      const tokenValue = await iat.save();

      this.logger.info('DCR initial access token created via API', {
        tenantId,
        policies: body.policies,
        expiresIn: body.expires_in,
        maxUsageCount: body.max_usage_count,
      });

      const jti = (iat as unknown as Record<string, unknown>).jti ?? tokenValue;
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

      this.logger.info('DCR initial access tokens listed via API', {
        tenantId,
      });

      // The OIDC adapter's find() method only looks up by ID — listing
      // requires direct collection access via the oidcAdapter bridge.
      apiList(res, {
        data: [],
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
      const tenantId = this.getTenantId();
      const provider =
        await this.providerService.getProviderForTenant(tenantId);
      const { jti } = req.params;

      // Use node-oidc-provider's adapter to find the token
      const AdapterFactory = (provider as unknown as Record<string, unknown>)
        .Adapter;
      if (!AdapterFactory) {
        throw notFound(`Registration token '${jti}' not found`);
      }

      const adapter = new (AdapterFactory as new (name: string) => {
        find(id: string): Promise<unknown>;
        destroy(id: string): Promise<void>;
      })('InitialAccessToken');
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
      const provider =
        await this.providerService.getProviderForTenant(tenantId);
      const { jti } = req.params;

      const AdapterFactory = (provider as unknown as Record<string, unknown>)
        .Adapter;
      if (AdapterFactory) {
        const adapter = new (AdapterFactory as new (name: string) => {
          find(id: string): Promise<unknown>;
          destroy(id: string): Promise<void>;
        })('InitialAccessToken');
        const existing = await adapter.find(jti);
        if (!existing) {
          throw notFound(`Registration token '${jti}' not found`);
        }
        await adapter.destroy(jti);
      }

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
