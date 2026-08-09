/**
 * TDD — AdminActivitiesController
 *
 * Verifies adapter-neutral filtering, pagination rendering, detail guards,
 * and audited retention cleanup through the public Express handlers.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { AdminActivitiesController } from '../../../../src/controllers/admin/activity.controller.js';
import { GuardError } from '../../../../src/utils/guard-error.js';

function makeMocks() {
  const flash = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const activityService = {
    queryActivities: vi.fn().mockResolvedValue({
      results: [{ id: 'activity-1' }],
      page: 1,
      limit: 50,
      totalPages: 2,
      totalResults: 60,
    }),
    getActivityStats: vi.fn().mockResolvedValue({ total: 60 }),
    getActivityTypes: vi.fn().mockResolvedValue(['login', 'logout']),
    findOne: vi.fn(),
    deleteOldActivities: vi.fn(),
    success: vi.fn(),
  };
  const sessionManager = {
    flash: vi.fn(() => flash),
    getActiveUser: vi.fn(() => ({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
    })),
  };
  const clientDeviceInfoManager = {
    getClientInfoFromRequest: vi.fn(() => ({
      ip: '127.0.0.1',
      user_agent: 'vitest',
      browser: { name: 'Vitest' },
    })),
  };
  return {
    flash,
    activityService,
    sessionManager,
    clientDeviceInfoManager,
  };
}

function makeController(mocks = makeMocks()) {
  return {
    controller: new AdminActivitiesController(
      mocks.activityService as any,
      mocks.sessionManager as any,
      mocks.clientDeviceInfoManager as any
    ),
    ...mocks,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    requestId: 'request-1',
    ...overrides,
  } as any;
}

function makeRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
  } as any;
}

describe('AdminActivitiesController', () => {
  describe('list()', () => {
    it('renders the default activity listing and pagination', async () => {
      const { controller, activityService } = makeController();
      const res = makeRes();

      await controller.list(makeReq(), res);

      expect(activityService.queryActivities).toHaveBeenCalledWith(
        {},
        {
          page: 1,
          limit: 50,
          sort: { timestamp: -1 },
        }
      );
      expect(activityService.getActivityStats).toHaveBeenCalledOnce();
      expect(activityService.getActivityTypes).toHaveBeenCalledOnce();
      expect(res.render).toHaveBeenCalledWith('admin/activities/index', {
        title: 'User Activities',
        activities: [{ id: 'activity-1' }],
        pagination: {
          page: 1,
          limit: 50,
          totalPages: 2,
          totalResults: 60,
          hasNextPage: true,
          hasPrevPage: false,
          nextPage: 2,
          prevPage: 0,
        },
        filters: {
          search: '',
          type: 'all',
          status: 'all',
          username: '',
          dateFrom: '',
          dateTo: '',
          sortBy: 'timestamp',
          sortOrder: 'desc',
        },
        activityTypes: ['all', 'login', 'logout'],
        statuses: ['all', 'success', 'failed', 'info', 'warning'],
        stats: { total: 60 },
      });
    });

    it('builds adapter-neutral filters from valid query values', async () => {
      const { controller, activityService } = makeController();
      activityService.queryActivities.mockResolvedValue({
        results: [],
        page: 2,
        limit: 10,
        totalPages: 2,
        totalResults: 11,
      });
      const res = makeRes();

      await controller.list(
        makeReq({
          query: {
            page: '2',
            limit: '10',
            search: '  login (admin).*  ',
            type: 'login',
            status: 'success',
            username: '  alice  ',
            dateFrom: '2026-08-01',
            dateTo: '2026-08-02',
            sortBy: 'type',
            sortOrder: 'asc',
          },
        }),
        res
      );

      expect(activityService.queryActivities).toHaveBeenCalledWith(
        {
          search: 'login (admin).*',
          type: 'login',
          status: 'success',
          'actor.username': 'alice',
          timestamp: {
            $gte: new Date('2026-08-01T00:00:00.000Z'),
            $lte: new Date('2026-08-02T23:59:59.999Z'),
          },
        },
        { page: 2, limit: 10, sort: { type: 1 } }
      );
      expect(res.render).toHaveBeenCalledWith(
        'admin/activities/index',
        expect.objectContaining({
          pagination: expect.objectContaining({
            hasNextPage: false,
            hasPrevPage: true,
          }),
        })
      );
    });

    it('supports full ISO timestamps without constructing invalid end dates', async () => {
      const { controller, activityService } = makeController();

      await controller.list(
        makeReq({
          query: {
            dateFrom: '2026-08-01T12:30:00.000Z',
            dateTo: '2026-08-02T14:45:00.000Z',
          },
        }),
        makeRes()
      );

      expect(activityService.queryActivities).toHaveBeenCalledWith(
        {
          timestamp: {
            $gte: new Date('2026-08-01T12:30:00.000Z'),
            $lte: new Date('2026-08-02T14:45:00.000Z'),
          },
        },
        expect.any(Object)
      );
    });

    it.each([
      [
        'start only',
        { dateFrom: '2026-08-01' },
        { $gte: new Date('2026-08-01T00:00:00.000Z') },
      ],
      [
        'end only',
        { dateTo: '2026-08-02' },
        { $lte: new Date('2026-08-02T23:59:59.999Z') },
      ],
    ])('supports a %s date range', async (_label, query, timestamp) => {
      const { controller, activityService } = makeController();

      await controller.list(makeReq({ query }), makeRes());

      expect(activityService.queryActivities).toHaveBeenCalledWith(
        { timestamp },
        expect.any(Object)
      );
    });

    it.each(['2026-02-30', '2026-99-99'])(
      'ignores all sentinels, malformed date %s, and non-scalar query values',
      async malformedDate => {
        const { controller, activityService } = makeController();

        await expect(
          controller.list(
            makeReq({
              query: {
                type: ['login', 'logout'],
                status: { nested: 'success' },
                username: ['alice', 'bob'],
                dateFrom: malformedDate,
                dateTo: ['2026-08-02'],
              },
            }),
            makeRes()
          )
        ).resolves.toBeUndefined();

        expect(activityService.queryActivities).toHaveBeenCalledWith(
          {},
          expect.any(Object)
        );
      }
    );

    it('does not apply explicit all filters or empty date bounds', async () => {
      const { controller, activityService } = makeController();

      await controller.list(
        makeReq({
          query: {
            type: 'all',
            status: 'all',
            dateFrom: ' ',
            dateTo: '',
          },
        }),
        makeRes()
      );

      expect(activityService.queryActivities).toHaveBeenCalledWith(
        {},
        expect.any(Object)
      );
    });

    it('ignores malformed non-date text', async () => {
      const { controller, activityService } = makeController();

      await controller.list(
        makeReq({ query: { dateFrom: 'definitely-not-a-date' } }),
        makeRes()
      );

      expect(activityService.queryActivities).toHaveBeenCalledWith(
        {},
        expect.any(Object)
      );
    });
  });

  describe('show()', () => {
    it('renders a found activity', async () => {
      const activity = { id: 'activity-1', type: 'login' };
      const { controller, activityService } = makeController();
      activityService.findOne.mockResolvedValue(activity);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'activity-1' } }), res);

      expect(activityService.findOne).toHaveBeenCalledWith({
        _id: 'activity-1',
      });
      expect(res.render).toHaveBeenCalledWith('admin/activities/show', {
        title: 'Activity details',
        activity,
      });
    });

    it('throws a routable 404 guard when the activity is missing', async () => {
      const { controller, activityService } = makeController();
      activityService.findOne.mockResolvedValue(null);

      await expect(
        controller.show(makeReq({ params: { id: 'missing' } }), makeRes())
      ).rejects.toMatchObject({
        message: 'Activity not found',
        status: 404,
        redirectTo: '/admin/activities',
        flashMessage: 'Activity not found',
      } satisfies Partial<GuardError>);
    });
  });

  describe('clearOldActivities()', () => {
    it.each([
      ['configured retention', '30', 30],
      ['default retention', undefined, 90],
      ['bounded retention', '999999', 36500],
    ])(
      'deletes using %s and records the admin action',
      async (_label, days, expectedDays) => {
        const { controller, activityService, flash } = makeController();
        activityService.deleteOldActivities.mockResolvedValue({
          deletedCount: 7,
        });
        const req = makeReq({ body: { days } });
        const res = makeRes();

        await controller.clearOldActivities(req, res);

        expect(activityService.deleteOldActivities).toHaveBeenCalledWith(
          expectedDays
        );
        expect(activityService.success).toHaveBeenCalledWith(
          'old_activities_cleared_by_admin',
          'Admin cleared old activities',
          null,
          expect.objectContaining({
            ip_address: '127.0.0.1',
            user_agent: 'vitest',
            actor: expect.objectContaining({
              username: 'admin',
              actor_type: 'admin',
            }),
            target: {
              target_type: 'system',
              entity_data: { deletedCount: 7, olderThanDays: expectedDays },
            },
            metadata: { requestId: 'request-1' },
          })
        );
        expect(flash.success).toHaveBeenCalledWith(
          'Successfully cleared 7 old activities'
        );
        expect(res.redirect).toHaveBeenCalledWith('/admin/activities');
      }
    );
  });
});
