import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Mock ua-parser-js
vi.mock('ua-parser-js', () => ({
  UAParser: vi.fn().mockImplementation(() => ({
    getResult: () => ({
      browser: { name: 'Chrome' },
      os: { name: 'Linux' },
      device: { type: 'desktop' },
    }),
  })),
}));

// Mock tenant context
vi.mock('../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    getTenantId: vi.fn().mockReturnValue('test-tenant'),
  },
}));

// Import after mocks
import { AdminSessionsController } from '../../../../src/controllers/admin/session.controller.js';

// ── Test Helpers ──

function createMockDeps() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const oidcSession = {
    countSessions: vi.fn().mockResolvedValue(0),
    findSessionsWithPagination: vi.fn().mockResolvedValue([]),
    findSessionById: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn().mockResolvedValue(false),
    findByAccountId: vi.fn().mockResolvedValue([]),
    getSessionStatistics: vi
      .fn()
      .mockResolvedValue({ total: 0, active: 0, expired: 0 }),
    getDistinctValues: vi.fn().mockResolvedValue([]),
  };

  const oidcAdapter = {
    session: oidcSession,
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
    findAllExpressSessions: vi.fn().mockResolvedValue([]),
    countAllExpressSessions: vi.fn().mockResolvedValue(0),
    revokeExpressSession: vi.fn().mockResolvedValue(false),
    revokeAllSessionsForUser: vi.fn().mockResolvedValue(0),
  };

  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn().mockReturnValue({}),
  };

  const oidcUtils = {
    processSessionData: vi.fn().mockResolvedValue({
      id: 'oidc-session-1',
      accountId: 'testuser',
      userInfo: {
        username: 'testuser',
        email: 'test@example.com',
        full_name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
      },
      device: 'Chrome on Linux',
      ip: '127.0.0.1',
      location: 'Online',
      startTime: 'Jan 1, 2025',
      lastActive: '1h ago',
      loginTimestamp: 1704067200,
      sessionAge: '1h ago',
      expiresIn: '23h',
      expiresAt: new Date('2025-01-02'),
      isExpired: false,
      status: 'active',
      clients: [],
      amr: [],
      acr: '',
      user_agent: 'Mozilla/5.0',
    }),
  };

  const activityService = {
    success: vi.fn(),
    failed: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    findActivitiesAroundTime: vi.fn().mockResolvedValue([]),
  };

  const pubsub = {
    isConnected: vi.fn().mockReturnValue(true),
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      deployment: { redis_prefix: 'parako' },
    }),
  };

  return {
    logger,
    oidcAdapter,
    sessionManager,
    clientDeviceInfoManager,
    oidcUtils,
    activityService,
    pubsub,
    configManager,
    flashChain,
    oidcSession,
  };
}

function createController(
  deps: ReturnType<typeof createMockDeps>
): AdminSessionsController {
  return new (AdminSessionsController as any)(
    deps.logger,
    deps.oidcAdapter,
    deps.sessionManager,
    deps.clientDeviceInfoManager,
    deps.oidcUtils,
    deps.activityService,
    deps.pubsub,
    deps.configManager
  );
}

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-user-agent'),
    sessionID: 'current-session-id',
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    render: vi.fn(),
    redirect: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    locals: { userTheme: 'light' },
  } as unknown as Response;
  return res;
}

function createMockExpressSession(overrides: Record<string, any> = {}): any {
  return {
    _id: 'express-sess-1',
    session: {
      accountId: 'testuser',
      isAuthenticated: true,
      authTime: new Date('2025-01-01T12:00:00Z').toISOString(),
      lastActivity: new Date('2025-01-01T13:00:00Z').toISOString(),
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120',
      ipAddress: '192.168.1.1',
      _metadata: {
        browser: { name: 'Chrome' },
        os: { name: 'Linux' },
        createdIp: '192.168.1.1',
      },
      ...overrides.session,
    },
    ...overrides,
  };
}

// ── Tests ──

