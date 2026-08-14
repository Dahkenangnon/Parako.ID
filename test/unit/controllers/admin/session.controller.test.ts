import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Mock ua-parser-js
vi.mock('ua-parser-js', () => ({
  UAParser: vi.fn().mockImplementation(function (userAgent: string) {
    return {
      getResult: () => ({
        browser: { name: userAgent === 'unknown-agent' ? '' : 'Chrome' },
        os: { name: userAgent === 'unknown-agent' ? '' : 'Linux' },
        device: { type: 'desktop' },
      }),
    };
  }),
}));

// Mock tenant context
vi.mock('../../../../src/multi-tenancy/tenant-context.js', () => ({
  tenantContext: {
    getTenantId: vi.fn().mockReturnValue('test-tenant'),
  },
}));

// Import after mocks
import { AdminSessionsController } from '../../../../src/controllers/admin/session.controller.js';

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

  const backchannelLogoutService = {
    notifySessionRevocation: vi.fn().mockResolvedValue(undefined),
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
    backchannelLogoutService,
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
    deps.configManager,
    deps.backchannelLogoutService
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

describe('AdminSessionsController', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let controller: AdminSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    controller = createController(deps);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('list()', () => {
    it('builds a portable case-insensitive username prefix filter', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const req = createMockReq({
        query: {
          username: '  Alice+Admin  ',
          status: 'active',
          sortOrder: 'asc',
        },
      });

      await controller.list(req, createMockRes());

      expect(deps.oidcSession.countSessions).toHaveBeenCalledWith({
        'payload.kind': 'Session',
        'payload.accountId': {
          $regex: '^Alice\\+Admin',
          $options: 'i',
        },
        'payload.exp': { $gt: Date.now() / 1000 },
      });
      expect(deps.oidcSession.findSessionsWithPagination).toHaveBeenCalledWith(
        expect.any(Object),
        'loginTime',
        1,
        0,
        20
      );
    });

    it.each([
      [{ nested: true }, { nested: true }],
      [42, 84],
      [[], []],
    ])(
      'ignores non-string username and status query values %#',
      async (username, status) => {
        const req = createMockReq({ query: { username, status } as any });
        const res = createMockRes();

        await expect(controller.list(req, res)).resolves.toBeUndefined();

        expect(deps.oidcSession.countSessions).toHaveBeenCalledWith({
          'payload.kind': 'Session',
        });
        expect((res.render as any).mock.calls[0][1].filters).toEqual(
          expect.objectContaining({ username: '', status: 'all' })
        );
      }
    );

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

      deps.sessionManager.findAllExpressSessions.mockResolvedValue([
        createMockExpressSession(),
      ]);
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
      expect(renderArgs.expressPagination).toEqual(
        expect.objectContaining({
          hasNext: true,
          hasPrev: true,
          startIndex: 11,
          endIndex: 20,
        })
      );
    });

    it('filters the complete OIDC result set before paginating searchable fields', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const req = createMockReq({
        query: {
          page: '2',
          limit: '2',
          search: 'needle',
          username: ['alice'],
          status: 'expired',
        } as any,
      });
      const res = createMockRes();
      deps.oidcSession.countSessions.mockResolvedValue(6);
      deps.oidcSession.findSessionsWithPagination.mockResolvedValue(
        ['username', 'name', 'email', 'device', 'ip', 'none'].map(field => ({
          payload: { field },
        }))
      );
      deps.oidcUtils.processSessionData.mockImplementation(async session => {
        const field = session.payload.field;
        return {
          userInfo: {
            username: field === 'username' ? 'needle' : 'user',
            full_name: field === 'name' ? 'Needle Name' : 'User Name',
            email:
              field === 'email' ? 'needle@example.com' : 'user@example.com',
          },
          device: field === 'device' ? 'Needle Browser' : 'Browser',
          ip: field === 'ip' ? 'needle-address' : '127.0.0.1',
        };
      });

      await controller.list(req, res);

      const expectedFilters = {
        'payload.kind': 'Session',
        'payload.accountId': { $regex: '^alice', $options: 'i' },
        'payload.exp': { $lte: Date.now() / 1000 },
      };
      expect(deps.oidcSession.countSessions).toHaveBeenCalledWith(
        expectedFilters
      );
      expect(deps.oidcSession.findSessionsWithPagination).toHaveBeenCalledWith(
        expectedFilters,
        'loginTime',
        -1,
        0,
        6
      );
      const rendered = (res.render as any).mock.calls[0][1];
      expect(rendered.sessions).toHaveLength(2);
      expect(
        rendered.sessions.every(
          (session: any) => session.sessionType === 'oidc'
        )
      ).toBe(true);
      expect(rendered.pagination).toEqual(
        expect.objectContaining({
          hasNext: true,
          hasPrev: true,
          startIndex: 3,
          endIndex: 4,
          totalSessions: 5,
          totalPages: 3,
        })
      );
    });

    it('treats a null adapter result as an empty OIDC page', async () => {
      deps.oidcSession.findSessionsWithPagination.mockResolvedValue(null);
      const res = createMockRes();

      await controller.list(createMockReq(), res);

      expect((res.render as any).mock.calls[0][1].sessions).toEqual([]);
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
      expect(deps.sessionManager.countAllExpressSessions).toHaveBeenCalledWith(
        'testuser'
      );
    });

    it('propagates errors to the global error handler', async () => {
      const req = createMockReq();
      const res = createMockRes();

      const dbError = new Error('DB error');
      deps.oidcSession.countSessions.mockRejectedValue(dbError);

      await expect(controller.list(req, res)).rejects.toBe(dbError);
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

    it('redirects when a matching Express document has no session payload', async () => {
      const req = createMockReq({
        params: { id: 'empty-express' },
        query: { type: 'express' },
      });
      const res = createMockRes();
      deps.sessionManager.findAllExpressSessions.mockResolvedValue([
        { _id: 'empty-express' },
      ]);

      await controller.show(req, res);

      expect(deps.flashChain.error).toHaveBeenCalledWith('Session not found');
      expect(res.redirect).toHaveBeenCalledWith('/admin/sessions');
    });

    it('uses stable timestamp defaults for sparse Express sessions', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const req = createMockReq({
        params: { id: 'sparse-express' },
        query: { type: 'express' },
      });
      const res = createMockRes();
      deps.sessionManager.findAllExpressSessions.mockResolvedValue([
        { _id: 'sparse-express', session: {} },
      ]);

      await controller.show(req, res);

      const rendered = (res.render as any).mock.calls[0][1].session;
      expect(rendered.created_at).toEqual(new Date('2026-08-02T12:00:00.000Z'));
      expect(rendered.updated_at).toEqual(rendered.created_at);
      expect(rendered.authorizations).toEqual({});
    });

    it('uses stable defaults for optional OIDC session fields', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      deps.oidcSession.findSessionById.mockResolvedValue({ payload: {} });
      const res = createMockRes();

      await controller.show(
        createMockReq({ params: { id: 'oidc-session-1' } }),
        res
      );

      const rendered = (res.render as any).mock.calls[0][1].session;
      expect(rendered.authorizations).toEqual({});
      expect(rendered.created_at).toEqual(new Date('2026-08-02T12:00:00.000Z'));
      expect(rendered.updated_at).toEqual(new Date('2026-08-02T12:00:00.000Z'));
    });
  });

  describe('revokeSession()', () => {
    it('notifies relying parties before deleting an OIDC session', async () => {
      const storedSession = {
        _id: 'oidc-session-1',
        payload: {
          accountId: 'testuser',
          authorizations: { 'client-a': { sid: 'sid-a' } },
        },
      };
      deps.oidcSession.findSessionById.mockResolvedValue(storedSession);
      deps.oidcSession.revokeSession.mockResolvedValue(true);

      await controller.revokeSession(
        createMockReq({ params: { id: 'oidc-session-1' }, body: {} }),
        createMockRes()
      );

      expect(
        deps.backchannelLogoutService.notifySessionRevocation
      ).toHaveBeenCalledWith(storedSession, 'test-tenant');
      expect(
        deps.backchannelLogoutService.notifySessionRevocation.mock
          .invocationCallOrder[0]
      ).toBeLessThan(
        deps.oidcSession.revokeSession.mock.invocationCallOrder[0] as number
      );
    });

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

    it('skips pubsub when it is disconnected and handles an unknown target', async () => {
      deps.pubsub.isConnected.mockReturnValue(false);
      deps.oidcSession.findSessionById.mockResolvedValue(null);
      deps.oidcSession.revokeSession.mockResolvedValue(true);

      await controller.revokeSession(
        createMockReq({ params: { id: 'orphan' }, body: {} }),
        createMockRes()
      );

      expect(deps.activityService.success).toHaveBeenCalledWith(
        'admin_session_revoked',
        expect.stringContaining('unknown'),
        null,
        expect.any(Object)
      );
      expect(deps.pubsub.publish).not.toHaveBeenCalled();
    });

    it.each([
      [new Error('redis unavailable'), 'redis unavailable'],
      ['redis unavailable', 'redis unavailable'],
    ])(
      'logs asynchronous pubsub failures without failing revocation %#',
      async (failure, message) => {
        deps.configManager.getConfig.mockReturnValue({ deployment: {} });
        deps.pubsub.publish.mockRejectedValue(failure);
        deps.oidcSession.findSessionById.mockResolvedValue({
          payload: { accountId: 'alice' },
        });
        deps.oidcSession.revokeSession.mockResolvedValue(true);

        await controller.revokeSession(
          createMockReq({ params: { id: 'oidc-session-1' }, body: {} }),
          createMockRes()
        );

        await vi.waitFor(() => {
          expect(deps.logger.warn).toHaveBeenCalledWith(
            'Pubsub broadcast of session revocation failed',
            expect.objectContaining({
              step: 'admin-session-revoke-broadcast',
              err: message,
            })
          );
        });
        expect(deps.pubsub.publish).toHaveBeenCalledWith(
          'parako:session:revoked',
          expect.objectContaining({ sessionId: 'oidc-session-1' })
        );
      }
    );

    it('uses an unknown target for an orphaned Express session that is revoked', async () => {
      deps.sessionManager.findAllExpressSessions.mockResolvedValue([]);
      deps.sessionManager.revokeExpressSession.mockResolvedValue(true);

      await controller.revokeSession(
        createMockReq({
          params: { id: 'orphan-express' },
          body: { sessionType: 'express' },
        }),
        createMockRes()
      );

      expect(deps.activityService.success).toHaveBeenCalledWith(
        'admin_session_revoked',
        expect.stringContaining('unknown'),
        null,
        expect.any(Object)
      );
    });
  });

  describe('revokeUserSessions()', () => {
    it('notifies relying parties before deleting every valid OIDC session', async () => {
      const sessions = [
        {
          _id: 'stored-1',
          payload: {
            jti: 'oidc-1',
            accountId: 'testuser',
            authorizations: { 'client-a': { sid: 'sid-a' } },
          },
        },
        {
          _id: 'stored-2',
          payload: {
            jti: 'oidc-2',
            accountId: 'testuser',
            authorizations: { 'client-b': { sid: 'sid-b' } },
          },
        },
      ];
      deps.oidcSession.findByAccountId.mockResolvedValue(sessions);
      deps.oidcSession.revokeSession.mockResolvedValue(true);

      await controller.revokeUserSessions(
        createMockReq({ params: { username: 'testuser' } }),
        createMockRes()
      );

      expect(
        deps.backchannelLogoutService.notifySessionRevocation
      ).toHaveBeenNthCalledWith(1, sessions[0], 'test-tenant');
      expect(
        deps.backchannelLogoutService.notifySessionRevocation
      ).toHaveBeenNthCalledWith(2, sessions[1], 'test-tenant');
      const notificationOrder =
        deps.backchannelLogoutService.notifySessionRevocation.mock
          .invocationCallOrder;
      const revocationOrder =
        deps.oidcSession.revokeSession.mock.invocationCallOrder;
      expect(notificationOrder[0]).toBeLessThan(revocationOrder[0] as number);
      expect(notificationOrder[1]).toBeLessThan(revocationOrder[1] as number);
    });

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

    it('skips malformed and already-revoked OIDC sessions', async () => {
      deps.oidcSession.findByAccountId.mockResolvedValue([
        { payload: {} },
        { payload: { jti: 'already-gone' } },
      ]);
      deps.oidcSession.revokeSession.mockResolvedValue(false);
      deps.sessionManager.revokeAllSessionsForUser.mockResolvedValue(0);

      await controller.revokeUserSessions(
        createMockReq({ params: { username: 'alice' } }),
        createMockRes()
      );

      expect(deps.oidcSession.revokeSession).toHaveBeenCalledTimes(1);
      expect(deps.flashChain.info).toHaveBeenCalledWith(
        'No active sessions found for this user'
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

    it('returns zero average when there are no active OIDC users', async () => {
      const res = createMockRes();

      await controller.getStats(createMockReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          uniqueUsers: 0,
          averageSessionsPerUser: '0',
        })
      );
    });
  });

  describe('Express session normalization', () => {
    it('normalizes sparse metadata, user activity, and minute/hour/day ages', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const now = Date.now();
      const sessions = [
        {
          _id: 'minute',
          session: {
            accountId: 'alice',
            authTime: new Date(now - 30 * 60_000).toISOString(),
            userAgent: 'test-agent',
          },
        },
        {
          _id: 'hour',
          session: {
            accountId: 'bob',
            authTime: new Date(now - 2 * 60 * 60_000).toISOString(),
            lastActivity: new Date(now - 60 * 60_000).toISOString(),
            userAgent: '',
            ipAddress: '',
            _metadata: {
              browser: { name: 'Firefox' },
              os: {},
              createdIp: '10.0.0.2',
            },
          },
        },
        {
          _id: 'day',
          session: {
            authTime: new Date(now - 2 * 24 * 60 * 60_000).toISOString(),
            ipAddress: '10.0.0.3',
            userAgent: 'day-agent',
            _metadata: {
              browser: { name: 'Safari' },
              os: { name: 'macOS' },
            },
          },
        },
        {
          _id: 'lookup-failure',
          session: {
            accountId: 'failure',
            authTime: new Date(now - 3 * 24 * 60 * 60_000).toISOString(),
          },
        },
        {
          _id: 'unknown-ua',
          session: {
            accountId: 'no-email',
            authTime: new Date(now - 4 * 24 * 60 * 60_000).toISOString(),
            userAgent: 'unknown-agent',
          },
        },
      ];
      deps.sessionManager.findAllExpressSessions.mockResolvedValue(sessions);
      deps.sessionManager.countAllExpressSessions.mockResolvedValue(5);
      deps.activityService.findActivitiesAroundTime.mockImplementation(
        async accountId => {
          if (accountId === 'failure') throw new Error('activity unavailable');
          if (accountId === 'bob')
            return [{ actor: { email: 'bob@example.com' } }];
          if (accountId === 'no-email') return [{ actor: {} }];
          if (accountId === 'Unknown') {
            return [
              {
                actor: {
                  email: 'known@example.com',
                  full_name: 'Known User',
                  given_name: 'Known',
                  family_name: 'User',
                },
              },
            ];
          }
          return [];
        }
      );
      const res = createMockRes();

      await controller.list(createMockReq(), res);

      const normalized = (res.render as any).mock.calls[0][1].expressSessions;
      expect(normalized).toEqual([
        expect.objectContaining({
          id: 'minute',
          device: 'Chrome on Linux',
          ip: 'Unknown',
          location: 'Unknown',
          sessionAge: '30m ago',
          user_agent: 'test-agent',
        }),
        expect.objectContaining({
          id: 'hour',
          device: 'Firefox on Unknown',
          ip: '10.0.0.2',
          sessionAge: '2h ago',
          userInfo: {
            username: 'bob',
            email: 'bob@example.com',
            full_name: 'Unknown User',
            given_name: '',
            family_name: '',
          },
          user_agent: 'Unknown',
        }),
        expect.objectContaining({
          id: 'day',
          accountId: 'Unknown',
          sessionAge: '2d ago',
          userInfo: {
            username: 'Unknown',
            email: 'known@example.com',
            full_name: 'Known User',
            given_name: 'Known',
            family_name: 'User',
          },
        }),
        expect.objectContaining({
          id: 'lookup-failure',
          userInfo: expect.objectContaining({
            username: 'failure',
            email: 'Unknown',
          }),
        }),
        expect.objectContaining({
          id: 'unknown-ua',
          device: 'Unknown on Unknown',
          userInfo: expect.objectContaining({ email: 'Unknown' }),
        }),
      ]);
    });
  });
});
