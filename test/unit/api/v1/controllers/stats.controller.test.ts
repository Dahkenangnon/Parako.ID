import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { StatsController } from '../../../../../src/api/v1/controllers/stats.controller.js';
import type { StatsControllerDeps } from '../../../../../src/api/v1/controllers/stats.controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(): StatsControllerDeps {
  return {
    userService: {
      count: vi.fn().mockResolvedValue(0),
      findWithPagination: vi.fn().mockResolvedValue({ docs: [], totalDocs: 0 }),
    },
    oidcAdapter: {
      client: {
        countClients: vi.fn().mockResolvedValue(0),
        getClientStatistics: vi.fn().mockResolvedValue({}),
      },
      session: {
        getSessionStatistics: vi
          .fn()
          .mockResolvedValue({ active: 0, total: 0 }),
      },
      grant: {
        getGrantStatistics: vi.fn().mockResolvedValue({ active: 0, total: 0 }),
      },
    },
    activityService: {
      getActivityStats: vi.fn().mockResolvedValue({
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/controllers/StatsController', () => {
  let deps: StatsControllerDeps;
  let controller: StatsController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new StatsController(deps);
  });

  // -----------------------------------------------------------------------
  // overview
  // -----------------------------------------------------------------------
  describe('overview()', () => {
    it('should aggregate stats from all services', async () => {
      vi.mocked(deps.userService.count!).mockResolvedValue(150);
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(10);
      vi.mocked(deps.oidcAdapter.client.getClientStatistics).mockResolvedValue({
        active: 8,
      });
      vi.mocked(
        deps.oidcAdapter.session.getSessionStatistics!
      ).mockResolvedValue({ active: 25, total: 100 });
      vi.mocked(deps.oidcAdapter.grant.getGrantStatistics!).mockResolvedValue({
        active: 50,
        total: 200,
      });
      vi.mocked(deps.activityService.getActivityStats).mockResolvedValue({
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
      expect(jsonCall.data.clients).toEqual({ total: 10, active: 8 });
      expect(jsonCall.data.sessions).toEqual({ active: 25, total: 100 });
      expect(jsonCall.data.grants).toEqual({ active: 50, total: 200 });
      expect(jsonCall.data.activity).toEqual(
        expect.objectContaining({
          totalActivities: 5000,
          uniqueUsers: 100,
        })
      );
    });

    it('should handle individual section failures gracefully', async () => {
      vi.mocked(deps.userService.count!).mockRejectedValue(
        new Error('User DB down')
      );
      vi.mocked(deps.oidcAdapter.client.countClients).mockRejectedValue(
        new Error('Client DB down')
      );
      vi.mocked(
        deps.oidcAdapter.session.getSessionStatistics!
      ).mockRejectedValue(new Error('Session fail'));
      vi.mocked(deps.oidcAdapter.grant.getGrantStatistics!).mockRejectedValue(
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

    it('should handle missing optional methods on adapters', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout.userService as any).count;
      delete (depsWithout.oidcAdapter.session as any).getSessionStatistics;
      delete (depsWithout.oidcAdapter.grant as any).getGrantStatistics;
      const controllerWithout = new StatsController(depsWithout);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.overview(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.users).toEqual({ total: null });
      expect(jsonCall.data.sessions).toEqual({ available: false });
      expect(jsonCall.data.grants).toEqual({ available: false });
    });

    it('should call next(error) when the response itself throws', async () => {
      // All individual section try/catch blocks succeed, but the final
      // apiSuccess call throws — simulating e.g. a circular JSON error.
      vi.mocked(deps.userService.count!).mockResolvedValue(10);
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

  // -----------------------------------------------------------------------
  // health
  // -----------------------------------------------------------------------
  describe('health()', () => {
    it('should return healthy status when all checks pass', async () => {
      vi.mocked(deps.userService.count!).mockResolvedValue(100);
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
      vi.mocked(deps.userService.count!).mockRejectedValue(
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

    it('should fall back to findWithPagination when count is not available', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout.userService as any).count;
      const controllerWithout = new StatsController(depsWithout);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.health(req, res, next);

      expect(depsWithout.userService.findWithPagination).toHaveBeenCalledWith(
        {},
        { page: 1, limit: 1 }
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.checks.database.status).toBe('healthy');
    });

    it('should report unhealthy config when getConfig returns null', async () => {
      vi.mocked(deps.configManager.getConfig).mockReturnValue(null);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.health(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.status).toBe('degraded');
      expect(jsonCall.data.checks.config.status).toBe('unhealthy');
    });

    it('should report unknown database status when no probe method is available', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout.userService as any).count;
      delete (depsWithout.userService as any).findWithPagination;
      const controllerWithout = new StatsController(depsWithout);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.health(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.checks.database.status).toBe('unknown');
    });

    it('should call next(error) when the response itself throws', async () => {
      vi.mocked(deps.userService.count!).mockResolvedValue(100);
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