describe('AdminSessionsController', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    controller = createController(deps);
  });

  describe('list()', () => {
    it('should render sessions page with both OIDC and Express sessions', async () => {
      const req = createMockReq();
      const res = createMockRes();

      deps.oidcSession.countSessions.mockResolvedValue(1);
      deps.oidcSession.findSessionsWithPagination.mockResolvedValue([
        { payload: { kind: 'Session', accountId: 'testuser' } },
      ]);
      deps.sessionManager.findAllExpressSessions.mockResolvedValue([
        createMockExpressSession(),
      ]);
      deps.sessionManager.countAllExpressSessions.mockResolvedValue(1);

      await controller.list(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/sessions/index',
        expect.objectContaining({
          title: 'User Sessions',
          sessions: expect.any(Array),
          expressSessions: expect.any(Array),
          pagination: expect.objectContaining({
            totalSessions: 1,
          }),
          expressPagination: expect.objectContaining({
            totalSessions: 1,
          }),
        })
      );
    });

    it('should mark OIDC sessions with sessionType "oidc"', async () => {
      const req = createMockReq();
      const res = createMockRes();

      deps.oidcSession.countSessions.mockResolvedValue(1);
      deps.oidcSession.findSessionsWithPagination.mockResolvedValue([
        { payload: { kind: 'Session', accountId: 'testuser' } },
      ]);

      await controller.list(req, res);

      const renderArgs = (res.render as any).mock.calls[0][1];
      expect(renderArgs.sessions[0].sessionType).toBe('oidc');
    });

    it('should pass Express pagination with separate query params', async () => {
      const req = createMockReq({
        query: { expressPage: '2', expressLimit: '10' },
      });
      const res = createMockRes();

      deps.sessionManager.countAllExpressSessions.mockResolvedValue(25);

      await controller.list(req, res);

      expect(deps.sessionManager.findAllExpressSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 10,
        })
      );

      const renderArgs = (res.render as any).mock.calls[0][1];
      expect(renderArgs.expressPagination.page).toBe(2);
      expect(renderArgs.expressPagination.totalPages).toBe(3);
    });

    it('should render empty state when no sessions exist', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await controller.list(req, res);

      const renderArgs = (res.render as any).mock.calls[0][1];
      expect(renderArgs.sessions).toEqual([]);
      expect(renderArgs.expressSessions).toEqual([]);
      expect(renderArgs.pagination.totalSessions).toBe(0);
      expect(renderArgs.expressPagination.totalSessions).toBe(0);
    });

    it('should apply search filter to Express sessions', async () => {
      const req = createMockReq({ query: { search: 'testuser' } });
      const res = createMockRes();

      await controller.list(req, res);

      expect(deps.sessionManager.findAllExpressSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'testuser',
        })
      );
    });

    it('should redirect to /admin on error', async () => {
      const req = createMockReq();
      const res = createMockRes();

      deps.oidcSession.countSessions.mockRejectedValue(new Error('DB error'));

      await controller.list(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Failed to load user sessions'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin');
    });
  });

  describe('show()', () => {
    it('should render OIDC session details by default', async () => {
      const req = createMockReq({ params: { id: 'oidc-session-1' } });
      const res = createMockRes();

      deps.oidcSession.findSessionById.mockResolvedValue({
        payload: {
          jti: 'oidc-session-1',
          accountId: 'testuser',
          authorizations: {},
        },
        created_at: new Date(),
        updated_at: new Date(),
      });

      await controller.show(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/sessions/show',
        expect.objectContaining({
          title: 'Session details',
          session: expect.objectContaining({
            sessionType: 'oidc',
          }),
        })
      );
    });

    it('should render Express session details when type=express', async () => {
      const req = createMockReq({
        params: { id: 'express-sess-1' },
        query: { type: 'express' },
      });
      const res = createMockRes();

      deps.sessionManager.findAllExpressSessions.mockResolvedValue([
        createMockExpressSession(),
      ]);

      await controller.show(req, res);

      expect(res.render).toHaveBeenCalledWith(
        'admin/sessions/show',
        expect.objectContaining({
          session: expect.objectContaining({
            sessionType: 'express',
            id: 'express-sess-1',
          }),
        })
      );
    });

    it('should redirect when Express session not found', async () => {
      const req = createMockReq({
        params: { id: 'nonexistent' },
        query: { type: 'express' },
      });
      const res = createMockRes();

      deps.sessionManager.findAllExpressSessions.mockResolvedValue([]);

      await controller.show(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith('Session not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/sessions');
    });

    it('should redirect when OIDC session not found', async () => {
      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();

      deps.oidcSession.findSessionById.mockResolvedValue(null);

      await controller.show(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith('Session not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/sessions');
    });
  });

  describe('revokeSession()', () => {
    it('should revoke OIDC session by default', async () => {
      const req = createMockReq({
        params: { id: 'oidc-session-1' },
        body: {},
      });
      const res = createMockRes();

      deps.oidcSession.findSessionById.mockResolvedValue({
        payload: { accountId: 'testuser' },
      });
      deps.oidcSession.revokeSession.mockResolvedValue(true);

      await controller.revokeSession(req, res);

      expect(deps.oidcSession.revokeSession).toHaveBeenCalledWith(
        'oidc-session-1'
      );
      expect(deps.flashChain.success).toHaveBeenCalledWith(
        'Session revoked successfully'
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'admin_session_revoked',
        expect.stringContaining('testuser'),
        null,
        expect.any(Object)
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/sessions');
    });

    it('should revoke Express session when sessionType is express', async () => {
      const req = createMockReq({
        params: { id: 'express-sess-1' },
        body: { sessionType: 'express' },
      });
      const res = createMockRes();

      deps.sessionManager.findAllExpressSessions.mockResolvedValue([
        createMockExpressSession(),
      ]);
      deps.sessionManager.revokeExpressSession.mockResolvedValue(true);

      await controller.revokeSession(req, res);

      expect(deps.sessionManager.revokeExpressSession).toHaveBeenCalledWith(
        'express-sess-1'
      );
      expect(deps.flashChain.success).toHaveBeenCalledWith(
        'Session revoked successfully'
      );
      expect(deps.activityService.success).toHaveBeenCalledWith(
        'admin_session_revoked',
        expect.stringContaining('Express session'),
        null,
        expect.any(Object)
      );
    });

    it('should flash error when OIDC session revocation fails', async () => {
      const req = createMockReq({
        params: { id: 'oidc-session-1' },
        body: {},
      });
      const res = createMockRes();

      deps.oidcSession.findSessionById.mockResolvedValue(null);
      deps.oidcSession.revokeSession.mockResolvedValue(false);

      await controller.revokeSession(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Session not found or already expired'
      );
    });

    it('should flash error when Express session revocation fails', async () => {
      const req = createMockReq({
        params: { id: 'express-sess-1' },
        body: { sessionType: 'express' },
      });
      const res = createMockRes();

      deps.sessionManager.findAllExpressSessions.mockResolvedValue([]);
      deps.sessionManager.revokeExpressSession.mockResolvedValue(false);

      await controller.revokeSession(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith(
        'Session not found or already expired'
      );
    });

    it('should broadcast session revocation via pubsub', async () => {
      const req = createMockReq({
        params: { id: 'oidc-session-1' },
        body: {},
      });
      const res = createMockRes();

      deps.oidcSession.findSessionById.mockResolvedValue({
        payload: { accountId: 'testuser' },
      });
      deps.oidcSession.revokeSession.mockResolvedValue(true);

      await controller.revokeSession(req, res);

      expect(deps.pubsub.publish).toHaveBeenCalledWith(
        expect.stringContaining('session:revoked'),
        expect.objectContaining({
          username: 'testuser',
          sessionId: 'oidc-session-1',
        })
      );
    });
  });

  describe('revokeUserSessions()', () => {
    it('should revoke both OIDC and Express sessions for a user', async () => {
      const req = createMockReq({ params: { username: 'testuser' } });
      const res = createMockRes();

      deps.oidcSession.findByAccountId.mockResolvedValue([
        { payload: { jti: 'oidc-1' } },
        { payload: { jti: 'oidc-2' } },
      ]);
      deps.oidcSession.revokeSession.mockResolvedValue(true);
      deps.sessionManager.revokeAllSessionsForUser.mockResolvedValue(1);

      await controller.revokeUserSessions(req, res);

      expect(deps.oidcSession.revokeSession).toHaveBeenCalledTimes(2);
      expect(deps.sessionManager.revokeAllSessionsForUser).toHaveBeenCalledWith(
        'testuser'
      );
      expect(deps.flashChain.success).toHaveBeenCalledWith(
        expect.stringContaining('3 session(s)')
      );
    });

    it('should flash info when no sessions found for user', async () => {
      const req = createMockReq({ params: { username: 'nobody' } });
      const res = createMockRes();

      deps.oidcSession.findByAccountId.mockResolvedValue([]);
      deps.sessionManager.revokeAllSessionsForUser.mockResolvedValue(0);

      await controller.revokeUserSessions(req, res);

      expect(deps.flashChain.info).toHaveBeenCalledWith(
        'No active sessions found for this user'
      );
    });

    it('should include Express revoked count in activity log', async () => {
      const req = createMockReq({ params: { username: 'testuser' } });
      const res = createMockRes();

      deps.oidcSession.findByAccountId.mockResolvedValue([
        { payload: { jti: 'oidc-1' } },
      ]);
      deps.oidcSession.revokeSession.mockResolvedValue(true);
      deps.sessionManager.revokeAllSessionsForUser.mockResolvedValue(2);

      await controller.revokeUserSessions(req, res);

      expect(deps.activityService.success).toHaveBeenCalledWith(
        'admin_sessions_bulk_revoked',
        expect.any(String),
        null,
        expect.objectContaining({
          target: expect.objectContaining({
            entity_data: expect.objectContaining({
              oidcRevokedCount: 1,
              expressRevokedCount: 2,
              totalRevoked: 3,
            }),
          }),
        })
      );
    });
  });

  describe('getStats()', () => {
    it('should return combined OIDC and Express session statistics', async () => {
      const req = createMockReq();
      const res = createMockRes();

      deps.oidcSession.getSessionStatistics.mockResolvedValue({
        total: 10,
        active: 8,
        expired: 2,
      });
      deps.oidcSession.getDistinctValues.mockResolvedValue(['user1', 'user2']);
      deps.sessionManager.countAllExpressSessions.mockResolvedValue(5);

      await controller.getStats(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          total: 15,
          oidcTotal: 10,
          oidcActive: 8,
          oidcExpired: 2,
          expressTotal: 5,
          uniqueUsers: 2,
        })
      );
    });

    it('should return 500 on error', async () => {
      const req = createMockReq();
      const res = createMockRes();

      deps.oidcSession.getSessionStatistics.mockRejectedValue(
        new Error('fail')
      );

      await controller.getStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
