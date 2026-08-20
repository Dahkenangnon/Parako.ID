import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import type {
  IKeyStore,
  StoredKey,
} from '../../di/interfaces/key-store.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { IRedisPubSubService } from '../../di/interfaces/redis-pubsub-service.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IAdminJwksController } from '../../di/interfaces/admin-jwks-controller.interface.js';
import { TYPES } from '../../di/types.js';
import { tenantContext } from '../../multi-tenancy/tenant-context.js';
import { buildRedisKey } from '../../multi-tenancy/redis-key.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { flashAndRedirect } from '../../utils/flash-redirect.js';

type AdminKey = Omit<StoredKey, 'privateKey'>;

function redactPrivateKey(key: StoredKey): AdminKey {
  return {
    kid: key.kid,
    alg: key.alg,
    use: key.use,
    status: key.status,
    promoted: key.promoted,
    publicKey: key.publicKey,
    createdAt: key.createdAt,
    rotatedAt: key.rotatedAt,
    tenantId: key.tenantId,
  };
}

@injectable()
export class AdminJwksController implements IAdminJwksController {
  private get redisPrefix(): string {
    return this.configManager.getConfig().deployment?.redis_prefix || 'parako';
  }

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.KeyStore) private readonly keyStore: IKeyStore,
    @inject(TYPES.ConfigManager)
    private readonly configManager: IConfigManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.RedisPubSubService)
    private readonly pubsub: IRedisPubSubService,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  private get activityLoggerDeps() {
    return {
      activityService: this.activityService,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

  public list = async (_req: Request, res: Response): Promise<void> => {
    const tenantId = tenantContext.getTenantId();
    const keys = await this.keyStore.listKeys(tenantId);
    const needsRotation = await this.keyStore.needsRotation(tenantId);
    const config = this.configManager.getConfig();
    const keyStoreConfig = config.security?.key_store || {};

    const stats = {
      total: keys.length,
      active: keys.filter((k: StoredKey) => k.status === 'active').length,
      expiring: keys.filter((k: StoredKey) => k.status === 'expiring').length,
      retired: keys.filter((k: StoredKey) => k.status === 'retired').length,
    };

    const sortedKeys = [...keys]
      .sort(
        (a: StoredKey, b: StoredKey) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .map(redactPrivateKey);

    res.render('admin/jwks/index', {
      title: 'JWKS Key Management',
      keys: sortedKeys,
      stats,
      needsRotation,
      keyStoreConfig: {
        type: keyStoreConfig.type || 'database',
        algorithms: keyStoreConfig.algorithms || ['RS256'],
        rotation_interval_days: keyStoreConfig.rotation_interval_days || 90,
        overlap_window_seconds: keyStoreConfig.overlap_window_seconds || 86400,
      },
    });
  };

  public show = async (req: Request, res: Response): Promise<void> => {
    const tenantId = tenantContext.getTenantId();
    const kid = req.params.kid;
    const keys = await this.keyStore.listKeys(tenantId);
    const key = keys.find((k: StoredKey) => k.kid === kid);

    if (!key) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'Key not found',
        '/admin/jwks'
      );
    }

    res.render('admin/jwks/show', {
      title: `Key Details - ${kid}`,
      key: redactPrivateKey(key),
      publicJwk: JSON.stringify(key.publicKey, null, 2),
    });
  };

  /**
   * Two-phase JWKS key rotation (admin panel — always synchronous)
   * POST /admin/jwks/rotate
   *
   * Phase 1: Generate new keys (unpromoted — verification only)
   * Phase 2: Promote keys to signing priority
   *
   * The admin panel always runs both phases synchronously to provide
   * immediate feedback. For distributed deployments that need a delay
   * between phases (promotion_delay_ms > 0), use the BullMQ background
   * worker which schedules promotion as a separate delayed job.
   */
  public rotate = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = tenantContext.getTenantId();

      // Phase 1: rotate (new keys are unpromoted)
      await this.keyStore.rotate(tenantId);
      this.publishJwksEvent('rotated');

      // Phase 2: promote immediately
      await this.keyStore.promoteKeys(tenantId);
      this.publishJwksEvent('promoted');

      // Clean up old keys past overlap window
      await this.keyStore.retireExpiredKeys(tenantId);

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success(
        'jwks_rotated_by_admin',
        null,
        'Admin manually rotated JWKS keys',
        {
          target: {
            target_type: 'system',
            entity_name: 'jwks',
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success('JWKS keys rotated successfully. New keys are now active.');
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'admin_jwks_rotate_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to rotate JWKS keys. Please try again.');
    }

    res.redirect('/admin/jwks');
  };

  public retireExpired = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = tenantContext.getTenantId();
      const retiredCount = await this.keyStore.retireExpiredKeys(tenantId);

      activityLoggerFor(this.activityLoggerDeps, req, {
        defaultActorType: 'admin',
      }).success(
        'jwks_expired_keys_retired_by_admin',
        null,
        'Admin retired expired JWKS keys',
        {
          target: {
            target_type: 'system',
            entity_name: 'jwks',
          },
        }
      );

      if (retiredCount > 0) {
        this.sessionManager
          .flash(req)
          .success(`${retiredCount} expired key(s) have been retired.`);
      } else {
        this.sessionManager
          .flash(req)
          .info('No keys are past the overlap window yet.');
      }
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'admin_jwks_retire_expired_failed',
      });
      this.sessionManager
        .flash(req)
        .error('Failed to retire expired keys. Please try again.');
    }

    res.redirect('/admin/jwks');
  };

  private publishJwksEvent(phase: 'rotated' | 'promoted'): void {
    if (!this.pubsub?.isConnected()) return;

    // Unified channel format: {prefix}:{tenantId}:jwks:{phase}
    // The admin panel is tenant-scoped (each tenant admin manages their own
    // OIDC tenant), so ALS context is always the correct tenant here.
    // buildRedisKey reads tenant from ALS, producing the same channel format
    // in both single-tenant (tenantId='default') and multi-tenant modes.
    const channel = buildRedisKey(this.redisPrefix, 'jwks', phase);
    const tenantId = tenantContext.getTenantId();

    const payload = {
      timestamp: Date.now(),
      source: 'admin_panel',
      tenantId,
    };

    this.pubsub.publish(channel, payload).catch((err: unknown) => {
      this.logger.warn(
        `Failed to publish JWKS ${phase} event: ${err instanceof Error ? err.message : String(err)}`,
        { context: 'jwks_pubsub_publish_failed', phase, tenantId }
      );
    });
  }
}
