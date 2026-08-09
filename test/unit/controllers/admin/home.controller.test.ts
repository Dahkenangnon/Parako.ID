/**
 * TDD — AdminHomeController
 *
 * Covers dashboard authentication, portable statistics queries, resilient
 * subsystem fallbacks, recent actor mapping, and theme updates.
 */
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHomeController } from '../../../../src/controllers/admin/home.controller.js';

function makeMocks() {
  const logger = { error: vi.fn(), info: vi.fn() };
  const sessionManager = {
    getActiveUser: vi.fn(() => ({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
    })),
    set: vi.fn(),
  };
  const userService = { countDocuments: vi.fn() };
  const activity = {
    getActivityStats: vi.fn().mockResolvedValue({
      totalActivities: 20,
      todayCount: 3,
    }),
    queryActivities: vi.fn().mockResolvedValue({
      results: [],
      page: 1,
      limit: 3,
      totalPages: 0,
      totalResults: 0,
    }),
  };
  const oidcAdapter = {
    client: {
      getClientStatistics: vi.fn().mockResolvedValue({ active: 2, total: 3 }),
      countClients: vi.fn().mockResolvedValue(3),
    },
    session: {
      getSessionStatistics: vi.fn().mockResolvedValue({
        total: 7,
        active: 5,
        expired: 2,
      }),
    },
    grant: {
      getGrantStatistics: vi.fn().mockResolvedValue({ total: 9, expired: 4 }),
    },
  };
  const configManager = {
    getConfig: vi.fn(() => ({
      application: { title: 'Parako ID' },
      deployment: { environment: 'production' },
      security: { authentication: { multi_factor: { enabled: true } } },
    })),
  };
  return {
    logger,
    sessionManager,
    userService,
    activity,
    oidcAdapter,
    configManager,
  };
}

