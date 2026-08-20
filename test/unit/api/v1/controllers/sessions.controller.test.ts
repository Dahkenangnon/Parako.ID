import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { SessionsController } from '../../../../../src/api/v1/controllers/sessions.controller.js';
import type { SessionsControllerDeps } from '../../../../../src/api/v1/controllers/sessions.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';
import { encodeCursor } from '../../../../../src/api/v1/pagination.js';

// Helpers

function createMockDeps(): SessionsControllerDeps {
  return {
    oidcAdapter: {
      session: {
        findSessionById: vi.fn().mockResolvedValue(null),
        revokeSession: vi.fn().mockResolvedValue(false),
        countSessions: vi.fn().mockResolvedValue(0),
        findSessionsWithPagination: vi.fn().mockResolvedValue([]),
        deleteSessionsByAccountId: vi
          .fn()
          .mockResolvedValue({ deletedCount: 0 }),
        deleteSessionsByIds: vi.fn().mockResolvedValue({ deletedCount: 0 }),
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

// Sample data

const sampleSession = {
  _id: 'sess-abc-123',
  jti: 'sess-abc-123',
  accountId: '507f1f77bcf86cd799439011',
  clientId: 'test-client-001',
  exp: 1741348800,
  iat: 1741345200,
};

// Tests

describe('api/v1/controllers/SessionsController', () => {
  let deps: SessionsControllerDeps;
  let controller: SessionsController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new SessionsController(deps);
  });

  // list
  describe('list()', () => {
    it('should return a normalized paginated list of sessions', async () => {
      const sessions = [
        { _id: 'sess-abc-123', payload: { ...sampleSession } },
        {
          _id: 'sess-abc-456',
          payload: { ...sampleSession, jti: 'sess-abc-456' },
        },
      ];
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue(sessions);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenCalledWith(
        { 'payload.kind': 'Session' },
        'createdAt',
        -1,
        0,
        26
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
      expect(jsonCall.data[0]).toMatchObject({
        id: 'sess-abc-123',
        jti: 'sess-abc-123',
        accountId: sampleSession.accountId,
      });
      expect(jsonCall.pagination).toBeDefined();
      expect(jsonCall.pagination.has_more).toBe(false);
    });

    it('should filter by username when provided', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([]);

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mock.calls[0][0];
      expect(callArg).toHaveProperty('payload.accountId', 'janedoe');
    });

    it('should filter by client_id when provided', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([]);

      const req = createMockRequest({ query: { client_id: 'my-client' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mock.calls[0][0];
      expect(callArg).toHaveProperty('payload.clientId', 'my-client');
    });

    it('should filter by active status when provided', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([]);

      const req = createMockRequest({ query: { active: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mock.calls[0][0];
      expect(callArg).toEqual(
        expect.objectContaining({
          'payload.exp': { $gt: expect.any(Number) },
        })
      );

      await controller.list(
        createMockRequest({ query: { active: 'false' } }),
        createMockResponse(),
        createMockNext()
      );
      const inactiveFilter = vi
        .mocked(deps.oidcAdapter.session.findSessionsWithPagination)
        .mock.calls.at(-1)?.[0];
      expect(inactiveFilter).toEqual(
        expect.objectContaining({
          'payload.exp': { $lte: expect.any(Number) },
        })
      );
    });

    it('normalizes adapter rows without an identifier or payload JTI', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([
        { _id: '', payload: { accountId: 'anonymous-row' } },
        {
          _id: '',
          id: 'session-id',
          payload: { accountId: 'known-row', jti: '' },
        },
      ]);
      const res = createMockResponse();

      await controller.list(createMockRequest(), res, createMockNext());

      expect(vi.mocked(res.json).mock.calls[0]?.[0].data).toEqual([
        { accountId: 'anonymous-row' },
        { accountId: 'known-row', id: 'session-id', jti: 'session-id' },
      ]);
    });

    it('should include the filtered count when requested', async () => {
      vi.mocked(deps.oidcAdapter.session.countSessions).mockResolvedValue(7);
      const req = createMockRequest({ query: { include_count: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.oidcAdapter.session.countSessions).toHaveBeenCalledWith({
        'payload.kind': 'Session',
      });
      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.pagination.total_count).toBe(7);
    });

    it('should resume after the session identified by the cursor', async () => {
      const firstPage = [
        { _id: 'sess-1', payload: { ...sampleSession, jti: 'sess-1' } },
        { _id: 'sess-2', payload: { ...sampleSession, jti: 'sess-2' } },
      ];
      const resumedPage = [
        { _id: 'sess-3', payload: { ...sampleSession, jti: 'sess-3' } },
        { _id: 'sess-4', payload: { ...sampleSession, jti: 'sess-4' } },
      ];
      vi.mocked(deps.oidcAdapter.session.findSessionsWithPagination)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(resumedPage);

      const req = createMockRequest({
        query: { limit: '1', after: encodeCursor({ jti: 'sess-2' }) },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenNthCalledWith(
        1,
        { 'payload.kind': 'Session' },
        'createdAt',
        -1,
        0,
        100
      );
      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenNthCalledWith(
        2,
        { 'payload.kind': 'Session' },
        'createdAt',
        -1,
        2,
        2
      );

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(1);
      expect(jsonCall.data[0]).toMatchObject({ jti: 'sess-3' });
      expect(jsonCall.pagination.has_more).toBe(true);
    });

    it('should reject a cursor for a session outside the filtered result', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([]);

      const req = createMockRequest({
        query: { after: encodeCursor({ jti: 'missing-session' }) },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(422);
      expect(error.detail).toContain('does not identify a session');
    });

    it('rejects a cursor without either supported session identifier', async () => {
      const next = createMockNext();

      await controller.list(
        createMockRequest({
          query: { after: encodeCursor({ other: 'value' }) },
        }),
        createMockResponse(),
        next
      );

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ApiError;
      expect(error.detail).toContain('missing a session identifier');
    });

    it('scans bounded adapter pages and accepts the cursor id alias', async () => {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({
        _id: '',
        id: `session-${index}`,
        payload: { accountId: 'user-1' },
      }));
      vi.mocked(deps.oidcAdapter.session.findSessionsWithPagination)
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce([
          {
            _id: '',
            id: 'cursor-session',
            payload: { accountId: 'user-1' },
          },
        ])
        .mockResolvedValueOnce([]);

      await controller.list(
        createMockRequest({
          query: { after: encodeCursor({ id: 'cursor-session' }) },
        }),
        createMockResponse(),
        createMockNext()
      );

      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenNthCalledWith(
        2,
        { 'payload.kind': 'Session' },
        'createdAt',
        -1,
        100,
        100
      );
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('Adapter failure');
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // get
  describe('get()', () => {
    it('should return a session by jti', async () => {
      vi.mocked(deps.oidcAdapter.session.findSessionById).mockResolvedValue({
        _id: sampleSession.jti,
        payload: { ...sampleSession },
      });

      const req = createMockRequest({ params: { jti: 'sess-abc-123' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(deps.oidcAdapter.session.findSessionById).toHaveBeenCalledWith(
        'sess-abc-123'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.jti).toBe('sess-abc-123');
      expect(jsonCall.data.accountId).toBe('507f1f77bcf86cd799439011');
    });

    it('should call next with 404 ApiError when session is not found', async () => {
      vi.mocked(deps.oidcAdapter.session.findSessionById).mockResolvedValue(
        null
      );

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

  // revoke
  describe('revoke()', () => {
    it('should revoke the session and return 204', async () => {
      vi.mocked(deps.oidcAdapter.session.findSessionById).mockResolvedValue({
        _id: sampleSession.jti,
        payload: { ...sampleSession },
      });

      const req = createMockRequest({ params: { jti: 'sess-abc-123' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(deps.oidcAdapter.session.findSessionById).toHaveBeenCalledWith(
        'sess-abc-123'
      );
      expect(deps.oidcAdapter.session.revokeSession).toHaveBeenCalledWith(
        'sess-abc-123'
      );
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should log session revocation', async () => {
      vi.mocked(deps.oidcAdapter.session.findSessionById).mockResolvedValue({
        _id: sampleSession.jti,
        payload: { ...sampleSession },
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
      vi.mocked(deps.oidcAdapter.session.findSessionById).mockResolvedValue(
        null
      );

      const req = createMockRequest({ params: { jti: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(deps.oidcAdapter.session.revokeSession).not.toHaveBeenCalled();
    });
  });

  // bulkRevoke
  describe('bulkRevoke()', () => {
    it('should use the cross-adapter account deletion method for a username-only filter', async () => {
      vi.mocked(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).mockResolvedValue({ deletedCount: 5 });

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).toHaveBeenCalledWith('janedoe');
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.revoked_count).toBe(5);
    });

    it('should list and batch-delete sessions when both filters are provided', async () => {
      const sessions = [
        { _id: 'sess-1', payload: { ...sampleSession, jti: 'sess-1' } },
        { _id: 'sess-2', payload: { ...sampleSession, jti: 'sess-2' } },
      ];
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue(sessions);
      vi.mocked(deps.oidcAdapter.session.deleteSessionsByIds).mockResolvedValue(
        { deletedCount: 2 }
      );

      const req = createMockRequest({
        query: { username: 'janedoe', client_id: 'my-client' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenCalledWith(
        {
          'payload.kind': 'Session',
          'payload.accountId': 'janedoe',
          'payload.clientId': 'my-client',
        },
        'createdAt',
        -1,
        0,
        100
      );
      expect(deps.oidcAdapter.session.deleteSessionsByIds).toHaveBeenCalledWith(
        ['sess-1', 'sess-2']
      );
      expect(deps.oidcAdapter.session.revokeSession).not.toHaveBeenCalled();

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.revoked_count).toBe(2);
    });

    it('scans every bounded page before deleting filtered sessions', async () => {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({
        _id: '',
        id: `session-${index}`,
        payload: {},
      }));
      vi.mocked(deps.oidcAdapter.session.findSessionsWithPagination)
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce([{ _id: '', id: 'session-100', payload: {} }]);
      vi.mocked(deps.oidcAdapter.session.deleteSessionsByIds).mockResolvedValue(
        { deletedCount: 101 }
      );

      const res = createMockResponse();
      await controller.bulkRevoke(
        createMockRequest({ query: { client_id: 'client-a' } }),
        res,
        createMockNext()
      );

      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenNthCalledWith(
        2,
        {
          'payload.kind': 'Session',
          'payload.clientId': 'client-a',
        },
        'createdAt',
        -1,
        100,
        100
      );
      expect(deps.oidcAdapter.session.deleteSessionsByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['session-0', 'session-100'])
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should filter by client_id in bulk revoke', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([]);

      const req = createMockRequest({ query: { client_id: 'my-client' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      const callArg = vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mock.calls[0][0];
      expect(callArg).toHaveProperty('payload.clientId', 'my-client');

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.revoked_count).toBe(0);
    });

    it('honors both username and client_id instead of revoking every account session', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([
        { _id: 'matching-session', payload: { jti: 'matching-session' } },
      ]);
      vi.mocked(deps.oidcAdapter.session.deleteSessionsByIds).mockResolvedValue(
        { deletedCount: 1 }
      );

      const req = createMockRequest({
        query: { client_id: 'my-client', username: 'janedoe' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).not.toHaveBeenCalled();
      expect(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          'payload.accountId': 'janedoe',
          'payload.clientId': 'my-client',
        }),
        'createdAt',
        -1,
        0,
        100
      );
      expect(deps.oidcAdapter.session.deleteSessionsByIds).toHaveBeenCalledWith(
        ['matching-session']
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('skips malformed adapter rows without a session identifier', async () => {
      vi.mocked(
        deps.oidcAdapter.session.findSessionsWithPagination
      ).mockResolvedValue([
        { _id: '', payload: {} },
        { _id: '', id: null, jti: '', payload: {} },
        { _id: '', id: 123, payload: {} },
      ]);
      vi.mocked(deps.oidcAdapter.session.deleteSessionsByIds).mockResolvedValue(
        {
          deletedCount: 1,
        }
      );

      const res = createMockResponse();
      await controller.bulkRevoke(
        createMockRequest({ query: { client_id: 'my-client' } }),
        res,
        createMockNext()
      );

      expect(deps.oidcAdapter.session.deleteSessionsByIds).toHaveBeenCalledWith(
        ['123']
      );
      expect(vi.mocked(res.json).mock.calls[0][0].data.revoked_count).toBe(1);
    });

    it('should log bulk revocation', async () => {
      vi.mocked(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).mockResolvedValue({ deletedCount: 3 });

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
      vi.mocked(
        deps.oidcAdapter.session.deleteSessionsByAccountId
      ).mockRejectedValue(error);

      const req = createMockRequest({ query: { username: 'janedoe' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.bulkRevoke(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // DB abstraction
  describe('DB abstraction', () => {
    describe('bulkRevoke — JTI resolution', () => {
      it('should fall back to session.id when jti is absent (Prisma)', async () => {
        const sessions = [
          { _id: '', id: 'prisma-session-1', payload: {} },
          { _id: '', id: 'prisma-session-2', payload: {} },
        ];
        vi.mocked(
          deps.oidcAdapter.session.findSessionsWithPagination
        ).mockResolvedValue(sessions);
        vi.mocked(
          deps.oidcAdapter.session.deleteSessionsByIds
        ).mockResolvedValue({ deletedCount: 2 });

        const req = createMockRequest({
          query: { client_id: 'test-client' },
        });
        const res = createMockResponse();
        await controller.bulkRevoke(req, res, createMockNext());

        expect(
          deps.oidcAdapter.session.deleteSessionsByIds
        ).toHaveBeenCalledWith(['prisma-session-1', 'prisma-session-2']);
      });
    });
  });
});
