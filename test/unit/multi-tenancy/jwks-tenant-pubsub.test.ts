/**
 * Tests for Task 4.4: Tenant-Scoped JWKS Rotation PubSub
 *
 * Verifies:
 * 1. JWKS controller publishes to tenant-scoped channels when multi-tenancy enabled
 * 2. JWKS controller publishes to global channels when multi-tenancy disabled
 * 3. ProviderService guards global JWKS subscriptions to single-tenant mode only
 */
import { describe, it, expect, vi } from 'vitest';
import { AdminJwksController } from '../../../src/controllers/admin/jwks.controller.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockPubSub() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    publishForTenant: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

function createMockConfigManager(multiTenantEnabled: boolean) {
  return {
    getConfig: vi.fn().mockReturnValue({
      features: {
        multi_tenancy: { enabled: multiTenantEnabled },
      },
      deployment: {
        redis_prefix: 'parako',
        environment: 'development',
      },
      security: {
        key_store: {
          rotation_interval_days: 30,
          overlap_window_seconds: 7200,
          algorithm: 'RS256',
          key_size: 2048,
        },
      },
    }),
    subscribe: vi.fn(),
  };
}

function createMockKeyStore() {
  return {
    initialize: vi.fn(),
    getJWKS: vi.fn().mockResolvedValue({ keys: [] }),
    listKeys: vi.fn().mockResolvedValue([]),
    needsRotation: vi.fn().mockResolvedValue(false),
    rotate: vi.fn().mockResolvedValue(undefined),
    promoteKeys: vi.fn().mockResolvedValue(undefined),
    retireExpiredKeys: vi.fn().mockResolvedValue(0),
  };
}

function createMockSessionManager() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    getActiveUser: vi.fn().mockReturnValue(null),
    flash: vi.fn().mockReturnValue({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  };
}

function createMockActivityService() {
  return {
    createActivity: vi.fn().mockResolvedValue(undefined),
    success: vi.fn().mockResolvedValue(undefined),
    failure: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockClientDeviceInfoManager() {
  return {
    getClientInfoFromRequest: vi.fn().mockReturnValue({}),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('JWKS Tenant-Scoped PubSub (Task 4.4)', () => {
  describe('AdminJwksController.publishJwksEvent()', () => {
    let pubsub: ReturnType<typeof createMockPubSub>;
    let logger: ReturnType<typeof createMockLogger>;

    function createController(multiTenantEnabled: boolean) {
      pubsub = createMockPubSub();
      logger = createMockLogger();
      const configManager = createMockConfigManager(multiTenantEnabled);

      return new (AdminJwksController as any)(
        /* logger */ logger,
        /* keyStore */ createMockKeyStore(),
        /* configManager */ configManager,
        /* sessionManager */ createMockSessionManager(),
        /* activityService */ createMockActivityService(),
        /* pubsub */ pubsub,
        /* clientDeviceInfoManager */ createMockClientDeviceInfoManager()
      );
    }

    it('publishes to tenant-scoped channel when multi-tenancy enabled', async () => {
      const controller = createController(true);

      // Access the private method via the rotate endpoint
      // Since we can't call private methods directly, we'll use the
      // rotate handler which calls publishJwksEvent('rotated')
      const mockReq = {
        session: {},
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
      };
      const mockRes = {
        redirect: vi.fn(),
      };

      await tenantContext.run('acme', async () => {
        await controller.rotate(mockReq, mockRes);
      });

      // buildRedisKey resolves tenant from ALS → parako:acme:jwks:rotated
      expect(pubsub.publish).toHaveBeenCalledWith(
        'parako:acme:jwks:rotated',
        expect.objectContaining({
          timestamp: expect.any(Number),
          source: 'admin_panel',
        })
      );
      expect(pubsub.publish).toHaveBeenCalledWith(
        'parako:acme:jwks:promoted',
        expect.objectContaining({
          timestamp: expect.any(Number),
          source: 'admin_panel',
        })
      );
      // publishForTenant is no longer used — controller calls buildRedisKey + publish
      expect(pubsub.publishForTenant).not.toHaveBeenCalled();
    });

    it('publishes to default-tenant channel when multi-tenancy disabled', async () => {
      const controller = createController(false);

      const mockReq = {
        session: {},
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
      };
      const mockRes = {
        redirect: vi.fn(),
      };

      await controller.rotate(mockReq, mockRes);

      // Outside ALS context, tenantId = 'default' → parako:default:jwks:rotated
      expect(pubsub.publish).toHaveBeenCalledWith(
        'parako:default:jwks:rotated',
        expect.objectContaining({
          timestamp: expect.any(Number),
          source: 'admin_panel',
        })
      );
      expect(pubsub.publishForTenant).not.toHaveBeenCalled();
    });
  });

  describe('ProviderService JWKS subscriptions', () => {
    it('subscribes to global JWKS channels only in single-tenant mode', async () => {
      const pubsub = createMockPubSub();
      const configManager = createMockConfigManager(false);

      // Import and create ProviderService
      const { ProviderService } = await import('../../../src/oidc/provider.js');

      new (ProviderService as any)(
        /* logger */ createMockLogger(),
        /* configManager */ configManager,
        /* oidcAdapter */ { initialize: vi.fn() },
        /* oidcConfig */ { getConfig: vi.fn(), getJwks: vi.fn() },
        /* keyStore */ createMockKeyStore(),
        /* pubsub */ pubsub,
        /* tenantProviderRegistry */ undefined
      );

      // In single-tenant mode, subscribes via buildRedisKeyForTenant with DEFAULT_TENANT_ID
      // Channel format: {prefix}:{tenantId}:jwks:{phase}
      expect(pubsub.subscribe).toHaveBeenCalledWith(
        'parako:default:jwks:rotated',
        expect.any(Function)
      );
      expect(pubsub.subscribe).toHaveBeenCalledWith(
        'parako:default:jwks:promoted',
        expect.any(Function)
      );
    });

    it('does NOT subscribe to global JWKS channels in multi-tenant mode', async () => {
      const pubsub = createMockPubSub();
      const configManager = createMockConfigManager(true);

      const { ProviderService } = await import('../../../src/oidc/provider.js');

      new (ProviderService as any)(
        /* logger */ createMockLogger(),
        /* configManager */ configManager,
        /* oidcAdapter */ { initialize: vi.fn() },
        /* oidcConfig */ { getConfig: vi.fn(), getJwks: vi.fn() },
        /* keyStore */ createMockKeyStore(),
        /* pubsub */ pubsub,
        /* tenantProviderRegistry */ {
          getProvider: vi.fn(),
          has: vi.fn(),
          size: vi.fn(),
          shutdown: vi.fn(),
          setProviderConfigurator: vi.fn(),
          reloadProviderJWKS: vi.fn(),
        }
      );

      // Should NOT subscribe to global JWKS channels
      const jwksSubscriptions = pubsub.subscribe.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as string).includes('jwks:rotated') ||
          (call[0] as string).includes('jwks:promoted')
      );
      expect(jwksSubscriptions).toHaveLength(0);
    });
  });
});
