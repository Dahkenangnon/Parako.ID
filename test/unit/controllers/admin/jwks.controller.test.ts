import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { StoredKey } from '../../../../src/di/interfaces/key-store.interface.js';

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Mock tenant context
vi.mock('../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    getTenantId: vi.fn().mockReturnValue('test-tenant'),
  },
}));

// Import after mocks
import { AdminJwksController } from '../../../../src/controllers/admin/jwks.controller.js';

// ── Test Helpers ──

function createMockKey(overrides: Partial<StoredKey> = {}): StoredKey {
  return {
    kid: 'test-kid-123',
    alg: 'RS256',
    use: 'sig',
    status: 'active',
    promoted: true,
    privateKey: { kty: 'RSA' } as JsonWebKey,
    publicKey: {
      kty: 'RSA',
      kid: 'test-kid-123',
      n: 'abc',
      e: 'AQAB',
    } as JsonWebKey,
    createdAt: new Date('2025-01-01'),
    tenantId: 'default',
    ...overrides,
  };
}

function createMockDeps() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const keyStore = {
    initialize: vi.fn(),
    getJWKS: vi.fn(),
    getPublicJWKS: vi.fn(),
    rotate: vi.fn().mockResolvedValue(undefined),
    promoteKeys: vi.fn().mockResolvedValue(3),
    retireExpiredKeys: vi.fn().mockResolvedValue(0),
    listKeys: vi.fn().mockResolvedValue([]),
    needsRotation: vi.fn().mockResolvedValue(false),
  };

  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      deployment: { redis_prefix: 'parako' },
      features: { multi_tenancy: { enabled: false } },
      security: {
        key_store: {
          type: 'database',
          algorithms: ['RS256', 'ES256'],
          rotation_interval_days: 90,
          overlap_window_seconds: 86400,
        },
      },
    }),
  };

  const flashChain = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };

  const sessionManager = {
    flash: vi.fn().mockReturnValue(flashChain),
    getActiveUser: vi.fn().mockReturnValue({
      id: 'admin-123',
      username: 'admin',
      email: 'admin@test.com',
    }),
  };

  const activityService = {
    success: vi.fn(),
    failed: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };

  const pubsub = {
    isConnected: vi.fn().mockReturnValue(true),
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn().mockReturnValue({}),
  };

  return {
    logger,
    keyStore,
    configManager,
    sessionManager,
    activityService,
    pubsub,
    clientDeviceInfoManager,
    flashChain,
  };
}

function createController(
  deps: ReturnType<typeof createMockDeps>
): AdminJwksController {
  return new (AdminJwksController as any)(
    deps.logger,
    deps.keyStore,
    deps.configManager,
    deps.sessionManager,
    deps.activityService,
    deps.pubsub,
    deps.clientDeviceInfoManager
  );
}

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-user-agent'),
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    render: vi.fn(),
    redirect: vi.fn(),
    locals: { userTheme: 'light' },
  } as unknown as Response;
  return res;
}

// ── Tests ──

