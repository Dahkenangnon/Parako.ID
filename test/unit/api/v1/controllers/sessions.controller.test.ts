import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { SessionsController } from '../../../../../src/api/v1/controllers/sessions.controller.js';
import type { SessionsControllerDeps } from '../../../../../src/api/v1/controllers/sessions.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(): SessionsControllerDeps {
  return {
    oidcAdapter: {
      session: {
        find: vi.fn().mockResolvedValue(null),
        destroy: vi.fn().mockResolvedValue(undefined),
        findAll: vi.fn().mockResolvedValue([]),
        revokeByAccountId: vi.fn().mockResolvedValue(0),
      },
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
    path: '/api/v1/sessions',
    apiAuth: {
      client_id: 'test-api-client',
      scope: 'parako:sessions:read parako:sessions:revoke',
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

const sampleSession = {
  _id: 'sess-abc-123',
  jti: 'sess-abc-123',
  accountId: '507f1f77bcf86cd799439011',
  clientId: 'test-client-001',
  exp: 1741348800,
  iat: 1741345200,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/controllers/SessionsController', () => {
  let deps: SessionsControllerDeps;
  let controller: SessionsController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new SessionsController(deps);
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  describe('list()', () => {
    it('should return a paginated list of sessions', async () => {
      const sessions = [
        { ...sampleSession },
        { ...sampleSession, _id: 'sess-abc-456', jti: 'sess-abc-456' },
      ];
      vi.mocked(deps.oidcAdapter.session.findAll!).mockResolvedValue(sessions);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.oidcAdapter.session.findAll).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
      expect(jsonCall.pagination).toBeDefined();
      expect(jsonCall.pagination.has_more).toBe(false);
    });

    it('should filter by username when provided', async () => {
      vi.mocked(deps.oidcAdapter.session.findAll!).mockResolvedValue([]);

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.oidcAdapter.session.findAll!).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('accountId', 'janedoe');
    });

    it('should filter by client_id when provided', async () => {
      vi.mocked(deps.oidcAdapter.session.findAll!).mockResolvedValue([]);

      const req = createMockRequest({ query: { client_id: 'my-client' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.oidcAdapter.session.findAll!).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('clientId', 'my-client');
    });

    it('should filter by active status when provided', async () => {
      vi.mocked(deps.oidcAdapter.session.findAll!).mockResolvedValue([]);

      const req = createMockRequest({ query: { active: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.oidcAdapter.session.findAll!).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('active', true);
    });

    it('should return empty array when findAll is not available', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout.oidcAdapter.session as any).findAll;
      const controllerWithout = new SessionsController(depsWithout);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.list(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual([]);
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Adapter failure');
      vi.mocked(deps.oidcAdapter.session.findAll!).mockRejectedValue(error);

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
    it('should return a session by jti', async () => {
      vi.mocked(deps.oidcAdapter.session.find).mockResolvedValue({
        ...sampleSession,
      });

      const req = createMockRequest({ params: { jti: 'sess-abc-123' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(deps.oidcAdapter.session.find).toHaveBeenCalledWith(
        'sess-abc-123'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.jti).toBe('sess-abc-123');
      expect(jsonCall.data.accountId).toBe('507f1f77bcf86cd799439011');
    });

    it('should call next with 404 ApiError when session is not found', async () => {
      vi.mocked(deps.oidcAdapter.session.find).mockResolvedValue(null);

      const req = createMockRequest({ params: { jti: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.detail).toContain('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // revoke
  // -----------------------------------------------------------------------
  describe('revoke()', () => {
    it('should revoke the session and return 204', async () => {
      vi.mocked(deps.oidcAdapter.session.find).mockResolvedValue({
        ...sampleSession,
      });

      const req = createMockRequest({ params: { jti: 'sess-abc-123' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(deps.oidcAdapter.session.find).toHaveBeenCalledWith(
        'sess-abc-123'
      );
      expect(deps.oidcAdapter.session.destroy).toHaveBeenCalledWith(
        'sess-abc-123'
      );
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should log session revocation', async () => {
      vi.mocked(deps.oidcAdapter.session.find).mockResolvedValue({
        ...sampleSession,
      });

      const req = createMockRequest({ params: { jti: 'sess-abc-123' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Session revoked via API',
        expect.objectContaining({ jti: 'sess-abc-123' })
      );
    });

    it('should call next with 404 when session is not found', async () => {
      vi.mocked(deps.oidcAdapter.session.find).mockResolvedValue(null);

      const req = createMockRequest({ params: { jti: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(deps.oidcAdapter.session.destroy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // bulkRevoke
  // -----------------------------------------------------------------------
  describe('bulkRevoke()', () => {
    it('should use revokeByAccountId when username is provided and method exists', async () => {
      vi.mocked(deps.oidcAdapter.session.revokeByAccountId!).mockResolvedValue(
        5
      );

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(deps.oidcAdapter.session.revokeByAccountId).toHaveBeenCalledWith(
        'janedoe'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.revoked_count).toBe(5);
    });

    it('should fall back to findAll + destroy loop when revokeByAccountId is not available', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout.oidcAdapter.session as any).revokeByAccountId;
      const controllerWithout = new SessionsController(depsWithout);

      const sessions = [
        { ...sampleSession, jti: 'sess-1' },
        { ...sampleSession, jti: 'sess-2' },
      ];
      vi.mocked(depsWithout.oidcAdapter.session.findAll!).mockResolvedValue(
        sessions
      );

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.bulkRevoke(req, res, next);

      expect(depsWithout.oidcAdapter.session.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'janedoe' })
      );
      expect(depsWithout.oidcAdapter.session.destroy).toHaveBeenCalledTimes(2);
      expect(depsWithout.oidcAdapter.session.destroy).toHaveBeenCalledWith(
        'sess-1'
      );
      expect(depsWithout.oidcAdapter.session.destroy).toHaveBeenCalledWith(
        'sess-2'
      );

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.revoked_count).toBe(2);
    });

    it('should filter by client_id in bulk revoke', async () => {
      const depsWithout = createMockDeps();
      delete (depsWithout.oidcAdapter.session as any).revokeByAccountId;
      const controllerWithout = new SessionsController(depsWithout);

      vi.mocked(depsWithout.oidcAdapter.session.findAll!).mockResolvedValue([]);

      const req = createMockRequest({ query: { client_id: 'my-client' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.bulkRevoke(req, res, next);

      const callArg = vi.mocked(depsWithout.oidcAdapter.session.findAll!).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('clientId', 'my-client');

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.revoked_count).toBe(0);
    });

    it('should log bulk revocation', async () => {
      vi.mocked(deps.oidcAdapter.session.revokeByAccountId!).mockResolvedValue(
        3
      );

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'Sessions bulk-revoked via API',
        expect.objectContaining({ count: 3 })
      );
    });

    it('should call next with 422 validation error when no filters are provided', async () => {
      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(422);
      expect(error.detail).toContain('filter');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Adapter failure');
      vi.mocked(deps.oidcAdapter.session.revokeByAccountId!).mockRejectedValue(
        error
      );

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // DB abstraction
  // -----------------------------------------------------------------------
  describe('DB abstraction', () => {
    describe('bulkRevoke — JTI resolution', () => {
      it('should fall back to session.id when jti is absent (Prisma)', async () => {
        const depsWithout = createMockDeps();
        delete (depsWithout.oidcAdapter.session as any).revokeByAccountId;
        const controllerWithout = new SessionsController(depsWithout);

        const sessions = [
          { id: 'prisma-session-1' },
          { id: 'prisma-session-2' },
        ];
        vi.mocked(depsWithout.oidcAdapter.session.findAll!).mockResolvedValue(
          sessions
        );

        const req = createMockRequest({
          query: { username: 'testuser' },
        });
        const res = createMockResponse();
        await controllerWithout.bulkRevoke(req, res, createMockNext());

        // Should have called destroy with session.id values
        expect(depsWithout.oidcAdapter.session.destroy).toHaveBeenCalledWith(
          'prisma-session-1'
        );
        expect(depsWithout.oidcAdapter.session.destroy).toHaveBeenCalledWith(
          'prisma-session-2'
        );
      });
    });
  });
});
