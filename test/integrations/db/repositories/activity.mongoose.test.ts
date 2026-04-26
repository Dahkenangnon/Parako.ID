import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createActivityModel } from '../../../../src/models/activity.model.js';
import { MongooseActivityRepository } from '../../../../src/db/repositories/mongoose/activity.repository.js';

// ─── Shared state ─────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer | undefined;
let repo: MongooseActivityRepository;
let mongoAvailable = true;

const makeActivity = (overrides: Record<string, unknown> = {}) => ({
  type: 'test.action',
  description: 'A test activity',
  status: 'success' as const,
  ip_address: '127.0.0.1',
  timestamp: new Date(),
  ...overrides,
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const ActivityModel = createActivityModel();
    repo = new MongooseActivityRepository(ActivityModel);
  } catch {
    mongoAvailable = false;
  }
}, 60_000);

afterAll(async () => {
  if (mongod) {
    await mongoose.disconnect();
    await mongod.stop();
  }
});

beforeEach(async ctx => {
  if (!mongoAvailable) {
    ctx.skip();
    return;
  }
  await mongoose.connection.collection('activities').deleteMany({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MongooseActivityRepository', () => {
  describe('create + findById', () => {
    it('creates an activity and retrieves it by id', async () => {
      const created = await repo.create(makeActivity());
      expect(created.id).toBeTruthy();
      const found = await repo.findById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.type).toBe('test.action');
      expect(found!.status).toBe('success');
    });

    it('returns null for an unknown id', async () => {
      const result = await repo.findById('000000000000000000000000');
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    it('returns paginated results matching a type filter', async () => {
      await repo.create(makeActivity({ type: 'user.login' }));
      await repo.create(makeActivity({ type: 'user.login' }));
      await repo.create(makeActivity({ type: 'user.logout' }));

      const result = await repo.findMany({ type: 'user.login' });

      expect(result.totalResults).toBe(2);
      expect(result.results).toHaveLength(2);
      result.results.forEach(a => expect(a.type).toBe('user.login'));
    });

    it('returns all when filter is empty', async () => {
      await repo.create(makeActivity());
      await repo.create(makeActivity());
      const result = await repo.findMany({});
      expect(result.totalResults).toBe(2);
    });

    it('respects limit in pagination options', async () => {
      await repo.create(makeActivity());
      await repo.create(makeActivity());
      await repo.create(makeActivity());

      const result = await repo.findMany({}, { page: 1, limit: 2 });

      expect(result.results).toHaveLength(2);
      expect(result.totalResults).toBe(3);
      expect(result.totalPages).toBe(2);
    });
  });

  describe('findByUser', () => {
    it('returns activities belonging to a specific user', async () => {
      // actor.user_id is stored as ObjectId in the schema — must be a valid hex id
      const userId = new Types.ObjectId().toHexString();
      const actor = {
        user_id: userId,
        actor_type: 'user',
        username: 'alice',
        email: 'alice@example.com',
        full_name: 'Alice',
      };
      await repo.create(makeActivity({ actor }));
      await repo.create(makeActivity({ actor }));
      await repo.create(makeActivity()); // no actor

      const result = await repo.findByUser(userId);

      expect(result.results).toHaveLength(2);
    });

    it('returns empty when user has no activities', async () => {
      await repo.create(makeActivity());
      const noUserId = new Types.ObjectId().toHexString();
      const result = await repo.findByUser(noUserId);
      expect(result.results).toHaveLength(0);
      expect(result.totalResults).toBe(0);
    });
  });

  describe('count', () => {
    it('counts all activities when no filter is given', async () => {
      await repo.create(makeActivity());
      await repo.create(makeActivity());
      expect(await repo.count()).toBe(2);
    });

    it('counts activities matching a status filter', async () => {
      await repo.create(makeActivity({ status: 'success' }));
      await repo.create(makeActivity({ status: 'failed' }));
      await repo.create(makeActivity({ status: 'failed' }));
      expect(await repo.count({ status: 'failed' })).toBe(2);
    });
  });

  describe('deleteOlderThan', () => {
    it('deletes activities with timestamp before the cutoff date', async () => {
      const cutoff = new Date('2023-01-01');
      await repo.create(makeActivity({ timestamp: new Date('2022-06-15') }));
      await repo.create(makeActivity({ timestamp: new Date('2022-12-31') }));
      await repo.create(makeActivity({ timestamp: new Date('2023-06-01') }));

      const deleted = await repo.deleteOlderThan(cutoff);

      expect(deleted).toBe(2);
      expect(await repo.count()).toBe(1);
    });

    it('returns 0 when nothing matches', async () => {
      await repo.create(makeActivity({ timestamp: new Date('2030-01-01') }));
      const deleted = await repo.deleteOlderThan(new Date('2000-01-01'));
      expect(deleted).toBe(0);
    });
  });

  describe('getDistinctTypes', () => {
    it('returns distinct type strings across all activities', async () => {
      await repo.create(makeActivity({ type: 'user.login' }));
      await repo.create(makeActivity({ type: 'user.login' }));
      await repo.create(makeActivity({ type: 'user.logout' }));
      await repo.create(makeActivity({ type: 'settings.change' }));

      const types = await repo.getDistinctTypes();

      expect(types).toContain('user.login');
      expect(types).toContain('user.logout');
      expect(types).toContain('settings.change');
      expect(types).toHaveLength(3);
    });

    it('respects a status filter', async () => {
      await repo.create(makeActivity({ type: 'login', status: 'success' }));
      await repo.create(makeActivity({ type: 'login', status: 'failed' }));
      await repo.create(makeActivity({ type: 'logout', status: 'failed' }));

      const types = await repo.getDistinctTypes({ status: 'failed' });

      expect(types).toContain('login');
      expect(types).toContain('logout');
    });
  });
});