describe('AdminJwksController', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminJwksController;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    controller = createController(deps);
  });

  describe('list()', () => {
    it('should render the keys list page with keys and stats', async () => {
      const keys = [
        createMockKey({ kid: 'key-1', status: 'active' }),
        createMockKey({
          kid: 'key-2',
          status: 'expiring',
          rotatedAt: new Date(),
        }),
        createMockKey({ kid: 'key-3', status: 'retired' }),
      ];
      deps.keyStore.listKeys.mockResolvedValue(keys);
      deps.keyStore.needsRotation.mockResolvedValue(false);

      const req = createMockReq();
      const res = createMockRes();

      await controller.list(req, res);

      expect(deps.keyStore.listKeys).toHaveBeenCalledWith('test-tenant');
      expect(deps.keyStore.needsRotation).toHaveBeenCalledWith('test-tenant');
      expect(res.render).toHaveBeenCalledWith(
        'admin/jwks/index',
        expect.objectContaining({
          title: 'JWKS Key Management',
          stats: {
            total: 3,
            active: 1,
            expiring: 1,
            retired: 1,
          },
          needsRotation: false,
          keyStoreConfig: expect.objectContaining({
            type: 'database',
            algorithms: ['RS256', 'ES256'],
          }),
        })
      );
    });

    it('should pass needsRotation flag when rotation is due', async () => {
      deps.keyStore.listKeys.mockResolvedValue([]);
      deps.keyStore.needsRotation.mockResolvedValue(true);

      const req = createMockReq();
      const res = createMockRes();

      await controller.list(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/jwks/index',
        expect.objectContaining({
          needsRotation: true,
        })
      );
    });

    it('should sort keys by createdAt descending', async () => {
      const older = createMockKey({
        kid: 'old',
        createdAt: new Date('2024-01-01'),
      });
      const newer = createMockKey({
        kid: 'new',
        createdAt: new Date('2025-06-01'),
      });
      deps.keyStore.listKeys.mockResolvedValue([older, newer]);

      const req = createMockReq();
      const res = createMockRes();

      await controller.list(req, res);

      const renderCall = (res.render as any).mock.calls[0];
      const renderedKeys = renderCall[1].keys;
      expect(renderedKeys[0].kid).toBe('new');
      expect(renderedKeys[1].kid).toBe('old');
    });

    it('should flash error and redirect on failure', async () => {
      deps.keyStore.listKeys.mockRejectedValue(new Error('DB error'));

      const req = createMockReq();
      const res = createMockRes();

      await controller.list(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Failed to load JWKS keys'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin');
    });
  });

  describe('show()', () => {
    it('should render key detail page with public key', async () => {
      const key = createMockKey({ kid: 'target-kid' });
      deps.keyStore.listKeys.mockResolvedValue([key]);

      const req = createMockReq({ params: { kid: 'target-kid' } });
      const res = createMockRes();

      await controller.show(req, res);

      expect(deps.keyStore.listKeys).toHaveBeenCalledWith('test-tenant');
      expect(res.render).toHaveBeenCalledWith(
        'admin/jwks/show',
        expect.objectContaining({
          key,
          publicJwk: JSON.stringify(key.publicKey, null, 2),
        })
      );
    });

    it('should flash error and redirect when key not found', async () => {
      deps.keyStore.listKeys.mockResolvedValue([]);

      const req = createMockReq({ params: { kid: 'nonexistent' } });
      const res = createMockRes();

      await controller.show(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith('Key not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });

    it('should flash error and redirect on failure', async () => {
      deps.keyStore.listKeys.mockRejectedValue(new Error('DB error'));

      const req = createMockReq({ params: { kid: 'any' } });
      const res = createMockRes();

      await controller.show(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Failed to load key details'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });
  });

  describe('rotate()', () => {
    it('should perform two-phase rotation: rotate, promote, publish, and log', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await controller.rotate(req, res);

      // Phase 1: rotate (generates unpromoted keys)
      expect(deps.keyStore.rotate).toHaveBeenCalledWith('test-tenant');
      // Phase 2: promote keys immediately (default delay=0)
      expect(deps.keyStore.promoteKeys).toHaveBeenCalledWith('test-tenant');
      // Retire old keys
      expect(deps.keyStore.retireExpiredKeys).toHaveBeenCalledWith(
        'test-tenant'
      );
      // Publish both rotation and promotion events
      // Channel format: {prefix}:{tenantId}:jwks:{phase}
      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:test-tenant:jwks:rotated',
        expect.objectContaining({
          timestamp: expect.any(Number),
          source: 'admin_panel',
        })
      );
      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        'parako:test-tenant:jwks:promoted',
        expect.objectContaining({
          timestamp: expect.any(Number),
          source: 'admin_panel',
        })
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'jwks_rotated_by_admin',
        'Admin manually rotated JWKS keys',
        null,
        expect.objectContaining({
          actor: expect.objectContaining({ actor_type: 'admin' }),
          target: expect.objectContaining({
            target_type: 'system',
            entity_name: 'jwks',
          }),
        })
      );
      expect(deps.flashChain.success).toHaveBeenCalledWith(
        'JWKS keys rotated successfully. New keys are now active.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });

    it('should run rotate → publish(rotated) → promote → publish(promoted) in order', async () => {
      const callOrder: string[] = [];
      deps.keyStore.rotate.mockImplementation(async () => {
        callOrder.push('rotate');
      });
      deps.keyStore.promoteKeys.mockImplementation(async () => {
        callOrder.push('promote');
        return 3;
      });
      deps.pubsub.publish.mockImplementation(async (_channel: string) => {
        callOrder.push(`publish:${_channel}`);
      });

      const req = createMockReq();
      const res = createMockRes();

      await controller.rotate(req, res);

      expect(callOrder).toEqual([
        'rotate',
        'publish:parako:test-tenant:jwks:rotated',
        'promote',
        'publish:parako:test-tenant:jwks:promoted',
      ]);
    });

    it('should skip pubsub when not connected', async () => {
      deps.pubsub.isConnected.mockReturnValue(false);

      const req = createMockReq();
      const res = createMockRes();

      await controller.rotate(req, res);

      expect(deps.pubsub.publish).not.toHaveBeenCalled();
      expect(deps.flashChain.success).toHaveBeenCalled();
    });

    it('should always run both phases synchronously (even with promotion_delay_ms > 0)', async () => {
      // Admin panel always runs immediate mode — BullMQ handles delayed promotion
      deps.configManager.getConfig.mockReturnValue({
        deployment: { redis_prefix: 'parako' },
        features: { multi_tenancy: { enabled: false } },
        security: {
          key_store: {
            type: 'database',
            algorithms: ['RS256'],
            rotation_interval_days: 90,
            overlap_window_seconds: 86400,
            promotion_delay_ms: 30000, // 30 seconds delay configured
          },
        },
      });

      const callOrder: string[] = [];
      deps.keyStore.rotate.mockImplementation(async () => {
        callOrder.push('rotate');
      });
      deps.keyStore.promoteKeys.mockImplementation(async () => {
        callOrder.push('promote');
        return 3;
      });
      deps.keyStore.retireExpiredKeys.mockImplementation(async () => {
        callOrder.push('retire');
        return 0;
      });

      const req = createMockReq();
      const res = createMockRes();

      await controller.rotate(req, res);

      // All three phases must run synchronously, regardless of promotion_delay_ms
      expect(callOrder).toEqual(['rotate', 'promote', 'retire']);
      expect(deps.flashChain.success).toHaveBeenCalled();
    });

    it('should flash error on rotation failure', async () => {
      deps.keyStore.rotate.mockRejectedValue(new Error('Rotation failed'));

      const req = createMockReq();
      const res = createMockRes();

      await controller.rotate(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Failed to rotate JWKS keys. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });
  });

  describe('retireExpired()', () => {
    it('should show success message with count when keys are retired', async () => {
      deps.keyStore.retireExpiredKeys.mockResolvedValue(3);

      const req = createMockReq();
      const res = createMockRes();

      await controller.retireExpired(req, res);

      expect(deps.keyStore.retireExpiredKeys).toHaveBeenCalledWith(
        'test-tenant'
      );
      expect(deps.activityService.success).toHaveBeenCalled();
      expect(deps.flashChain.success).toHaveBeenCalledWith(
        '3 expired key(s) have been retired.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });

    it('should show info message when no keys are retired', async () => {
      deps.keyStore.retireExpiredKeys.mockResolvedValue(0);

      const req = createMockReq();
      const res = createMockRes();

      await controller.retireExpired(req, res);

      expect(deps.flashChain.info).toHaveBeenCalledWith(
        'No keys are past the overlap window yet.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });

    it('should flash error on failure', async () => {
      deps.keyStore.retireExpiredKeys.mockRejectedValue(new Error('Failed'));

      const req = createMockReq();
      const res = createMockRes();

      await controller.retireExpired(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Failed to retire expired keys. Please try again.'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/jwks');
    });
  });
});
