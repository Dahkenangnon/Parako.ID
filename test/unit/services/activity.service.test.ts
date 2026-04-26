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

// ── Stubs ─────────────────────────────────────────────────────────────────────

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

// ── Mock IActivityRepository ──────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeService(repo: IActivityRepository): ActivityService {
  return new ActivityService(mockLogger, repo as any, mockConfigManager);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

  // ── getUserActivities ────────────────────────────────────────────────────────

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
  });

  // ── queryActivities ──────────────────────────────────────────────────────────

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
  });

  // ── deleteOldActivities ──────────────────────────────────────────────────────

  describe('deleteOldActivities', () => {
    it('delegates to repo.deleteOlderThan with computed cutoff date', async () => {
      vi.mocked(repo.deleteOlderThan).mockResolvedValue(42);

      const result = await service.deleteOldActivities(30);

      expect(repo.deleteOlderThan).toHaveBeenCalledWith(expect.any(Date));
      expect(result.deletedCount).toBe(42);
    });
  });

  // ── getActivityStats ─────────────────────────────────────────────────────────

  describe('getActivityStats', () => {
    it('delegates to repo.count for each stat', async () => {
      vi.mocked(repo.count).mockResolvedValue(10);
      (repo as any).getDistinctTypes = vi
        .fn()
        .mockResolvedValue(['login_success', 'logout']);

      const stats = await service.getActivityStats();

      expect(repo.count).toHaveBeenCalled();
      expect(stats).toMatchObject({
        totalActivities: expect.any(Number),
        todayCount: expect.any(Number),
        successfulLogins: expect.any(Number),
        failedLogins: expect.any(Number),
      });
    });
  });

  // ── deleteLog ────────────────────────────────────────────────────────────────

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
  });
});
