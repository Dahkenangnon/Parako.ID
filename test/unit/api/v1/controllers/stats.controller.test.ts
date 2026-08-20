import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { StatsController } from '../../../../../src/api/v1/controllers/stats.controller.js';
import type { StatsControllerDeps } from '../../../../../src/api/v1/controllers/stats.controller.js';

// Helpers

function createMockDeps(): StatsControllerDeps {
  return {
    userService: {
      countDocuments: vi.fn().mockResolvedValue(0),
    },
    oidcAdapter: {
      client: {
        countClients: vi.fn().mockResolvedValue(0),
        getClientStatistics: vi.fn().mockResolvedValue({
          total: 0,
          active: 0,
          inactive: 0,
          byType: { web: 0, native: 0, spa: 0 },
        }),
      },
      session: {
        getSessionStatistics: vi
          .fn()
          .mockResolvedValue({ active: 0, total: 0, expired: 0 }),
      },
      grant: {
        getGrantStatistics: vi.fn().mockResolvedValue({
          total: 0,
          recent: 0,
          expired: 0,
          byClient: [],
          byUser: [],
        }),
      },
    },
    activityService: {
      getActivityStats: vi.fn().mockResolvedValue({
        available: true,
        totalActivities: 0,
        uniqueUsers: 0,
        todayCount: 0,
        successfulLogins: 0,
        failedLogins: 0,
      }),
    },
    configManager: {
      getConfig: vi.fn().mockReturnValue({ app: { name: 'Parako.ID' } }),
    },
    logger: {
      error: vi.fn(),
    },
  };
}

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    path: '/api/v1/stats',
    apiAuth: { client_id: 'test-api-client', scope: 'parako:stats:read' },
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

// Tests

