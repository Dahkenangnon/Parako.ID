import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSettingsModel } from '../../../../src/models/settings.model.js';
import { MongooseSettingsRepository } from '../../../../src/db/repositories/mongoose/settings.repository.js';
import { DEFAULT_FULL_CONFIG } from '../../../../src/config/constants.js';

let mongod: MongoMemoryServer | undefined;
let repo: MongooseSettingsRepository;
let mongoAvailable = true;

// Use the canonical default config — guaranteed to pass schema validation.
// Overrides are merged shallowly at the top level only; don't pass nested partials.
const makeValue = () => ({ ...DEFAULT_FULL_CONFIG }) as any;

beforeAll(async () => {
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const SettingsModel = createSettingsModel();
    repo = new MongooseSettingsRepository(SettingsModel);
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
  await mongoose.connection.collection('settings').deleteMany({});
});

describe('MongooseSettingsRepository', () => {
  describe('save + findActive', () => {
    it('creates first version and marks it active', async () => {
      const saved = await repo.save('parako_config', makeValue());
      expect(saved.is_active).toBe(true);
      expect(saved.key).toBe('parako_config');
      expect(saved._version).toBe(0);

      const active = await repo.findActive('parako_config');
      expect(active).not.toBeNull();
      expect(active!.id).toBe(saved.id);
    });

    it('deactivates previous version on second save', async () => {
      const first = await repo.save('parako_config', makeValue());
      const second = await repo.save('parako_config', makeValue());

      expect(second.is_active).toBe(true);
      expect(second._version).toBe(1);

      // Reload first to check it's now inactive
      const firstReloaded = await repo.findById(first.id!);
      expect(firstReloaded!.is_active).toBe(false);

      // Only one active record
      const active = await repo.findActive('parako_config');
      expect(active!.id).toBe(second.id);
    });
  });

  describe('findVersion', () => {
    it('finds a specific semver version', async () => {
      const s = await repo.save('parako_config', makeValue());
      const found = await repo.findVersion('parako_config', s.version);
      expect(found).not.toBeNull();
      expect(found!.version).toBe(s.version);
    });
  });

  describe('findHistory', () => {
    it('returns all versions newest first', async () => {
      await repo.save('parako_config', makeValue());
      await repo.save('parako_config', makeValue());
      await repo.save('parako_config', makeValue());

      const history = await repo.findHistory('parako_config');
      expect(history.length).toBe(3);
      // newest _version first
      expect(history[0]._version).toBeGreaterThan(history[1]._version);
    });
  });

  describe('getLatestVersion', () => {
    it('returns highest semver seen', async () => {
      await repo.save('parako_config', makeValue());
      await repo.save('parako_config', makeValue());
      const latest = await repo.getLatestVersion('parako_config');
      expect(latest).toBeTruthy();
      // Latest version after two saves should reflect incremented patch
      expect(latest).toBe('1.0.1');
    });

    it('returns null when no settings exist for key', async () => {
      const latest = await repo.getLatestVersion('nonexistent_key');
      expect(latest).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns settings by id', async () => {
      const s = await repo.save('parako_config', makeValue());
      const found = await repo.findById(s.id!);
      expect(found).not.toBeNull();
      expect(found!.key).toBe('parako_config');
    });
  });

  describe('save — rollback scenario', () => {
    it('new version is always active even when value contains isActive: false', async () => {
      // Simulate two saves so version 1 is deactivated
      await repo.save('parako_config', makeValue());
      const v2 = await repo.save('parako_config', makeValue());
      expect(v2.is_active).toBe(true);

      // Fetch v1 from history — it has isActive: false
      const history = await repo.findHistory('parako_config');
      const v1 = history.find(h => h._version === 0)!;
      expect(v1.is_active).toBe(false);

      // Rollback: save with the old (inactive) document as the value
      const rollback = await repo.save('parako_config', v1 as any);

      // The new row MUST be active regardless of isActive in the passed value
      expect(rollback.is_active).toBe(true);
      const active = await repo.findActive('parako_config');
      expect(active).not.toBeNull();
      expect(active!.id).toBe(rollback.id);
    });
  });
});
