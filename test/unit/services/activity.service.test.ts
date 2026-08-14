/**
 * TDD — ActivityService uses IActivityRepository for data access
 *
 * RED: ActivityService extends BaseService (Mongoose), uses activityModel directly.
 * GREEN: After migrating to IActivityRepository.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityService } from '../../../src/services/activity.service.js';
import type { IActivity } from '../../../src/models/activity.model.js';
import type { IActivityRepository } from '../../../src/db/repositories/interfaces/activity.repository.js';
import type { PaginatedResult } from '../../../src/db/repositories/interfaces/base.repository.js';
import { encryptValue, isEncrypted } from '../../../src/utils/encryption.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
  getLogger: () => null,
  flush: async () => {},
  shutdown: async () => {},
} as any;

const mockConfigManager = {
  subscribe: vi.fn(),
  getConfig: () => ({
    security: { protection: { encrypt_device_data: false } },
  }),
} as any;

function makeMockRepo(): IActivityRepository {
  return {
    findById: vi.fn(),
    findOne: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    findByUser: vi.fn(),
    findByDevice: vi.fn(),
    deleteOlderThan: vi.fn(),
    getDistinctTypes: vi.fn(),
  } as unknown as IActivityRepository;
}

function makeActivity(overrides: Partial<IActivity> = {}): IActivity {
  return {
    _id: 'act-123',
    id: 'act-123',
    type: 'login_success',
    description: 'User logged in',
    timestamp: new Date('2025-01-01'),
    status: 'success',
    ipAddress: '127.0.0.1',
    ...overrides,
  } as unknown as IActivity;
}

function makePaginatedResult(results: IActivity[]): PaginatedResult<IActivity> {
  return {
    results,
    totalResults: results.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  };
}

function makeService(
  repo: IActivityRepository,
  configManager = mockConfigManager
): ActivityService {
  return new ActivityService(mockLogger, repo as any, configManager);
}

describe('ActivityService — IActivityRepository delegation', () => {
  let repo: IActivityRepository;
  let service: ActivityService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  afterEach(async () => {
    await service.shutdown();
  });

  describe('base-service compatibility', () => {
    it('finds by string, _id, id, and repository filter', async () => {
      const activity = makeActivity();
      vi.mocked(repo.findById).mockResolvedValue(activity);
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult([activity])
      );

      await expect(service.findOne('act-123')).resolves.toBe(activity);
      await expect(service.findOne({ _id: 'act-123' })).resolves.toBe(activity);
      await expect(service.findOne({ id: 123 })).resolves.toBe(activity);
      await expect(service.findOne({ status: 'success' })).resolves.toBe(
        activity
      );

      expect(repo.findById).toHaveBeenNthCalledWith(1, 'act-123');
      expect(repo.findById).toHaveBeenNthCalledWith(2, 'act-123');
      expect(repo.findById).toHaveBeenNthCalledWith(3, '123');
      expect(repo.findMany).toHaveBeenCalledWith(
        { status: 'success' },
        { page: 1, limit: 1 }
      );
    });

    it('returns null when a filtered find has no result', async () => {
      vi.mocked(repo.findMany).mockResolvedValue(makePaginatedResult([]));
      await expect(service.findOne({ type: 'missing' })).resolves.toBeNull();
    });

    it('delegates count, list, pagination, and create operations', async () => {
      const activities = [makeActivity(), makeActivity({ id: 'act-2' })];
      vi.mocked(repo.count).mockResolvedValue(2);
      vi.mocked(repo.findMany).mockResolvedValue({
        ...makePaginatedResult(activities),
        page: 2,
        limit: 2,
        totalResults: 5,
        totalPages: 3,
      });
      vi.mocked(repo.create)
        .mockResolvedValueOnce(activities[0])
        .mockResolvedValueOnce(activities[0])
        .mockResolvedValueOnce(activities[1]);

      await expect(service.countDocuments({ status: 'success' })).resolves.toBe(
        2
      );
      await expect(service.findMany({ status: 'success' })).resolves.toEqual(
        activities
      );
      await expect(
        service.findWithPagination(
          { status: 'success' },
          { page: 2, limit: 2, sort: { timestamp: -1 } }
        )
      ).resolves.toEqual({
        results: activities,
        page: 2,
        limit: 2,
        totalResults: 5,
        totalPages: 3,
      });
      await expect(service.createOne(activities[0])).resolves.toBe(
        activities[0]
      );
      await expect(service.createMany(activities)).resolves.toEqual(activities);
    });

    it.each([
      ['updateById', () => service.updateById('a', {})],
      ['updateMany', () => service.updateMany({}, {})],
      ['deleteMany', () => service.deleteMany({})],
      ['aggregate', () => service.aggregate([])],
      ['deleteOne', () => service.deleteOne('a')],
    ])('rejects unsupported %s mutations', async (_name, invoke) => {
      await expect(invoke()).rejects.toThrow(
        /not supported|deleteOldActivities/
      );
    });
  });

  describe('activity logging and batching', () => {
    it('persists all log levels with actor, target, legacy username, and defaults on shutdown', async () => {
      service.success(
        'login_success',
        'Signed in',
        {
          _id: 42,
          email: 'maria@example.test',
          name: 'Maria Example',
          given_name: 'Maria',
          family_name: 'Example',
        },
        {
          target: {
            id: 'target-1',
            custom_identifier_1: 'target-name',
            given_name: 'Target',
            family_name: 'User',
            target_type: 'user',
            entity_id: 'entity-1',
            entity_name: 'Entity',
            entity_data: { safe: true },
          },
        }
      );
      service.failed('login_failed', 'Failed', { id: 'u2', username: 'maria' });
      service.info('profile_viewed', 'Viewed', undefined, {
        actor: { email: 'actor@example.test', actor_type: 'admin' },
      });
      service.warning('risk', 'Risk', undefined, {
        username: 'legacy-user',
      } as any);

      await service.shutdown();

      expect(repo.create).toHaveBeenCalledTimes(4);
      expect(repo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'login_success',
          status: 'success',
          ip_address: '0.0.0.0',
          user_agent: 'Unknown',
          actor: {
            user_id: '42',
            username: 'maria',
            email: 'maria@example.test',
            full_name: 'Maria Example',
            given_name: 'Maria',
            family_name: 'Example',
            actor_type: 'user',
          },
          target: expect.objectContaining({
            user_id: 'target-1',
            username: 'target-name',
            full_name: 'Target User',
            target_type: 'user',
            entity_id: 'entity-1',
          }),
        })
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ status: 'failed', username: 'maria' })
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          status: 'info',
          actor: expect.objectContaining({
            username: 'actor',
            actor_type: 'admin',
          }),
        })
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({ status: 'warning', username: 'legacy-user' })
      );
    });

    it('builds full names from either name or individual name parts', async () => {
      service.info('named', 'Named', { id: 'u1', name: 'Display Name' });
      service.info('parts', 'Parts', {
        id: 'u2',
        given_name: 'Given',
      });
      service.info('family', 'Family', {
        id: 'u3',
        family_name: 'Family',
      });
      await service.shutdown();

      expect(repo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          actor: expect.objectContaining({ full_name: 'Display Name' }),
        })
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          actor: expect.objectContaining({ full_name: 'Given' }),
        })
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          actor: expect.objectContaining({ full_name: 'Family' }),
        })
      );
    });

    it('persists critical events immediately and reports persistence failures', async () => {
      vi.mocked(repo.create)
        .mockResolvedValueOnce(makeActivity())
        .mockRejectedValueOnce(new Error('critical failed'));

      service.success('account_lockout', 'Locked', { username: 'maria' });
      await vi.waitFor(() => expect(repo.create).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Critical security event logged immediately',
          expect.objectContaining({ type: 'account_lockout' })
        )
      );

      service.failed('suspicious_activity', 'Suspicious', {
        username: 'maria',
      });
      await vi.waitFor(() =>
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({ context: 'error_logging_critical_event' })
        )
      );
    });

    it('drops noncritical events when the bounded queue is full', () => {
      (service as any).activityQueue = Array.from({ length: 10_000 }, () => ({
        type: 'existing',
      }));

      service.info('new-event', 'Dropped');

      expect((service as any).activityQueue).toHaveLength(10_000);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Activity queue full, dropping event',
        { type: 'new-event', queueSize: 10_000 }
      );
      (service as any).activityQueue = [];
    });

    it('flushes immediately at the configured batch size and handles failures', async () => {
      (service as any).batchSize = 1;
      vi.mocked(repo.create)
        .mockResolvedValueOnce(makeActivity())
        .mockRejectedValueOnce(new Error('immediate failed'));

      service.info('first', 'First');
      await vi.waitFor(() => expect(repo.create).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Immediate batch processed 1 activity logs'
        )
      );

      service.info('second', 'Second');
      await vi.waitFor(() =>
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            context: 'failed_to_process_immediate_activity_batch',
          })
        )
      );
      expect((service as any).processingBatch).toBe(false);
    });

    it('processes scheduled batches and retries only critical queued audit events', async () => {
      await service.shutdown();
      vi.useFakeTimers();
      const scheduledRepo = makeMockRepo();
      const scheduledService = makeService(scheduledRepo);
      vi.mocked(scheduledRepo.create)
        .mockRejectedValueOnce(new Error('batch failed'))
        .mockRejectedValueOnce(new Error('parallel batch failed'))
        .mockRejectedValueOnce(new Error('retry failed'));

      try {
        scheduledService.failed('login_failed', 'Failed login');
        scheduledService.info('noncritical', 'Ordinary event');
        await vi.advanceTimersByTimeAsync(2_000);

        expect(scheduledRepo.create).toHaveBeenCalledTimes(3);
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Retrying 1 critical logs individually'
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            context: 'failed_to_save_critical_activity',
            type: 'login_failed',
          })
        );
        expect((scheduledService as any).processingBatch).toBe(false);
      } finally {
        await scheduledService.shutdown();
        vi.useRealTimers();
      }
    });

    it('processes a successful scheduled batch and skips empty or active batches', async () => {
      await service.shutdown();
      vi.useFakeTimers();
      const scheduledRepo = makeMockRepo();
      const scheduledService = makeService(scheduledRepo);

      try {
        await vi.advanceTimersByTimeAsync(2_000);
        expect(scheduledRepo.create).not.toHaveBeenCalled();

        scheduledService.info('queued', 'Queued');
        await vi.advanceTimersByTimeAsync(2_000);
        expect(scheduledRepo.create).toHaveBeenCalledTimes(1);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Batch processed 1 activity logs'
        );

        scheduledService.info('blocked', 'Blocked');
        (scheduledService as any).processingBatch = true;
        await vi.advanceTimersByTimeAsync(2_000);
        expect(scheduledRepo.create).toHaveBeenCalledTimes(1);
        (scheduledService as any).processingBatch = false;
        (scheduledService as any).activityQueue = [];
      } finally {
        await scheduledService.shutdown();
        vi.useRealTimers();
      }
    });

    it('keeps audit persistence best-effort during shutdown failure', async () => {
      vi.mocked(repo.create).mockRejectedValue(new Error('flush failed'));
      service.info('queued', 'Queued');

      await expect(service.shutdown()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: 'error_flushing_activity_logs_on_shutdown',
        })
      );
      expect((service as any).activityQueue).toEqual([]);
    });

    it('falls back to unencrypted logging when configuration lookup fails', async () => {
      const configFailureService = makeService(repo, {
        getConfig: () => {
          throw new Error('config unavailable');
        },
      } as any);

      configFailureService.info('queued', 'Queued', undefined, {
        device_infos: { fingerprint: 'plain-fingerprint' },
      });
      await configFailureService.shutdown();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          device_infos: { fingerprint: 'plain-fingerprint' },
        })
      );
    });

    it('contains unexpected queue-construction errors without throwing', () => {
      expect(() => (service as any).queueActivity(null)).not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'error_queuing_activity' })
      );
    });

    it('covers empty private helpers and preserves explicit queue defaults', async () => {
      expect((service as any).extractUserData(undefined)).toEqual({});
      expect((service as any).decryptSensitiveDeviceFields(undefined)).toBe(
        undefined
      );

      const timestamp = new Date('2026-08-01T12:00:00.000Z');
      service.info('explicit', 'Explicit', undefined, {
        timestamp,
        actor: { email: 'actor@example.test' },
        target: { email: 'target@example.test' },
      } as any);
      await service.shutdown();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp,
          actor: expect.objectContaining({ actor_type: 'user' }),
          target: expect.objectContaining({ target_type: 'none' }),
        })
      );

      (service as any).queueActivity({
        type: 'private-default-timestamp',
        description: 'Uses queue fallback',
      });
      await service.shutdown();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'private-default-timestamp',
          timestamp: expect.any(Date),
        })
      );
    });

    it('preserves raw target identity fields that are not extractable user fields', async () => {
      service.info('target-fallback', 'Target fallback', undefined, {
        target: {
          target_type: 'service',
          user_id: 'raw-user-id',
          username: '',
          email: false,
          full_name: 17,
          given_name: false,
          family_name: false,
        },
      } as any);
      await service.shutdown();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            user_id: 'raw-user-id',
            username: '',
            email: false,
            full_name: 17,
            given_name: false,
            family_name: false,
          }),
        })
      );
    });

    it('skips immediate processing while active or empty', async () => {
      (service as any).processingBatch = true;
      (service as any).activityQueue = [{ type: 'queued' }];
      await (service as any).processBatchImmediately();
      expect(repo.create).not.toHaveBeenCalled();

      (service as any).processingBatch = false;
      (service as any).activityQueue = [];
      await (service as any).processBatchImmediately();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('does not retry ordinary events after a scheduled batch failure', async () => {
      await service.shutdown();
      vi.useFakeTimers();
      const scheduledRepo = makeMockRepo();
      const scheduledService = makeService(scheduledRepo);
      vi.mocked(scheduledRepo.create).mockRejectedValue(new Error('failed'));

      try {
        scheduledService.info('', 'Event without a classified type');
        await vi.advanceTimersByTimeAsync(2_000);
        expect(scheduledRepo.create).toHaveBeenCalledTimes(1);
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          expect.stringContaining('Retrying')
        );
      } finally {
        await scheduledService.shutdown();
        vi.useRealTimers();
      }
    });
  });

  describe('getUserActivities', () => {
    it('delegates to repo.findByUser', async () => {
      const activities = [makeActivity()];
      vi.mocked(repo.findByUser).mockResolvedValue(
        makePaginatedResult(activities)
      );

      const result = await service.getUserActivities('user-123', {
        page: 1,
        limit: 10,
      });

      expect(repo.findByUser).toHaveBeenCalledWith('user-123', {
        page: 1,
        limit: 10,
        sort: { timestamp: -1 },
      });
      expect(result.results).toEqual(activities);
      expect(result.totalResults).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('forwards a cursor with a stable compound default sort', async () => {
      const cursor = {
        timestamp: new Date('2026-08-05T12:00:00.000Z'),
        id: 'activity-3',
      };
      vi.mocked(repo.findByUser).mockResolvedValue(makePaginatedResult([]));

      await service.getUserActivities('user-123', {
        page: 1,
        limit: 10,
        cursor,
      });

      expect(repo.findByUser).toHaveBeenCalledWith(
        'user-123',
        {
          page: 1,
          limit: 10,
          sort: { timestamp: -1, id: -1 },
        },
        cursor
      );
    });

    it('logs and rethrows repository failures', async () => {
      vi.mocked(repo.findByUser).mockRejectedValue(new Error('failed'));
      await expect(service.getUserActivities('user-123')).rejects.toThrow(
        'failed'
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'error_getting_user_activities' })
      );
    });

    it('applies default pagination and sorting for zero-valued options', async () => {
      vi.mocked(repo.findByUser).mockResolvedValue(makePaginatedResult([]));
      await service.getUserActivities('user-123', {
        page: 0,
        limit: 0,
      });
      expect(repo.findByUser).toHaveBeenCalledWith('user-123', {
        page: 1,
        limit: 20,
        sort: { timestamp: -1 },
      });
    });
  });

  describe('queryActivities', () => {
    it('delegates to repo.findMany', async () => {
      const activities = [makeActivity(), makeActivity({ type: 'logout' })];
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult(activities)
      );

      const filter = { status: 'success' as const };
      const result = await service.queryActivities(filter, {
        page: 2,
        limit: 5,
      });

      expect(repo.findMany).toHaveBeenCalled();
      expect(result.results).toEqual(activities);
      expect(result.totalResults).toBe(2);
      expect(result.totalPages).toBe(1);
    });

    it('returns empty result on error', async () => {
      vi.mocked(repo.findMany).mockRejectedValue(new Error('DB error'));

      const result = await service.queryActivities({}, { page: 1, limit: 20 });

      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it('applies default pagination in success and failure results', async () => {
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce(makePaginatedResult([]))
        .mockRejectedValueOnce(new Error('failed'));

      await service.queryActivities({}, { page: 0, limit: 0 });
      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        {},
        { page: 1, limit: 20, sort: { timestamp: -1 } }
      );
      await expect(
        service.queryActivities({}, { page: 0, limit: 0 })
      ).resolves.toEqual({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 20,
      });
    });
  });

  describe('query helpers', () => {
    it('finds activities in an epoch-second time window', async () => {
      const activity = makeActivity();
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult([activity])
      );

      await expect(
        service.findActivitiesAroundTime('maria', 1_700_000_000, 60)
      ).resolves.toEqual([activity]);
      expect(repo.findMany).toHaveBeenCalledWith(
        {
          'actor.username': 'maria',
          timestamp: {
            $gte: new Date((1_700_000_000 - 60) * 1000),
            $lte: new Date((1_700_000_000 + 60) * 1000),
          },
        },
        { page: 1, limit: 100, sort: { timestamp: -1 } }
      );
    });

    it('returns no nearby activities when the repository fails', async () => {
      vi.mocked(repo.findMany).mockRejectedValue(new Error('query failed'));
      await expect(
        service.findActivitiesAroundTime('maria', 1_700_000_000)
      ).resolves.toEqual([]);
    });

    it.each([
      [Number.NaN, 60],
      [Number.POSITIVE_INFINITY, 60],
      [1_700_000_000, 0],
      [1_700_000_000, -1],
      [1_700_000_000, Number.NaN],
      [1_700_000_000, Number.POSITIVE_INFINITY],
    ])(
      'rejects an invalid activity time query (%s, %s) before repository access',
      async (targetTime, timeWindow) => {
        await expect(
          service.findActivitiesAroundTime('maria', targetTime, timeWindow)
        ).resolves.toEqual([]);
        expect(repo.findMany).not.toHaveBeenCalled();
      }
    );

    it('returns distinct user and global activity types', async () => {
      vi.mocked(repo.getDistinctTypes)
        .mockResolvedValueOnce(['login_success'])
        .mockResolvedValueOnce(['login_success', 'logout']);

      await expect(service.getUserActivityTypes('user-123')).resolves.toEqual([
        'login_success',
      ]);
      await expect(service.getActivityTypes()).resolves.toEqual([
        'login_success',
        'logout',
      ]);
      expect(repo.getDistinctTypes).toHaveBeenNthCalledWith(1, {
        related_user_id: 'user-123',
      });
      expect(repo.getDistinctTypes).toHaveBeenNthCalledWith(2);
    });

    it('returns empty type lists on repository failures', async () => {
      vi.mocked(repo.getDistinctTypes).mockRejectedValue(new Error('failed'));
      await expect(service.getUserActivityTypes('user-123')).resolves.toEqual(
        []
      );
      await expect(service.getActivityTypes()).resolves.toEqual([]);
    });

    it('marks zeroed stats unavailable when a count fails', async () => {
      vi.mocked(repo.count).mockRejectedValue(new Error('count failed'));
      await expect(service.getActivityStats()).resolves.toEqual({
        available: false,
        totalActivities: 0,
        uniqueUsers: 0,
        todayCount: 0,
        successfulLogins: 0,
        failedLogins: 0,
      });
    });
  });

  describe('last activity projections', () => {
    it('returns the latest timestamp by user id and username', async () => {
      const timestamp = new Date('2026-08-01T10:00:00.000Z');
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult([makeActivity({ timestamp })])
      );

      await expect(service.getLastActivityDateTime('u1')).resolves.toBe(
        timestamp
      );
      await expect(
        service.getLastActivityDateTime(undefined, 'maria')
      ).resolves.toBe(timestamp);
      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        { 'actor.user_id': 'u1' },
        { page: 1, limit: 1, sort: { timestamp: -1 } }
      );
      expect(repo.findMany).toHaveBeenNthCalledWith(
        2,
        { 'actor.username': 'maria' },
        { page: 1, limit: 1, sort: { timestamp: -1 } }
      );
    });

    it('returns null for missing identity, missing activity, and query failure', async () => {
      await expect(service.getLastActivityDateTime()).resolves.toBeNull();
      vi.mocked(repo.findMany).mockResolvedValueOnce(makePaginatedResult([]));
      await expect(service.getLastActivityDateTime('u1')).resolves.toBeNull();
      vi.mocked(repo.findMany).mockRejectedValueOnce(new Error('failed'));
      await expect(service.getLastActivityDateTime('u1')).resolves.toBeNull();
    });

    it('formats the latest timestamp and returns null when absent', async () => {
      const timestamp = new Date('2026-07-01T10:00:00.000Z');
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce(
          makePaginatedResult([makeActivity({ timestamp })])
        )
        .mockResolvedValueOnce(makePaginatedResult([]));

      await expect(
        service.getLastActivityDateTimeFormatted('u1', undefined, {
          language: 'en',
          serverTimezone: false,
          timezone: 'UTC',
        })
      ).resolves.toEqual(expect.any(String));
      await expect(
        service.getLastActivityDateTimeFormatted('u1')
      ).resolves.toBeNull();
    });

    it('returns raw and formatted latest activity information', async () => {
      const activity = makeActivity({
        timestamp: new Date('2026-07-01T10:00:00.000Z'),
        type: 'password_changed',
        description: 'Password changed',
      });
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult([activity])
      );

      await expect(service.getLastActivityInfo('u1')).resolves.toEqual({
        timestamp: activity.timestamp,
        type: 'password_changed',
        description: 'Password changed',
      });
      await expect(
        service.getLastActivityInfo(undefined, 'maria')
      ).resolves.toEqual(expect.objectContaining({ type: 'password_changed' }));
      await expect(
        service.getLastActivityInfoFormatted('u1', undefined, {
          language: 'en',
        })
      ).resolves.toEqual({
        timestamp: activity.timestamp,
        formattedTimestamp: expect.any(String),
        type: 'password_changed',
        description: 'Password changed',
        relativeTime: expect.any(String),
      });
    });

    it('returns null activity information for invalid, absent, and failed lookups', async () => {
      await expect(service.getLastActivityInfo()).resolves.toBeNull();
      vi.mocked(repo.findMany).mockResolvedValueOnce(makePaginatedResult([]));
      await expect(service.getLastActivityInfo('u1')).resolves.toBeNull();
      vi.mocked(repo.findMany).mockRejectedValueOnce(new Error('failed'));
      await expect(service.getLastActivityInfo('u1')).resolves.toBeNull();
      vi.mocked(repo.findMany).mockResolvedValueOnce(makePaginatedResult([]));
      await expect(
        service.getLastActivityInfoFormatted('u1')
      ).resolves.toBeNull();
    });

    it('contains failures raised by the formatted projection dependencies', async () => {
      vi.spyOn(service, 'getLastActivityDateTime').mockRejectedValueOnce(
        new Error('date projection failed')
      );
      await expect(
        service.getLastActivityDateTimeFormatted('u1')
      ).resolves.toBeNull();

      vi.spyOn(service, 'getLastActivityInfo').mockRejectedValueOnce(
        new Error('info projection failed')
      );
      await expect(
        service.getLastActivityInfoFormatted('u1')
      ).resolves.toBeNull();
    });

    it('uses safe fallbacks when relative and full formatting fail', () => {
      const date = new Date('2026-07-01T10:00:00.000Z');
      const throwingRelativeOptions = Object.defineProperty({}, 'language', {
        get: () => {
          throw new Error('language failed');
        },
      });
      expect(
        (service as any).getShortRelativeTimeHelper(
          date,
          throwingRelativeOptions
        )
      ).toBe('unknown');

      vi.spyOn(date, 'toLocaleDateString')
        .mockImplementationOnce(() => {
          throw new Error('primary fallback failed');
        })
        .mockReturnValue('safe fallback');
      expect(
        service.formatActivityDateTime(date, { language: 'invalid' as any })
      ).toBe('safe fallback');

      const frenchDate = new Date('2026-07-01T10:00:00.000Z');
      vi.spyOn(frenchDate, 'getFullYear').mockImplementation(() => {
        throw new Error('formatting failed');
      });
      vi.spyOn(frenchDate, 'toLocaleDateString')
        .mockImplementationOnce(() => {
          throw new Error('primary fallback failed');
        })
        .mockReturnValue('repli sûr');
      expect(
        service.formatActivityDateTime(frenchDate, {
          language: 'fr',
          serverTimezone: false,
        })
      ).toBe('repli sûr');
    });
  });

  describe('audit retention queries', () => {
    it('builds the default and fully filtered configuration audit queries', async () => {
      vi.mocked(repo.findMany).mockResolvedValue(makePaginatedResult([]));
      await service.findConfigAuditLogs();

      const startDate = new Date('2026-07-01T00:00:00.000Z');
      const endDate = new Date('2026-07-02T00:00:00.000Z');
      const expectedEndDate = new Date(endDate);
      expectedEndDate.setHours(23, 59, 59, 999);
      await service.findConfigAuditLogs(
        {
          action: 'update_config',
          username: 'admin',
          status: 'success',
          startDate,
          endDate,
        },
        { page: 2, limit: 10, sort: { timestamp: 1 } }
      );

      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        {
          type: [
            'update_config',
            'reveal_secret',
            'rollback_config',
            'test_email',
            'delete_audit_log',
          ],
        },
        { page: 1, limit: 20, sort: { timestamp: -1 } }
      );
      expect(repo.findMany).toHaveBeenNthCalledWith(
        2,
        {
          type: 'update_config',
          'actor.username': 'admin',
          status: 'success',
          timestamp: {
            $gte: startDate,
            $lte: expectedEndDate,
          },
        },
        { page: 2, limit: 10, sort: { timestamp: 1 } }
      );
    });

    it('finds records older than the computed cutoff and fails closed', async () => {
      const activity = makeActivity();
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce(makePaginatedResult([activity]))
        .mockRejectedValueOnce(new Error('failed'));

      await expect(service.findOlderThan(30)).resolves.toEqual([activity]);
      expect(repo.findMany).toHaveBeenCalledWith(
        { timestamp: { $lte: expect.any(Date) } },
        { page: 1, limit: 50000, sort: { timestamp: -1 } }
      );
      await expect(service.findOlderThan(30)).resolves.toEqual([]);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid non-destructive age query (%s) before repository access',
      async days => {
        await expect(service.findOlderThan(days)).resolves.toEqual([]);
        expect(repo.findMany).not.toHaveBeenCalled();
      }
    );

    it('rethrows repository failures while deleting old activities', async () => {
      vi.mocked(repo.deleteOlderThan).mockRejectedValue(new Error('failed'));
      await expect(service.deleteOldActivities()).rejects.toThrow('failed');
    });

    it('returns the configured pagination fallback if audit filter construction fails', async () => {
      const filters = Object.defineProperty({}, 'action', {
        get: () => {
          throw new Error('filter failed');
        },
      });
      await expect(
        service.findConfigAuditLogs(filters as any, {
          page: 0,
          limit: 0,
        })
      ).resolves.toEqual({
        results: [],
        totalResults: 0,
        totalPages: 0,
        page: 1,
        limit: 20,
      });
    });

    it('builds start-only and end-only audit date filters', async () => {
      vi.mocked(repo.findMany).mockResolvedValue(makePaginatedResult([]));
      const startDate = new Date('2026-07-01T00:00:00.000Z');
      const endDate = new Date('2026-07-02T00:00:00.000Z');
      const expectedEndDate = new Date(endDate);
      expectedEndDate.setHours(23, 59, 59, 999);

      await service.findConfigAuditLogs({ startDate });
      await service.findConfigAuditLogs({ endDate });

      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ timestamp: { $gte: startDate } }),
        expect.any(Object)
      );
      expect(repo.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ timestamp: { $lte: expectedEndDate } }),
        expect.any(Object)
      );
    });
  });

  describe('deleteOldActivities', () => {
    it('delegates to repo.deleteOlderThan with computed cutoff date', async () => {
      vi.mocked(repo.deleteOlderThan).mockResolvedValue(42);

      const result = await service.deleteOldActivities(30);

      expect(repo.deleteOlderThan).toHaveBeenCalledWith(expect.any(Date));
      expect(result.deletedCount).toBe(42);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid retention period (%s) before deleting',
      async olderThanDays => {
        await expect(
          service.deleteOldActivities(olderThanDays)
        ).rejects.toThrow(/positive integer/);
        expect(repo.deleteOlderThan).not.toHaveBeenCalled();
      }
    );
  });

  describe('getActivityStats', () => {
    it('delegates to repo.count for each stat', async () => {
      vi.mocked(repo.count).mockResolvedValue(10);
      (repo as any).getDistinctTypes = vi
        .fn()
        .mockResolvedValue(['login_success', 'logout']);

      const stats = await service.getActivityStats();

      expect(repo.count).toHaveBeenCalled();
      expect(stats).toMatchObject({
        available: true,
        totalActivities: expect.any(Number),
        todayCount: expect.any(Number),
        successfulLogins: expect.any(Number),
        failedLogins: expect.any(Number),
      });
    });
  });

  describe('deleteLog', () => {
    it('delegates findById and delete to repo', async () => {
      const oldActivity = makeActivity({
        timestamp: new Date('2020-01-01'), // clearly older than 90 days
      });
      vi.mocked(repo.findById).mockResolvedValue(oldActivity);
      vi.mocked(repo.delete).mockResolvedValue(undefined);

      const result = await service.deleteLog('act-123', 90);

      expect(repo.findById).toHaveBeenCalledWith('act-123');
      expect(repo.delete).toHaveBeenCalledWith('act-123');
      expect(result).toEqual(oldActivity);
    });

    it('returns null when activity not found', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const result = await service.deleteLog('nonexistent', 90);

      expect(result).toBeNull();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('throws when activity is too young', async () => {
      const youngActivity = makeActivity({ timestamp: new Date() });
      vi.mocked(repo.findById).mockResolvedValue(youngActivity);

      await expect(service.deleteLog('act-123', 90)).rejects.toThrow(
        /Cannot delete log/
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid minimum age (%s) before reading the log',
      async minAgeDays => {
        await expect(service.deleteLog('act-123', minAgeDays)).rejects.toThrow(
          /positive integer/
        );
        expect(repo.findById).not.toHaveBeenCalled();
      }
    );
  });

  describe('device history and trust', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid device-history limit (%s) without querying',
      async limit => {
        await expect(
          service.getDeviceHistoryForUser('user-123', limit)
        ).rejects.toThrow(/positive integer/);
        expect(repo.findMany).not.toHaveBeenCalled();
      }
    );

    it('recognizes a trusted device when its stored fingerprint is encrypted', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
      const encryptedFingerprint = encryptValue('device-fingerprint');
      const encryptedConfig = {
        getConfig: () => ({
          security: { protection: { encrypt_device_data: true } },
        }),
      } as any;
      const encryptedService = makeService(repo, encryptedConfig);

      try {
        vi.mocked(repo.findMany).mockImplementation(async filter => {
          if (filter['device_infos.fingerprint']) {
            return makePaginatedResult([]);
          }
          return makePaginatedResult([
            makeActivity({
              actor: { user_id: 'user-123', actor_type: 'user' },
              device_infos: {
                fingerprint: encryptedFingerprint,
                device_trust: {
                  trusted: true,
                  trusted_at: new Date('2026-07-01T00:00:00.000Z'),
                  trusted_until: new Date('2099-01-01T00:00:00.000Z'),
                  fingerprint: 'device-fingerprint',
                },
              },
            }),
          ]);
        });

        await expect(
          encryptedService.isTrustedDevice('user-123', 'device-fingerprint')
        ).resolves.toBe(true);
        expect(repo.findMany).toHaveBeenCalledWith(
          {
            'actor.user_id': 'user-123',
            type: 'new_device_verified',
            status: 'success',
          },
          { page: 1, limit: 50, sort: { timestamp: -1 } }
        );
      } finally {
        await encryptedService.shutdown();
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('encrypts all sensitive device fields before persisting an activity', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'b'.repeat(64);
      const encryptedConfig = {
        getConfig: () => ({
          security: { protection: { encrypt_device_data: true } },
        }),
      } as any;
      const encryptedService = makeService(repo, encryptedConfig);

      try {
        encryptedService.success(
          'login_success',
          'Signed in',
          { id: 'u1' },
          {
            device_infos: {
              fingerprint: 'device-fingerprint',
              fingerprint_js_id: 'fingerprint-js',
              geo_location: { country: 'BJ', city: 'Cotonou' },
              device_trust: {
                trusted: true,
                trusted_at: new Date('2026-07-01T00:00:00.000Z'),
                trusted_until: new Date('2099-01-01T00:00:00.000Z'),
                fingerprint: 'device-fingerprint',
              },
            },
          }
        );
        await encryptedService.shutdown();

        const persisted = vi.mocked(repo.create).mock.calls[0]?.[0] as any;
        expect(isEncrypted(persisted.device_infos.fingerprint)).toBe(true);
        expect(isEncrypted(persisted.device_infos.fingerprint_js_id)).toBe(
          true
        );
        expect(
          isEncrypted(persisted.device_infos.device_trust.fingerprint)
        ).toBe(true);
        expect(isEncrypted(persisted.device_infos._encryptedGeoLocation)).toBe(
          true
        );
        expect(persisted.device_infos.geo_location).toBeUndefined();
      } finally {
        await encryptedService.shutdown();
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('keeps already encrypted fields idempotent and tolerates missing protection config', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'd'.repeat(64);
      const encrypted = encryptValue('already-encrypted');
      const encryptionService = makeService(repo, {
        getConfig: () => ({
          security: { protection: { encrypt_device_data: true } },
        }),
      } as any);
      const noProtectionService = makeService(repo, {
        getConfig: () => ({}),
      } as any);

      try {
        expect(
          (encryptionService as any).encryptSensitiveDeviceFields({
            fingerprint: encrypted,
            fingerprint_js_id: encrypted,
            device_trust: { fingerprint: encrypted },
            geo_location: 'not-an-object',
          })
        ).toEqual({
          fingerprint: encrypted,
          fingerprint_js_id: encrypted,
          device_trust: { fingerprint: encrypted },
          geo_location: 'not-an-object',
        });
        expect(
          (encryptionService as any).encryptSensitiveDeviceFields({
            fingerprint: 'without-trust-metadata',
          })
        ).toEqual({ fingerprint: expect.stringMatching(/^ENCRYPTED:/) });
        expect(
          (noProtectionService as any).encryptSensitiveDeviceFields({
            fingerprint: 'plain',
          })
        ).toEqual({ fingerprint: 'plain' });
      } finally {
        await encryptionService.shutdown();
        await noProtectionService.shutdown();
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('omits sensitive device data instead of persisting plaintext when encryption fails', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      const encryptedConfig = {
        getConfig: () => ({
          security: { protection: { encrypt_device_data: true } },
        }),
      } as any;
      const encryptedService = makeService(repo, encryptedConfig);

      try {
        encryptedService.success(
          'login_success',
          'Signed in',
          { id: 'u1' },
          {
            device_infos: { fingerprint: 'must-not-leak' },
          }
        );
        await encryptedService.shutdown();

        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ device_infos: undefined })
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            context: 'error_encrypting_device_fields',
          })
        );
      } finally {
        await encryptedService.shutdown();
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('does not expose malformed encrypted fingerprints in device history', async () => {
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult([
          makeActivity({
            device_infos: {
              fingerprint: 'ENCRYPTED:v1:malformed',
            },
          }),
        ])
      );

      await expect(
        service.getDeviceHistoryForUser('user-123')
      ).resolves.toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'error_decrypting_device_fields' })
      );
    });

    it('returns decrypted, unique, limited device history with all client details', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'c'.repeat(64);
      const fingerprint = encryptValue('device-one');
      const fingerprintJs = encryptValue('js-one');
      const encryptedGeo = encryptValue(
        JSON.stringify({ country: 'BJ', city: 'Cotonou' })
      );
      const activities = [
        makeActivity({
          ip_address: '',
          user_agent: '',
          device_infos: {
            fingerprint,
            fingerprint_js_id: fingerprintJs,
            platform: 'Linux',
            browser: { name: 'Chromium', version: '151' },
            os: { name: 'Linux', version: '6' },
            device: { type: 'desktop', vendor: 'Generic', model: 'PC' },
            language: 'en',
            timezone_guess: 'Africa/Porto-Novo',
            device_trust: {
              trusted: true,
              trusted_at: new Date('2026-07-01T00:00:00.000Z'),
              trusted_until: new Date('2099-01-01T00:00:00.000Z'),
              fingerprint,
            },
            _encryptedGeoLocation: encryptedGeo,
          } as any,
        }),
        makeActivity({
          ip_address: 'duplicate',
          device_infos: { fingerprint },
        }),
        makeActivity({
          ip_address: 'second',
          user_agent: 'Agent',
          device_infos: { fingerprint: 'device-two' },
        }),
      ];
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult(activities)
      );

      try {
        await expect(
          service.getDeviceHistoryForUser('user-123', 1)
        ).resolves.toEqual([
          {
            ip: 'unknown',
            user_agent: 'Linux',
            browser: { name: 'Chromium', version: '151' },
            os: { name: 'Linux', version: '6' },
            device: { type: 'desktop', vendor: 'Generic', model: 'PC' },
            language: 'en',
            timezone_guess: 'Africa/Porto-Novo',
            fingerprint: 'device-one',
            fingerprint_js_id: 'js-one',
          },
        ]);
        expect(repo.findMany).toHaveBeenCalledWith(
          {
            'actor.user_id': 'user-123',
            type: [
              'login_success',
              'oidc.login.success',
              'social_login_success',
            ],
            status: 'success',
          },
          { page: 1, limit: 3, sort: { timestamp: -1 } }
        );
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('deduplicates device history and returns an empty list for absent or failed records', async () => {
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce(
          makePaginatedResult([
            makeActivity({ device_infos: undefined }),
            makeActivity({ device_infos: { fingerprint: '' } }),
          ])
        )
        .mockRejectedValueOnce(new Error('history failed'));

      await expect(
        service.getDeviceHistoryForUser('user-123')
      ).resolves.toEqual([]);
      await expect(
        service.getDeviceHistoryForUser('user-123')
      ).resolves.toEqual([]);
    });

    it('deduplicates repeated fingerprints and selects explicit or fallback user agents', async () => {
      vi.mocked(repo.findMany).mockResolvedValue(
        makePaginatedResult([
          makeActivity({
            ip_address: 'one',
            user_agent: 'Explicit Agent',
            device_infos: { fingerprint: 'same' },
          }),
          makeActivity({
            ip_address: 'duplicate',
            user_agent: 'Ignored',
            device_infos: { fingerprint: 'same' },
          }),
          makeActivity({
            ip_address: 'two',
            user_agent: '',
            device_infos: { fingerprint: 'other' },
          }),
        ])
      );

      await expect(
        service.getDeviceHistoryForUser('user-123', 3)
      ).resolves.toEqual([
        expect.objectContaining({
          fingerprint: 'same',
          user_agent: 'Explicit Agent',
        }),
        expect.objectContaining({
          fingerprint: 'other',
          user_agent: 'Unknown',
        }),
      ]);
    });

    it('rejects blank, mismatched, expired, malformed, and failed trust records', async () => {
      await expect(service.isTrustedDevice('user-123', '')).resolves.toBe(
        false
      );
      expect(repo.findMany).not.toHaveBeenCalled();

      vi.mocked(repo.findMany).mockResolvedValueOnce(
        makePaginatedResult([
          makeActivity({
            device_infos: {
              fingerprint: 'other-device',
              device_trust: {
                trusted: true,
                trusted_at: new Date('2026-01-01T00:00:00.000Z'),
                trusted_until: new Date('2099-01-01T00:00:00.000Z'),
                fingerprint: 'other-device',
              },
            },
          }),
          makeActivity({
            device_infos: {
              fingerprint: 'device-fingerprint',
              device_trust: {
                trusted: true,
                trusted_at: new Date('2025-01-01T00:00:00.000Z'),
                trusted_until: new Date('2025-02-01T00:00:00.000Z'),
                fingerprint: 'device-fingerprint',
              },
            },
          }),
          makeActivity({ device_infos: undefined }),
        ])
      );
      await expect(
        service.isTrustedDevice('user-123', 'device-fingerprint')
      ).resolves.toBe(false);

      vi.mocked(repo.findMany).mockRejectedValueOnce(new Error('trust failed'));
      await expect(
        service.isTrustedDevice('user-123', 'device-fingerprint')
      ).resolves.toBe(false);
    });
  });
});
