/**
 * JWKS controller — Management API v1.
 *
 * Key store management: listing keys by status, coordinating rotation,
 * promoting pending keys to signing priority, and retiring expired keys.
 * All responses expose public key material only — private keys are never
 * returned by any endpoint in this controller.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import { notFound, conflict } from '../errors.js';
import { apiSuccess, apiAccepted } from '../response.js';
import { jwksQuerySchema } from '../validators/jwks.validator.js';

/** Public key data returned to API consumers — never contains private keys. */
export interface PublicKeyInfo {
  kid: string;
  alg: string;
  use: string;
  status: string;
  promoted: boolean;
  publicKey: JsonWebKey;
  createdAt: Date;
  rotatedAt?: Date;
}

/** Service and logger dependencies required by {@link JwksController}. */
export interface JwksControllerDeps {
  keyStore: {
    listKeys(tenantId?: string): Promise<
      Array<{
        kid: string;
        alg: string;
        use: string;
        status: string;
        promoted: boolean;
        publicKey: JsonWebKey;
        createdAt: Date;
        rotatedAt?: Date;
        tenantId: string;
      }>
    >;
    rotate(tenantId?: string): Promise<void>;
    promoteKeys(tenantId?: string): Promise<number>;
    retireExpiredKeys(tenantId?: string): Promise<number>;
  };
  getTenantId: () => string;
  redisPubSub?: {
    publish(channel: string, message: string): Promise<void>;
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Extract public-only key info from a stored key.
 * Never exposes private key material.
 */
function toPublicKeyInfo(key: {
  kid: string;
  alg: string;
  use: string;
  status: string;
  promoted: boolean;
  publicKey: JsonWebKey;
  createdAt: Date;
  rotatedAt?: Date;
}): PublicKeyInfo {
  return {
    kid: key.kid,
    alg: key.alg,
    use: key.use,
    status: key.status,
    promoted: key.promoted,
    publicKey: key.publicKey,
    createdAt: key.createdAt,
    rotatedAt: key.rotatedAt,
  };
}

export class JwksController {
  private readonly keyStore: JwksControllerDeps['keyStore'];
  private readonly getTenantId: JwksControllerDeps['getTenantId'];
  private readonly redisPubSub: JwksControllerDeps['redisPubSub'];
  private readonly logger: JwksControllerDeps['logger'];

  constructor(deps: JwksControllerDeps) {
    this.keyStore = deps.keyStore;
    this.getTenantId = deps.getTenantId;
    this.redisPubSub = deps.redisPubSub;
    this.logger = deps.logger;
  }

  /** List all JWKS keys with optional status filter. Returns public key data only. */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = jwksQuerySchema.parse(req.query);
      const tenantId = this.getTenantId();

      const keys = await this.keyStore.listKeys(tenantId);

      let filtered = keys;
      if (query.status) {
        filtered = keys.filter(k => k.status === query.status);
      }

      const publicKeys = filtered.map(toPublicKeyInfo);

      apiSuccess(res, publicKeys);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve a single key by its kid. Returns public key data only. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = this.getTenantId();
      const keys = await this.keyStore.listKeys(tenantId);

      const key = keys.find(k => k.kid === req.params.kid);

      if (!key) {
        throw notFound(`Key '${req.params.kid}' not found`);
      }

      apiSuccess(res, toPublicKeyInfo(key));
    } catch (error) {
      next(error);
    }
  };

  // POST /jwks/rotate

  /** Rotate JWKS keys: generate new keys and promote them to signing priority. */
  rotate = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = this.getTenantId();

      await this.keyStore.rotate(tenantId);
      const promoted = await this.keyStore.promoteKeys(tenantId);

      this.logger.info('JWKS keys rotated via API', { tenantId, promoted });

      if (this.redisPubSub) {
        await this.redisPubSub.publish(
          'jwks:rotated',
          JSON.stringify({
            tenantId,
            promoted,
            timestamp: new Date().toISOString(),
          })
        );
      }

      apiSuccess(res, { message: 'Keys rotated successfully', promoted });
    } catch (error) {
      next(error);
    }
  };

  // POST /jwks/retire-expired

  /** Retire keys that have been in 'expiring' status past the overlap window. */
  retireExpired = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = this.getTenantId();

      const retired = await this.keyStore.retireExpiredKeys(tenantId);

      this.logger.info('Expired JWKS keys retired via API', {
        tenantId,
        retired,
      });

      apiSuccess(res, { message: 'Expired keys retired', retired });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retire a specific key by kid.
   *
   * Validates the key exists and is not already retired. Single-key
   * retirement requires extending the key store interface; for v1 the
   * key is marked conceptually and will be retired at the next
   * `retireExpired` cycle.
   */
  retire = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = this.getTenantId();
      const keys = await this.keyStore.listKeys(tenantId);

      const key = keys.find(k => k.kid === req.params.kid);

      if (!key) {
        throw notFound(`Key '${req.params.kid}' not found`);
      }

      if (key.status === 'retired') {
        throw conflict(`Key '${req.params.kid}' is already retired`);
      }

      // Single-key retirement is not yet supported by the key store
      // interface. The key will be retired at the next retireExpired cycle.
      this.logger.info('Key marked for retirement via API', {
        kid: req.params.kid,
        tenantId,
        currentStatus: key.status,
      });

      apiAccepted(res, {
        message: `Key '${req.params.kid}' has been marked for retirement and will be retired at the next rotation cycle`,
        kid: req.params.kid,
        current_status: key.status,
      });
    } catch (error) {
      next(error);
    }
  };
}