function makeController(mocks = makeMocks()) {
  return {
    controller: new AdminHomeController(
      mocks.logger as any,
      mocks.sessionManager as any,
      mocks.userService as any,
      mocks.activity as any,
      mocks.oidcAdapter as any,
      mocks.configManager as any
    ),
    ...mocks,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return { body: {}, ...overrides } as any;
}

function makeRes() {
  const res = {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  } as any;
  res.status.mockReturnValue(res);
  return res;
}

describe('AdminHomeController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dashboard()', () => {
    it('redirects unauthenticated requests before loading dashboard data', async () => {
      const mocks = makeMocks();
      mocks.sessionManager.getActiveUser.mockReturnValue(undefined as any);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.dashboard(makeReq(), res);

      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Admin dashboard access without authenticated user'
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(mocks.userService.countDocuments).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
    });

    it('renders accurate aggregate statistics and recent actors', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:34:56.000Z'));
      const mocks = makeMocks();
      mocks.userService.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5);
      mocks.activity.queryActivities.mockResolvedValue({
        results: [
          {
            type: 'login',
            description: 'Signed in',
            timestamp: new Date('2026-08-02T12:00:00.000Z'),
            actor: { username: 'alice', email: 'alice@example.com' },
            metadata: { client: 'demo' },
          },
          {
            type: 'system',
            description: 'Maintenance',
            timestamp: new Date('2026-08-02T11:00:00.000Z'),
          },
        ],
        page: 1,
        limit: 3,
        totalPages: 1,
        totalResults: 2,
      });
      const { controller } = makeController(mocks);
      const res = makeRes();
      const todayStart = new Date('2026-08-02T12:34:56.000Z');
      todayStart.setHours(0, 0, 0, 0);

      await controller.dashboard(makeReq(), res);

      expect(mocks.userService.countDocuments.mock.calls).toEqual([
        [{}],
        [{ account_enabled: true }],
        [{ email_verified: true }],
        [{ roles: { $in: ['admin', 'superadmin'] } }],
        [{ created_at: { $gte: todayStart } }],
        [{ created_at: { $gte: new Date('2026-07-26T12:34:56.000Z') } }],
        [{ created_at: { $gte: new Date('2026-07-02T12:34:56.000Z') } }],
      ]);
      expect(res.render).toHaveBeenCalledWith('admin/home', {
        title: 'Admin Dashboard',
        stats: {
          users: {
            total: 10,
            active: 8,
            verified: 6,
            admins: 2,
            newToday: 1,
            newThisWeek: 3,
            newThisMonth: 5,
            verificationRate: 60,
            activeRate: 80,
          },
          oidc: { clients: 3, activeClients: 2, totalClients: 3 },
          sessions: { total: 7, active: 5, expired: 2 },
          grants: { total: 9, active: 5, revoked: 4 },
          activities: { total: 20, today: 3, thisWeek: 0, thisMonth: 0 },
        },
        recentActivity: [
          {
            type: 'login',
            message: 'Signed in',
            timestamp: new Date('2026-08-02T12:00:00.000Z'),
            user: { username: 'alice', email: 'alice@example.com' },
            metadata: { client: 'demo' },
          },
          {
            type: 'system',
            message: 'Maintenance',
            timestamp: new Date('2026-08-02T11:00:00.000Z'),
            user: null,
            metadata: {},
          },
        ],
        appInfo: {
          title: 'Parako ID',
          environment: 'production',
          mfaEnabled: true,
        },
        layout: 'layouts/admin-layout',
      });
    });
  });

  describe('statistics helpers', () => {
    it('uses zero rates when there are no users', async () => {
      const mocks = makeMocks();
      mocks.userService.countDocuments.mockResolvedValue(0);
      const { controller } = makeController(mocks);

      const stats = await controller.getSystemStats();

      expect(stats.users.verificationRate).toBe(0);
      expect(stats.users.activeRate).toBe(0);
    });

    it('returns a complete zero snapshot when user statistics fail', async () => {
      const failure = new Error('user count failed');
      const mocks = makeMocks();
      mocks.userService.countDocuments.mockRejectedValue(failure);
      const { controller } = makeController(mocks);

      await expect(controller.getSystemStats()).resolves.toEqual({
        users: {
          total: 0,
          active: 0,
          verified: 0,
          admins: 0,
          newToday: 0,
          newThisWeek: 0,
          newThisMonth: 0,
          verificationRate: 0,
          activeRate: 0,
        },
        oidc: { clients: 0, activeClients: 0, totalClients: 0 },
        sessions: { total: 0, active: 0, expired: 0 },
        grants: { total: 0, active: 0, revoked: 0 },
        activities: { total: 0, today: 0, thisWeek: 0, thisMonth: 0 },
      });
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'admin_stats_load_failed',
      });
    });

    it('normalizes missing OIDC totals and falls back on adapter failure', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.client.getClientStatistics.mockResolvedValue({
        active: 1,
        total: undefined,
      } as any);
      const { controller } = makeController(mocks);

      await expect(controller.getOIDCStats()).resolves.toEqual({
        clients: 3,
        activeClients: 1,
        totalClients: 0,
      });

      const failure = new Error('OIDC unavailable');
      mocks.oidcAdapter.client.getClientStatistics.mockRejectedValue(failure);
      await expect(controller.getOIDCStats()).resolves.toEqual({
        clients: 0,
        activeClients: 0,
        totalClients: 0,
      });
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'oidc_client_statistics_load_failed',
      });
    });

    it.each([
      [
        'sessions',
        'getSessionsStats',
        'session',
        'getSessionStatistics',
        { total: 0, active: 0, expired: 0 },
        'session_statistics_load_failed',
      ],
      [
        'grants',
        'getGrantsStats',
        'grant',
        'getGrantStatistics',
        { total: 0, active: 0, revoked: 0 },
        'grant_statistics_load_failed',
      ],
    ])(
      'returns zero %s statistics on adapter failure',
      async (_label, helper, adapter, method, fallback, context) => {
        const failure = new Error(`${adapter} unavailable`);
        const mocks = makeMocks();
        (mocks.oidcAdapter as any)[adapter][method].mockRejectedValue(failure);
        const { controller } = makeController(mocks);

        await expect((controller as any)[helper]()).resolves.toEqual(fallback);
        expect(mocks.logger.error).toHaveBeenCalledWith(failure, { context });
      }
    );

    it('normalizes missing activity totals and falls back on failure', async () => {
      const mocks = makeMocks();
      mocks.activity.getActivityStats.mockResolvedValue({} as any);
      const { controller } = makeController(mocks);

      await expect(controller.getActivityStats()).resolves.toEqual({
        total: 0,
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
      });

      const failure = new Error('activity stats unavailable');
      mocks.activity.getActivityStats.mockRejectedValue(failure);
      await expect(controller.getActivityStats()).resolves.toEqual({
        total: 0,
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
      });
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'activity_statistics_load_failed',
      });
    });
  });

  describe('getRecentActivity()', () => {
    it('returns an empty list and logs when activity loading fails', async () => {
      const failure = new Error('activity unavailable');
      const mocks = makeMocks();
      mocks.activity.queryActivities.mockRejectedValue(failure);
      const { controller } = makeController(mocks);

      await expect(controller.getRecentActivity()).resolves.toEqual([]);
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'recent_activity_load_failed',
      });
    });
  });

  describe('updateTheme()', () => {
    it.each([undefined, null, '', 'system', ['dark']])(
      'rejects invalid theme %s',
      async theme => {
        const { controller, sessionManager } = makeController();
        const res = makeRes();

        await controller.updateTheme(makeReq({ body: { theme } }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid theme. Must be "light" or "dark".',
        });
        expect(sessionManager.set).not.toHaveBeenCalled();
      }
    );

    it.each(['light', 'dark'])('persists the %s theme', async theme => {
      const { controller, sessionManager, logger } = makeController();
      const req = makeReq({ body: { theme } });
      const res = makeRes();

      await controller.updateTheme(req, res);

      expect(sessionManager.set).toHaveBeenCalledWith(req, 'userTheme', theme);
      expect(logger.info).toHaveBeenCalledWith('Admin theme updated', {
        theme,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        theme,
        message: 'Theme updated successfully',
      });
    });

    it('returns a sanitized 500 when the session cannot be updated', async () => {
      const failure = new Error('private session store detail');
      const mocks = makeMocks();
      mocks.sessionManager.set.mockImplementation(() => {
        throw failure;
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.updateTheme(makeReq({ body: { theme: 'dark' } }), res);

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'admin_theme_update_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to update theme',
      });
      expect(JSON.stringify(res.json.mock.calls)).not.toContain(
        'session store'
      );
    });
  });
});
