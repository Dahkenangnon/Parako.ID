import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { AuditController } from '../../../../../src/api/v1/controllers/audit.controller.js';
import type { AuditControllerDeps } from '../../../../../src/api/v1/controllers/audit.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';

// Helpers

function createMockDeps(): AuditControllerDeps {
  return {
    activityService: {
      queryActivities: vi.fn().mockResolvedValue({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      }),
      findOne: vi.fn().mockResolvedValue(null),
      getActivityTypes: vi.fn().mockResolvedValue([]),
      getActivityStats: vi.fn().mockResolvedValue({
        totalActivities: 0,
        uniqueUsers: 0,
        todayCount: 0,
        successfulLogins: 0,
        failedLogins: 0,
      }),
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
    path: '/api/v1/audit',
    apiAuth: {
      client_id: 'test-api-client',
      scope: 'parako:audit:read parako:stats:read',
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

// Sample data

const sampleActivity = {
  _id: '507f1f77bcf86cd799439011',
  type: 'login',
  status: 'success',
  description: 'User logged in successfully',
  username: 'janedoe',
  timestamp: new Date('2026-03-07T10:00:00Z'),
  ip_address: '192.168.1.1',
  client_id: 'test-client-001',
};

const sampleActivity2 = {
  _id: '507f1f77bcf86cd799439012',
  type: 'password_change',
  status: 'success',
  description: 'User changed password',
  username: 'johndoe',
  timestamp: new Date('2026-03-07T11:00:00Z'),
  ip_address: '10.0.0.1',
};

// Tests

describe('api/v1/controllers/AuditController', () => {
  let deps: AuditControllerDeps;
  let controller: AuditController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new AuditController(deps);
  });

  // list
  describe('list()', () => {
    it('should return a paginated list of audit entries', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [{ ...sampleActivity }, { ...sampleActivity2 }],
        totalResults: 2,
        totalPages: 1,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.activityService.queryActivities).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
      expect(jsonCall.pagination).toBeDefined();
      expect(jsonCall.pagination.has_more).toBe(false);
    });

    it('should filter by type when provided', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({ query: { type: 'login' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.activityService.queryActivities).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('type', 'login');
    });

    it('should filter by status when provided', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({ query: { status: 'failed' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.activityService.queryActivities).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('status', 'failed');
    });

    it('should filter by username when provided', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.activityService.queryActivities).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('actor.username', 'janedoe');
    });

    it('should filter by client_id when provided', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({
        query: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.activityService.queryActivities).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('client_id', 'test-client-001');
    });

    it('should build date range filter when from and to are provided', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({
        query: {
          from: '2026-03-01T00:00:00Z',
          to: '2026-03-07T23:59:59Z',
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.activityService.queryActivities).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('timestamp');
      const range = callArg.timestamp as Record<string, unknown>;
      expect(range.$gte).toBeInstanceOf(Date);
      expect(range.$lte).toBeInstanceOf(Date);
    });

    it('should include total_count when include_count=true', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 42,
        totalPages: 2,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({ query: { include_count: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.pagination.total_count).toBe(42);
    });

    it('should not include total_count when include_count is not set', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: [],
        totalResults: 42,
        totalPages: 2,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.pagination.total_count).toBeUndefined();
    });

    it('should return an empty page when the service omits its results array', async () => {
      vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
        results: undefined as unknown as any[],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 25,
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: [],
        pagination: { has_more: false, next_cursor: null },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('DB connection lost');
      vi.mocked(deps.activityService.queryActivities).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // get
  describe('get()', () => {
    it('should return a single audit entry by ID', async () => {
      vi.mocked(deps.activityService.findOne).mockResolvedValue({
        ...sampleActivity,
      });

      const req = createMockRequest({
        params: { id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(deps.activityService.findOne).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.type).toBe('login');
      expect(jsonCall.data.username).toBe('janedoe');
    });

    it('should call next with 404 ApiError when entry is not found', async () => {
      vi.mocked(deps.activityService.findOne).mockResolvedValue(null);

      const req = createMockRequest({ params: { id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.detail).toContain('nonexistent');
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Query failed');
      vi.mocked(deps.activityService.findOne).mockRejectedValue(error);

      const req = createMockRequest({
        params: { id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // types
  describe('types()', () => {
    it('should return all distinct activity types', async () => {
      const activityTypes = ['login', 'logout', 'password_change', 'mfa_setup'];
      vi.mocked(deps.activityService.getActivityTypes).mockResolvedValue(
        activityTypes
      );

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.types(req, res, next);

      expect(deps.activityService.getActivityTypes).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual(activityTypes);
      expect(jsonCall.data).toHaveLength(4);
    });

    it('should return empty array when no types exist', async () => {
      vi.mocked(deps.activityService.getActivityTypes).mockResolvedValue([]);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.types(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual([]);
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Query failed');
      vi.mocked(deps.activityService.getActivityTypes).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.types(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // stats
  describe('stats()', () => {
    it('should return aggregate activity statistics', async () => {
      const activityStats = {
        totalActivities: 1500,
        uniqueUsers: 120,
        todayCount: 45,
        successfulLogins: 1200,
        failedLogins: 300,
      };
      vi.mocked(deps.activityService.getActivityStats).mockResolvedValue(
        activityStats
      );

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.stats(req, res, next);

      expect(deps.activityService.getActivityStats).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual(activityStats);
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Stats calculation failed');
      vi.mocked(deps.activityService.getActivityStats).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.stats(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // DB abstraction
  describe('DB abstraction', () => {
    describe('date range filtering', () => {
      it('should pass the shared repository timestamp contract with from/to', async () => {
        const req = createMockRequest({
          query: { from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z' },
        });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const filter = vi.mocked(deps.activityService.queryActivities).mock
          .calls[0][0];
        expect(filter.timestamp).toBeDefined();
        expect((filter.timestamp as any).$gte).toEqual(
          new Date('2026-01-01T00:00:00Z')
        );
        expect((filter.timestamp as any).$lte).toEqual(
          new Date('2026-12-31T23:59:59Z')
        );
        expect(filter.timestampRange).toBeUndefined();
      });

      it('should pass only timestamp.$gte when only "from" query param given', async () => {
        const req = createMockRequest({
          query: { from: '2026-01-01T00:00:00Z' },
        });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const filter = vi.mocked(deps.activityService.queryActivities).mock
          .calls[0][0];
        expect(filter.timestamp).toBeDefined();
        expect((filter.timestamp as any).$gte).toEqual(
          new Date('2026-01-01T00:00:00Z')
        );
        expect((filter.timestamp as any).$lte).toBeUndefined();
      });

      it('should pass only timestamp.$lte when only "to" query param given', async () => {
        const req = createMockRequest({
          query: { to: '2026-12-31T23:59:59Z' },
        });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const filter = vi.mocked(deps.activityService.queryActivities).mock
          .calls[0][0];
        expect(filter.timestamp).toBeDefined();
        expect((filter.timestamp as any).$gte).toBeUndefined();
        expect((filter.timestamp as any).$lte).toEqual(
          new Date('2026-12-31T23:59:59Z')
        );
      });

      it('should omit timestamp when no date params provided', async () => {
        const req = createMockRequest({ query: {} });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const filter = vi.mocked(deps.activityService.queryActivities).mock
          .calls[0][0];
        expect(filter.timestamp).toBeUndefined();
      });
    });

    describe('list — cursor field', () => {
      it('should pass "id" as cursor field (not "_id")', async () => {
        const activities = [
          { id: 'a1', type: 'login' },
          { id: 'a2', type: 'logout' },
          { id: 'a3', type: 'login' },
          { id: 'a4', type: 'logout' },
        ];
        vi.mocked(deps.activityService.queryActivities).mockResolvedValue({
          results: activities,
          totalResults: 4,
          totalPages: 1,
          page: 1,
          limit: 3,
        });
        const req = createMockRequest({ query: { limit: '3' } });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        // When has_more is true, cursor should use 'id' key
        expect(body.pagination.has_more).toBe(true);
        const decoded = JSON.parse(
          Buffer.from(
            body.pagination.next_cursor.replace(/-/g, '+').replace(/_/g, '/'),
            'base64'
          ).toString()
        );
        expect(decoded.id).toBeDefined();
      });
    });
  });
});
