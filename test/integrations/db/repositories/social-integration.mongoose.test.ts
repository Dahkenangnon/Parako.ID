import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSocialIntegrationModel } from '../../../../src/models/social-integration.model.js';
import { MongooseSocialIntegrationRepository } from '../../../../src/db/repositories/mongoose/social-integration.repository.js';

// ─── Shared state ─────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer | undefined;
let repo: MongooseSocialIntegrationRepository;
let counter = 0;
let mongoAvailable = true;

// unique provider_sub per call; also unique user_id+method combo avoids index conflicts
const makeIntegration = (overrides: Record<string, unknown> = {}) => {
  const sub = `sub-${Date.now()}-${counter++}`;
  return {
    user_id: `user-${Date.now()}-${counter}`,
    method: 'google' as const,
    provider_sub: sub,
    provider_data: { sub },
    is_active: true,
    last_used: new Date(),
    ...overrides,
  };
};

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const SocialIntegrationModel = createSocialIntegrationModel();
    repo = new MongooseSocialIntegrationRepository(SocialIntegrationModel);
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
  await mongoose.connection.collection('socialintegrations').deleteMany({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MongooseSocialIntegrationRepository', () => {
  describe('create + findById', () => {
    it('creates an integration and retrieves it by id', async () => {
      const created = await repo.create(makeIntegration() as any);
      expect(created.id).toBeTruthy();
      const found = await repo.findById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.method).toBe('google');
    });

    it('returns null for an unknown id', async () => {
      const result = await repo.findById('000000000000000000000000');
      expect(result).toBeNull();
    });
  });

  describe('findOne', () => {
    it('finds an integration by filter', async () => {
      const data = makeIntegration({ user_id: 'u1', method: 'github' });
      await repo.create(data as any);

      const found = await repo.findOne({ user_id: 'u1', method: 'github' });

      expect(found).not.toBeNull();
      expect(found!.method).toBe('github');
    });

    it('returns null when filter does not match', async () => {
      const result = await repo.findOne({ user_id: 'nobody' });
      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('returns paginated integrations for a user', async () => {
      const userId = 'user-findbyid';
      await repo.create(
        makeIntegration({ user_id: userId, method: 'google' }) as any
      );
      await repo.create(
        makeIntegration({ user_id: userId, method: 'github' }) as any
      );
      await repo.create(makeIntegration()); // different user

      const result = await repo.findByUserId(userId);

      expect(result.totalResults).toBe(2);
      result.results.forEach(i => expect(i.user_id).toBe(userId));
    });
  });

  describe('findByUserAndProvider', () => {
    it('finds the integration for a given user and method', async () => {
      const userId = 'user-fbyp';
      await repo.create(
        makeIntegration({ user_id: userId, method: 'google' }) as any
      );

      const found = await repo.findByUserAndProvider(userId, 'google');

      expect(found).not.toBeNull();
      expect(found!.user_id).toBe(userId);
      expect(found!.method).toBe('google');
    });

    it('returns null when method does not match', async () => {
      const userId = 'user-fbyp2';
      await repo.create(
        makeIntegration({ user_id: userId, method: 'github' }) as any
      );

      const result = await repo.findByUserAndProvider(userId, 'google');

      expect(result).toBeNull();
    });
  });

  describe('findByProvider', () => {
    it('returns all integrations for a given method', async () => {
      await repo.create(makeIntegration({ method: 'google' }) as any);
      await repo.create(makeIntegration({ method: 'google' }) as any);
      await repo.create(makeIntegration({ method: 'github' }) as any);

      const results = await repo.findByProvider('google');

      expect(results).toHaveLength(2);
      results.forEach(i => expect(i.method).toBe('google'));
    });

    it('returns empty array when no integrations match', async () => {
      await repo.create(makeIntegration({ method: 'google' }) as any);
      const results = await repo.findByProvider('github');
      expect(results).toHaveLength(0);
    });
  });

  describe('deleteByUserId', () => {
    it('deletes all integrations for a user and returns the count', async () => {
      const userId = 'user-del';
      await repo.create(
        makeIntegration({ user_id: userId, method: 'google' }) as any
      );
      await repo.create(
        makeIntegration({ user_id: userId, method: 'github' }) as any
      );
      await repo.create(makeIntegration()); // different user

      const deleted = await repo.deleteByUserId(userId);

      expect(deleted).toBe(2);
      expect(await repo.count({ user_id: userId })).toBe(0);
    });

    it('returns 0 when user has no integrations', async () => {
      const deleted = await repo.deleteByUserId('nobody');
      expect(deleted).toBe(0);
    });
  });

  describe('count', () => {
    it('counts all integrations', async () => {
      await repo.create(makeIntegration() as any);
      await repo.create(makeIntegration() as any);
      expect(await repo.count()).toBe(2);
    });

    it('counts with a filter', async () => {
      await repo.create(makeIntegration({ is_active: true }) as any);
      await repo.create(makeIntegration({ is_active: false }) as any);
      expect(await repo.count({ is_active: false })).toBe(1);
    });
  });

  describe('update', () => {
    it('updates integration fields', async () => {
      const created = await repo.create(
        makeIntegration({ is_active: true }) as any
      );
      const updated = await repo.update(created.id!, {
        is_active: false,
      } as any);
      expect(updated.is_active).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes the integration', async () => {
      const created = await repo.create(makeIntegration() as any);
      await repo.delete(created.id!);
      const found = await repo.findById(created.id!);
      expect(found).toBeNull();
    });
  });
});
