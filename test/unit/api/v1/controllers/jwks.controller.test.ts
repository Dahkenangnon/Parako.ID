import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { JwksController } from '../../../../../src/api/v1/controllers/jwks.controller.js';
import type { JwksControllerDeps } from '../../../../../src/api/v1/controllers/jwks.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(): JwksControllerDeps {
  return {
    keyStore: {
      listKeys: vi.fn().mockResolvedValue([]),
      rotate: vi.fn().mockResolvedValue(undefined),
      promoteKeys: vi.fn().mockResolvedValue(0),
      retireExpiredKeys: vi.fn().mockResolvedValue(0),
    },
    getTenantId: vi.fn().mockReturnValue('default'),
    redisPubSub: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
  };
}

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    path: '/api/v1/jwks',
    apiAuth: {
      client_id: 'test-api-client',
      scope: 'parako:jwks:read parako:jwks:rotate',
    },
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleKey = {
  kid: 'key-001',
  alg: 'RS256',
  use: 'sig',
  status: 'active',
  promoted: true,
  privateKey: { kty: 'RSA', n: 'private-n' } as JsonWebKey,
  publicKey: { kty: 'RSA', n: 'public-n' } as JsonWebKey,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  rotatedAt: new Date('2026-02-01T00:00:00Z'),
  tenantId: 'default',
};

const sampleExpiringKey = {
  ...sampleKey,
  kid: 'key-002',
  status: 'expiring',
  promoted: false,
  createdAt: new Date('2025-12-01T00:00:00Z'),
};