describe('api/v1/controllers/StatsController', () => {
  let deps: StatsControllerDeps;
  let controller: StatsController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new StatsController(deps);
  });

  // overview
  describe('overview()', () => {
    it('should aggregate stats from all services', async () => {
      vi.mocked(deps.userService.countDocuments).mockResolvedValue(150);
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(10);
      vi.mocked(deps.oidcAdapter.client.getClientStatistics).mockResolvedValue({
        total: 10,
        active: 8,
        inactive: 2,
        byType: { web: 7, native: 2, spa: 1 },
      });
      vi.mocked(
        deps.oidcAdapter.session.getSessionStatistics
      ).mockResolvedValue({ active: 25, total: 100, expired: 75 });
      vi.mocked(deps.oidcAdapter.grant.getGrantStatistics).mockResolvedValue({
        total: 200,
        recent: 50,
        expired: 150,
        byClient: [],
        byUser: [],
      });
      vi.mocked(deps.activityService.getActivityStats).mockResolvedValue({
        available: true,
        totalActivities: 5000,
        uniqueUsers: 100,
        todayCount: 75,
        successfulLogins: 4500,
        failedLogins: 500,
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.overview(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.users).toEqual({ total: 150 });
      expect(jsonCall.data.clients).toEqual({
        total: 10,
        active: 8,
        inactive: 2,
        byType: { web: 7, native: 2, spa: 1 },
      });
      expect(jsonCall.data.sessions).toEqual({
        active: 25,
        total: 100,
        expired: 75,
      });
      expect(jsonCall.data.grants).toEqual({
        total: 200,
        recent: 50,
        expired: 150,
        byClient: [],
        byUser: [],
      });
      expect(jsonCall.data.activity).toEqual(
        expect.objectContaining({
          totalActivities: 5000,
          uniqueUsers: 100,
        })
      );
    });

    it('should use one authoritative client statistics snapshot', async () => {
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(10);
      vi.mocked(deps.oidcAdapter.client.getClientStatistics).mockResolvedValue({
        total: 11,
        active: 8,
        inactive: 3,
        byType: { web: 8, native: 2, spa: 1 },
      });

      const res = createMockResponse();

      await controller.overview(createMockRequest(), res, createMockNext());

      expect(deps.oidcAdapter.client.countClients).not.toHaveBeenCalled();
      expect(vi.mocked(res.json).mock.calls[0][0].data.clients).toEqual({
        total: 11,
        active: 8,
        inactive: 3,
        byType: { web: 8, native: 2, spa: 1 },
      });
    });

    it('should handle individual section failures gracefully', async () => {
      vi.mocked(deps.userService.countDocuments).mockRejectedValue(
        new Error('User DB down')
      );
      vi.mocked(deps.oidcAdapter.client.getClientStatistics).mockRejectedValue(
        new Error('Client DB down')
      );
      vi.mocked(
        deps.oidcAdapter.session.getSessionStatistics
      ).mockRejectedValue(new Error('Session fail'));
      vi.mocked(deps.oidcAdapter.grant.getGrantStatistics).mockRejectedValue(
        new Error('Grant fail')
      );
      vi.mocked(deps.activityService.getActivityStats).mockRejectedValue(
        new Error('Activity fail')
      );

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.overview(req, res, next);

      // Should still return 200 — individual sections report errors
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.users).toHaveProperty('error');
      expect(jsonCall.data.clients).toHaveProperty('error');
      expect(jsonCall.data.sessions).toHaveProperty('error');
      expect(jsonCall.data.grants).toHaveProperty('error');
      expect(jsonCall.data.activity).toHaveProperty('error');

      // Should have logged all errors
      expect(deps.logger.error).toHaveBeenCalledTimes(5);
    });

    it('should call next(error) when the response itself throws', async () => {
      // All individual section try/catch blocks succeed, but the final
      // apiSuccess call throws — simulating e.g. a circular JSON error.
      vi.mocked(deps.userService.countDocuments).mockResolvedValue(10);
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(5);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      const serializationError = new Error('Cannot serialize');
      vi.mocked(res.json).mockImplementation(() => {
        throw serializationError;
      });

      await controller.overview(req, res, next);

      expect(next).toHaveBeenCalledWith(serializationError);
    });
  });

  // health
  describe('health()', () => {
    it('should return healthy status when all checks pass', async () => {
      vi.mocked(deps.userService.countDocuments).mockResolvedValue(100);
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(5);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.health(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.status).toBe('healthy');
      expect(jsonCall.data.checks.database.status).toBe('healthy');
      expect(jsonCall.data.checks.oidc.status).toBe('healthy');
      expect(jsonCall.data.checks.config.status).toBe('healthy');
      expect(jsonCall.data.timestamp).toBeDefined();
    });

    it('should return degraded status with 503 when a check fails', async () => {
      vi.mocked(deps.userService.countDocuments).mockRejectedValue(
        new Error('DB down')
      );

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.health(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.status).toBe('degraded');
      expect(jsonCall.data.checks.database.status).toBe('unhealthy');
      expect(jsonCall.data.checks.database.message).toContain(
        'Database connection failed'
      );
    });

    it('should report an unhealthy OIDC adapter when its probe fails', async () => {
      const oidcError = new Error('OIDC adapter down');
      vi.mocked(deps.oidcAdapter.client.countClients).mockRejectedValue(
        oidcError
      );
      const res = createMockResponse();

      await controller.health(createMockRequest(), res, createMockNext());

      expect(res.status).toHaveBeenCalledWith(503);
      expect(vi.mocked(res.json).mock.calls[0][0].data.checks.oidc).toEqual({
        status: 'unhealthy',
        message: 'OIDC adapter connection failed',
      });
      expect(deps.logger.error).toHaveBeenCalledWith(oidcError, {
        check: 'oidc',
      });
    });

    it('uses the repository-neutral countDocuments capability', async () => {
      await controller.health(
        createMockRequest(),
        createMockResponse(),
        createMockNext()
      );

      expect(deps.userService.countDocuments).toHaveBeenCalledWith();
    });

    it('should report unhealthy config when getConfig returns null', async () => {
      vi.mocked(deps.configManager.getConfig).mockReturnValue(null as never);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.health(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.status).toBe('degraded');
      expect(jsonCall.data.checks.config.status).toBe('unhealthy');
    });

    it('should report an unhealthy config check when loading throws', async () => {
      const configError = new Error('Configuration unavailable');
      vi.mocked(deps.configManager.getConfig).mockImplementation(() => {
        throw configError;
      });
      const res = createMockResponse();

      await controller.health(createMockRequest(), res, createMockNext());

      expect(res.status).toHaveBeenCalledWith(503);
      expect(vi.mocked(res.json).mock.calls[0][0].data.checks.config).toEqual({
        status: 'unhealthy',
        message: 'Configuration check failed',
      });
      expect(deps.logger.error).toHaveBeenCalledWith(configError, {
        check: 'config',
      });
    });

    it('should call next(error) when the response itself throws', async () => {
      vi.mocked(deps.userService.countDocuments).mockResolvedValue(100);
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(5);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      const serializationError = new Error('Cannot serialize');
      vi.mocked(res.json).mockImplementation(() => {
        throw serializationError;
      });

      await controller.health(req, res, next);

      expect(next).toHaveBeenCalledWith(serializationError);
    });
  });
});