const sampleRetiredKey = {
  ...sampleKey,
  kid: 'key-003',
  status: 'retired',
  promoted: false,
  createdAt: new Date('2025-11-01T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/controllers/JwksController', () => {
  let deps: JwksControllerDeps;
  let controller: JwksController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new JwksController(deps);
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  describe('list()', () => {
    it('should return all keys with public data only', async () => {
      const keys = [{ ...sampleKey }, { ...sampleExpiringKey }];
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue(keys);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.keyStore.listKeys).toHaveBeenCalledWith('default');
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);

      // Must NOT expose private keys
      for (const key of jsonCall.data) {
        expect(key).not.toHaveProperty('privateKey');
        expect(key).toHaveProperty('publicKey');
        expect(key).toHaveProperty('kid');
        expect(key).toHaveProperty('alg');
        expect(key).toHaveProperty('status');
      }
    });

    it('should filter keys by status when query parameter is provided', async () => {
      const keys = [
        { ...sampleKey },
        { ...sampleExpiringKey },
        { ...sampleRetiredKey },
      ];
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue(keys);

      const req = createMockRequest({ query: { status: 'active' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(1);
      expect(jsonCall.data[0].kid).toBe('key-001');
      expect(jsonCall.data[0].status).toBe('active');
    });

    it('should return empty array when no keys match the status filter', async () => {
      const keys = [{ ...sampleKey }];
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue(keys);

      const req = createMockRequest({ query: { status: 'retired' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(0);
    });

    it('should use the tenant ID from getTenantId()', async () => {
      vi.mocked(deps.getTenantId).mockReturnValue('tenant-abc');
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([]);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.keyStore.listKeys).toHaveBeenCalledWith('tenant-abc');
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Key store unavailable');
      vi.mocked(deps.keyStore.listKeys).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------
  describe('get()', () => {
    it('should return a single key by kid with public data only', async () => {
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([{ ...sampleKey }]);

      const req = createMockRequest({ params: { kid: 'key-001' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.kid).toBe('key-001');
      expect(jsonCall.data.alg).toBe('RS256');
      expect(jsonCall.data).not.toHaveProperty('privateKey');
      expect(jsonCall.data).toHaveProperty('publicKey');
    });

    it('should call next with 404 ApiError when kid is not found', async () => {
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([{ ...sampleKey }]);

      const req = createMockRequest({ params: { kid: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.detail).toContain('nonexistent');
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Key store unavailable');
      vi.mocked(deps.keyStore.listKeys).mockRejectedValue(error);

      const req = createMockRequest({ params: { kid: 'key-001' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // rotate
  // -----------------------------------------------------------------------
  describe('rotate()', () => {
    it('should rotate keys, promote them, and return success with promoted count', async () => {
      vi.mocked(deps.keyStore.promoteKeys).mockResolvedValue(2);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.rotate(req, res, next);

      expect(deps.keyStore.rotate).toHaveBeenCalledWith('default');
      expect(deps.keyStore.promoteKeys).toHaveBeenCalledWith('default');
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.message).toBe('Keys rotated successfully');
      expect(jsonCall.data.promoted).toBe(2);
    });

    it('should log the rotation event', async () => {
      vi.mocked(deps.keyStore.promoteKeys).mockResolvedValue(1);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.rotate(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'JWKS keys rotated via API',
        expect.objectContaining({ tenantId: 'default', promoted: 1 })
      );
    });

    it('should publish a Redis event when redisPubSub is available', async () => {
      vi.mocked(deps.keyStore.promoteKeys).mockResolvedValue(1);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.rotate(req, res, next);

      expect(deps.redisPubSub!.publish).toHaveBeenCalledWith(
        'jwks:rotated',
        expect.stringContaining('"tenantId":"default"')
      );
    });

    it('should succeed even when redisPubSub is not available', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout as any).redisPubSub;
      const controllerWithout = new JwksController(depsWithout);

      vi.mocked(depsWithout.keyStore.promoteKeys).mockResolvedValue(0);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.rotate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Rotation failed');
      vi.mocked(deps.keyStore.rotate).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.rotate(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // retireExpired
  // -----------------------------------------------------------------------
  describe('retireExpired()', () => {
    it('should retire expired keys and return the count', async () => {
      vi.mocked(deps.keyStore.retireExpiredKeys).mockResolvedValue(3);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retireExpired(req, res, next);

      expect(deps.keyStore.retireExpiredKeys).toHaveBeenCalledWith('default');
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.message).toBe('Expired keys retired');
      expect(jsonCall.data.retired).toBe(3);
    });

    it('should log the retirement event', async () => {
      vi.mocked(deps.keyStore.retireExpiredKeys).mockResolvedValue(2);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retireExpired(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Expired JWKS keys retired via API',
        expect.objectContaining({ tenantId: 'default', retired: 2 })
      );
    });

    it('should return 0 when no keys are expired', async () => {
      vi.mocked(deps.keyStore.retireExpiredKeys).mockResolvedValue(0);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retireExpired(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.retired).toBe(0);
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Retirement failed');
      vi.mocked(deps.keyStore.retireExpiredKeys).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retireExpired(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // retire
  // -----------------------------------------------------------------------
  describe('retire()', () => {
    it('should verify the key exists and return 202 accepted for an active key', async () => {
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([{ ...sampleKey }]);

      const req = createMockRequest({ params: { kid: 'key-001' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retire(req, res, next);

      expect(res.status).toHaveBeenCalledWith(202);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.kid).toBe('key-001');
      expect(jsonCall.data.current_status).toBe('active');
    });

    it('should log the retirement request', async () => {
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([{ ...sampleKey }]);

      const req = createMockRequest({ params: { kid: 'key-001' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retire(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Key marked for retirement via API',
        expect.objectContaining({ kid: 'key-001', currentStatus: 'active' })
      );
    });

    it('should call next with 404 ApiError when kid is not found', async () => {
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([{ ...sampleKey }]);

      const req = createMockRequest({ params: { kid: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retire(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.detail).toContain('nonexistent');
    });

    it('should call next with 409 ApiError when key is already retired', async () => {
      vi.mocked(deps.keyStore.listKeys).mockResolvedValue([
        { ...sampleRetiredKey },
      ]);

      const req = createMockRequest({ params: { kid: 'key-003' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retire(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(409);
      expect(error.detail).toContain('already retired');
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Key store unavailable');
      vi.mocked(deps.keyStore.listKeys).mockRejectedValue(error);

      const req = createMockRequest({ params: { kid: 'key-001' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.retire(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
